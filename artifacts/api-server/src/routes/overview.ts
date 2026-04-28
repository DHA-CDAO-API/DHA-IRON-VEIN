import { Router, type IRouter } from "express";
import {
  db,
  alerts as alertsTable,
  activityEntries,
  appSettings,
  bloodLots,
  coldChainAssets,
  dosSnapshots,
  inventoryBalances,
  items as itemsTable,
  nodes as nodesTable,
  routes as routesTable,
  shipments as shipmentsTable,
  temperatureEvents,
} from "@workspace/db";
import { and, asc, desc, eq, gte, lt, inArray } from "drizzle-orm";
import {
  completeChat,
  resolveModel,
  type AIProvider,
} from "@workspace/ai-orchestrator";
import { computeDailyDemand, projectDaysOfSupply, runScenario } from "@workspace/sim";
import { computeRiskByNode, computeInFlightShipments } from "../lib/snapshot";
import { loadSimContext } from "../lib/ctx";
import {
  TESTING_SUPPLY_ITEMS,
  computeNodeBloodReadiness,
  computeTheaterBloodReadiness,
} from "../lib/blood-readiness";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Tier = "NOMINAL" | "WATCH" | "CRITICAL";

function tierFromDOS(dos: number, watchDays: number, criticalDays: number): Tier {
  if (!Number.isFinite(dos)) return "NOMINAL";
  if (dos <= criticalDays) return "CRITICAL";
  if (dos <= watchDays) return "WATCH";
  return "NOMINAL";
}

function maxTier(a: Tier, b: Tier): Tier {
  const order: Record<Tier, number> = { NOMINAL: 0, WATCH: 1, CRITICAL: 2 };
  return order[a] >= order[b] ? a : b;
}

function severityToTier(severity: string): Tier {
  const s = severity.toUpperCase();
  if (s === "CRITICAL" || s === "FAILED") return "CRITICAL";
  if (s === "WARN" || s === "WARNING" || s === "EXCURSION") return "WATCH";
  return "NOMINAL";
}

// Per-node DOS snapshots are persisted to the `dos_snapshots` table so the
// leaderboard's delta-vs-24h survives restarts and reflects a real time
// series (rather than the in-memory placeholder we used to ship).
//
// On each leaderboard build we:
//   1) load the most recent snapshot per node from the lookback window,
//      preferring rows ~24h old (or as close as available),
//   2) write a fresh snapshot with the current DOS,
//   3) prune snapshots older than the retention window so the table
//      doesn't grow without bound.
const DOS_SNAPSHOT_LOOKBACK_MS = 30 * 60 * 60 * 1000; // 30h
const DOS_SNAPSHOT_TARGET_MS = 24 * 60 * 60 * 1000; // 24h
const DOS_SNAPSHOT_MIN_AGE_MS = 6 * 60 * 60 * 1000; // 6h
const DOS_SNAPSHOT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7d

type DosBaseline = { recordedAtMs: number; dos: number };

async function loadDosBaselines(
  nodeIds: string[],
): Promise<Map<string, DosBaseline>> {
  if (nodeIds.length === 0) return new Map();
  const since = new Date(Date.now() - DOS_SNAPSHOT_LOOKBACK_MS);
  const rows = await db
    .select()
    .from(dosSnapshots)
    .where(
      and(
        inArray(dosSnapshots.nodeId, nodeIds),
        gte(dosSnapshots.recordedAt, since),
      ),
    );
  // Pick, per node, the snapshot whose age is closest to ~24h. Snapshots
  // newer than the min-age window are skipped — a "vs 24h" delta computed
  // against a row taken minutes ago would be misleading.
  const now = Date.now();
  const best = new Map<string, { delta: number; baseline: DosBaseline }>();
  for (const r of rows) {
    const age = now - r.recordedAt.getTime();
    if (age < DOS_SNAPSHOT_MIN_AGE_MS) continue;
    const delta = Math.abs(age - DOS_SNAPSHOT_TARGET_MS);
    const cur = best.get(r.nodeId);
    if (!cur || delta < cur.delta) {
      best.set(r.nodeId, {
        delta,
        baseline: { recordedAtMs: r.recordedAt.getTime(), dos: r.viableDaysOfSupply },
      });
    }
  }
  const out = new Map<string, DosBaseline>();
  for (const [k, v] of best.entries()) out.set(k, v.baseline);
  return out;
}

async function recordDosSnapshots(
  samples: Array<{ nodeId: string; dos: number }>,
): Promise<void> {
  if (samples.length === 0) return;
  await db.insert(dosSnapshots).values(
    samples.map((s) => ({
      nodeId: s.nodeId,
      // Clamp the sentinel "≥999" supply to avoid storing meaningless extremes.
      viableDaysOfSupply: Number.isFinite(s.dos)
        ? Math.min(999, Math.max(0, s.dos))
        : 0,
    })),
  );
  // Best-effort retention prune. Failure here shouldn't break the request.
  try {
    const cutoff = new Date(Date.now() - DOS_SNAPSHOT_RETENTION_MS);
    await db.delete(dosSnapshots).where(lt(dosSnapshots.recordedAt, cutoff));
  } catch {
    // ignore prune errors
  }
}

// ---------------------------------------------------------------------------
// 1. /api/overview/cascade — Top single-point-of-failure cascade scenarios
// ---------------------------------------------------------------------------

router.get("/overview/cascade", async (_req, res, next) => {
  try {
    const [{ ctx }, allAssets, allLots, riskRes, nodeRows, routeRows] = await Promise.all([
      loadSimContext(),
      db.select().from(coldChainAssets),
      db.select().from(bloodLots),
      computeRiskByNode(),
      db.select().from(nodesTable),
      db.select().from(routesTable),
    ]);
    const generatedAt = new Date().toISOString();
    const nodeNameMap = new Map(nodeRows.map((n) => [n.id, n.name]));
    const riskByNode = new Map(riskRes.riskByNode.map((r) => [r.nodeId, r]));

    // Build downstream-spoke map: which nodes treat each hub as their parent.
    const spokesByHub = new Map<string, string[]>();
    for (const n of nodeRows) {
      const parent = n.upstreamNode ?? n.regionalHub;
      if (!parent) continue;
      const arr = spokesByHub.get(parent) ?? [];
      arr.push(n.id);
      spokesByHub.set(parent, arr);
    }

    type AffectedSpoke = {
      nodeId: string;
      nodeName: string;
      currentDaysOfSupply: number;
      projectedDaysOfSupply: number;
      tier: Tier;
    };
    type Confidence = "HIGH" | "MEDIUM" | "LOW";
    type CascadeScenario = {
      id: string;
      triggerType: "hub_loss" | "generator_failure" | "route_interdiction";
      triggerNodeId: string;
      triggerNodeName: string;
      triggerLabel: string;
      severity: Tier;
      confidence: Confidence;
      affectedSiteCount: number;
      affectedSiteIds: string[];
      affectedSpokes: AffectedSpoke[];
      projectedDosImpact: number;
      leadTimeImpactHours: number;
      narrative: string;
    };
    const scenarios: CascadeScenario[] = [];

    // (a) Hub-loss cascades — if a hub or theater goes dark, every spoke
    // falls back to its viable on-hand stock only.  We drive the projected
    // DOS for each spoke through the shared scenario engine so the impact
    // accounts for per-item burn rates, criticality thresholds, and the
    // operational-state demand model rather than a flat
    // (current_dos − route_days) heuristic.
    for (const [hubId, spokes] of spokesByHub.entries()) {
      if (spokes.length < 2) continue;
      const hub = nodeRows.find((n) => n.id === hubId);
      if (!hub) continue;
      const downstreamRoutes = routeRows.filter(
        (r) => r.fromNode === hubId && spokes.includes(r.toNode),
      );
      const avgRouteDays = downstreamRoutes.length > 0
        ? downstreamRoutes.reduce((s, r) => s + r.days, 0) / downstreamRoutes.length
        : 2;

      // Run the scenario engine against the spoke set: hub loss models as a
      // lost upstream (route delay equal to the lost transit + reliability
      // collapse). We give the simulation enough horizon to actually exhaust
      // organic stock so the projected DOS is meaningful.
      const horizon = Math.max(
        7,
        Math.min(30, Math.round(avgRouteDays * 2 + ctx.watchDays)),
      );
      const outcome = runScenario(ctx, {
        horizonDays: horizon,
        perturbation: {
          affectedNodes: spokes,
          routeDelayDays: avgRouteDays,
          routeReliabilityDelta: -0.5,
          // Operational tempo typically rises during a hub outage as the
          // theater redistributes load — model a mild encounter uplift.
          encounterMultiplier: 1.1,
        },
      });
      // Walk the scenario time-series directly so EVERY spoke gets an
      // engine-projected min DOS, not just the top-12 / high-delta nodes
      // surfaced via `outcome.impactedNodes`. This avoids any silent
      // fallback to heuristics for spokes the engine considered
      // less-impacted.
      const minDosBySpoke = new Map<string, number>();
      for (const step of outcome.steps) {
        for (const [nodeId, dos] of Object.entries(step.dosByNode)) {
          if (!Number.isFinite(dos)) continue;
          const cur = minDosBySpoke.get(nodeId);
          if (cur === undefined || dos < cur) minDosBySpoke.set(nodeId, dos);
        }
      }

      let dosSum = 0;
      let baselineDosSum = 0;
      let worst: Tier = "NOMINAL";
      const affectedSpokes: AffectedSpoke[] = [];
      let scoredSpokes = 0;
      let heuristicFallbacks = 0;
      for (const spokeId of spokes) {
        const spokeNode = nodeRows.find((n) => n.id === spokeId);
        const r = riskByNode.get(spokeId);
        if (!r || !Number.isFinite(r.daysOfSupply) || r.daysOfSupply >= 999) continue;
        scoredSpokes++;
        // Engine-projected min DOS over the horizon. Only fall back to the
        // (currentDOS − avgRouteDays) heuristic for spokes the engine has
        // no profile for (and therefore no time-series for either) — track
        // those so confidence is downgraded accordingly.
        const engineMin = minDosBySpoke.get(spokeId);
        let projected: number;
        if (engineMin !== undefined && Number.isFinite(engineMin) && engineMin < 999) {
          projected = Math.max(0, engineMin);
        } else {
          projected = Math.max(0, r.daysOfSupply - avgRouteDays);
          heuristicFallbacks++;
        }
        const tier = tierFromDOS(projected, ctx.watchDays, ctx.criticalDays);
        affectedSpokes.push({
          nodeId: spokeId,
          nodeName: spokeNode?.name ?? spokeId,
          currentDaysOfSupply: Number(r.daysOfSupply.toFixed(1)),
          projectedDaysOfSupply: Number(projected.toFixed(1)),
          tier,
        });
        dosSum += projected;
        baselineDosSum += r.daysOfSupply;
        worst = maxTier(worst, tier);
      }
      if (affectedSpokes.length === 0) continue;
      const avgBaselineDos = scoredSpokes > 0 ? baselineDosSum / scoredSpokes : 0;
      const avgProjectedDos = scoredSpokes > 0 ? dosSum / scoredSpokes : 0;
      // Confidence reflects how complete our risk picture for the spokes is.
      const coverage = scoredSpokes / spokes.length;
      // Coverage of the spoke set, plus penalty for any spokes that had
      // to fall back to the lead-time heuristic (no engine profile).
      const engineCoverage =
        scoredSpokes > 0 ? (scoredSpokes - heuristicFallbacks) / scoredSpokes : 0;
      const baseConfidence: Confidence =
        coverage >= 0.9 && downstreamRoutes.length > 0
          ? "HIGH"
          : coverage >= 0.6
            ? "MEDIUM"
            : "LOW";
      const confidence: Confidence =
        engineCoverage < 0.5
          ? "LOW"
          : engineCoverage < 0.9 && baseConfidence === "HIGH"
            ? "MEDIUM"
            : baseConfidence;
      // Real impact: how many days of buffer the spokes lose under the
      // engine's projection.
      const projectedDosImpact = Number(
        Math.max(0, avgBaselineDos - avgProjectedDos).toFixed(1),
      );
      scenarios.push({
        id: `cascade-hub-${hubId}`,
        triggerType: "hub_loss",
        triggerNodeId: hubId,
        triggerNodeName: hub.name,
        triggerLabel: `${hub.name} (${hub.type}) goes dark`,
        severity: worst,
        confidence,
        affectedSiteCount: affectedSpokes.length,
        affectedSiteIds: affectedSpokes.map((s) => s.nodeId),
        affectedSpokes,
        projectedDosImpact,
        leadTimeImpactHours: Math.round(avgRouteDays * 24),
        narrative:
          `If ${hub.name} loses operational capacity, ${affectedSpokes.length} downstream ` +
          `${affectedSpokes.length === 1 ? "site" : "sites"} fall from an avg ` +
          `${avgBaselineDos.toFixed(1)}d to ${avgProjectedDos.toFixed(1)}d of supply ` +
          `over a ${horizon}-day horizon, absorbing a ${avgRouteDays.toFixed(1)}-day ` +
          `resupply gap until alternate routing is established.`,
      });
    }

    // (b) Generator-failure cascades — assets at low fuel jeopardise blood units.
    const generatorsByNode = new Map<string, typeof allAssets[number]>();
    for (const a of allAssets) {
      if (a.assetType !== "generator") continue;
      const cur = generatorsByNode.get(a.nodeId);
      if (!cur || a.fuelDaysRemaining < cur.fuelDaysRemaining) {
        generatorsByNode.set(a.nodeId, a);
      }
    }
    const lotsByNode = new Map<string, number>();
    for (const lot of allLots) {
      if (lot.status === "EXPIRED" || lot.status === "COMPROMISED") continue;
      lotsByNode.set(lot.nodeId, (lotsByNode.get(lot.nodeId) ?? 0) + lot.units);
    }
    for (const [nodeId, gen] of generatorsByNode.entries()) {
      const fuel = gen.fuelDaysRemaining;
      if (fuel >= 7) continue;
      const node = nodeRows.find((n) => n.id === nodeId);
      if (!node) continue;
      const units = lotsByNode.get(nodeId) ?? 0;
      if (units === 0) continue;
      const sev: Tier = fuel <= 2 ? "CRITICAL" : "WATCH";
      const r = riskByNode.get(nodeId);
      const currentDos = r && Number.isFinite(r.daysOfSupply) && r.daysOfSupply < 999
        ? r.daysOfSupply
        : 0;
      // On generator failure, anything still on cold-chain becomes scrap
      // once fuel runs out — projected DOS for blood at this site collapses
      // toward zero as soon as the generator stops.
      const projectedDos = Math.max(0, Math.min(currentDos, fuel));
      scenarios.push({
        id: `cascade-gen-${nodeId}`,
        triggerType: "generator_failure",
        triggerNodeId: nodeId,
        triggerNodeName: node.name,
        triggerLabel: `${node.name} backup generator (${fuel.toFixed(1)}d fuel)`,
        severity: sev,
        // Single-site, well-instrumented signal — high confidence.
        confidence: "HIGH",
        affectedSiteCount: 1,
        affectedSiteIds: [nodeId],
        affectedSpokes: [
          {
            nodeId,
            nodeName: node.name,
            currentDaysOfSupply: Number(currentDos.toFixed(1)),
            projectedDaysOfSupply: Number(projectedDos.toFixed(1)),
            tier: tierFromDOS(projectedDos, ctx.watchDays, ctx.criticalDays),
          },
        ],
        projectedDosImpact: Number((currentDos - projectedDos).toFixed(1)),
        leadTimeImpactHours: Math.round(fuel * 24),
        narrative:
          `${node.name} has ${fuel.toFixed(1)} days of generator fuel and ` +
          `${units} viable blood units on cold-chain assets. A grid loss ` +
          `combined with refuel slip would compromise the entire holding.`,
      });
    }

    // Rank by severity then affected count.
    const sevOrder: Record<Tier, number> = { CRITICAL: 2, WATCH: 1, NOMINAL: 0 };
    scenarios.sort((a, b) => {
      const s = sevOrder[b.severity] - sevOrder[a.severity];
      if (s !== 0) return s;
      return b.affectedSiteCount - a.affectedSiteCount;
    });
    const top = scenarios.slice(0, 3).map((s) => ({
      ...s,
      affectedSiteNames: s.affectedSiteIds.map((id) => nodeNameMap.get(id) ?? id),
    }));

    res.json({ generatedAt, scenarios: top });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// 2. /api/overview/leaderboard — Most-fragile blood-storing sites
// ---------------------------------------------------------------------------

router.get("/overview/leaderboard", async (req, res, next) => {
  try {
    const limit = Math.min(20, Math.max(1, Number(req.query.limit ?? 8) || 8));
    const [{ ctx }, nodeRows, allLots, itemRows] = await Promise.all([
      loadSimContext(),
      db.select().from(nodesTable),
      db.select().from(bloodLots),
      db.select().from(itemsTable),
    ]);
    const generatedAt = new Date().toISOString();
    const itemMap = new Map(itemRows.map((i) => [i.id, i]));

    // Only consider blood-storing nodes (those with at least one lot).
    const nodesWithBlood = new Set<string>();
    for (const lot of allLots) nodesWithBlood.add(lot.nodeId);
    const candidates = nodeRows.filter((n) => nodesWithBlood.has(n.id));

    type Entry = {
      nodeId: string;
      nodeName: string;
      nodeType: string;
      regionalHub: string | null;
      viableUnits: number;
      viableDaysOfSupply: number;
      daysUntilStockout: number;
      deltaDosVs24h: number;
      hasBaseline: boolean;
      tier: Tier;
      sparkline: Array<{ day: number; value: number; label: string | null }>;
      constraintCategory: string | null;
      deeplink: string;
    };

    // Pull baselines for every blood-storing candidate up front so we can
    // assemble per-entry deltas without one query per row.
    const candidateIds = candidates.map((c) => c.id);
    const baselineMap = await loadDosBaselines(candidateIds);

    const entries: Entry[] = [];
    const samplesToRecord: Array<{ nodeId: string; dos: number }> = [];
    for (const node of candidates) {
      const readiness = await computeNodeBloodReadiness(node.id);
      if (!readiness) continue;

      // Daily blood-product burn (used to drive sparkline + stockout).
      const profile = ctx.profiles.get(node.id);
      let burn = 0;
      if (profile) {
        const demands = computeDailyDemand({
          profile,
          items: ctx.items,
          operationalState: ctx.states.get(profile.operationalState),
          itemSkew: ctx.itemSkew,
        });
        for (const d of demands) {
          const it = itemMap.get(d.itemId);
          if (it?.category === "blood_products") burn += d.quantity;
        }
      }

      const tier = tierFromDOS(
        readiness.viableDaysOfSupply,
        ctx.watchDays,
        ctx.criticalDays,
      );

      // 7-day projected sparkline. When we know the daily burn rate we
      // step down by units/burn per day; when burn is zero (or DOS is the
      // sentinel ≥999 used for "effectively infinite" supply) we hold the
      // current value flat so the trend line doesn't mislead.
      const sparkline: Array<{ day: number; value: number; label: string | null }> = [];
      const startingDos = readiness.viableDaysOfSupply;
      const isSentinel = !Number.isFinite(startingDos) || startingDos >= 999;
      for (let day = 0; day < 7; day++) {
        let v: number;
        if (isSentinel || burn <= 0) {
          v = isSentinel ? Number(startingDos.toFixed(1)) : startingDos;
        } else {
          v = Math.max(0, startingDos - day);
        }
        sparkline.push({
          day,
          value: Number(v.toFixed(1)),
          label: day === 0 ? "today" : day === 6 ? "+6d" : null,
        });
      }

      // Pick the tightest constraint category for this node.
      let constraintCategory: string | null = null;
      const cc = readiness.coldChain;
      const ts = readiness.testingSupplies;
      if (cc.failedAssets > 0 || cc.healthPercent < 60) constraintCategory = "cold_chain";
      else if (ts.minDaysOfSupply <= ctx.criticalDays) constraintCategory = "reagents";
      else if (readiness.viableDaysOfSupply <= ctx.criticalDays) constraintCategory = "blood";
      else if (readiness.donors.effectiveCollectionCapacity === 0) constraintCategory = "donors";

      // Compare today's DOS against the persisted snapshot history to derive
      // a real "delta vs ~24h ago". When no baseline exists yet (cold start
      // or fresh DB), delta is 0 and hasBaseline=false so the UI can render
      // an em-dash. Today's value is queued for write below in one batch.
      const baseline = baselineMap.get(node.id) ?? null;
      const deltaDosVs24h = baseline
        ? Number((readiness.viableDaysOfSupply - baseline.dos).toFixed(1))
        : 0;
      samplesToRecord.push({
        nodeId: node.id,
        dos: readiness.viableDaysOfSupply,
      });

      entries.push({
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        regionalHub: node.regionalHub ?? null,
        viableUnits: readiness.totalViableUnits,
        viableDaysOfSupply: readiness.viableDaysOfSupply,
        daysUntilStockout: burn > 0
          ? Number((readiness.totalViableUnits / burn).toFixed(1))
          : 999,
        deltaDosVs24h,
        hasBaseline: baseline !== null,
        tier,
        sparkline,
        constraintCategory,
        deeplink: `/sites/${node.id}?tab=blood-readiness`,
      });
    }

    entries.sort((a, b) => a.viableDaysOfSupply - b.viableDaysOfSupply);
    // Persist a fresh batch of snapshots so subsequent calls have a real
    // baseline to compare against. Errors are non-fatal — the leaderboard
    // payload still ships if the write fails.
    try {
      await recordDosSnapshots(samplesToRecord);
    } catch {
      // ignore snapshot persistence failures
    }
    res.json({ generatedAt, entries: entries.slice(0, limit) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// 3. /api/overview/cold-chain-pulse — Recent temperature excursion events
// ---------------------------------------------------------------------------

router.get("/overview/cold-chain-pulse", async (req, res, next) => {
  try {
    const windowMinutes = Math.min(
      24 * 60,
      Math.max(15, Number(req.query.windowMinutes ?? 60) || 60),
    );
    const since = new Date(Date.now() - windowMinutes * 60_000);

    const [events, allAssets, allLots, nodeRows] = await Promise.all([
      db
        .select()
        .from(temperatureEvents)
        .where(gte(temperatureEvents.occurredAt, since))
        .orderBy(asc(temperatureEvents.occurredAt))
        .limit(50),
      db.select().from(coldChainAssets),
      db.select().from(bloodLots),
      db.select().from(nodesTable),
    ]);
    // The window is the contract: when nothing happened in the requested
    // span we return an empty list so the caller can render an
    // "all clear" state rather than misleading older data.

    const assetMap = new Map(allAssets.map((a) => [a.id, a]));
    const nodeNameMap = new Map(nodeRows.map((n) => [n.id, n.name]));
    const lotsByAsset = new Map<string, number>();
    for (const lot of allLots) {
      if (!lot.coldChainAssetId) continue;
      if (lot.status === "EXPIRED" || lot.status === "COMPROMISED") continue;
      lotsByAsset.set(
        lot.coldChainAssetId,
        (lotsByAsset.get(lot.coldChainAssetId) ?? 0) + lot.units,
      );
    }

    const out = events.map((e) => {
      const asset = assetMap.get(e.assetId);
      const targetMin = asset?.targetTempMinC ?? 0;
      const targetMax = asset?.targetTempMaxC ?? 0;
      let peakDelta = 0;
      if (asset) {
        if (e.recordedTempC > targetMax) peakDelta = e.recordedTempC - targetMax;
        else if (e.recordedTempC < targetMin) peakDelta = e.recordedTempC - targetMin;
      }
      return {
        id: e.id,
        occurredAt: e.occurredAt.toISOString(),
        assetId: e.assetId,
        assetName: asset?.name ?? e.assetId,
        assetType: asset?.assetType ?? "unknown",
        nodeId: e.nodeId,
        nodeName: nodeNameMap.get(e.nodeId) ?? e.nodeId,
        severity: e.severity,
        recordedTempC: e.recordedTempC,
        targetTempMinC: targetMin,
        targetTempMaxC: targetMax,
        peakTempDeltaC: Number(peakDelta.toFixed(2)),
        recovered: e.resolvedAt !== null,
        resolvedAt: e.resolvedAt ? e.resolvedAt.toISOString() : null,
        affectedUnits: lotsByAsset.get(e.assetId) ?? 0,
        notes: e.notes ?? "",
      };
    });

    res.json({ generatedAt: new Date().toISOString(), windowMinutes, events: out });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// 4. /api/overview/activity-stream — Denser, classified live activity feed
// ---------------------------------------------------------------------------

router.get("/overview/activity-stream", async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(5, Number(req.query.limit ?? 20) || 20));
    // Cursor pagination: clients pass back the `nextCursor` value from a
    // previous response (an ISO timestamp) to fetch older items. We pull
    // a wider source window so the merged stream still has `limit` items
    // after sorting + de-duplication across the three source tables.
    const cursorRaw = typeof req.query.cursor === "string" ? req.query.cursor : null;
    const cursorDate = cursorRaw ? new Date(cursorRaw) : null;
    const cursorValid = cursorDate && !Number.isNaN(cursorDate.getTime()) ? cursorDate : null;
    const sourceLimit = limit * 4;
    const [activity, openAlerts, recentTempEvents, nodeRows] = await Promise.all([
      cursorValid
        ? db
            .select()
            .from(activityEntries)
            .where(lt(activityEntries.ts, cursorValid))
            .orderBy(desc(activityEntries.ts))
            .limit(sourceLimit)
        : db
            .select()
            .from(activityEntries)
            .orderBy(desc(activityEntries.ts))
            .limit(sourceLimit),
      cursorValid
        ? db
            .select()
            .from(alertsTable)
            .where(and(eq(alertsTable.status, "OPEN"), lt(alertsTable.openedAt, cursorValid)))
            .orderBy(desc(alertsTable.openedAt))
            .limit(sourceLimit)
        : db
            .select()
            .from(alertsTable)
            .where(eq(alertsTable.status, "OPEN"))
            .orderBy(desc(alertsTable.openedAt))
            .limit(sourceLimit),
      cursorValid
        ? db
            .select()
            .from(temperatureEvents)
            .where(lt(temperatureEvents.occurredAt, cursorValid))
            .orderBy(desc(temperatureEvents.occurredAt))
            .limit(sourceLimit)
        : db
            .select()
            .from(temperatureEvents)
            .orderBy(desc(temperatureEvents.occurredAt))
            .limit(sourceLimit),
      db.select().from(nodesTable),
    ]);
    const nodeNameMap = new Map(nodeRows.map((n) => [n.id, n.name]));

    type Item = {
      id: string;
      kind: string;
      summary: string;
      severity: "info" | "watch" | "warning" | "critical";
      nodeId: string | null;
      nodeName: string | null;
      itemId: string | null;
      orderId: string | null;
      actorRole: string | null;
      createdAt: string;
      deeplink: string | null;
    };

    const items: Item[] = [];

    function activitySeverity(kind: string): Item["severity"] {
      const k = kind.toLowerCase();
      if (k.includes("critical") || k.includes("alert_open") || k.includes("excursion")) return "critical";
      if (k.includes("warn")) return "warning";
      if (k.includes("watch")) return "watch";
      return "info";
    }

    function classify(kind: string): string {
      const k = kind.toLowerCase();
      if (k.startsWith("shipment")) return "shipment_milestone";
      if (k.startsWith("alert")) return "alert";
      if (k.startsWith("recommendation")) return "recommendation_promoted";
      if (k.startsWith("order")) return "order_state_change";
      if (k.startsWith("cold_chain") || k.includes("temperature")) return "cold_chain_event";
      return kind || "generic";
    }

    function deeplinkFor(kind: string, refType: string | null, refId: string | null): string | null {
      if (!refId) return null;
      switch (refType) {
        case "node":
          return `/sites/${refId}`;
        case "item":
          return `/items/${refId}`;
        case "order":
          return `/orders/${refId}`;
        case "scenario":
          return `/scenarios/${refId}`;
        default:
          return null;
      }
    }

    for (const a of activity) {
      const meta = (a.meta ?? {}) as Record<string, unknown>;
      const nodeId =
        a.refType === "node" ? a.refId : (typeof meta.nodeId === "string" ? meta.nodeId : null);
      items.push({
        id: `act-${a.id}`,
        kind: classify(a.kind),
        summary: a.message,
        severity: activitySeverity(a.kind),
        nodeId,
        nodeName: nodeId ? nodeNameMap.get(nodeId) ?? null : null,
        itemId:
          a.refType === "item" ? a.refId : (typeof meta.itemId === "string" ? meta.itemId : null),
        orderId: a.refType === "order" ? a.refId : null,
        actorRole: a.actor,
        createdAt: a.ts.toISOString(),
        deeplink: deeplinkFor(a.kind, a.refType, a.refId),
      });
    }

    for (const al of openAlerts) {
      items.push({
        id: `alert-${al.id}`,
        kind: "alert",
        summary: al.message,
        severity: severityToTier(al.severity).toLowerCase() === "critical"
          ? "critical"
          : severityToTier(al.severity).toLowerCase() === "watch"
            ? "warning"
            : "info",
        nodeId: al.nodeId,
        nodeName: nodeNameMap.get(al.nodeId) ?? null,
        itemId: al.itemId ?? null,
        orderId: null,
        actorRole: "system",
        createdAt: al.openedAt.toISOString(),
        deeplink: `/sites/${al.nodeId}`,
      });
    }

    for (const t of recentTempEvents) {
      items.push({
        id: `cc-${t.id}`,
        kind: "cold_chain_event",
        summary: `${t.severity}: ${t.notes || "temperature excursion"} (${t.recordedTempC.toFixed(1)}°C)`,
        severity: t.severity === "CRITICAL" ? "critical" : t.severity === "WARNING" ? "warning" : "watch",
        nodeId: t.nodeId,
        nodeName: nodeNameMap.get(t.nodeId) ?? null,
        itemId: null,
        orderId: null,
        actorRole: "telemetry",
        createdAt: t.occurredAt.toISOString(),
        deeplink: `/sites/${t.nodeId}`,
      });
    }

    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = items.slice(0, limit);
    const nextCursor =
      page.length === limit && items.length > limit ? page[page.length - 1]!.createdAt : null;
    res.json({
      generatedAt: new Date().toISOString(),
      items: page,
      nextCursor,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// 5. /api/overview/mission-risk-matrix
// ---------------------------------------------------------------------------

const MISSION_DEFS: Array<{
  id: string;
  label: string;
  matches: (nodeType: string, regionalHub: string | null) => boolean;
}> = [
  {
    id: "maritime_dmo",
    label: "Maritime DMO",
    matches: (t) => /naval|maritime|ship|fleet|carrier/i.test(t),
  },
  {
    id: "air",
    label: "Air Operations",
    matches: (t) => /air|aero|af |afb|squadron/i.test(t),
  },
  {
    id: "ground",
    label: "Ground Forces",
    matches: (t) => /bas|ground|army|forward|expeditionary|battalion|brigade/i.test(t),
  },
  {
    id: "special_ops",
    label: "Special Operations",
    matches: (t) => /sof|special|sf|seal|raider/i.test(t),
  },
  {
    id: "humanitarian",
    label: "Humanitarian Assistance",
    matches: (t) => /clinic|civilian|humanitarian|aid|relief|partner/i.test(t),
  },
];

const SUPPLY_COLUMNS: Array<{ id: string; label: string }> = [
  { id: "blood", label: "Blood Components" },
  { id: "cold_chain", label: "Cold Chain" },
  { id: "reagents", label: "Reagents & Testing" },
  { id: "donors", label: "Donor Capacity" },
  { id: "lift", label: "Lift & Transport" },
];

router.get("/overview/mission-risk-matrix", async (_req, res, next) => {
  try {
    const [{ ctx }, nodeRows, allLots, allAssets, allBalances, allShipments, allItems, riskRes] =
      await Promise.all([
        loadSimContext(),
        db.select().from(nodesTable),
        db.select().from(bloodLots),
        db.select().from(coldChainAssets),
        db.select().from(inventoryBalances),
        db.select().from(shipmentsTable).orderBy(desc(shipmentsTable.departedAt)).limit(500),
        db.select().from(itemsTable),
        computeRiskByNode(),
      ]);

    // For each mission, derive the relevant node set.  Default = every blood-
    // storing node so every mission has at least baseline coverage.
    const bloodStoringIds = new Set<string>(allLots.map((l) => l.nodeId));
    const missionNodeIds = new Map<string, string[]>();
    for (const m of MISSION_DEFS) {
      const ids = nodeRows
        .filter((n) => bloodStoringIds.has(n.id) && m.matches(n.type, n.regionalHub ?? null))
        .map((n) => n.id);
      // Fallback: blood-storing nodes that look most relevant by type bucket.
      missionNodeIds.set(m.id, ids.length > 0 ? ids : Array.from(bloodStoringIds));
    }

    // Pre-compute per-node viable DOS and constraint signals.
    const lotsByNode = new Map<string, number>();
    for (const lot of allLots) {
      if (lot.status === "EXPIRED" || lot.status === "COMPROMISED") continue;
      lotsByNode.set(lot.nodeId, (lotsByNode.get(lot.nodeId) ?? 0) + lot.units);
    }
    const assetsByNode = new Map<string, typeof allAssets>();
    for (const a of allAssets) {
      const arr = assetsByNode.get(a.nodeId) ?? [];
      arr.push(a);
      assetsByNode.set(a.nodeId, arr);
    }
    const balanceMap = new Map<string, number>();
    for (const b of allBalances) balanceMap.set(`${b.nodeId}:${b.itemId}`, b.onHand);

    // Demand per node × item.
    const burnByKey = new Map<string, number>();
    for (const node of ctx.nodes) {
      const profile = ctx.profiles.get(node.id);
      if (!profile) continue;
      const demands = computeDailyDemand({
        profile,
        items: ctx.items,
        operationalState: ctx.states.get(profile.operationalState),
        itemSkew: ctx.itemSkew,
      });
      for (const d of demands) burnByKey.set(`${node.id}:${d.itemId}`, d.quantity);
    }

    // Lift signal: route reliability × inflight load.
    const inflightCount = allShipments.filter((s) => s.etaAt.getTime() > Date.now()).length;

    const missions = MISSION_DEFS.map((m) => ({
      id: m.id,
      label: m.label,
      siteCount: missionNodeIds.get(m.id)?.length ?? 0,
    }));

    const cells: Array<{
      missionId: string;
      columnId: string;
      tier: Tier;
      affectedSites: number;
      rationale: string;
      metricValue: number;
    }> = [];

    // Blood-product item ids — restrict the blood column's burn to these
    // so DOS isn't diluted by demand for unrelated supplies.
    const bloodItemIds = allItems
      .filter((it) => it.category === "blood_products")
      .map((it) => it.id);

    for (const m of MISSION_DEFS) {
      const nodeIds = missionNodeIds.get(m.id) ?? [];
      {
        let critSites = 0;
        let watchSites = 0;
        let minDOS = 999;
        for (const id of nodeIds) {
          const units = lotsByNode.get(id) ?? 0;
          let burn = 0;
          for (const itemId of bloodItemIds) {
            burn += burnByKey.get(`${id}:${itemId}`) ?? 0;
          }
          const dos = projectDaysOfSupply(units, burn);
          if (dos < minDOS) minDOS = dos;
          const t = tierFromDOS(dos, ctx.watchDays, ctx.criticalDays);
          if (t === "CRITICAL") critSites++;
          else if (t === "WATCH") watchSites++;
        }
        const tier: Tier = critSites > 0 ? "CRITICAL" : watchSites > 0 ? "WATCH" : "NOMINAL";
        cells.push({
          missionId: m.id,
          columnId: "blood",
          tier,
          affectedSites: critSites + watchSites,
          rationale:
            tier === "NOMINAL"
              ? `All ${nodeIds.length} sites above warn threshold`
              : `${critSites} site(s) critical, ${watchSites} watch — min DOS ${minDOS.toFixed(1)}d`,
          metricValue: Number(minDOS === 999 ? 0 : minDOS.toFixed(1)),
        });
      }
      // Cold chain
      {
        let failed = 0;
        let excursion = 0;
        let totalAssets = 0;
        const impactedSites = new Set<string>();
        for (const id of nodeIds) {
          const a = assetsByNode.get(id) ?? [];
          let siteImpacted = false;
          for (const asset of a) {
            if (asset.assetType === "generator") continue;
            totalAssets++;
            if (asset.status === "FAILED") {
              failed++;
              siteImpacted = true;
            } else if (asset.status === "EXCURSION") {
              excursion++;
              siteImpacted = true;
            }
          }
          if (siteImpacted) impactedSites.add(id);
        }
        const tier: Tier = failed > 0 ? "CRITICAL" : excursion > 0 ? "WATCH" : "NOMINAL";
        const healthPct = totalAssets > 0
          ? Number((((totalAssets - failed - excursion * 0.6) / totalAssets) * 100).toFixed(1))
          : 100;
        cells.push({
          missionId: m.id,
          columnId: "cold_chain",
          tier,
          affectedSites: impactedSites.size,
          rationale:
            tier === "NOMINAL"
              ? `Cold chain healthy (${totalAssets} assets nominal)`
              : `${impactedSites.size} site(s) impacted — ${failed} failed / ${excursion} excursion across ${totalAssets} assets`,
          metricValue: healthPct,
        });
      }
      // Reagents & Testing
      {
        let critSites = 0;
        let watchSites = 0;
        let minDOS = 999;
        for (const id of nodeIds) {
          for (const reagent of TESTING_SUPPLY_ITEMS) {
            const onHand = balanceMap.get(`${id}:${reagent.itemId}`) ?? 0;
            const burn = burnByKey.get(`${id}:${reagent.itemId}`) ?? 0;
            const dos = projectDaysOfSupply(onHand, burn);
            if (dos < minDOS) minDOS = dos;
            const t = tierFromDOS(dos, ctx.watchDays, ctx.criticalDays);
            if (t === "CRITICAL") {
              critSites++;
              break;
            } else if (t === "WATCH") {
              watchSites++;
              break;
            }
          }
        }
        const tier: Tier = critSites > 0 ? "CRITICAL" : watchSites > 0 ? "WATCH" : "NOMINAL";
        cells.push({
          missionId: m.id,
          columnId: "reagents",
          tier,
          affectedSites: critSites + watchSites,
          rationale:
            tier === "NOMINAL"
              ? `Reagents above critical threshold network-wide`
              : `${critSites} critical / ${watchSites} watch — min reagent DOS ${minDOS.toFixed(1)}d`,
          metricValue: Number(minDOS === 999 ? 0 : minDOS.toFixed(1)),
        });
      }
      // Donor Capacity
      {
        const r = riskRes.riskByNode.filter((row) => nodeIds.includes(row.nodeId));
        // Approximate donor strain via aggregate critical short items at sites.
        const stressedSites = r.filter((x) => x.criticalShortItems > 0).length;
        const tier: Tier = stressedSites > nodeIds.length * 0.4
          ? "CRITICAL"
          : stressedSites > 0
            ? "WATCH"
            : "NOMINAL";
        cells.push({
          missionId: m.id,
          columnId: "donors",
          tier,
          affectedSites: stressedSites,
          rationale:
            tier === "NOMINAL"
              ? "Donor pool sufficient for projected demand"
              : `${stressedSites} site(s) showing donor/collection strain`,
          metricValue: stressedSites,
        });
      }
      // Lift & Transport
      {
        const ids = new Set(nodeIds);
        const inMission = allShipments.filter(
          (s) => (ids.has(s.toNode) || ids.has(s.fromNode)) && s.etaAt.getTime() > Date.now(),
        );
        const tier: Tier = inMission.length === 0 && nodeIds.length > 0
          ? "WATCH"
          : "NOMINAL";
        cells.push({
          missionId: m.id,
          columnId: "lift",
          tier,
          affectedSites: 0,
          rationale:
            inMission.length === 0
              ? "No shipments currently in flight to mission sites"
              : `${inMission.length} shipment(s) in flight to mission sites (theatre total ${inflightCount})`,
          metricValue: inMission.length,
        });
      }
    }

    res.json({
      generatedAt: new Date().toISOString(),
      missions,
      supplyColumns: SUPPLY_COLUMNS,
      cells,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// 6. /api/overview/ai-brief — 3-bullet AI commander brief, cached ~60s
// ---------------------------------------------------------------------------

type CachedBrief = {
  payload: Record<string, unknown>;
  expiresAt: number;
};
const briefCache = new Map<string, CachedBrief>();
const BRIEF_TTL_MS = 60_000;
let lastBriefBullets: { topRisk: string; recommendedAction: string; change: string } | null = null;

function buildFallbackBrief(args: {
  theaterDOS: number;
  critAlerts: number;
  warnAlerts: number;
  shipments: number;
  topRiskName: string;
}) {
  return {
    topRisk:
      args.critAlerts > 0
        ? `${args.critAlerts} critical alerts open across theater; ${args.topRiskName} is the most-fragile site at ${args.theaterDOS.toFixed(1)}d theater DOS.`
        : `Theater holding ${args.theaterDOS.toFixed(1)}d of supply with ${args.warnAlerts} watch-level alerts.`,
    recommendedAction:
      args.critAlerts > 0
        ? `Triage open critical alerts and accelerate inbound shipments to ${args.topRiskName}.`
        : `Maintain current resupply cadence; stage contingency lift in case of operational tempo shift.`,
    change:
      args.shipments > 0
        ? `${args.shipments} shipment(s) in flight since the last brief.`
        : `No inbound movement since last brief — recommend posture review.`,
  };
}

router.get("/overview/ai-brief", async (req, res, next) => {
  try {
    const force = req.query.refresh === "true";
    const cacheKey = "default";
    const now = Date.now();
    const cached = briefCache.get(cacheKey);
    if (cached && !force && cached.expiresAt > now) {
      res.json({ ...cached.payload, cached: true });
      return;
    }

    const [risk, shipments, openAlerts, blood, settingsRows, nodeRows] = await Promise.all([
      computeRiskByNode(),
      computeInFlightShipments(),
      db.select().from(alertsTable).where(eq(alertsTable.status, "OPEN")),
      computeTheaterBloodReadiness(),
      db.select().from(appSettings),
      db.select().from(nodesTable),
    ]);
    const settings = settingsRows[0];
    const provider = (settings?.aiProvider ?? "openai") as AIProvider;
    const model = resolveModel(provider, settings?.aiModel);

    const dosVals = risk.riskByNode
      .filter((r) => Number.isFinite(r.daysOfSupply) && r.daysOfSupply < 999)
      .map((r) => r.daysOfSupply);
    const theaterDOS = dosVals.length > 0
      ? dosVals.reduce((s, v) => s + v, 0) / dosVals.length
      : 0;
    const critAlerts = openAlerts.filter((a) => a.severity === "CRITICAL").length;
    const warnAlerts = openAlerts.filter((a) => a.severity === "WARN" || a.severity === "WARNING").length;
    const topRisk = [...risk.riskByNode].sort((a, b) => b.riskScore - a.riskScore)[0];
    const nodeNameMap = new Map(nodeRows.map((n) => [n.id, n.name]));
    const topRiskName = topRisk ? nodeNameMap.get(topRisk.nodeId) ?? topRisk.nodeId : "—";

    const fallback = buildFallbackBrief({
      theaterDOS,
      critAlerts,
      warnAlerts,
      shipments: shipments.length,
      topRiskName,
    });

    let bullets = fallback;
    let usedFallback = true;
    let rawText: string | null = null;

    try {
      const system =
        "You are the INDOPACOM Predictive Sustainment commander brief assistant. " +
        "Produce a terse, action-oriented 3-bullet brief for a senior sustainment officer. " +
        "Output strictly as compact JSON: {\"topRisk\":\"...\",\"recommendedAction\":\"...\",\"change\":\"...\"}. " +
        "Each bullet must be a single declarative sentence under 30 words.";
      const userMsg = JSON.stringify({
        theaterDaysOfSupply: Number(theaterDOS.toFixed(1)),
        openCriticalAlerts: critAlerts,
        openWarnAlerts: warnAlerts,
        shipmentsInFlight: shipments.length,
        topRiskNode: { id: topRisk?.nodeId ?? null, name: topRiskName, riskScore: topRisk?.riskScore ?? 0 },
        bloodReadiness: {
          totalViableUnits: blood.totalViableUnits,
          unitsExpiringWithin72h: blood.unitsExpiringWithin72h,
          coldChainHealthPercent: blood.coldChainHealthPercent,
          coldChainAssetsFailed: blood.coldChainAssetsFailed,
          reagentDaysRemaining: blood.reagentDaysRemaining,
        },
        previousBullets: lastBriefBullets,
      });

      rawText = await completeChat({
        provider,
        model,
        system,
        messages: [{ role: "user", content: userMsg }],
        maxOutputTokens: 350,
      });

      // Robustly extract JSON object from response.
      const start = rawText.indexOf("{");
      const end = rawText.lastIndexOf("}");
      if (start >= 0 && end > start) {
        const parsed = JSON.parse(rawText.slice(start, end + 1)) as Partial<typeof fallback>;
        if (parsed.topRisk && parsed.recommendedAction && parsed.change) {
          bullets = {
            topRisk: String(parsed.topRisk),
            recommendedAction: String(parsed.recommendedAction),
            change: String(parsed.change),
          };
          usedFallback = false;
        }
      }
    } catch {
      // Keep fallback bullets when AI provider is unreachable / unconfigured.
      usedFallback = true;
    }

    lastBriefBullets = bullets;

    const payload = {
      generatedAt: new Date().toISOString(),
      provider,
      model,
      cached: false,
      fallback: usedFallback,
      bullets,
      rawText: usedFallback ? null : rawText,
    };
    briefCache.set(cacheKey, { payload, expiresAt: now + BRIEF_TTL_MS });
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
