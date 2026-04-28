import { Router, type IRouter } from "express";
import { db, scenarios as scenariosTable, presetEvents, appSettings, activityEntries } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { loadSimContext } from "../lib/ctx";
import { runScenario, type ScenarioRunInput } from "@workspace/sim";
import { completeChat, resolveModel, SCENARIO_BRIEF_SYSTEM } from "@workspace/ai-orchestrator";

const router: IRouter = Router();

function severityFromKind(kind: string): string {
  const k = kind.toUpperCase();
  if (k.includes("CONFLICT") || k.includes("WAR") || k.includes("PRC") || k.includes("MASCAS")) return "CRITICAL";
  if (k.includes("TYPHOON") || k.includes("WEATHER") || k.includes("STORM")) return "HIGH";
  if (k.includes("COLD_CHAIN") || k.includes("OUTAGE")) return "HIGH";
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
    const rows = await db.select().from(presetEvents);
    res.json(
      rows.map((p) => ({
        id: p.id,
        // OpenAPI contract
        label: p.name,
        description: p.summary,
        severity: severityFromKind(p.kind),
        parameters: p.parameters,
        // Legacy fields
        name: p.name,
        kind: p.kind,
        summary: p.summary,
        durationDays: p.durationDays,
      })),
    );
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
    const envelope = buildScenarioResultEnvelope({
      id: row.id,
      name: row.name,
      summary: row.summary,
      kind: row.kind,
      runAt: row.runAt,
      result: row.result as ReturnType<typeof runScenario>,
      coaBrief: row.coaBrief ?? "",
      ctx: ctx.ctx,
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
  perturbation: z.record(z.unknown()).optional(),
  horizonDays: z.number().int().positive().max(45).optional(),
  generateBrief: z.boolean().optional(),
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
    let perturbation = body.perturbation ?? {};
    let summary = body.summary ?? "";
    let presetMeta: Record<string, unknown> | undefined;
    if (body.presetEventId) {
      const [preset] = await db
        .select()
        .from(presetEvents)
        .where(eq(presetEvents.id, body.presetEventId));
      if (preset) {
        const params = preset.parameters as ScenarioRunInput["perturbation"];
        perturbation = { ...params, ...(body.perturbation ?? {}) };
        summary = summary || preset.summary;
        presetMeta = { presetEventId: preset.id, presetName: preset.name };
      }
    }

    const horizonDays = Math.max(1, Math.min(45, body.horizonDays ?? 21));
    const result = runScenario(ctx.ctx, { horizonDays, perturbation });

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
    const envelope = buildScenarioResultEnvelope({
      id,
      name: body.name,
      summary,
      kind: body.kind,
      runAt: new Date(),
      result,
      coaBrief,
      ctx: ctx.ctx,
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
}) {
  const { id, name, summary, kind, runAt, result, coaBrief, ctx } = args;
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
    recommendations: [],
    timeline,
    narrative: coaBrief || null,
    kind,
  };
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
