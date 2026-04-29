import { Router, type IRouter } from "express";
import { db, activityEntries } from "@workspace/db";
import { and, desc, eq, or, sql, type SQL } from "drizzle-orm";

const router: IRouter = Router();

router.get("/activity", async (req, res, next) => {
  try {
    const limit = Math.min(200, Number(req.query.limit ?? 30) || 30);
    const nodeId = typeof req.query.nodeId === "string" && req.query.nodeId.length > 0
      ? req.query.nodeId
      : null;
    const kind = typeof req.query.kind === "string" && req.query.kind.length > 0
      ? req.query.kind
      : null;

    const conditions: SQL[] = [];
    if (nodeId) {
      const metaNodeIdMatches = sql`${activityEntries.meta}->>'nodeId' = ${nodeId}`;
      conditions.push(
        or(
          and(eq(activityEntries.refType, "node"), eq(activityEntries.refId, nodeId))!,
          metaNodeIdMatches,
        )!,
      );
    }
    if (kind) {
      conditions.push(eq(activityEntries.kind, kind));
    }

    const rows = await db
      .select()
      .from(activityEntries)
      .where(conditions.length === 1 ? conditions[0] : conditions.length > 1 ? and(...conditions) : undefined)
      .orderBy(desc(activityEntries.ts))
      .limit(limit);
    res.json(
      rows.map((r) => {
        const meta = (r.meta ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          // OpenAPI contract
          kind: r.kind,
          summary: r.message,
          nodeId: r.refType === "node" ? r.refId : (typeof meta.nodeId === "string" ? meta.nodeId : null),
          itemId: r.refType === "item" ? r.refId : (typeof meta.itemId === "string" ? meta.itemId : null),
          orderId: r.refType === "order" ? r.refId : null,
          scenarioId: r.refType === "scenario" ? r.refId : null,
          actorRole: r.actor,
          createdAt: r.ts.toISOString(),
          // Legacy fields
          ts: r.ts.toISOString(),
          actor: r.actor,
          message: r.message,
          refType: r.refType,
          refId: r.refId,
          meta: r.meta,
        };
      }),
    );
  } catch (err) {
    next(err);
  }
});

export default router;
