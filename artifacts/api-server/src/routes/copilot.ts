import { Router, type IRouter } from "express";
import {
  db,
  conversations,
  conversationMessages,
  appSettings,
  activityEntries,
  alerts as alertsTable,
  orders as ordersTable,
} from "@workspace/db";
import { and, asc, desc, eq, gte } from "drizzle-orm";
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
    const convId = req.params.conversationId;
    const body = req.body as { content: string };

    // 1. Conversation lookup happens BEFORE any SSE response so a missing
    //    conversation can surface as a normal 404 with JSON body.
    let conv;
    try {
      [conv] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, convId));
    } catch (err) {
      return next(err);
    }
    if (!conv) return res.status(404).json({ error: "conversation not found" });

    // 2. Commit the SSE response immediately. Once headers are flushed,
    //    every subsequent failure becomes a `data: {type:"error",...}`
    //    frame the client already knows how to render — instead of a
    //    bare HTTP 500 with no detail (which prod's sanitizing error
    //    handler would otherwise produce). This both improves UX and
    //    makes prod-only failures debuggable from the browser.
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const send = (obj: unknown) => {
      try {
        res.write(`data: ${JSON.stringify(obj)}\n\n`);
      } catch {
        /* client disconnected — nothing to do */
      }
    };

    let assistantBuffer = "";
    let provider: "openai" | "anthropic" = "openai";
    let model = "";

    try {
      await db.insert(conversationMessages).values({
        conversationId: convId,
        role: "user",
        content: body.content,
      });

      const sinceRecentOrders = new Date(Date.now() - 14 * 86_400_000);
      const [risk, shipments, ctx, settings, openAlerts, recentOrders] =
        await Promise.all([
          computeRiskByNode(),
          computeInFlightShipments(),
          loadSimContext(),
          db.select().from(appSettings).then((rows) => rows[0]),
          db
            .select()
            .from(alertsTable)
            .where(eq(alertsTable.status, "OPEN"))
            .orderBy(desc(alertsTable.openedAt))
            .limit(60),
          db
            .select()
            .from(ordersTable)
            .where(
              and(
                gte(ordersTable.createdAt, sinceRecentOrders),
              ),
            )
            .orderBy(desc(ordersTable.createdAt))
            .limit(40),
        ]);
      provider = (settings?.aiProvider ?? conv.aiProvider) as
        | "openai"
        | "anthropic";
      model = resolveModel(provider, settings?.aiModel ?? conv.aiModel);

      const top5 = [...risk.riskByNode]
        .sort((a, b) => b.riskScore - a.riskScore)
        .slice(0, 5)
        .map((r) => ({
          id: r.nodeId,
          name: ctx.ctx.nodes.find((n) => n.id === r.nodeId)?.name ?? r.nodeId,
          risk: r.riskScore,
          dos: r.daysOfSupply,
        }));

      // Sort alerts critical-first so the truncation keeps the most important.
      const sortedAlerts = [...openAlerts].sort((a, b) => {
        const sevRank = (s: string) => (s === "CRITICAL" ? 0 : s === "WARNING" ? 1 : 2);
        return sevRank(a.severity) - sevRank(b.severity);
      });

      const theaterContext = buildTheaterContext({
        operationalState: risk.operationalState,
        topRiskNodes: top5,
        openCriticalAlerts: risk.riskByNode.reduce((s, r) => s + (r.openAlerts ?? 0), 0),
        shipmentsInFlight: shipments.length,
        nodes: ctx.ctx.nodes.map((n) => ({
          id: n.id,
          name: n.name,
          countryCode: (n as { countryCode?: string | null }).countryCode ?? null,
          type: (n as { type?: string | null }).type ?? null,
        })),
        items: ctx.ctx.items.map((i) => ({
          id: i.id,
          name: i.name,
          unitOfIssue: i.unitOfIssue ?? null,
          criticality: i.criticality ?? null,
        })),
        suppliers: ctx.suppliers.map((s) => ({
          id: s.id,
          name: s.name,
          leadTimeDaysMean: s.leadTimeDaysMean ?? null,
          reliabilityScore: s.reliabilityScore ?? null,
          itemsCovered: s.itemsCovered ?? [],
        })),
        alerts: sortedAlerts.map((a) => ({
          id: a.id,
          severity: a.severity,
          nodeId: a.nodeId,
          itemId: a.itemId ?? null,
          message: a.message ?? null,
        })),
        orders: recentOrders.map((o) => ({
          id: o.id,
          nodeId: o.nodeId,
          supplierId: o.supplierId ?? null,
          status: o.status,
          priority: o.priority ?? null,
          requestedDeliveryAt:
            o.requestedDeliveryAt instanceof Date
              ? o.requestedDeliveryAt.toISOString()
              : (o.requestedDeliveryAt as string | null) ?? null,
        })),
        shipments: shipments.map((s) => ({
          id: s.id,
          fromNode: s.fromNode,
          toNode: s.toNode,
          itemId: s.itemId,
          itemName: s.itemName,
          quantity: s.quantity,
          etaDays: s.etaDays,
          priority: s.priority,
        })),
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
    } catch (err) {
      // SSE response is already committed (status 200), so we surface the
      // failure as an in-stream error frame the client renders inline —
      // not as an HTTP 500 with no detail. Full stack is logged server-side.
      // We deliberately echo the raw err.message in the SSE frame for this
      // hackathon demo so prod-only failures stay diagnosable from the
      // browser; for a hardened deployment, replace with a sanitized
      // user-safe string + correlation id.
      req.log?.error(
        { err, convId, provider, model },
        "copilot stream failed",
      );
      const msg = err instanceof Error ? err.message : String(err);
      send({ type: "error", value: msg });
      send({ type: "done" });
      // Persist an assistant-side error turn so the conversation transcript
      // stays consistent — otherwise the saved history is left with a
      // dangling user message and no reply, which corrupts the next turn's
      // context window. Best-effort: a DB failure here is non-fatal.
      try {
        await db.insert(conversationMessages).values({
          conversationId: convId,
          role: "assistant",
          content: `[copilot error] ${msg}`,
        });
        await db
          .update(conversations)
          .set({ updatedAt: new Date() })
          .where(eq(conversations.id, convId));
      } catch (persistErr) {
        req.log?.error(
          { err: persistErr, convId },
          "failed to persist copilot error turn",
        );
      }
    } finally {
      try {
        res.end();
      } catch {
        /* already ended */
      }
    }
  },
);

function extractCitations(text: string): Array<{ refType: string; refId: string }> {
  const out: Array<{ refType: string; refId: string }> = [];
  const re = /\[(node|item|order|alert|supplier|shipment):([\w-]+)\]/g;
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
