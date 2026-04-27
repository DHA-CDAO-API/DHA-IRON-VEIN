import { Router, type IRouter } from "express";
import {
  db,
  conversations,
  conversationMessages,
  appSettings,
  activityEntries,
} from "@workspace/db";
import { asc, desc, eq } from "drizzle-orm";
import {
  COMMANDER_SYSTEM,
  buildTheaterContext,
  resolveModel,
  streamChat,
  type ChatMessage,
} from "@workspace/ai-orchestrator";
import { computeRiskByNode, computeInFlightShipments } from "../lib/snapshot";
import { loadSimContext } from "../lib/ctx";

const router: IRouter = Router();

router.get("/copilot/conversations", async (_req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(conversations)
      .orderBy(desc(conversations.updatedAt))
      .limit(50);
    res.json(
      rows.map((c) => ({
        id: c.id,
        title: c.title,
        role: c.role,
        aiProvider: c.aiProvider,
        aiModel: c.aiModel,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.post("/copilot/conversations", async (req, res, next) => {
  try {
    const body = req.body as { title?: string; role?: string };
    const id = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const [settings] = await db.select().from(appSettings);
    await db.insert(conversations).values({
      id,
      title: body.title ?? "New conversation",
      role: body.role ?? "commander",
      aiProvider: settings?.aiProvider ?? "openai",
      aiModel: settings?.aiModel ?? "gpt-5.4",
    });
    res.status(201).json({
      id,
      title: body.title ?? "New conversation",
      role: body.role ?? "commander",
      aiProvider: settings?.aiProvider ?? "openai",
      aiModel: settings?.aiModel ?? "gpt-5.4",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/copilot/conversations/:conversationId", async (req, res, next) => {
  try {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, req.params.conversationId));
    if (!conv) return res.status(404).json({ error: "conversation not found" });
    const msgs = await db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conv.id))
      .orderBy(asc(conversationMessages.createdAt));
    res.json({
      id: conv.id,
      title: conv.title,
      role: conv.role,
      aiProvider: conv.aiProvider,
      aiModel: conv.aiModel,
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt.toISOString(),
      messages: msgs.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        citations: m.citations,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/copilot/conversations/:conversationId/messages",
  async (req, res, next) => {
    try {
      const convId = req.params.conversationId;
      const body = req.body as { content: string };
      const [conv] = await db.select().from(conversations).where(eq(conversations.id, convId));
      if (!conv) return res.status(404).json({ error: "conversation not found" });

      await db.insert(conversationMessages).values({
        conversationId: convId,
        role: "user",
        content: body.content,
      });

      const [risk, shipments, ctx, settings] = await Promise.all([
        computeRiskByNode(),
        computeInFlightShipments(),
        loadSimContext(),
        db.select().from(appSettings).then((rows) => rows[0]),
      ]);
      const provider = (settings?.aiProvider ?? conv.aiProvider) as "openai" | "anthropic";
      const model = resolveModel(provider, settings?.aiModel ?? conv.aiModel);

      const top5 = [...risk.riskByNode]
        .sort((a, b) => b.riskScore - a.riskScore)
        .slice(0, 5)
        .map((r) => ({
          id: r.nodeId,
          name: ctx.ctx.nodes.find((n) => n.id === r.nodeId)?.name ?? r.nodeId,
          risk: r.riskScore,
          dos: r.daysOfSupply,
        }));

      const theaterContext = buildTheaterContext({
        operationalState: risk.operationalState,
        topRiskNodes: top5,
        openCriticalAlerts: risk.riskByNode.reduce((s, r) => s + (r.openAlerts ?? 0), 0),
        shipmentsInFlight: shipments.length,
      });

      const history = await db
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, convId))
        .orderBy(asc(conversationMessages.createdAt));
      const messages: ChatMessage[] = history.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      const send = (obj: unknown) => {
        res.write(`data: ${JSON.stringify(obj)}\n\n`);
      };

      let assistantBuffer = "";
      try {
        for await (const chunk of streamChat({
          provider,
          model,
          system: `${COMMANDER_SYSTEM}\n\n${theaterContext}\n\nUser role: ${conv.role}.`,
          messages,
          maxOutputTokens: 700,
        })) {
          if (chunk.type === "token") {
            assistantBuffer += chunk.value;
            send(chunk);
          } else if (chunk.type === "error") {
            send(chunk);
          } else if (chunk.type === "done") {
            send(chunk);
          }
        }
      } catch (err) {
        send({ type: "error", value: err instanceof Error ? err.message : String(err) });
        send({ type: "done" });
      }

      const citations = extractCitations(assistantBuffer);
      await db.insert(conversationMessages).values({
        conversationId: convId,
        role: "assistant",
        content: assistantBuffer,
        citations,
      });
      await db
        .update(conversations)
        .set({ updatedAt: new Date() })
        .where(eq(conversations.id, convId));
      await db.insert(activityEntries).values({
        kind: "COPILOT_MESSAGE",
        actor: conv.role,
        message: `Copilot reply (${assistantBuffer.length} chars)`,
        refType: "conversation",
        refId: convId,
        meta: { provider, model },
      });
      res.end();
    } catch (err) {
      req.log?.error({ err }, "copilot stream failed");
      next(err);
    }
  },
);

function extractCitations(text: string): Array<{ refType: string; refId: string }> {
  const out: Array<{ refType: string; refId: string }> = [];
  const re = /\[(node|item|order|alert):([\w-]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const refType = m[1];
    const refId = m[2];
    if (!refType || !refId) continue;
    if (out.find((c) => c.refType === refType && c.refId === refId)) continue;
    out.push({ refType, refId });
  }
  return out;
}

export default router;
