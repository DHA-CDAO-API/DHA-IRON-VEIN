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
      rows.map((r) => ({
        id: r.id,
        ts: r.ts.toISOString(),
        kind: r.kind,
        actor: r.actor,
        message: r.message,
        refType: r.refType,
        refId: r.refId,
        meta: r.meta,
      })),
    );
  } catch (err) {
    next(err);
  }
});

export default router;
