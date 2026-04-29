import { sql, type SQL } from "drizzle-orm";

/**
 * Symmetric encryption helper backed by pgcrypto's `pgp_sym_encrypt` /
 * `pgp_sym_decrypt`. The key (`DATA_ENCRYPTION_KEY`) lives only in process
 * env (never in the DB) and is required at startup. Using SQL-side
 * encryption keeps plaintext off the wire and out of the application's
 * memory after a write — a `pg_dump` of the bytea column shows only
 * cipher bytes.
 *
 * Algorithm: OpenPGP CFB w/ Cast5 (pgcrypto's default) — AES is selected
 * by the `cipher-algo=aes256` option below, giving AES-256 at rest.
 *
 * IMPORTANT: This is application-tier crypto on top of the DB. It is
 * intentionally orthogonal to disk encryption / backups.
 */

const KEY_ENV = "DATA_ENCRYPTION_KEY";

let cachedKey: string | null = null;
/**
 * Read the symmetric encryption key from process env. Exported so other
 * crypto-aware helpers (e.g. atomic upsert CTEs that need to inline
 * `pgp_sym_decrypt`) can request the same key without going through the
 * SQL builders. Treat the returned string as a sealed secret — never log it.
 */
export function getKey(): string {
  if (cachedKey) return cachedKey;
  const k = process.env[KEY_ENV];
  if (!k || k.length < 32) {
    throw new Error(
      `${KEY_ENV} must be set to a >=32 char secret to enable column encryption`,
    );
  }
  cachedKey = k;
  return k;
}

/** True when the encryption key is configured. */
export function isEncryptionEnabled(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

/** Encrypt a plaintext string into a bytea column. Pass null/undefined to clear. */
export function encryptText(plain: string | null | undefined): SQL | null {
  if (plain == null) return null;
  const key = getKey();
  return sql`pgp_sym_encrypt(${plain}::text, ${key}, 'cipher-algo=aes256')`;
}

/** Project a bytea-encrypted column back to plaintext as a SELECT expression. */
export function decryptText(column: unknown): SQL<string | null> {
  const key = getKey();
  return sql<string | null>`CASE WHEN ${column} IS NULL THEN NULL ELSE pgp_sym_decrypt(${column}::bytea, ${key}, 'cipher-algo=aes256') END`;
}

/**
 * One-shot, app-level decrypt of a bytea buffer (used by the verification
 * script). Pulls the bytes through pgcrypto via a one-row SELECT so the key
 * never touches application code's hot path.
 */
export async function decryptBytes(
  bytes: Buffer | null,
  exec: (q: SQL) => Promise<{ rows: Array<{ plain: string | null }> }>,
): Promise<string | null> {
  if (!bytes) return null;
  const key = getKey();
  const result = await exec(
    sql`SELECT pgp_sym_decrypt(${bytes}::bytea, ${key}, 'cipher-algo=aes256') AS plain`,
  );
  return result.rows[0]?.plain ?? null;
}
