import { Router, type IRouter } from "express";
import { db, profiles } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const ROLES = [
  {
    id: "commander",
    label: "Commander",
    description: "Theater commander — focused on risk posture, COA decisions, escalation.",
  },
  {
    id: "logistician",
    label: "Logistician",
    description: "Class VIII supply chain operator — orders, inventory, lead times.",
  },
  {
    id: "medical_planner",
    label: "Medical Planner",
    description: "Surgeon's office — demand planning, mass casualty contingencies.",
  },
  {
    id: "analyst",
    label: "Analyst",
    description: "J-2 / J-4 analyst — scenarios, modeling, after-action.",
  },
];

async function ensureProfile() {
  const rows = await db.select().from(profiles);
  if (rows.length === 0) {
    await db.insert(profiles).values({});
    return (await db.select().from(profiles))[0];
  }
  return rows[0];
}

router.get("/profile", async (_req, res, next) => {
  try {
    res.json(await ensureProfile());
  } catch (err) {
    next(err);
  }
});

router.patch("/profile", async (req, res, next) => {
  try {
    const cur = await ensureProfile();
    if (!cur) return res.status(500).json({ error: "profile not initialised" });
    const allowed: (keyof typeof cur)[] = [
      "displayName",
      "role",
      "theaterAssignment",
      "contactEmail",
    ];
    const update: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in (req.body as Record<string, unknown>)) {
        update[k] = (req.body as Record<string, unknown>)[k];
      }
    }
    if (Object.keys(update).length > 0) {
      await db.update(profiles).set(update).where(eq(profiles.id, cur.id));
    }
    res.json(await ensureProfile());
  } catch (err) {
    next(err);
  }
});

router.get("/profile/roles", async (_req, res) => {
  res.json(ROLES);
});

export default router;
