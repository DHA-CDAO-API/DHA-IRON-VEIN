import * as client from "openid-client";
import crypto from "node:crypto";
import { type Request, type Response } from "express";
import { db, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Auth-tier session model.
 *
 * - Session lifetime is **12 hours absolute** with **no idle timeout**.
 *   This is intentionally demo-friendly: the operator can present
 *   uninterrupted for the full window, but the cookie is hard-killed at
 *   the absolute expiry.
 * - The session stores the OIDC user, tokens, the absolute expiry, the
 *   MFA verification window, and a per-session CSRF secret used for the
 *   double-submit token.
 */

export const ISSUER_URL = process.env.ISSUER_URL ?? "https://replit.com/oidc";
export const SESSION_COOKIE = "sid";
export const CSRF_COOKIE = "csrf";

/** 12-hour absolute session lifetime. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * MFA verification window inside a session. After the user passes a TOTP
 * challenge the session is marked verified for this many ms; once it
 * lapses the user is challenged again. Within a single 12-hour session
 * we leave this equal to the session lifetime so the operator is not
 * re-challenged mid-demo.
 */
export const MFA_VERIFY_TTL_MS = SESSION_TTL_MS;

export type AppRole = "commander" | "logistician" | "analyst" | "medical_planner";

export interface AuthSessionUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  role: AppRole;
}

export interface SessionData {
  user: AuthSessionUser;
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  /** Per-session CSRF secret (random hex). Compared against `X-CSRF-Token`. */
  csrf: string;
  /** Wall-clock (ms) when this session must be hard-killed. */
  absoluteExpireAtMs: number;
  /** Wall-clock (ms) until which MFA is considered verified. 0 means not yet. */
  mfaVerifiedUntilMs: number;
}

let oidcConfig: client.Configuration | null = null;
export async function getOidcConfig(): Promise<client.Configuration> {
  if (!oidcConfig) {
    oidcConfig = await client.discovery(new URL(ISSUER_URL), process.env.REPL_ID!);
  }
  return oidcConfig;
}

export function newCsrfSecret(): string {
  return crypto.randomBytes(24).toString("hex");
}

export async function createSession(
  data: Omit<SessionData, "absoluteExpireAtMs" | "csrf" | "mfaVerifiedUntilMs"> & {
    csrf?: string;
    mfaVerifiedUntilMs?: number;
  },
): Promise<{ sid: string; session: SessionData }> {
  const sid = crypto.randomBytes(32).toString("hex");
  const session: SessionData = {
    ...data,
    csrf: data.csrf ?? newCsrfSecret(),
    absoluteExpireAtMs: Date.now() + SESSION_TTL_MS,
    mfaVerifiedUntilMs: data.mfaVerifiedUntilMs ?? 0,
  };
  await db.insert(sessionsTable).values({
    sid,
    sess: session as unknown as Record<string, unknown>,
    expire: new Date(session.absoluteExpireAtMs),
  });
  return { sid, session };
}

export async function getSession(sid: string): Promise<SessionData | null> {
  const [row] = await db.select().from(sessionsTable).where(eq(sessionsTable.sid, sid));
  if (!row) return null;
  const sess = row.sess as unknown as SessionData;
  // Absolute expiry — no sliding window, no idle timeout.
  const expiry =
    sess.absoluteExpireAtMs ??
    (row.expire instanceof Date ? row.expire.getTime() : Date.parse(String(row.expire)));
  if (Date.now() > expiry) {
    await deleteSession(sid);
    return null;
  }
  return sess;
}

export async function updateSession(sid: string, data: SessionData): Promise<void> {
  await db
    .update(sessionsTable)
    .set({
      sess: data as unknown as Record<string, unknown>,
      // Absolute expiry never extends past `absoluteExpireAtMs` — we mirror
      // it onto the indexed expire column so the cleaner can prune rows.
      expire: new Date(data.absoluteExpireAtMs),
    })
    .where(eq(sessionsTable.sid, sid));
}

export async function deleteSession(sid: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
}

export async function clearSession(res: Response, sid?: string): Promise<void> {
  if (sid) await deleteSession(sid);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.clearCookie(CSRF_COOKIE, { path: "/" });
}

export function getSessionId(req: Request): string | undefined {
  const authHeader = req.headers["authorization"];
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return req.cookies?.[SESSION_COOKIE];
}

export function isMfaVerified(session: SessionData | null | undefined): boolean {
  if (!session) return false;
  return Date.now() < (session.mfaVerifiedUntilMs ?? 0);
}

export function markMfaVerified(session: SessionData): SessionData {
  return {
    ...session,
    mfaVerifiedUntilMs: Math.min(
      session.absoluteExpireAtMs,
      Date.now() + MFA_VERIFY_TTL_MS,
    ),
  };
}
