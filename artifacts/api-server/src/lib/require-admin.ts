import type { Request, Response, NextFunction } from "express";
import { db, profiles } from "@workspace/db";

// Roles that are allowed to use the admin endpoints (catalog price edits,
// etc.). The codebase has no real auth wall, so we use the singleton
// profile's `role` as the effective identity — the same field the UI
// reads via /profile to drive the role-aware sidebar / nav.
//
// `logistician` owns Class VIII supply chain operations (orders,
// inventory, lead times) so they're the natural owner for catalog price
// changes. `commander` keeps oversight authority. Other roles
// (medical_planner, analyst) are read-only against the catalog.
export const ADMIN_ROLES = new Set(["logistician", "commander"]);

export async function getActiveRole(): Promise<string | null> {
  const rows = await db.select().from(profiles);
  if (rows.length === 0) return null;
  return rows[0]?.role ?? null;
}

/**
 * Express middleware that rejects requests when the active profile's role
 * is not in {@link ADMIN_ROLES}. Returns 403 with a structured body so the
 * UI can surface "you don't have permission" without parsing prose.
 */
export async function requireAdmin(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const role = await getActiveRole();
    if (!role || !ADMIN_ROLES.has(role)) {
      res.status(403).json({
        error: "forbidden",
        message:
          "This action requires an admin role (logistician or commander). Switch your active perspective on the Profile page.",
        requiredRoles: Array.from(ADMIN_ROLES),
        actualRole: role,
      });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}
