import {
  generateSecret as otpGenerateSecret,
  generateURI as otpGenerateURI,
  verifySync as otpVerifySync,
} from "otplib";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db, userMfa, mfaAudit } from "@workspace/db";
import { eq } from "drizzle-orm";
import { encryptText, decryptText, getKey } from "./crypto";

/**
 * RFC 6238 TOTP enrollment, verification, and recovery codes for use
 * with Microsoft Authenticator / Google Authenticator / 1Password / etc.
 *
 * Anti-bruteforce: 5 failed attempts triggers a 15-minute lockout per
 * user. Failures and lockouts are also recorded to `mfa_audit` so the
 * security:verify script can confirm the lockout works end-to-end.
 *
 * Implementation note: otplib v13's functional API ships with built-in
 * default plugins (NobleCryptoPlugin + ScureBase32Plugin), so a 30-second
 * step / 6 digits / sha1 (the authenticator standard) is the default.
 */

const ISSUER = "DHA IRONVEIN";
export const RECOVERY_CODE_COUNT = 10;
export const FAILURE_THRESHOLD = 5;
export const FAILURE_WINDOW_MS = 5 * 60 * 1000;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export function generateSecret(): string {
  return otpGenerateSecret();
}

export function buildOtpauthUri(account: string, secret: string): string {
  return otpGenerateURI({ issuer: ISSUER, label: account, secret });
}

export function getIssuer(): string {
  return ISSUER;
}

export function verifyToken(token: string, secret: string): boolean {
  try {
    // Allow ±90s of clock skew. otplib v13's option is `epochTolerance`
    // and is measured in SECONDS (not steps). 90s is generous enough to
    // absorb any realistic clock drift between Microsoft Authenticator
    // on a phone and the production server, plus the time it takes a
    // user to read the code and submit it across a slow connection.
    const result = otpVerifySync({ token: token.trim(), secret, epochTolerance: 90 });
    return result.valid === true;
  } catch {
    return false;
  }
}

/**
 * Recovery codes are formatted `XXXX-XXXX-XXXX` for human entry. They
 * are bcrypt-hashed before persistence and consumed (removed from the
 * stored set) on first successful use.
 */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const codes: string[] = [];
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  for (let i = 0; i < count; i++) {
    let raw = "";
    for (let j = 0; j < 12; j++) raw += chars[crypto.randomInt(0, chars.length)];
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`);
  }
  return codes;
}

export async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => bcrypt.hash(c.toUpperCase(), 10)));
}

export async function consumeRecoveryCode(
  userId: string,
  candidate: string,
  hashes: string[],
): Promise<{ matched: boolean; remaining: string[] }> {
  const normalized = candidate.replace(/\s+/g, "").toUpperCase();
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(normalized, hashes[i]!)) {
      const remaining = hashes.slice(0, i).concat(hashes.slice(i + 1));
      await db
        .update(userMfa)
        .set({ recoveryCodesHashes: remaining })
        .where(eq(userMfa.userId, userId));
      return { matched: true, remaining };
    }
  }
  return { matched: false, remaining: hashes };
}

export interface MfaRow {
  userId: string;
  enrolledAt: Date | null;
  failureCount: number;
  lockoutUntil: Date | null;
  recoveryCodesHashes: string[] | null;
}

export async function getMfaRow(userId: string): Promise<MfaRow | null> {
  const rows = await db
    .select({
      userId: userMfa.userId,
      enrolledAt: userMfa.enrolledAt,
      failureCount: userMfa.failureCount,
      lockoutUntil: userMfa.lockoutUntil,
      recoveryCodesHashes: userMfa.recoveryCodesHashes,
    })
    .from(userMfa)
    .where(eq(userMfa.userId, userId));
  return rows[0] ?? null;
}

export async function getDecryptedSecret(userId: string): Promise<string | null> {
  const rows = await db
    .select({ secret: decryptText(userMfa.secretEnc) })
    .from(userMfa)
    .where(eq(userMfa.userId, userId));
  return rows[0]?.secret ?? null;
}

/**
 * Atomically read-or-create the pending TOTP secret for a user. If a row
 * already exists (pending or finalized), the stored secret is returned
 * untouched and `created` is false — this is what makes `/mfa/enroll/start`
 * idempotent across concurrent calls (e.g. React StrictMode double-mounts
 * or two browser tabs).
 *
 * Implementation: a single statement performs an INSERT with the candidate
 * secret and `ON CONFLICT (user_id) DO NOTHING`. The CTE then SELECTs the
 * decrypted secret and `(xmax = 0)` (Postgres trick: xmax is 0 on a freshly
 * inserted tuple, non-zero when the row already existed and the insert was
 * skipped). Net result: at most one new row is created per user, and every
 * caller observes the same persisted secret.
 */
export async function getOrCreatePendingSecret(
  userId: string,
  candidate: string,
): Promise<{ secret: string; created: boolean }> {
  const key = getKey();
  const result = await db.execute(sql`
    WITH ins AS (
      INSERT INTO user_mfa (user_id, secret_enc, enrolled_at, failure_count, recovery_codes_hashes, created_at, updated_at)
      VALUES (
        ${userId},
        pgp_sym_encrypt(${candidate}::text, ${key}, 'cipher-algo=aes256'),
        NULL,
        0,
        NULL,
        NOW(),
        NOW()
      )
      ON CONFLICT (user_id) DO NOTHING
      RETURNING user_id, xmax
    )
    SELECT
      pgp_sym_decrypt(m.secret_enc::bytea, ${key}, 'cipher-algo=aes256') AS secret,
      COALESCE((SELECT xmax = 0 FROM ins), false) AS created
    FROM user_mfa m
    WHERE m.user_id = ${userId}
  `);
  const row = result.rows[0] as { secret: string | null; created: boolean } | undefined;
  if (!row?.secret) throw new Error("failed to read pending mfa secret");
  return { secret: row.secret, created: !!row.created };
}

/**
 * Persist (or upsert) a pending TOTP secret in the encrypted column. Until
 * the first verify completes, `enrolledAt` stays NULL so the secret is
 * just a candidate.
 */
export async function upsertPendingSecret(userId: string, secret: string): Promise<void> {
  const enc = encryptText(secret);
  await db.execute(sql`
    INSERT INTO user_mfa (user_id, secret_enc, enrolled_at, failure_count, recovery_codes_hashes, created_at, updated_at)
    VALUES (${userId}, ${enc!}, NULL, 0, NULL, NOW(), NOW())
    ON CONFLICT (user_id) DO UPDATE SET secret_enc = ${enc!}, enrolled_at = NULL, failure_count = 0, recovery_codes_hashes = NULL, updated_at = NOW()
  `);
}

export async function finalizeEnrollment(
  userId: string,
  recoveryHashes: string[],
): Promise<void> {
  await db
    .update(userMfa)
    .set({
      enrolledAt: new Date(),
      failureCount: 0,
      lockoutUntil: null,
      recoveryCodesHashes: recoveryHashes,
    })
    .where(eq(userMfa.userId, userId));
}

export async function recordSuccess(userId: string): Promise<void> {
  await db
    .update(userMfa)
    .set({ failureCount: 0, lockoutUntil: null, lastUsedAt: new Date() })
    .where(eq(userMfa.userId, userId));
}

export async function recordFailure(
  userId: string,
): Promise<{ failureCount: number; lockoutUntil: Date | null }> {
  const row = await getMfaRow(userId);
  const next = (row?.failureCount ?? 0) + 1;
  let lockoutUntil: Date | null = null;
  if (next >= FAILURE_THRESHOLD) {
    lockoutUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
  }
  await db
    .update(userMfa)
    .set({ failureCount: next, lockoutUntil })
    .where(eq(userMfa.userId, userId));
  return { failureCount: next, lockoutUntil };
}

export function isLockedOut(row: MfaRow | null): { locked: boolean; retryAfterSeconds: number } {
  if (!row?.lockoutUntil) return { locked: false, retryAfterSeconds: 0 };
  const ms = row.lockoutUntil.getTime() - Date.now();
  if (ms <= 0) return { locked: false, retryAfterSeconds: 0 };
  return { locked: true, retryAfterSeconds: Math.ceil(ms / 1000) };
}

export async function logAudit(
  userId: string | null,
  event: string,
  detail: string | null,
  ip: string | null,
): Promise<void> {
  try {
    await db.insert(mfaAudit).values({ userId, event, detail, ip });
  } catch {
    // Audit logging must never throw past the route handler.
  }
}

/**
 * Render a tiny SVG QR code for the otpauth URI. We deliberately avoid
 * pulling in a heavy QR rendering pipeline server-side: the client also
 * shows a copy-paste friendly secret, and the otpauth URI is the
 * canonical input.
 *
 * Implementation note: at build time we depend on `qrcode` (Node SVG
 * renderer). The output is a tiny self-contained SVG string the
 * browser can drop into innerHTML.
 */
export async function renderQrSvg(otpauthUri: string): Promise<string> {
  const QRCode = (await import("qrcode")).default;
  return QRCode.toString(otpauthUri, { type: "svg", margin: 1, width: 224 });
}
