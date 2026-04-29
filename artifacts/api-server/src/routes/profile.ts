import { Router, type IRouter } from "express";
import { db, profiles } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ensureProfileForUser,
  loadDecryptedProfile,
} from "../middlewares/authMiddleware";
import { encryptText } from "../lib/crypto";
import { audit } from "../lib/audit";

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

const VALID_ROLES = new Set(ROLES.map((r) => r.id));

router.get("/profile", async (req, res, next) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "auth_required" });
    }
    await ensureProfileForUser({
      id: req.user.id,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      email: req.user.email,
    });
    const profile = await loadDecryptedProfile(req.user.id);
    if (!profile) return res.status(500).json({ error: "profile not initialised" });
    res.json({
      name: profile.displayName,
      role: profile.role,
      base: profile.theaterAssignment,
      contactEmail: profile.contactEmail,
      avatar: req.user.profileImageUrl,
      lastActiveAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/profile", async (req, res, next) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "auth_required" });
    }
    await ensureProfileForUser({
      id: req.user.id,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      email: req.user.email,
    });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const update: Record<string, unknown> = {};
    const displayName =
      typeof body.name === "string" ? body.name : typeof body.displayName === "string" ? body.displayName : undefined;
    if (displayName !== undefined) update.displayNameEnc = encryptText(displayName);
    if (typeof body.base === "string") update.theaterAssignment = body.base;
    if (typeof body.theaterAssignment === "string")
      update.theaterAssignment = body.theaterAssignment;
    if (typeof body.contactEmail === "string") update.contactEmailEnc = encryptText(body.contactEmail);
    if (typeof body.role === "string" && VALID_ROLES.has(body.role)) {
      update.role = body.role;
      audit({
        event: "profile.role.change",
        outcome: "success",
        actorId: req.user.id,
        actorRole: req.user.role,
        subject: req.user.id,
        detail: { from: req.user.role, to: body.role },
      });
    }

    if (Object.keys(update).length > 0) {
      await db.update(profiles).set(update).where(eq(profiles.userId, req.user.id));
    }
    const next = await loadDecryptedProfile(req.user.id);
    if (!next) return res.status(500).json({ error: "profile not initialised" });
    res.json({
      name: next.displayName,
      role: next.role,
      base: next.theaterAssignment,
      contactEmail: next.contactEmail,
      avatar: req.user.profileImageUrl,
      lastActiveAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/profile/roles", async (_req, res) => {
  res.json(ROLES);
});

export default router;
