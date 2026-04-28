import { Router, type IRouter } from "express";
import { db, activityEntries } from "@workspace/db";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/activity", async (req, res, next) => {
  try {
    const limit = Math.min(200, Number(req.query.limit ?? 30) || 30);
    const rows = await db
      .select()
      .from(activityEntries)
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
