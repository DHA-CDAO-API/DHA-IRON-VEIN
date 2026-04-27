import { Router, type IRouter } from "express";
import { db, alerts, activityEntries } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/alerts", async (req, res, next) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const severity = typeof req.query.severity === "string" ? req.query.severity : undefined;
    const conds = [];
    if (status) conds.push(eq(alerts.status, status));
    if (severity) conds.push(eq(alerts.severity, severity));
    const rows = conds.length
      ? await db.select().from(alerts).where(and(...conds)).orderBy(desc(alerts.openedAt))
      : await db.select().from(alerts).orderBy(desc(alerts.openedAt));
    res.json(
      rows.map((a) => ({
        ...a,
        openedAt: a.openedAt.toISOString(),
        ackedAt: a.ackedAt ? a.ackedAt.toISOString() : null,
        resolvedAt: a.resolvedAt ? a.resolvedAt.toISOString() : null,
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.post("/alerts/:alertId/ack", async (req, res, next) => {
  try {
    const id = req.params.alertId;
    const ackedBy = (req.body as { ackedBy?: string }).ackedBy ?? "operator";
    await db
      .update(alerts)
      .set({ status: "ACK", ackedBy, ackedAt: new Date() })
      .where(eq(alerts.id, id));
    const [row] = await db.select().from(alerts).where(eq(alerts.id, id));
    if (!row) return res.status(404).json({ error: "alert not found" });
    await db.insert(activityEntries).values({
      kind: "ALERT_ACK",
      actor: ackedBy,
      message: `Alert ${id} acknowledged`,
      refType: "alert",
      refId: id,
      meta: {},
    });
    res.json({
      ...row,
      openedAt: row.openedAt.toISOString(),
      ackedAt: row.ackedAt ? row.ackedAt.toISOString() : null,
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
