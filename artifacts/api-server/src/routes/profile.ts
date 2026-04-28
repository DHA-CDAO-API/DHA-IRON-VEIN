import { Router, type IRouter } from "express";
import { db, profiles } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const ROLES = [
  {
    id: "commander",
    label: "Commander",
    description: "Theater commander — focused on risk posture, COA decisions, escalation.",
    focus: ["Risk posture", "COA decisions", "Escalation", "Force protection"],
    primaryColor: "#f59e0b",
  },
  {
    id: "logistician",
    label: "Logistician",
    description: "Class VIII supply chain operator — orders, inventory, lead times.",
    focus: ["Orders", "Inventory", "Lead times", "Throughput"],
    primaryColor: "#38bdf8",
  },
  {
    id: "medical_planner",
    label: "Medical Planner",
    description: "Surgeon's office — demand planning, mass casualty contingencies.",
    focus: ["Demand planning", "Mass-cas contingency", "Blood products", "Cold chain"],
    primaryColor: "#ef4444",
  },
  {
    id: "analyst",
    label: "Analyst",
    description: "J-2 / J-4 analyst — scenarios, modeling, after-action.",
    focus: ["Scenarios", "Modeling", "After-action", "Risk scoring"],
    primaryColor: "#a78bfa",
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

function toApiProfile(row: typeof profiles.$inferSelect) {
  return {
    name: row.displayName,
    role: row.role,
    base: row.theaterAssignment,
    avatar: null,
    lastActiveAt: new Date().toISOString(),
  };
}

router.get("/profile", async (_req, res, next) => {
  try {
    const cur = await ensureProfile();
    if (!cur) return res.status(500).json({ error: "profile not initialised" });
    res.json(toApiProfile(cur));
  } catch (err) {
    next(err);
  }
});

router.patch("/profile", async (req, res, next) => {
  try {
    const cur = await ensureProfile();
    if (!cur) return res.status(500).json({ error: "profile not initialised" });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const update: Record<string, unknown> = {};
    if (typeof body.name === "string") update.displayName = body.name;
    if (typeof body.base === "string") update.theaterAssignment = body.base;
    if (typeof body.role === "string") update.role = body.role;
    if (typeof body.displayName === "string") update.displayName = body.displayName;
    if (typeof body.theaterAssignment === "string") update.theaterAssignment = body.theaterAssignment;
    if (typeof body.contactEmail === "string") update.contactEmail = body.contactEmail;
    if (Object.keys(update).length > 0) {
      await db.update(profiles).set(update).where(eq(profiles.id, cur.id));
    }
    const next_ = await ensureProfile();
    res.json(next_ ? toApiProfile(next_) : null);
  } catch (err) {
    next(err);
  }
});

router.get("/profile/roles", async (_req, res) => {
  res.json(ROLES);
});

export default router;
