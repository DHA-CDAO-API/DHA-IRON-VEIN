import { Router, type IRouter } from "express";
import { db, scenarios as scenariosTable, presetEvents, appSettings, activityEntries } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { loadSimContext } from "../lib/ctx";
import { runScenario, type ScenarioRunInput } from "@workspace/sim";
import { completeChat, resolveModel, SCENARIO_BRIEF_SYSTEM } from "@workspace/ai-orchestrator";

const router: IRouter = Router();

router.get("/scenarios", async (_req, res, next) => {
  try {
    const rows = await db.select().from(scenariosTable).orderBy(desc(scenariosTable.runAt)).limit(50);
    res.json(
      rows.map((s) => ({
        id: s.id,
        name: s.name,
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
    res.json(rows);
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
    res.json({
      id: row.id,
      name: row.name,
      summary: row.summary,
      kind: row.kind,
      runAt: row.runAt.toISOString(),
      result: row.result,
      coaBrief: row.coaBrief,
      aiProvider: row.aiProvider,
      aiModel: row.aiModel,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/scenarios", async (req, res, next) => {
  try {
    const body = req.body as {
      name: string;
      kind: string;
      summary?: string;
      presetEventId?: string;
      perturbation?: ScenarioRunInput["perturbation"];
      horizonDays?: number;
      generateBrief?: boolean;
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
    res.json({
      id,
      name: body.name,
      summary,
      kind: body.kind,
      runAt: new Date().toISOString(),
      result,
      coaBrief,
      aiProvider,
      aiModel,
    });
  } catch (err) {
    req.log?.error({ err }, "scenario run failed");
    next(err);
  }
});

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
