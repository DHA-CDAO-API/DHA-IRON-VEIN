import { Router, type IRouter } from "express";
import { db, appSettings } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

async function ensureSettings() {
  const rows = await db.select().from(appSettings);
  if (rows.length === 0) {
    await db.insert(appSettings).values({});
    return (await db.select().from(appSettings))[0];
  }
  return rows[0];
}

router.get("/settings", async (_req, res, next) => {
  try {
    const s = await ensureSettings();
    res.json(s);
  } catch (err) {
    next(err);
  }
});

router.patch("/settings", async (req, res, next) => {
  try {
    const cur = await ensureSettings();
    if (!cur) return res.status(500).json({ error: "settings not initialised" });
    const allowed: (keyof typeof cur)[] = [
      "aiProvider",
      "aiModel",
      "autoFlyMap",
      "demandPaddingDays",
      "wasteFactor",
      "dmlssConnectorEnabled",
      "alertWatchThresholdDays",
      "alertCriticalThresholdDays",
    ];
    const update: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in (req.body as Record<string, unknown>)) {
        update[k] = (req.body as Record<string, unknown>)[k];
      }
    }
    if (Object.keys(update).length > 0) {
      await db.update(appSettings).set(update).where(eq(appSettings.id, cur.id));
    }
    const next = await ensureSettings();
    res.json(next);
  } catch (err) {
    next(err);
  }
});

export default router;
