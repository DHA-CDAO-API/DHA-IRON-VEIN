import * as oidc from "openid-client";
import { type Request, type Response, type NextFunction } from "express";
import { db, profiles } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  clearSession,
  getOidcConfig,
  getSessionId,
  getSession,
  updateSession,
  type SessionData,
  type AppRole,
} from "../lib/auth";
import { decryptText } from "../lib/crypto";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface User {
      id: string;
      email: string | null;
      firstName: string | null;
      lastName: string | null;
      profileImageUrl: string | null;
      role: AppRole;
    }
    interface Request {
      isAuthenticated(): this is AuthedRequest;
      user?: User | undefined;
      session?: SessionData | undefined;
      sessionId?: string | undefined;
    }
    interface AuthedRequest {
      user: User;
      session: SessionData;
      sessionId: string;
    }
  }
}

const VALID_ROLES: ReadonlyArray<AppRole> = [
  "commander",
  "logistician",
  "analyst",
  "medical_planner",
];

async function resolveCurrentRole(userId: string, fallback: AppRole): Promise<AppRole> {
  const rows = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  const dbRole = rows[0]?.role;
  if (dbRole && (VALID_ROLES as ReadonlyArray<string>).includes(dbRole)) {
    return dbRole as AppRole;
  }
  return fallback;
}

async function refreshIfExpired(
  sid: string,
  session: SessionData,
): Promise<SessionData | null> {
  const now = Math.floor(Date.now() / 1000);
  if (!session.expires_at || now <= session.expires_at) return session;
  if (!session.refresh_token) return null;
  try {
    const config = await getOidcConfig();
    const tokens = await oidc.refreshTokenGrant(config, session.refresh_token);
    session.access_token = tokens.access_token;
    session.refresh_token = tokens.refresh_token ?? session.refresh_token;
    const expiresIn = tokens.expiresIn();
    if (expiresIn) session.expires_at = now + expiresIn;
    await updateSession(sid, session);
    return session;
  } catch {
    return null;
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request["isAuthenticated"];

  const sid = getSessionId(req);
  if (!sid) return next();

  const session = await getSession(sid);
  if (!session?.user?.id) {
    await clearSession(res, sid);
    return next();
  }
  const refreshed = await refreshIfExpired(sid, session);
  if (!refreshed) {
    await clearSession(res, sid);
    return next();
  }

  // Always pull the freshest role from the profile so a role change applies
  // immediately on the next request without forcing the user to log out.
  const role = await resolveCurrentRole(refreshed.user.id, refreshed.user.role);
  if (role !== refreshed.user.role) {
    refreshed.user.role = role;
    await updateSession(sid, refreshed);
  }

  req.user = refreshed.user;
  req.session = refreshed;
  req.sessionId = sid;
  next();
}

/** Ensures the request has a valid session. */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "auth_required" });
    return;
  }
  next();
}

/** Ensures the session has passed MFA. */
export function requireMfa(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "auth_required" });
    return;
  }
  // Demo bypass: when MFA_BYPASS=true, treat any authenticated session as MFA-verified.
  // Remove this env var (or set to false) to re-enable MFA enforcement.
  if (process.env.MFA_BYPASS === "true") {
    next();
    return;
  }
  const verifiedUntil = req.session?.mfaVerifiedUntilMs ?? 0;
  if (Date.now() >= verifiedUntil) {
    res.status(401).json({ error: "mfa_required" });
    return;
  }
  next();
}

/** Ensures the user holds at least one of the allowed roles. */
export function requireRole(...allowed: ReadonlyArray<AppRole>) {
  const set = new Set(allowed);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "auth_required" });
      return;
    }
    if (!set.has(req.user.role)) {
      res.status(403).json({
        error: "forbidden",
        detail: `role '${req.user.role}' is not permitted to perform this action`,
        requiredRoles: [...set],
      });
      return;
    }
    next();
  };
}

/**
 * Helper used by the auth router after a fresh login: ensures a profiles
 * row exists for the user and seeds the encrypted display fields from
 * the OIDC claims.
 *
 * Bootstrap rule (so the project owner is never locked out):
 *  - If `OWNER_USER_ID` is set and matches the new user, role = commander.
 *  - Else if no other profile exists yet, the first ever user becomes
 *    commander (acts as the admin bootstrap).
 *  - Otherwise the new user defaults to `analyst` (least privilege).
 */
export async function ensureProfileForUser(user: {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}): Promise<AppRole> {
  const existing = await db
    .select({ userId: profiles.userId, role: profiles.role })
    .from(profiles)
    .where(eq(profiles.userId, user.id));
  if (existing.length > 0) {
    const r = existing[0]!.role;
    return (VALID_ROLES as ReadonlyArray<string>).includes(r) ? (r as AppRole) : "analyst";
  }

  const owner = process.env.OWNER_USER_ID;
  let role: AppRole = "analyst";
  if (owner && owner === user.id) {
    role = "commander";
  } else {
    const totalRows = await db.select({ userId: profiles.userId }).from(profiles).limit(1);
    if (totalRows.length === 0) role = "commander";
  }

  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || null;
  const key = process.env.DATA_ENCRYPTION_KEY ?? "";
  await db.execute(sql`
    INSERT INTO profiles (user_id, display_name_enc, contact_email_enc, role, theater_assignment, created_at, updated_at)
    VALUES (
      ${user.id},
      ${displayName ? sql`pgp_sym_encrypt(${displayName}::text, ${key}, 'cipher-algo=aes256')` : sql`NULL`},
      ${user.email ? sql`pgp_sym_encrypt(${user.email}::text, ${key}, 'cipher-algo=aes256')` : sql`NULL`},
      ${role},
      'MARFORPAC J-4 (Forward)',
      NOW(),
      NOW()
    )
    ON CONFLICT (user_id) DO NOTHING
  `);
  return role;
}

/**
 * Decrypts the display name and contact email for a user's profile so
 * the API can return them in the auth/profile responses.
 */
export async function loadDecryptedProfile(userId: string): Promise<{
  displayName: string | null;
  contactEmail: string | null;
  role: AppRole;
  theaterAssignment: string;
} | null> {
  const rows = await db
    .select({
      displayName: decryptText(profiles.displayNameEnc),
      contactEmail: decryptText(profiles.contactEmailEnc),
      role: profiles.role,
      theaterAssignment: profiles.theaterAssignment,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  const row = rows[0];
  if (!row) return null;
  const role = (VALID_ROLES as ReadonlyArray<string>).includes(row.role)
    ? (row.role as AppRole)
    : "analyst";
  return {
    displayName: row.displayName ?? null,
    contactEmail: row.contactEmail ?? null,
    role,
    theaterAssignment: row.theaterAssignment,
  };
}
