import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { sql, eq } from "drizzle-orm";
import { z } from "zod";
import { db, usersTable, userMfa } from "@workspace/db";
import {
  createSession,
  updateSession,
  SESSION_COOKIE,
  CSRF_COOKIE,
  SESSION_TTL_MS,
  MFA_VERIFY_TTL_MS,
  type AppRole,
  type SessionData,
} from "../lib/auth";

/**
 * Test-only auth bypass router.
 *
 * Mounted ONLY when `E2E_TEST_HOOKS === "1"` and `NODE_ENV !== "production"`.
 * Lets the Playwright e2e suite mint a session for any of the four app
 * roles (commander, logistician, analyst, medical_planner) without going
 * through the real Replit OIDC flow.
 *
 * The endpoints upsert a stable per-role test user, profile, and MFA
 * row; create a session row; and set the same `sid` + `csrf` cookies the
 * real /callback handler uses. Once the session cookie is set, all the
 * normal middleware (authMiddleware, requireMfa, requireRole, csrf)
 * runs unchanged — that is the whole point of the test: we are exercising
 * the real auth stack, not a stubbed one.
 */

const VALID_ROLES = [
  "commander",
  "logistician",
  "analyst",
  "medical_planner",
] as const;

const TEST_USER_PREFIX = "e2e-test-";

const LoginBody = z.object({
  role: z.enum(VALID_ROLES),
  mfaEnrolled: z.boolean().optional().default(true),
  mfaVerified: z.boolean().optional().default(true),
});

const ResetBody = z.object({
  role: z.enum(VALID_ROLES).optional(),
});

function isEnabled(): boolean {
  return (
    process.env.E2E_TEST_HOOKS === "1" &&
    process.env.NODE_ENV !== "production"
  );
}

function gate(_req: Request, res: Response, next: NextFunction) {
  if (!isEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  next();
}

const router: IRouter = Router();

router.post("/test-auth/login", gate, async (req, res, next) => {
  try {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", detail: parsed.error.message });
      return;
    }
    const { role, mfaEnrolled, mfaVerified } = parsed.data;
    const userId = `${TEST_USER_PREFIX}${role}`;
    const email = `${userId}@e2e.test`;

    const userValues = {
      id: userId,
      email,
      firstName: role,
      lastName: "Test",
      profileImageUrl: null,
    };
    const [dbUser] = await db
      .insert(usersTable)
      .values(userValues)
      .onConflictDoUpdate({
        target: usersTable.id,
        set: { ...userValues, updatedAt: new Date() },
      })
      .returning();

    if (!dbUser) {
      res.status(500).json({ error: "user_upsert_failed" });
      return;
    }

    const key = process.env.DATA_ENCRYPTION_KEY ?? "";
    const displayName = `${role} (e2e)`;
    await db.execute(sql`
      INSERT INTO profiles (user_id, display_name_enc, contact_email_enc, role, theater_assignment, created_at, updated_at)
      VALUES (
        ${userId},
        pgp_sym_encrypt(${displayName}::text, ${key}, 'cipher-algo=aes256'),
        pgp_sym_encrypt(${email}::text, ${key}, 'cipher-algo=aes256'),
        ${role},
        'E2E TEST THEATER',
        NOW(),
        NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        role = EXCLUDED.role,
        display_name_enc = EXCLUDED.display_name_enc,
        contact_email_enc = EXCLUDED.contact_email_enc,
        updated_at = NOW()
    `);

    if (mfaEnrolled) {
      // A canonical RFC 6238 test secret. The MFA gate only checks
      // `enrolled_at IS NOT NULL` and the per-session `mfaVerifiedUntilMs`
      // window, so we never need the test to actually present a TOTP code.
      await db.execute(sql`
        INSERT INTO user_mfa (
          user_id, secret_enc, enrolled_at, failure_count,
          recovery_codes_hashes, created_at, updated_at
        )
        VALUES (
          ${userId},
          pgp_sym_encrypt('JBSWY3DPEHPK3PXP'::text, ${key}, 'cipher-algo=aes256'),
          NOW(),
          0,
          ARRAY[]::text[],
          NOW(),
          NOW()
        )
        ON CONFLICT (user_id) DO UPDATE SET
          enrolled_at = NOW(),
          failure_count = 0,
          lockout_until = NULL,
          updated_at = NOW()
      `);
    } else {
      await db.delete(userMfa).where(eq(userMfa.userId, userId));
    }

    const sessionData: Omit<
      SessionData,
      "absoluteExpireAtMs" | "csrf" | "mfaVerifiedUntilMs"
    > = {
      user: {
        id: dbUser.id,
        email: dbUser.email,
        firstName: dbUser.firstName,
        lastName: dbUser.lastName,
        profileImageUrl: dbUser.profileImageUrl,
        role: role as AppRole,
      },
      access_token: "e2e-test-access-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };
    const { sid, session } = await createSession(sessionData);

    if (mfaVerified && mfaEnrolled) {
      session.mfaVerifiedUntilMs = Math.min(
        session.absoluteExpireAtMs,
        Date.now() + MFA_VERIFY_TTL_MS,
      );
      await updateSession(sid, session);
    }

    res.cookie(SESSION_COOKIE, sid, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_MS,
    });
    res.cookie(CSRF_COOKIE, session.csrf, {
      httpOnly: false,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_MS,
    });

    res.json({
      ok: true,
      userId: dbUser.id,
      role,
      mfa: { enrolled: mfaEnrolled, verified: mfaVerified && mfaEnrolled },
      csrf: session.csrf,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/test-auth/reset", gate, async (req, res, next) => {
  try {
    const parsed = ResetBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    const targets: string[] = parsed.data.role
      ? [`${TEST_USER_PREFIX}${parsed.data.role}`]
      : VALID_ROLES.map((r) => `${TEST_USER_PREFIX}${r}`);

    for (const userId of targets) {
      // ON DELETE CASCADE on profiles/user_mfa removes those rows.
      // sessions are not FK'd to users; clear them manually.
      await db.execute(sql`
        DELETE FROM sessions WHERE (sess->'user'->>'id') = ${userId}
      `);
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.clearCookie(CSRF_COOKIE, { path: "/" });
    res.json({ ok: true, removed: targets });
  } catch (err) {
    next(err);
  }
});

router.get("/test-auth/whoami", gate, (req, res) => {
  res.json({
    enabled: true,
    user: req.user
      ? {
          id: req.user.id,
          role: req.user.role,
        }
      : null,
    mfaVerified: Date.now() < (req.session?.mfaVerifiedUntilMs ?? 0),
  });
});

export default router;
export { isEnabled as testAuthEnabled };
