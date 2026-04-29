import { Router, type IRouter } from "express";
import { db, appSettings } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { decryptText, encryptText } from "../lib/crypto";

const router: IRouter = Router();

async function ensureSettings() {
  const rows = await db.select({ id: appSettings.id }).from(appSettings);
  if (rows.length === 0) {
    await db.insert(appSettings).values({});
  }
}

/** Mask an API-key-like string for display purposes. */
function maskSecret(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 6) return "•".repeat(value.length);
  return `${value.slice(0, 3)}${"•".repeat(Math.max(4, value.length - 6))}${value.slice(-3)}`;
}

async function readSettingsResponse() {
  await ensureSettings();
  const rows = await db
    .select({
      id: appSettings.id,
      aiProvider: appSettings.aiProvider,
      aiModel: appSettings.aiModel,
      aiProviderApiKeyEnc: appSettings.aiProviderApiKeyEnc,
      // Decrypt only to mask — we never echo the secret in plaintext.
      aiProviderApiKeyPlain: decryptText(appSettings.aiProviderApiKeyEnc),
      autoFlyMap: appSettings.autoFlyMap,
      demandPaddingDays: appSettings.demandPaddingDays,
      wasteFactor: appSettings.wasteFactor,
      dmlssConnectorEnabled: appSettings.dmlssConnectorEnabled,
      alertWatchThresholdDays: appSettings.alertWatchThresholdDays,
      alertCriticalThresholdDays: appSettings.alertCriticalThresholdDays,
    })
    .from(appSettings);
  const s = rows[0];
  if (!s) return null;
  return {
    id: s.id,
    aiProvider: s.aiProvider,
    aiModel: s.aiModel,
    aiProviderApiKeyConfigured: !!s.aiProviderApiKeyEnc,
    aiProviderApiKeyMasked: maskSecret(s.aiProviderApiKeyPlain),
    autoFlyMap: s.autoFlyMap,
    demandPaddingDays: s.demandPaddingDays,
    wasteFactor: s.wasteFactor,
    dmlssConnectorEnabled: s.dmlssConnectorEnabled,
    alertWatchThresholdDays: s.alertWatchThresholdDays,
    alertCriticalThresholdDays: s.alertCriticalThresholdDays,
  };
}

router.get("/settings", async (_req, res, next) => {
  try {
    const payload = await readSettingsResponse();
    if (!payload) return res.status(500).json({ error: "settings not initialised" });
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.patch("/settings", async (req, res, next) => {
  try {
    await ensureSettings();
    const body = req.body as Record<string, unknown>;
    const allowed = [
      "aiProvider",
      "aiModel",
      "autoFlyMap",
      "demandPaddingDays",
      "wasteFactor",
      "dmlssConnectorEnabled",
      "alertWatchThresholdDays",
      "alertCriticalThresholdDays",
    ] as const;
    const update: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in body) update[k] = body[k];
    }
    if ("aiProviderApiKey" in body) {
      const v = body.aiProviderApiKey;
      if (v == null || (typeof v === "string" && v.length === 0)) {
        update.aiProviderApiKeyEnc = sql`NULL`;
      } else if (typeof v === "string") {
        update.aiProviderApiKeyEnc = encryptText(v);
      }
    }
    if (Object.keys(update).length > 0) {
      const rows = await db.select({ id: appSettings.id }).from(appSettings);
      const id = rows[0]?.id;
      if (id !== undefined) {
        await db.update(appSettings).set(update).where(eq(appSettings.id, id));
      }
    }
    // Re-read through the GET shape to keep response consistent.
    const payload = await readSettingsResponse();
    if (!payload) return res.status(500).json({ error: "settings not initialised" });
    return res.json(payload);
  } catch (err) {
    next(err);
  }
});

export default router;
