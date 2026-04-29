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
  rankSuppliersForShortfall,
  classifySupplierChannel,
  applySupplierDegradation,
  summarizeSupplierImpact,
  type AppliedSupplierImpact,
  type RecommendationAlternative,
  type RecommendationDisplacement,
  type RecommendationSplitAllocation,
  type ScenarioRunInput,
  type ScenarioSupplierImpactRow,
  type SimSupplier,
  type SupplierImpact,
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

// Auto-suggest supplier impacts from the set of affected nodes' countries.
// Operator-supplied entries always win — we only add entries for suppliers
// whose `country` matches an affected country and which the operator has
// not already flagged. The defaults are intentionally conservative
// (50% capacity hit, +5d lead time, -0.15 reliability for the full
// horizon) so the impact is visible without overpowering the model.
function autoFlagSuppliersByCountry(args: {
  affectedNodeIds: string[];
  nodes: { id: string; countryCode?: string | null }[];
  suppliers: SimSupplier[];
  existing: SupplierImpact[];
}): SupplierImpact[] {
  const { affectedNodeIds, nodes, suppliers, existing } = args;
  if (affectedNodeIds.length === 0) return existing;
  const affectedSet = new Set(affectedNodeIds);
  const countries = new Set<string>();
  for (const n of nodes) {
    if (!affectedSet.has(n.id)) continue;
    if (typeof n.countryCode === "string" && n.countryCode.length > 0) {
      countries.add(n.countryCode.toUpperCase());
    }
  }
  if (countries.size === 0) return existing;
  const explicit = new Set(existing.map((e) => e.supplierId));
  const additions: SupplierImpact[] = [];
  for (const s of suppliers) {
    if (!s.country) continue;
    if (!countries.has(s.country.toUpperCase())) continue;
    if (explicit.has(s.id)) continue;
    additions.push({
      supplierId: s.id,
      capacityMultiplier: 0.5,
      leadTimeDeltaDays: 5,
      reliabilityDelta: -0.15,
      autoFlagged: true,
      cause: `In-country with affected nodes (${s.country})`,
    });
  }
  return [...existing, ...additions];
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
    // Reconstruct the supplier degradation that was in effect when the
    // scenario was saved so the rendered Supplier Impact section matches
    // the COA recommendations the operator originally saw.
    const inputs = (row.inputs as Record<string, unknown>) ?? {};
    const savedPerturbation =
      (inputs.perturbation as Record<string, unknown> | undefined) ?? {};
    const savedHorizon =
      typeof inputs.horizonDays === "number" ? (inputs.horizonDays as number) : 21;
    const savedImpacts: SupplierImpact[] = Array.isArray(
      savedPerturbation.impactedSuppliers,
    )
      ? (savedPerturbation.impactedSuppliers as SupplierImpact[])
      : [];
    const degraded = applySupplierDegradation({
      suppliers: ctx.suppliers,
      impacted: savedImpacts,
      horizonDays: savedHorizon,
    });
    const envelope = buildScenarioResultEnvelope({
      id: row.id,
      name: row.name,
      summary: row.summary,
      kind: row.kind,
      runAt: row.runAt,
      result: row.result as ReturnType<typeof runScenario>,
      coaBrief: row.coaBrief ?? "",
      ctx: ctx.ctx,
      suppliers: degraded.suppliers,
      baselineSuppliers: ctx.suppliers,
      appliedSupplierImpacts: degraded.applied,
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
    // Expand operator-drawn zones into affected nodes BEFORE the auto-flag
    // pass so suppliers in zone-only countries get auto-flagged on every
    // live preview tick (parity with the save/run path).
    if (raw.zoneIds && raw.zoneIds.length > 0) {
      const existingZ = Array.isArray(
        (perturbation as Record<string, unknown>).zoneIds,
      )
        ? ((perturbation as Record<string, unknown>).zoneIds as string[])
        : [];
      (perturbation as Record<string, unknown>).zoneIds = Array.from(
        new Set([...existingZ, ...raw.zoneIds]),
      );
    }
    await expandZonesIntoPerturbation(perturbation as Record<string, unknown>);
    const horizonDays = Math.max(1, Math.min(45, raw.horizonDays ?? 21));
    // Auto-flag suppliers in countries that contain affected nodes, then
    // apply the per-supplier degradation knobs to a horizon-blended copy
    // of the supplier list. The original list stays untouched so the
    // ranker can still see baseline values where needed. Operator-supplied
    // entries (including `excluded` tombstones for previously auto-flagged
    // suppliers) always win, so the operator has the final say.
    const explicitImpacts: SupplierImpact[] = Array.isArray(
      perturbation.impactedSuppliers,
    )
      ? perturbation.impactedSuppliers
      : [];
    const allImpacts = autoFlagSuppliersByCountry({
      affectedNodeIds: perturbation.affectedNodes ?? [],
      nodes: ctx.ctx.nodes,
      suppliers: ctx.suppliers,
      existing: explicitImpacts,
    });
    perturbation = { ...perturbation, impactedSuppliers: allImpacts };
    const degraded = applySupplierDegradation({
      suppliers: ctx.suppliers,
      impacted: allImpacts,
      horizonDays,
    });
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
      suppliers: degraded.suppliers,
      baselineSuppliers: ctx.suppliers,
      appliedSupplierImpacts: degraded.applied,
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

    // Auto-flag in-country suppliers (operator-supplied entries always win),
    // then apply degradation to a copy of the supplier list. The degraded
    // list is what the COA ranker sees, so degraded suppliers fall down
    // the alternatives list and offline ones are skipped entirely.
    const explicitImpacts: SupplierImpact[] = Array.isArray(
      (perturbation as Record<string, unknown>).impactedSuppliers,
    )
      ? ((perturbation as Record<string, unknown>).impactedSuppliers as SupplierImpact[])
      : [];
    const allImpacts = autoFlagSuppliersByCountry({
      affectedNodeIds: Array.isArray(perturbation.affectedNodes)
        ? (perturbation.affectedNodes as string[])
        : [],
      nodes: ctx.ctx.nodes,
      suppliers: ctx.suppliers,
      existing: explicitImpacts,
    });
    perturbation.impactedSuppliers = allImpacts;
    const degraded = applySupplierDegradation({
      suppliers: ctx.suppliers,
      impacted: allImpacts,
      horizonDays,
    });

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
      const supplierLines = degraded.applied.length > 0
        ? degraded.applied.slice(0, 6).map((a) => {
            const cap = (a.capacityMultiplierApplied * 100).toFixed(0);
            const flag = a.autoFlagged ? " [auto-flagged]" : "";
            const cause = a.cause ? ` cause=${a.cause}` : "";
            return `${a.supplierName} [supplier:${a.supplierId}] capacity=${cap}% +${a.leadTimeDeltaApplied.toFixed(1)}d lead Δrel=${a.reliabilityDeltaApplied.toFixed(2)} outage=${a.outageDays}d${flag}${cause}`;
          })
        : ["(no supplier degradation applied)"];
      const userMsg =
        `SCENARIO: ${body.name}\nKIND: ${body.kind}\nSUMMARY: ${summary}\nHORIZON: ${horizonDays} days\n` +
        `PERTURBATION: ${JSON.stringify(perturbation)}\nPEAK DAY: ${result.peakDay}\n` +
        `TOP IMPACTED NODES:\n${topImpacted.join("\n")}\n` +
        `IMPACTED SUPPLIERS:\n${supplierLines.join("\n")}\n\n` +
        `Write the COA brief. When suppliers are degraded, explicitly call out which sources are offline or constrained, which items they normally fulfill, and the recommended reroute.`;
      // Race the AI brief against a hard 12s deadline. The Replit
      // edge proxy in front of this server cancels upstream requests
      // that take too long and surfaces them to the browser as a
      // generic "HTTP 502 Bad Gateway", which operators see whenever
      // they save a scenario while the model is slow. Falling back
      // to the deterministic brief is far better UX than a 502: the
      // operator still gets a saved scenario plus a structured COA,
      // and a slow model can't take down the entire scenario flow.
      const briefDeadlineMs = 12_000;
      let deadlineTimer: NodeJS.Timeout | null = null;
      try {
        coaBrief = await Promise.race([
          completeChat({
            provider: aiProvider as "openai" | "anthropic",
            model: aiModel,
            system: SCENARIO_BRIEF_SYSTEM,
            messages: [{ role: "user", content: userMsg }],
            maxOutputTokens: 800,
          }),
          // Hard deadline guard. We cannot abort the in-flight LLM
          // request from here (the underlying HTTP client doesn't
          // expose an AbortController), so the losing promise's
          // tokens still bill — but at least we always clear the
          // timer on the happy path so we don't leak Node timers
          // for up to 12s on every successful scenario save.
          new Promise<string>((_resolve, reject) => {
            deadlineTimer = setTimeout(
              () =>
                reject(
                  new Error(
                    `AI brief exceeded ${briefDeadlineMs}ms deadline`,
                  ),
                ),
              briefDeadlineMs,
            );
          }),
        ]);
      } catch (err) {
        req.log?.warn({ err }, "AI brief failed; emitting deterministic fallback");
        coaBrief = buildFallbackBrief(body.name, summary, result.peakDay, topImpacted);
      } finally {
        if (deadlineTimer) clearTimeout(deadlineTimer);
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
      suppliers: degraded.suppliers,
      baselineSuppliers: ctx.suppliers,
      appliedSupplierImpacts: degraded.applied,
    });
    if (recsToPersist.length > 0) {
      // Strip envelope-only fields before insert (DB schema only has the
      // narrative reason; UI-only attribution stays in-memory).
      const dbRows = recsToPersist.map(
        ({
          alternatives: _alt,
          displacedFrom: _df,
          splitAllocation: _sa,
          ...row
        }) => row,
      );
      await db.insert(recsTable).values(dbRows).onConflictDoNothing();
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
      suppliers: degraded.suppliers,
      baselineSuppliers: ctx.suppliers,
      appliedSupplierImpacts: degraded.applied,
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
  // Supplier list the COA ranker should see — already mutated with any
  // active per-supplier degradation. The ranker treats availability,
  // lead-time, and reliability values as authoritative.
  suppliers: SimSupplier[];
  // Untouched supplier list used to compute the Supplier Impact section
  // (so we can show baseline values alongside the degraded ones).
  baselineSuppliers?: SimSupplier[];
  appliedSupplierImpacts?: AppliedSupplierImpact[];
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
    baselineSuppliers,
    appliedSupplierImpacts,
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

  // Timeline (one point per simulated step). We surface two DOS series:
  //   - networkDaysOfSupply: average across every node in the network.
  //     Useful for whole-of-theater health, but a few impacted MTFs can
  //     barely move the global average.
  //   - impactedDaysOfSupply: average across only the nodes flagged as
  //     impacted by the scenario. Lets the UI show a faithful picture of
  //     how the targeted sites degrade over the horizon.
  const impactedNodeIds = new Set(result.impactedNodes.map((n) => n.nodeId));
  const timeline = result.steps.map((s) => {
    const dosVals = Object.values(s.dosByNode).filter((v) => v < 999);
    const networkDOS =
      dosVals.length > 0 ? dosVals.reduce((a, b) => a + b, 0) / dosVals.length : 0;
    const impactedVals = Array.from(impactedNodeIds)
      .map((id) => s.dosByNode[id])
      .filter((v): v is number => typeof v === "number" && v < 999);
    const impactedDOS =
      impactedVals.length > 0
        ? impactedVals.reduce((a, b) => a + b, 0) / impactedVals.length
        : networkDOS;
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
      impactedDaysOfSupply: Number(impactedDOS.toFixed(2)),
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

  const recommendations = buildScenarioRecommendationsView({
    scenarioId: id,
    result,
    ctx,
    suppliers,
    baselineSuppliers,
    appliedSupplierImpacts,
    promotedByRecId,
    runAt,
  });

  // Build the Supplier Impact section. We derive the "rerouted to" map by
  // looking at the recs we just produced: for every shortfall item where
  // an impacted supplier USED to be a viable source (it covers the item)
  // but the ranker chose a different supplier, we tag that as a reroute
  // away from the impacted supplier.
  const baseline = baselineSuppliers ?? suppliers;
  const baselineById = new Map(baseline.map((s) => [s.id, s]));
  const reroutedTo = new Map<
    string,
    { supplierId: string; supplierName: string }
  >();
  if (appliedSupplierImpacts && appliedSupplierImpacts.length > 0) {
    const impactedIds = new Set(appliedSupplierImpacts.map((a) => a.supplierId));
    for (const rec of recommendations) {
      const chosenId = rec.suggestedSupplierId;
      if (!chosenId || impactedIds.has(chosenId)) continue;
      const chosenName = suppliers.find((s) => s.id === chosenId)?.name ?? chosenId;
      for (const impactedId of impactedIds) {
        const base = baselineById.get(impactedId);
        const items = base?.itemsCovered ?? [];
        if (items.length > 0 && !items.includes(rec.itemId)) continue;
        reroutedTo.set(`${impactedId}:${rec.itemId}`, {
          supplierId: chosenId,
          supplierName: chosenName,
        });
      }
    }
  }
  const shortfallItemIds = new Set(result.perItemShortfall.map((s) => s.itemId));
  const supplierImpact: ScenarioSupplierImpactRow[] =
    appliedSupplierImpacts && appliedSupplierImpacts.length > 0
      ? summarizeSupplierImpact({
          applied: appliedSupplierImpacts,
          baselineSuppliers: baseline,
          shortfallItemIds,
          reroutedTo,
        })
      : [];

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
    recommendations,
    timeline,
    narrative: coaBrief || null,
    cascades: result.cascades,
    cascadeNarrative: result.cascades?.narrative ?? [],
    supplierImpact,
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

function pickRankedSupplierForShortfall(args: {
  itemId: string;
  suggestedQty: number;
  shortfallHorizonDays: number;
  upstreamRouteDays: number;
  suppliers: SimSupplier[];
}) {
  const ranked = rankSuppliersForShortfall(args);
  return { top: ranked[0], all: ranked };
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
  channel?: "DOD" | "COMMERCIAL" | "HOST_NATION" | "ALLIED";
  etaDays: number;
  estimatedTotalCostUsd?: number;
  displacedFrom?: RecommendationDisplacement;
  splitAllocation?: RecommendationSplitAllocation[];
}): string {
  const supplierClause = args.supplierName
    ? ` via ${args.supplierName} (~${args.etaDays.toFixed(0)}d ETA)`
    : "";
  const channelClause = args.channel
    ? args.channel === "COMMERCIAL"
      ? " — Buy on market"
      : args.channel === "HOST_NATION"
        ? " — host-nation"
        : args.channel === "ALLIED"
          ? " — allied partner"
          : " — DOD prime"
    : "";
  const costClause =
    typeof args.estimatedTotalCostUsd === "number" && Number.isFinite(args.estimatedTotalCostUsd)
      ? ` Est. cost $${args.estimatedTotalCostUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`
      : "";
  // Explicit attribution: "primary supplier X is offline → routing through Y"
  // so the operator immediately understands why the COA shifted off the
  // steady-state pick.
  const displacedClause = args.displacedFrom
    ? args.displacedFrom.availabilityFraction <= 0.001
      ? ` Primary source ${args.displacedFrom.supplierName} is OFFLINE${args.displacedFrom.cause ? ` (${args.displacedFrom.cause})` : ""} — routing through ${args.supplierName ?? "alternate"}.`
      : ` Primary source ${args.displacedFrom.supplierName} at ${(args.displacedFrom.availabilityFraction * 100).toFixed(0)}% capacity${args.displacedFrom.cause ? ` (${args.displacedFrom.cause})` : ""} — routing through ${args.supplierName ?? "alternate"}.`
    : "";
  // Split-source attribution: when one supplier can't carry the load, we
  // call out the proportional fill across the chosen alternates.
  const splitClause =
    args.splitAllocation && args.splitAllocation.length >= 2
      ? ` Split fill: ${args.splitAllocation
          .map(
            (a) =>
              `${(a.pctOfTotal * 100).toFixed(0)}% ${a.supplierName} (${a.qty.toLocaleString()} ${args.unitOfIssue})`,
          )
          .join(" + ")}.`
      : "";
  return `Pre-position ${args.qty.toLocaleString()} ${args.unitOfIssue} ${args.itemName} to ${args.nodeName} — projected DOS ${args.dos.toFixed(1)} d at ${args.burn.toFixed(1)}/d burn${supplierClause}${channelClause}.${costClause}${displacedClause}${splitClause}`;
}

// Compute the would-be primary supplier for an item using *baseline* (un-
// degraded) supplier values. Returns the highest-ranked supplier that
// covers `itemId` against an empty perturbation. We use this to attribute
// reroutes back to the primary source the scenario knocked out.
function pickBaselinePrimary(args: {
  itemId: string;
  shortfallHorizonDays: number;
  upstreamRouteDays: number;
  baselineSuppliers: SimSupplier[];
}): SimSupplier | undefined {
  const ranked = rankSuppliersForShortfall({
    itemId: args.itemId,
    suggestedQty: 1,
    shortfallHorizonDays: args.shortfallHorizonDays,
    upstreamRouteDays: args.upstreamRouteDays,
    suppliers: args.baselineSuppliers,
  });
  if (ranked.length === 0) return undefined;
  return args.baselineSuppliers.find((s) => s.id === ranked[0].supplierId);
}

// Allocate `totalQty` across two suppliers proportional to their available
// capacity fractions. We only split when the primary's capacity is meaningfully
// constrained (< 0.7) AND a secondary alternate has higher availability;
// otherwise single-source as before.
function computeSplitAllocation(args: {
  totalQty: number;
  primary: RecommendationAlternative;
  alternates: RecommendationAlternative[];
  suppliers: SimSupplier[];
}): RecommendationSplitAllocation[] | undefined {
  const { totalQty, primary, alternates, suppliers } = args;
  if (totalQty <= 0) return undefined;
  const primarySim = suppliers.find((s) => s.id === primary.supplierId);
  const primaryAvail =
    typeof primarySim?.availabilityFraction === "number"
      ? primarySim.availabilityFraction
      : 1;
  if (primaryAvail >= 0.7) return undefined;
  // Find the next alternate that actually carries the item and has higher
  // availability than the primary. Skip the primary itself.
  const secondary = alternates.find((a) => {
    if (a.supplierId === primary.supplierId) return false;
    const sim = suppliers.find((s) => s.id === a.supplierId);
    const avail =
      typeof sim?.availabilityFraction === "number" ? sim.availabilityFraction : 1;
    return avail > primaryAvail + 0.05;
  });
  if (!secondary) return undefined;
  const secondarySim = suppliers.find((s) => s.id === secondary.supplierId);
  const secondaryAvail =
    typeof secondarySim?.availabilityFraction === "number"
      ? secondarySim.availabilityFraction
      : 1;
  const totalAvail = primaryAvail + secondaryAvail;
  if (totalAvail <= 0) return undefined;
  const primaryPct = primaryAvail / totalAvail;
  const secondaryPct = 1 - primaryPct;
  const primaryQty = Math.max(1, Math.round(totalQty * primaryPct));
  const secondaryQty = Math.max(1, totalQty - primaryQty);
  return [
    {
      supplierId: primary.supplierId,
      supplierName: primary.supplierName,
      channel: primary.channel,
      qty: primaryQty,
      pctOfTotal: Number((primaryQty / totalQty).toFixed(3)),
      etaDays: primary.etaDays,
    },
    {
      supplierId: secondary.supplierId,
      supplierName: secondary.supplierName,
      channel: secondary.channel,
      qty: secondaryQty,
      pctOfTotal: Number((secondaryQty / totalQty).toFixed(3)),
      etaDays: secondary.etaDays,
    },
  ];
}

type EnrichedRecRow = ScenarioRecRow & {
  alternatives: RecommendationAlternative[];
  displacedFrom?: RecommendationDisplacement;
  splitAllocation?: RecommendationSplitAllocation[];
};

// Lightweight directed-route lookup. Mirrors the sim package's internal
// `findRouteBetween` since that helper isn't exported from `@workspace/sim`.
function findScenarioRouteBetween(
  fromId: string,
  toId: string,
  routes: ScenarioCtxLite["routes"],
): { days: number; reliability: number } | null {
  const direct = routes.find((r) => r.fromNode === fromId && r.toNode === toId);
  if (direct) {
    return {
      days: direct.days,
      reliability: direct.reliability,
    };
  }
  return null;
}

// Decide whether a TLAMM hub should source a scenario shortfall, with
// neighbor-AOR fallback if the MTF's primary TLAMM is depleted or its
// route is broken. Returns `null` when no TLAMM can plausibly source
// the rec — the caller falls back to outside suppliers.
function pickScenarioTlammSource(args: {
  mtfNodeId: string;
  itemId: string;
  qty: number;
  ctx: ScenarioCtxLite;
}): { tlammNodeId: string; tlammName: string; etaDays: number; isNeighborAor: boolean } | null {
  const { mtfNodeId, itemId, qty, ctx } = args;
  const mtf = ctx.nodes.find((n) => n.id === mtfNodeId);
  if (!mtf || mtf.isTlamm) return null;
  const tlammStock = (tlammId: string): number =>
    ctx.balances
      .filter((b) => b.nodeId === tlammId && b.itemId === itemId)
      .reduce((sum, b) => sum + b.onHand, 0);
  const tryTlamm = (tlammId: string): { etaDays: number } | null => {
    const tlamm = ctx.nodes.find((n) => n.id === tlammId && n.isTlamm);
    if (!tlamm) return null;
    if (tlammStock(tlammId) < qty * 0.5) return null;
    const route = findScenarioRouteBetween(tlammId, mtfNodeId, ctx.routes);
    if (!route || route.reliability < 0.4) return null;
    return { etaDays: Math.round(route.days * 10) / 10 };
  };
  if (mtf.primaryTlammNodeId) {
    const primary = tryTlamm(mtf.primaryTlammNodeId);
    if (primary) {
      const t = ctx.nodes.find((n) => n.id === mtf.primaryTlammNodeId)!;
      return {
        tlammNodeId: t.id,
        tlammName: t.name,
        etaDays: primary.etaDays,
        isNeighborAor: false,
      };
    }
  }
  // Neighbor-AOR fallback: pick the TLAMM with the most stock + a working
  // route, even if it serves a different AOR.
  const candidates = ctx.nodes
    .filter((n) => n.isTlamm && n.id !== mtf.primaryTlammNodeId)
    .map((t) => ({ tlamm: t, stock: tlammStock(t.id) }))
    .filter((c) => c.stock >= qty * 0.5)
    .sort((a, b) => b.stock - a.stock);
  for (const c of candidates) {
    const ok = tryTlamm(c.tlamm.id);
    if (ok) {
      return {
        tlammNodeId: c.tlamm.id,
        tlammName: c.tlamm.name,
        etaDays: ok.etaDays,
        isNeighborAor: true,
      };
    }
  }
  return null;
}

function buildScenarioRecommendationRows(args: {
  scenarioId: string;
  result: ReturnType<typeof runScenario>;
  ctx: ScenarioCtxLite;
  suppliers: SimSupplier[];
  // Untouched supplier list — used to identify the would-be primary
  // source so we can attribute reroutes when degraded.
  baselineSuppliers?: SimSupplier[];
  appliedSupplierImpacts?: AppliedSupplierImpact[];
}): EnrichedRecRow[] {
  const { scenarioId, result, ctx, suppliers, baselineSuppliers, appliedSupplierImpacts } = args;
  const nodeMap = new Map(ctx.nodes.map((n) => [n.id, n]));
  const itemMap = new Map(ctx.items.map((i) => [i.id, i]));
  const rows: EnrichedRecRow[] = [];
  // Index applied impacts so we can attach human-friendly cause + capacity
  // to the displaced-from rationale.
  const appliedById = new Map(
    (appliedSupplierImpacts ?? []).map((a) => [a.supplierId, a]),
  );
  const baselineList = baselineSuppliers ?? suppliers;
  const shortlist = result.perItemShortfall.slice(0, 8);
  for (const sf of shortlist) {
    const node = nodeMap.get(sf.nodeId);
    const item = itemMap.get(sf.itemId);
    if (!node || !item) continue;
    const tlammPick = pickScenarioTlammSource({
      mtfNodeId: sf.nodeId,
      itemId: sf.itemId,
      qty: sf.suggestedQty,
      ctx,
    });
    const upstream = findUpstreamRoute(sf.nodeId, ctx.routes);
    const ranked = rankSuppliersForShortfall({
      itemId: sf.itemId,
      suggestedQty: sf.suggestedQty,
      shortfallHorizonDays: Math.max(ctx.criticalDays, sf.projectedDOS),
      upstreamRouteDays: upstream?.days ?? 2,
      suppliers,
    });
    const expectedRiskReduction = Math.min(
      90,
      Math.round(((ctx.watchDays - sf.projectedDOS) / Math.max(1, ctx.watchDays)) * 60) +
        (sf.projectedDOS <= ctx.criticalDays ? 25 : 0),
    );
    // Prefer sourcing from a TLAMM hub when one can plausibly cover the
    // shortfall (primary AOR first, then neighbor-AOR fallback). Encode
    // the chosen TLAMM in the rec id so the view function can attribute
    // sourceKind/sourceNode without needing extra DB columns.
    if (tlammPick) {
      const aorTag = tlammPick.isNeighborAor ? " (neighbor-AOR)" : "";
      rows.push({
        id: `rec-sc-${scenarioId}-${sf.nodeId}-${sf.itemId}-tlamm-${tlammPick.tlammNodeId}`,
        nodeId: sf.nodeId,
        itemId: sf.itemId,
        kind: recKindForDOS(sf.projectedDOS, ctx.criticalDays),
        suggestedQty: sf.suggestedQty,
        reason: `Pre-position ${sf.suggestedQty.toLocaleString()} ${item.unitOfIssue} ${item.name} from TLAMM hub ${tlammPick.tlammName}${aorTag} to ${node.name} — projected DOS ${sf.projectedDOS.toFixed(1)} d at ${sf.peakDemandPerDay.toFixed(1)}/d burn; ETA ${tlammPick.etaDays.toFixed(1)} d via theater stockpile.`,
        expectedRiskReduction,
        sourceSupplierId: null,
        sourceChannel: null,
        estimatedUnitCostUsd: 0,
        estimatedTotalCostUsd: 0,
        etaDays: tlammPick.etaDays,
        status: "OPEN",
        scenarioId,
        alternatives: ranked.slice(0, 4),
      });
      continue;
    }
    const top = ranked[0];
    // Identify the would-be primary against baseline values. If the chosen
    // supplier differs and the baseline primary is in the impacted set, we
    // attribute the reroute back to that primary so the rationale can say
    // "primary X at 40% capacity → routing through Y".
    const baselinePrimary =
      appliedSupplierImpacts && appliedSupplierImpacts.length > 0
        ? pickBaselinePrimary({
            itemId: sf.itemId,
            shortfallHorizonDays: Math.max(ctx.criticalDays, sf.projectedDOS),
            upstreamRouteDays: upstream?.days ?? 2,
            baselineSuppliers: baselineList,
          })
        : undefined;
    let displacedFrom: RecommendationDisplacement | undefined;
    if (
      baselinePrimary &&
      top &&
      baselinePrimary.id !== top.supplierId &&
      appliedById.has(baselinePrimary.id)
    ) {
      const a = appliedById.get(baselinePrimary.id)!;
      displacedFrom = {
        supplierId: baselinePrimary.id,
        supplierName: baselinePrimary.name,
        availabilityFraction: a.capacityMultiplierApplied,
        cause: a.cause,
      };
    }
    // Capacity-aware split sourcing: if the chosen supplier's availability is
    // constrained AND a healthier alternate exists, split the fill across both
    // suppliers proportional to capacity.
    const splitAllocation = top
      ? computeSplitAllocation({
          totalQty: sf.suggestedQty,
          primary: top,
          alternates: ranked.slice(1, 4),
          suppliers,
        })
      : undefined;
    // Fallback if no supplier carries the item: use the legacy upstream pick
    // so we never emit a row with a missing supplier when the catalog is
    // sparse.
    const fallback = top
      ? undefined
      : pickSupplierForNode(sf.nodeId, ctx, suppliers);
    const channel = top
      ? top.channel
      : fallback
        ? classifySupplierChannel(fallback)
        : null;
    const eta = top
      ? top.etaDays
      : Math.round(
          ((fallback?.leadTimeDaysMean ?? item.leadTimeDays) + (upstream?.days ?? 2)) * 10,
        ) / 10;
    const supplierName = top ? top.supplierName : fallback?.name;
    const estimatedUnitCost = top ? top.estimatedUnitCostUsd : 1.5;
    const estimatedTotalCost = top
      ? top.estimatedTotalCostUsd
      : Number((sf.suggestedQty * 1.5).toFixed(2));
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
        supplierName,
        channel: channel ?? undefined,
        etaDays: eta,
        estimatedTotalCostUsd: estimatedTotalCost,
        displacedFrom,
        splitAllocation,
      }),
      expectedRiskReduction,
      sourceSupplierId: top?.supplierId ?? fallback?.id ?? null,
      sourceChannel: channel ?? null,
      estimatedUnitCostUsd: estimatedUnitCost,
      estimatedTotalCostUsd: estimatedTotalCost,
      etaDays: eta,
      status: "OPEN",
      scenarioId,
      alternatives: ranked.slice(0, 4),
      displacedFrom,
      splitAllocation,
    });
  }
  return rows;
}

function buildScenarioRecommendationsView(args: {
  scenarioId: string;
  result: ReturnType<typeof runScenario>;
  ctx: ScenarioCtxLite;
  suppliers: SimSupplier[];
  baselineSuppliers?: SimSupplier[];
  appliedSupplierImpacts?: AppliedSupplierImpact[];
  promotedByRecId: Map<string, string | null>;
  runAt: Date;
}) {
  const {
    scenarioId,
    result,
    ctx,
    suppliers,
    baselineSuppliers,
    appliedSupplierImpacts,
    promotedByRecId,
    runAt,
  } = args;
  const nodeMap = new Map(ctx.nodes.map((n) => [n.id, n]));
  const itemMap = new Map(ctx.items.map((i) => [i.id, i]));
  const rows = buildScenarioRecommendationRows({
    scenarioId,
    result,
    ctx,
    suppliers,
    baselineSuppliers,
    appliedSupplierImpacts,
  });
  return rows.map((row) => {
    const node = nodeMap.get(row.nodeId);
    const item = itemMap.get(row.itemId);
    const supplier = suppliers.find((s) => s.id === row.sourceSupplierId);
    const dosFromShortfall =
      result.perItemShortfall.find(
        (sf) => sf.nodeId === row.nodeId && sf.itemId === row.itemId,
      )?.projectedDOS ?? 999;
    // TLAMM-sourced rows encode the chosen hub in the rec id
    // (`...-tlamm-{tlammNodeId}`); decode it here for source attribution.
    const tlammMatch = /-tlamm-([^-]+(?:-[^-]+)*)$/.exec(row.id);
    const tlammNode = tlammMatch ? nodeMap.get(tlammMatch[1]) : null;
    const isTlammSourced = Boolean(tlammNode?.isTlamm);
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
      suggestedFromNodeId: isTlammSourced ? (tlammNode?.id ?? null) : (supplier?.id ?? null),
      sourceKind: isTlammSourced ? "TLAMM" : row.sourceSupplierId ? "SUPPLIER" : null,
      sourceNodeId: isTlammSourced ? (tlammNode?.id ?? null) : null,
      sourceNodeName: isTlammSourced ? (tlammNode?.name ?? null) : null,
      sourceChannel: row.sourceChannel ?? null,
      etaDays: row.etaDays ?? 0,
      estimatedUnitCostUsd: row.estimatedUnitCostUsd ?? 0,
      estimatedTotalCostUsd: row.estimatedTotalCostUsd ?? 0,
      estimatedCost: row.estimatedTotalCostUsd ?? 0,
      alternatives: row.alternatives,
      displacedFrom: row.displacedFrom ?? null,
      splitAllocation: row.splitAllocation ?? null,
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
