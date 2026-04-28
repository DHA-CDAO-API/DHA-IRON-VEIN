import { Router, type IRouter } from "express";
import {
  db,
  scenarios as scenariosTable,
  presetEvents,
  appSettings,
  activityEntries,
  recommendations as recsTable,
  theaterZones,
  nodes as nodesTable,
} from "@workspace/db";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { loadSimContext } from "../lib/ctx";
import {
  runScenario,
  findUpstreamRoute,
  type ScenarioRunInput,
  type SimSupplier,
} from "@workspace/sim";
import { completeChat, resolveModel, SCENARIO_BRIEF_SYSTEM } from "@workspace/ai-orchestrator";

// Ray-casting point-in-polygon test. Polygon is a list of [lon, lat] pairs.
function pointInPolygon(lon: number, lat: number, polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Expand `zoneIds` referenced in a scenario perturbation into the set of
// network nodes that fall inside any of those zones, and apply default
// route delays/reliability hits if not already set. Mutates `perturbation`
// in place and returns the list of zone names matched (for logging/UI).
async function expandZonesIntoPerturbation(
  perturbation: Record<string, unknown>,
): Promise<{ matchedZoneNames: string[]; addedNodeIds: string[] }> {
  const zoneIds = Array.isArray(perturbation.zoneIds)
    ? (perturbation.zoneIds as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  if (zoneIds.length === 0) return { matchedZoneNames: [], addedNodeIds: [] };

  const [zoneRows, allNodes] = await Promise.all([
    db.select().from(theaterZones).where(inArray(theaterZones.id, zoneIds)),
    db.select().from(nodesTable),
  ]);

  const insideNodeIds = new Set<string>();
  for (const z of zoneRows) {
    const poly = (z.polygon ?? []) as number[][];
    if (poly.length < 3) continue;
    for (const n of allNodes) {
      if (pointInPolygon(n.longitude, n.latitude, poly)) insideNodeIds.add(n.id);
    }
  }

  const existing = Array.isArray(perturbation.affectedNodes)
    ? (perturbation.affectedNodes as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const merged = Array.from(new Set([...existing, ...insideNodeIds]));
  perturbation.affectedNodes = merged;

  // Default route delay/reliability hit for the worst severity in matched zones,
  // unless the operator already specified explicit values.
  const worstSeverity = zoneRows.reduce<string>((acc, z) => {
    const order: Record<string, number> = { WATCH: 1, WARNING: 2, CRITICAL: 3 };
    return (order[z.severity] ?? 0) > (order[acc] ?? 0) ? z.severity : acc;
  }, "WATCH");
  const sevDefaults: Record<string, { delay: number; reliab: number }> = {
    WATCH: { delay: 1, reliab: -0.1 },
    WARNING: { delay: 2, reliab: -0.2 },
    CRITICAL: { delay: 4, reliab: -0.35 },
  };
  const def = sevDefaults[worstSeverity] ?? sevDefaults.WATCH;
  if (perturbation.routeDelayDays === undefined || perturbation.routeDelayDays === null) {
    perturbation.routeDelayDays = def.delay;
  }
  if (perturbation.routeReliabilityDelta === undefined || perturbation.routeReliabilityDelta === null) {
    perturbation.routeReliabilityDelta = def.reliab;
  }

  return {
    matchedZoneNames: zoneRows.map((z) => z.name),
    addedNodeIds: Array.from(insideNodeIds),
  };
}

const router: IRouter = Router();

function severityFromKind(kind: string): string {
  const k = kind.toUpperCase();
  if (
    k.includes("WAR") ||
    k.includes("CONFLICT") ||
    k.includes("KINETIC") ||
    k.includes("PRC") ||
    k.includes("MASCAL") ||
    k.includes("MASS_CASUALTY")
  )
    return "CRITICAL";
  if (
    k.includes("CONTESTED") ||
    k.includes("DENIAL") ||
    k.includes("INTERDICTION") ||
    k.includes("BLOCKADE")
  )
    return "CRITICAL";
  if (k.includes("CYBER") || k.includes("COMMS") || k.includes("CABLE")) return "HIGH";
  if (k.includes("TYPHOON") || k.includes("WEATHER") || k.includes("STORM") || k.includes("NATURAL")) return "HIGH";
  if (k.includes("COLD_CHAIN") || k.includes("OUTAGE") || k.includes("INFRA")) return "HIGH";
  return "MEDIUM";
}

router.get("/scenarios", async (_req, res, next) => {
  try {
    const rows = await db.select().from(scenariosTable).orderBy(desc(scenariosTable.runAt)).limit(50);
    res.json(
      rows.map((s) => ({
        id: s.id,
        name: s.name,
        // OpenAPI contract
        description: s.summary,
        status: "completed",
        createdAt: s.runAt.toISOString(),
        completedAt: s.runAt.toISOString(),
        createdByRole: null,
        // Legacy fields kept for older callers
        summary: s.summary,
        kind: s.kind,
        runAt: s.runAt.toISOString(),
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/scenarios/preset-events", async (_req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(presetEvents)
      .orderBy(asc(presetEvents.displayOrder), asc(presetEvents.name));
    res.json(
      rows.map((p) => ({
        id: p.id,
        // OpenAPI contract
        label: p.name,
        description: p.summary,
        severity: severityFromKind(p.kind),
        kind: p.kind,
        durationDays: p.durationDays,
        displayOrder: p.displayOrder,
        parameters: p.parameters,
        // Legacy fields
        name: p.name,
        summary: p.summary,
      })),
    );
  } catch (err) {
    next(err);
  }
});

const UpdateScenarioInput = z.object({
  name: z.string().min(1).max(200),
});

router.patch("/scenarios/:scenarioId", async (req, res, next) => {
  try {
    const parsed = UpdateScenarioInput.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "invalid scenario patch payload", details: parsed.error.flatten() });
    }
    const id = req.params.scenarioId;
    const [existing] = await db
      .select()
      .from(scenariosTable)
      .where(eq(scenariosTable.id, id));
    if (!existing) return res.status(404).json({ error: "scenario not found" });
    const newName = parsed.data.name.trim();
    if (newName.length === 0) {
      return res.status(400).json({ error: "scenario name cannot be empty" });
    }
    if (newName !== existing.name) {
      await db
        .update(scenariosTable)
        .set({ name: newName })
        .where(eq(scenariosTable.id, id));
      await db.insert(activityEntries).values({
        kind: "SCENARIO_RENAMED",
        actor: "operator",
        message: `Scenario renamed "${existing.name}" → "${newName}"`,
        refType: "scenario",
        refId: id,
        meta: { previousName: existing.name, newName },
      });
    }
    const [row] = await db
      .select()
      .from(scenariosTable)
      .where(eq(scenariosTable.id, id));
    if (!row) return res.status(404).json({ error: "scenario not found" });
    res.json({
      id: row.id,
      name: row.name,
      description: row.summary,
      status: "completed",
      createdAt: row.runAt.toISOString(),
      completedAt: row.runAt.toISOString(),
      createdByRole: null,
      summary: row.summary,
      kind: row.kind,
      runAt: row.runAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/scenarios/:scenarioId", async (req, res, next) => {
  try {
    const id = req.params.scenarioId;
    const [existing] = await db
      .select()
      .from(scenariosTable)
      .where(eq(scenariosTable.id, id));
    if (!existing) return res.status(404).json({ error: "scenario not found" });
    // Drop any recommendations the scenario produced (recommendations carry
    // a soft scenarioId reference but no DB-level cascade).
    await db.delete(recsTable).where(eq(recsTable.scenarioId, id));
    await db.delete(scenariosTable).where(eq(scenariosTable.id, id));
    await db.insert(activityEntries).values({
      kind: "SCENARIO_DELETED",
      actor: "operator",
      message: `Scenario "${existing.name}" deleted`,
      refType: "scenario",
      refId: id,
      meta: { name: existing.name, kind: existing.kind },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/scenarios/:scenarioId", async (req, res, next) => {
  try {
    const [row] = await db
      .select()
      .from(scenariosTable)
      .where(eq(scenariosTable.id, req.params.scenarioId));
    if (!row) return res.status(404).json({ error: "scenario not found" });
    const ctx = await loadSimContext();
    const persistedRecs = await db
      .select()
      .from(recsTable)
      .where(eq(recsTable.scenarioId, row.id));
    const envelope = buildScenarioResultEnvelope({
      id: row.id,
      name: row.name,
      summary: row.summary,
      kind: row.kind,
      runAt: row.runAt,
      result: row.result as ReturnType<typeof runScenario>,
      coaBrief: row.coaBrief ?? "",
      ctx: ctx.ctx,
      suppliers: ctx.suppliers,
      promotedByRecId: new Map(
        persistedRecs.map((r) => [r.id, r.promotedOrderId ?? null]),
      ),
    });
    res.json({
      // Legacy fields first
      id: row.id,
      name: row.name,
      status: "completed",
      createdAt: row.runAt.toISOString(),
      completedAt: row.runAt.toISOString(),
      createdByRole: null,
      runAt: row.runAt.toISOString(),
      result: row.result,
      coaBrief: row.coaBrief,
      aiProvider: row.aiProvider,
      aiModel: row.aiModel,
      // The original perturbation payload so the UI can re-load it into
      // the custom builder and trigger a re-run.
      inputs: row.inputs,
      // OpenAPI ScenarioResult last so its `summary` object + `scenario` win
      ...envelope,
    });
  } catch (err) {
    next(err);
  }
});

const RunScenarioInput = z.object({
  name: z.string().min(1),
  kind: z.string().min(1).optional(),
  eventId: z.string().optional(),
  presetEventId: z.string().optional(),
  description: z.string().nullish(),
  summary: z.string().optional(),
  focusNodeIds: z.array(z.string()).optional(),
  zoneIds: z.array(z.string()).optional(),
  perturbation: z.record(z.unknown()).optional(),
  horizonDays: z.number().int().positive().max(45).optional(),
  generateBrief: z.boolean().optional(),
});

router.post("/scenarios/preview", async (req, res, next) => {
  try {
    const parsed = RunScenarioInput.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "invalid scenario payload", details: parsed.error.flatten() });
    }
    const raw = parsed.data;
    const ctx = await loadSimContext();
    let perturbation = (raw.perturbation as ScenarioRunInput["perturbation"]) ?? {};
    let summary = raw.summary ?? raw.description ?? "";
    const presetEventId = raw.presetEventId ?? raw.eventId;
    if (presetEventId) {
      const [preset] = await db
        .select()
        .from(presetEvents)
        .where(eq(presetEvents.id, presetEventId));
      if (preset) {
        const params = preset.parameters as ScenarioRunInput["perturbation"];
        perturbation = { ...params, ...(raw.perturbation ?? {}) };
        summary = summary || preset.summary;
      }
    }
    const horizonDays = Math.max(1, Math.min(45, raw.horizonDays ?? 21));
    const result = runScenario(ctx.ctx, { horizonDays, perturbation });
    const envelope = buildScenarioResultEnvelope({
      id: "preview",
      name: raw.name,
      summary,
      kind: raw.kind ?? "GENERIC",
      runAt: new Date(),
      result,
      coaBrief: "",
      ctx: ctx.ctx,
      suppliers: ctx.suppliers,
      promotedByRecId: new Map(),
    });
    res.json({
      id: "preview",
      name: raw.name,
      runAt: new Date().toISOString(),
      result,
      coaBrief: "",
      ...envelope,
    });
  } catch (err) {
    req.log?.error({ err }, "scenario preview failed");
    next(err);
  }
});

router.post("/scenarios", async (req, res, next) => {
  try {
    const parsed = RunScenarioInput.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "invalid scenario payload", details: parsed.error.flatten() });
    }
    const raw = parsed.data;
    const body = {
      name: raw.name,
      kind: raw.kind ?? "GENERIC",
      summary: raw.summary ?? raw.description ?? undefined,
      presetEventId: raw.presetEventId ?? raw.eventId,
      perturbation: raw.perturbation as ScenarioRunInput["perturbation"] | undefined,
      horizonDays: raw.horizonDays,
      generateBrief: raw.generateBrief,
    };

    const ctx = await loadSimContext();
    let perturbation: Record<string, unknown> = (body.perturbation as Record<string, unknown>) ?? {};
    // Allow zoneIds to be passed at the top level of the request as a
    // convenience; merge them into the perturbation alongside any zoneIds
    // the perturbation may already carry.
    if (raw.zoneIds && raw.zoneIds.length > 0) {
      const existing = Array.isArray(perturbation.zoneIds)
        ? (perturbation.zoneIds as string[])
        : [];
      perturbation.zoneIds = Array.from(new Set([...existing, ...raw.zoneIds]));
    }
    let summary = body.summary ?? "";
    let presetMeta: Record<string, unknown> | undefined;
    if (body.presetEventId) {
      const [preset] = await db
        .select()
        .from(presetEvents)
        .where(eq(presetEvents.id, body.presetEventId));
      if (preset) {
        const params = preset.parameters as Record<string, unknown>;
        perturbation = { ...params, ...perturbation };
        summary = summary || preset.summary;
        presetMeta = { presetEventId: preset.id, presetName: preset.name };
      }
    }

    // Resolve any operator-drawn theater zones into affected nodes before
    // handing the perturbation to the simulator.
    const zoneExpansion = await expandZonesIntoPerturbation(perturbation);
    if (zoneExpansion.matchedZoneNames.length > 0 && !summary) {
      summary = `Operator zone perturbation: ${zoneExpansion.matchedZoneNames.join(", ")}`;
    }

    const horizonDays = Math.max(1, Math.min(45, body.horizonDays ?? 21));
    const result = runScenario(ctx.ctx, {
      horizonDays,
      perturbation: perturbation as ScenarioRunInput["perturbation"],
    });

    let coaBrief = "";
    let aiProvider = "openai";
    let aiModel = "gpt-5.4";
    if (body.generateBrief !== false) {
      const [settings] = await db.select().from(appSettings);
      aiProvider = settings?.aiProvider ?? "openai";
      aiModel = resolveModel(aiProvider as "openai" | "anthropic", settings?.aiModel);
      const topImpacted = result.impactedNodes.slice(0, 6).map((n) => {
        const node = ctx.ctx.nodes.find((x) => x.id === n.nodeId);
        return `${node?.name ?? n.nodeId} [node:${n.nodeId}] baseline=${n.baselineRisk} peak=${n.peakRisk} minDOS=${n.minDOS.toFixed(1)}d`;
      });
      const userMsg = `SCENARIO: ${body.name}\nKIND: ${body.kind}\nSUMMARY: ${summary}\nHORIZON: ${horizonDays} days\nPERTURBATION: ${JSON.stringify(perturbation)}\nPEAK DAY: ${result.peakDay}\nTOP IMPACTED NODES:\n${topImpacted.join("\n")}\n\nWrite the COA brief.`;
      try {
        coaBrief = await completeChat({
          provider: aiProvider as "openai" | "anthropic",
          model: aiModel,
          system: SCENARIO_BRIEF_SYSTEM,
          messages: [{ role: "user", content: userMsg }],
          maxOutputTokens: 800,
        });
      } catch (err) {
        req.log?.warn({ err }, "AI brief failed; emitting deterministic fallback");
        coaBrief = buildFallbackBrief(body.name, summary, result.peakDay, topImpacted);
      }
    }

    const id = `sc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    await db.insert(scenariosTable).values({
      id,
      name: body.name,
      summary,
      kind: body.kind,
      inputs: { perturbation, horizonDays, ...(presetMeta ?? {}) },
      result,
      aiProvider,
      aiModel,
      coaBrief,
    });
    await db.insert(activityEntries).values({
      kind: "SCENARIO_RUN",
      actor: "operator",
      message: `Scenario "${body.name}" run (${body.kind})`,
      refType: "scenario",
      refId: id,
      meta: { peakDay: result.peakDay, impacted: result.impactedNodes.length },
    });

    const recsToPersist = buildScenarioRecommendationRows({
      scenarioId: id,
      result,
      ctx: ctx.ctx,
      suppliers: ctx.suppliers,
    });
    if (recsToPersist.length > 0) {
      await db.insert(recsTable).values(recsToPersist).onConflictDoNothing();
    }

    const envelope = buildScenarioResultEnvelope({
      id,
      name: body.name,
      summary,
      kind: body.kind,
      runAt: new Date(),
      result,
      coaBrief,
      ctx: ctx.ctx,
      suppliers: ctx.suppliers,
      promotedByRecId: new Map(),
    });
    res.json({
      // Legacy fields first (no `kind` here — envelope owns it)
      id,
      name: body.name,
      runAt: new Date().toISOString(),
      result,
      coaBrief,
      aiProvider,
      aiModel,
      // OpenAPI ScenarioResult last so its `summary` object + `scenario` win
      ...envelope,
    });
  } catch (err) {
    req.log?.error({ err }, "scenario run failed");
    next(err);
  }
});

type ScenarioCtxLite = Awaited<ReturnType<typeof loadSimContext>>["ctx"];

function buildScenarioResultEnvelope(args: {
  id: string;
  name: string;
  summary: string;
  kind: string;
  runAt: Date;
  result: ReturnType<typeof runScenario>;
  coaBrief: string;
  ctx: ScenarioCtxLite;
  suppliers: SimSupplier[];
  promotedByRecId: Map<string, string | null>;
}) {
  const {
    id,
    name,
    summary,
    kind,
    runAt,
    result,
    coaBrief,
    ctx,
    suppliers,
    promotedByRecId,
  } = args;
  const nodeMap = new Map(ctx.nodes.map((n) => [n.id, n]));
  const itemMap = new Map(ctx.items.map((i) => [i.id, i]));
  const peakRiskNodeRow = result.impactedNodes[0];

  // perNode outcomes
  const perNode = result.impactedNodes.map((n) => {
    const baselineDOS = (() => {
      const balances = ctx.balances.filter((b) => b.nodeId === n.nodeId);
      if (balances.length === 0) return 999;
      let minDos = 999;
      for (const b of balances) {
        const item = itemMap.get(b.itemId);
        if (!item) continue;
        const dos = b.onHand / Math.max(0.01, item.wasteAdjustedDemand);
        if (dos < minDos) minDos = dos;
      }
      return Math.min(999, minDos);
    })();
    const criticalItemIds: string[] = [];
    for (const b of ctx.balances.filter((x) => x.nodeId === n.nodeId)) {
      const item = itemMap.get(b.itemId);
      if (!item) continue;
      const dos = b.onHand / Math.max(0.01, item.wasteAdjustedDemand);
      if (dos <= ctx.criticalDays && item.criticality === "critical") {
        criticalItemIds.push(b.itemId);
      }
    }
    return {
      nodeId: n.nodeId,
      nodeName: nodeMap.get(n.nodeId)?.name ?? n.nodeId,
      daysOfSupplyBefore: Number(baselineDOS.toFixed(1)),
      daysOfSupplyAfter: Number(n.minDOS.toFixed(1)),
      peakShortageDay: n.daysCritical > 0 ? result.peakDay : null,
      criticalItemIds,
      riskScore: Number(n.peakRisk.toFixed(1)),
    };
  });

  // perItem outcomes (top 12 by wasteAdjustedDemand, blood products first)
  const perItem = ctx.items
    .slice()
    .sort((a, b) => {
      const aCrit = a.criticality === "critical" ? 0 : a.criticality === "high" ? 1 : 2;
      const bCrit = b.criticality === "critical" ? 0 : b.criticality === "high" ? 1 : 2;
      if (aCrit !== bCrit) return aCrit - bCrit;
      return b.wasteAdjustedDemand - a.wasteAdjustedDemand;
    })
    .slice(0, 12)
    .map((it) => {
      const peakDemand = it.wasteAdjustedDemand * (1 + result.peakDay * 0.01);
      const totalOnHand = ctx.balances
        .filter((b) => b.itemId === it.id)
        .reduce((s, b) => s + b.onHand, 0);
      const totalNeed = peakDemand * 7;
      const shortfall = Math.max(0, totalNeed - totalOnHand);
      return {
        itemId: it.id,
        itemName: it.name,
        peakDemandPerDay: Number(peakDemand.toFixed(2)),
        totalShortfall: Number(shortfall.toFixed(0)),
        recommendedReorder: Number((shortfall * 1.2).toFixed(0)),
      };
    });

  // Timeline (one point per simulated step)
  const timeline = result.steps.map((s) => {
    const dosVals = Object.values(s.dosByNode).filter((v) => v < 999);
    const networkDOS =
      dosVals.length > 0 ? dosVals.reduce((a, b) => a + b, 0) / dosVals.length : 0;
    const openShortages = Object.values(s.criticalShortByNode).reduce(
      (a, b) => a + b,
      0,
    );
    const riskAvg =
      Object.values(s.riskByNode).reduce((a, b) => a + b, 0) /
      Math.max(1, Object.keys(s.riskByNode).length);
    return {
      day: s.day,
      networkDaysOfSupply: Number(networkDOS.toFixed(2)),
      openShortages,
      demandIndex: Number((riskAvg / 50).toFixed(2)),
    };
  });

  const baselineNetworkDOS = (() => {
    const baselineVals = result.impactedNodes
      .map((n) => perNode.find((p) => p.nodeId === n.nodeId)?.daysOfSupplyBefore ?? 999)
      .filter((v) => v < 999);
    return baselineVals.length > 0
      ? Number((baselineVals.reduce((a, b) => a + b, 0) / baselineVals.length).toFixed(1))
      : 0;
  })();
  const afterNetworkDOS = (() => {
    const vals = perNode.map((p) => p.daysOfSupplyAfter).filter((v) => v < 999);
    return vals.length > 0
      ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1))
      : 0;
  })();

  return {
    scenario: {
      id,
      name,
      description: summary,
      status: "completed",
      createdAt: runAt.toISOString(),
      completedAt: runAt.toISOString(),
      createdByRole: null,
    },
    summary: {
      estimatedShortageEvents: timeline.reduce((s, t) => s + t.openShortages, 0),
      peakRiskNodeId: peakRiskNodeRow?.nodeId ?? null,
      peakRiskNodeName: peakRiskNodeRow ? nodeMap.get(peakRiskNodeRow.nodeId)?.name ?? null : null,
      networkDaysOfSupplyBefore: baselineNetworkDOS,
      networkDaysOfSupplyAfter: afterNetworkDOS,
      peakDemandMultiplier: timeline.length > 0 ? Math.max(...timeline.map((t) => t.demandIndex)) : 1,
      avgRoutingLatency: 0,
      confidenceScore: 0.78,
    },
    perNode,
    perItem,
    recommendations: buildScenarioRecommendationsView({
      scenarioId: id,
      result,
      ctx,
      suppliers,
      promotedByRecId,
      runAt,
    }),
    timeline,
    narrative: coaBrief || null,
    kind,
  };
}

type ScenarioRecRow = typeof recsTable.$inferInsert;

function pickSupplierForNode(
  nodeId: string,
  ctx: ScenarioCtxLite,
  suppliers: SimSupplier[],
): SimSupplier | undefined {
  if (suppliers.length === 0) return undefined;
  const upstream = findUpstreamRoute(nodeId, ctx.routes);
  if (upstream) {
    const matched = suppliers.find((s) => s.id === upstream.fromNode);
    if (matched) return matched;
  }
  return suppliers[0];
}

function priorityForDOS(dos: number, criticalDays: number): "FLASH" | "URGENT" | "ROUTINE" {
  if (dos <= criticalDays) return "FLASH";
  if (dos <= criticalDays * 2) return "URGENT";
  return "ROUTINE";
}

function recKindForDOS(dos: number, criticalDays: number): string {
  if (dos <= criticalDays) return "ESCALATE";
  return "REORDER";
}

function buildScenarioRecRationale(args: {
  itemName: string;
  unitOfIssue: string;
  nodeName: string;
  qty: number;
  dos: number;
  burn: number;
  supplierName?: string;
  etaDays: number;
}): string {
  const supplierClause = args.supplierName
    ? ` via ${args.supplierName} (~${args.etaDays.toFixed(0)}d ETA)`
    : "";
  return `Pre-position ${args.qty.toLocaleString()} ${args.unitOfIssue} ${args.itemName} to ${args.nodeName} — projected DOS ${args.dos.toFixed(1)} d at ${args.burn.toFixed(1)}/d burn${supplierClause}.`;
}

function buildScenarioRecommendationRows(args: {
  scenarioId: string;
  result: ReturnType<typeof runScenario>;
  ctx: ScenarioCtxLite;
  suppliers: SimSupplier[];
}): ScenarioRecRow[] {
  const { scenarioId, result, ctx, suppliers } = args;
  const nodeMap = new Map(ctx.nodes.map((n) => [n.id, n]));
  const itemMap = new Map(ctx.items.map((i) => [i.id, i]));
  const rows: ScenarioRecRow[] = [];
  const shortlist = result.perItemShortfall.slice(0, 8);
  for (const sf of shortlist) {
    const node = nodeMap.get(sf.nodeId);
    const item = itemMap.get(sf.itemId);
    if (!node || !item) continue;
    const supplier = pickSupplierForNode(sf.nodeId, ctx, suppliers);
    const upstream = findUpstreamRoute(sf.nodeId, ctx.routes);
    const eta = Math.round(
      ((supplier?.leadTimeDaysMean ?? item.leadTimeDays) + (upstream?.days ?? 2)) * 10,
    ) / 10;
    const expectedRiskReduction = Math.min(
      90,
      Math.round(((ctx.watchDays - sf.projectedDOS) / Math.max(1, ctx.watchDays)) * 60) +
        (sf.projectedDOS <= ctx.criticalDays ? 25 : 0),
    );
    rows.push({
      id: `rec-sc-${scenarioId}-${sf.nodeId}-${sf.itemId}`,
      nodeId: sf.nodeId,
      itemId: sf.itemId,
      kind: recKindForDOS(sf.projectedDOS, ctx.criticalDays),
      suggestedQty: sf.suggestedQty,
      reason: buildScenarioRecRationale({
        itemName: item.name,
        unitOfIssue: item.unitOfIssue,
        nodeName: node.name,
        qty: sf.suggestedQty,
        dos: sf.projectedDOS,
        burn: sf.peakDemandPerDay,
        supplierName: supplier?.name,
        etaDays: eta,
      }),
      expectedRiskReduction,
      sourceSupplierId: supplier?.id ?? null,
      etaDays: eta,
      status: "OPEN",
      scenarioId,
    });
  }
  return rows;
}

function buildScenarioRecommendationsView(args: {
  scenarioId: string;
  result: ReturnType<typeof runScenario>;
  ctx: ScenarioCtxLite;
  suppliers: SimSupplier[];
  promotedByRecId: Map<string, string | null>;
  runAt: Date;
}) {
  const { scenarioId, result, ctx, suppliers, promotedByRecId, runAt } = args;
  const nodeMap = new Map(ctx.nodes.map((n) => [n.id, n]));
  const itemMap = new Map(ctx.items.map((i) => [i.id, i]));
  const rows = buildScenarioRecommendationRows({ scenarioId, result, ctx, suppliers });
  return rows.map((row) => {
    const node = nodeMap.get(row.nodeId);
    const item = itemMap.get(row.itemId);
    const supplier = suppliers.find((s) => s.id === row.sourceSupplierId);
    const dosFromShortfall =
      result.perItemShortfall.find(
        (sf) => sf.nodeId === row.nodeId && sf.itemId === row.itemId,
      )?.projectedDOS ?? 999;
    return {
      id: row.id,
      kind: row.kind,
      nodeId: row.nodeId,
      nodeName: node?.name,
      itemId: row.itemId,
      itemName: item?.name,
      quantity: row.suggestedQty ?? 0,
      priority: priorityForDOS(dosFromShortfall, ctx.criticalDays),
      rationale: row.reason,
      suggestedSupplierId: row.sourceSupplierId ?? null,
      suggestedSupplierName: supplier?.name ?? null,
      suggestedFromNodeId: supplier?.id ?? null,
      etaDays: row.etaDays ?? 0,
      estimatedCost: Number(((row.suggestedQty ?? 0) * 1.5).toFixed(2)),
      generatedAt: runAt.toISOString(),
      confidenceScore: Math.min(0.95, 0.55 + (row.expectedRiskReduction ?? 0) / 200),
      scenarioId,
      promotedOrderId: promotedByRecId.get(row.id) ?? null,
    };
  });
}

function buildFallbackBrief(
  name: string,
  summary: string,
  peakDay: number,
  topImpacted: string[],
): string {
  return `**BLUF:** Scenario "${name}" produces measurable Class VIII risk; peak stress at D+${peakDay}.

**Impact Assessment**
- ${summary || "Perturbation modeled across theater nodes."}
- Top impacted nodes:\n  - ${topImpacted.join("\n  - ")}
- Baseline supply posture is degraded; primary upstream routes likely insufficient.

**Recommended COA**
1. Pre-position reserve stock to top-3 impacted hubs within 72h (low cost, high risk reduction).
2. Open secondary route via host-nation channel; accept ~15% reliability hit (medium cost, medium risk reduction).
3. Issue FLASH replenishment from CONUS depot via airlift (high cost, highest risk reduction).

**Decision Point:** Approve COA selection within 12 hours to preserve all options.`;
}

export default router;
