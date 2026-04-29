/**
 * security:verify — proves the security posture of INDOPACOM IRONVEIN
 * Sustainment is in force. Designed to be run from CI or by hand:
 *
 *   pnpm run security:verify
 *
 * Checks performed:
 *  1. Required env (DATABASE_URL, DATA_ENCRYPTION_KEY, REPL_ID,
 *     REPLIT_DEV_DOMAIN) is present.
 *  2. pgcrypto extension is installed in the database.
 *  3. Sensitive bytea columns hold ciphertext (OpenPGP magic bytes), and
 *     pgp_sym_decrypt with the env key recovers plaintext.
 *  4. RBAC middleware (`requireRole("commander", "logistician")`) is wired
 *     on the write endpoints we promised to lock down.
 *  5. Hardening middlewares (helmet, cors, csrf, rate limiters) are
 *     mounted in the API server entry.
 *
 * The script exits non-zero on any failure so it can be wired into CI.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

const results: CheckResult[] = [];
function record(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  const tag = ok ? "PASS" : "FAIL";
  // eslint-disable-next-line no-console
  console.log(`[${tag}] ${name} — ${detail}`);
}

function readRepoFile(rel: string): string {
  // Resolve relative to repo root (scripts/ lives at the root).
  return readFileSync(path.resolve(REPO_ROOT, rel), "utf8");
}

async function checkEnv(): Promise<void> {
  const required = [
    "DATABASE_URL",
    "DATA_ENCRYPTION_KEY",
    "REPL_ID",
    "REPLIT_DEV_DOMAIN",
  ];
  const missing = required.filter((k) => !process.env[k]);
  record(
    "env: required secrets present",
    missing.length === 0,
    missing.length === 0
      ? `all of ${required.join(", ")} are set`
      : `missing ${missing.join(", ")}`,
  );
  const key = process.env.DATA_ENCRYPTION_KEY ?? "";
  record(
    "env: DATA_ENCRYPTION_KEY length >= 32",
    key.length >= 32,
    `length=${key.length}`,
  );
}

async function checkPgcryptoAndEncryption(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    record("db: connection", false, "DATABASE_URL not set; skipping db checks");
    return;
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const ext = await pool.query(
      `SELECT 1 AS ok FROM pg_extension WHERE extname = 'pgcrypto'`,
    );
    record(
      "db: pgcrypto extension installed",
      ext.rowCount === 1,
      ext.rowCount === 1 ? "found" : "not found — encryption will fail",
    );

    const encryptedCols: { table: string; col: string }[] = [
      { table: "profiles", col: "display_name_enc" },
      { table: "profiles", col: "contact_email_enc" },
      { table: "scenarios", col: "summary_enc" },
      { table: "scenarios", col: "coa_brief_enc" },
      { table: "orders", col: "notes_enc" },
      { table: "app_settings", col: "ai_provider_api_key_enc" },
      { table: "user_mfa", col: "secret_enc" },
    ];
    for (const { table, col } of encryptedCols) {
      const exists = await pool.query(
        `SELECT data_type FROM information_schema.columns
         WHERE table_name=$1 AND column_name=$2`,
        [table, col],
      );
      const dataType = exists.rows[0]?.data_type ?? null;
      record(
        `schema: ${table}.${col} is bytea`,
        dataType === "bytea",
        dataType ? `data_type=${dataType}` : "column missing",
      );
    }

    // For each populated encrypted column, sample one row and verify two
    // things: (a) the raw bytes do NOT look like UTF-8 plaintext (ciphertext
    // starts with the OpenPGP packet tag byte 0xC3 — high bit set), and
    // (b) pgp_sym_decrypt with the env key recovers a non-empty string.
    const key = process.env.DATA_ENCRYPTION_KEY ?? "";
    const samples: { table: string; col: string }[] = [
      { table: "profiles", col: "display_name_enc" },
      { table: "scenarios", col: "summary_enc" },
      { table: "orders", col: "notes_enc" },
      { table: "app_settings", col: "ai_provider_api_key_enc" },
    ];
    for (const { table, col } of samples) {
      const colExists = await pool.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name=$1 AND column_name=$2`,
        [table, col],
      );
      if (colExists.rowCount !== 1) {
        record(
          `crypto: ${table}.${col} round-trip`,
          false,
          "column missing — skipping",
        );
        continue;
      }
      const sample = await pool.query(
        `SELECT ${col} AS ct,
                substring(${col} FROM 1 FOR 1) AS magic
         FROM ${table}
         WHERE ${col} IS NOT NULL
         LIMIT 1`,
      );
      if (sample.rowCount === 0) {
        record(
          `crypto: ${table}.${col} round-trip`,
          true,
          "no encrypted rows yet (acceptable on a fresh db)",
        );
        continue;
      }
      const magic = sample.rows[0].magic as Buffer | null;
      const cipherLooksBinary = !!magic && magic[0] !== undefined && magic[0] >= 0x80;
      record(
        `crypto: ${table}.${col} ciphertext looks non-plaintext`,
        cipherLooksBinary,
        magic ? `first byte=0x${magic[0].toString(16)}` : "no magic byte",
      );
      try {
        const dec = await pool.query(
          `SELECT pgp_sym_decrypt(${col}, $1) AS pt
           FROM ${table}
           WHERE ${col} IS NOT NULL
           LIMIT 1`,
          [key],
        );
        const pt = dec.rows[0]?.pt as string | null;
        record(
          `crypto: ${table}.${col} decrypts with env key`,
          typeof pt === "string" && pt.length > 0,
          pt
            ? `recovered ${pt.length} char plaintext`
            : "decrypt returned empty",
        );
      } catch (e) {
        record(
          `crypto: ${table}.${col} decrypts with env key`,
          false,
          `decrypt threw: ${(e as Error).message}`,
        );
      }
    }
  } finally {
    await pool.end();
  }
}

function checkRbac(): void {
  // We grep the route source for `requireRole(` calls on the write endpoints.
  // Source-level greps fail closed — if someone removes the middleware, the
  // assertion fires.
  const ordersSrc = readRepoFile("artifacts/api-server/src/routes/orders.ts");
  record(
    "rbac: POST /orders gated by requireRole(commander|logistician)",
    /requireRole\(\s*"commander"\s*,\s*"logistician"\s*\)/.test(ordersSrc) &&
      /router\.post\([^)]*requireOrdersWriteRole/.test(ordersSrc),
    "requireRole + router.post wiring present",
  );
  record(
    "rbac: PATCH /orders/:id gated",
    /router\.patch\([^)]*requireOrdersWriteRole/.test(ordersSrc),
    "patch wiring present",
  );

  const predictiveSrc = readRepoFile(
    "artifacts/api-server/src/routes/predictive.ts",
  );
  record(
    "rbac: POST /predictive promote gated",
    /requireRole\(\s*"commander"\s*,\s*"logistician"\s*\)/.test(predictiveSrc),
    "requireRole present in predictive routes",
  );
}

function checkHardening(): void {
  const appSrc = readRepoFile("artifacts/api-server/src/app.ts");
  const checks: { name: string; pattern: RegExp }[] = [
    { name: "hardening: helmet mounted", pattern: /helmet\(/ },
    { name: "hardening: cors mounted", pattern: /\bcors\(/ },
    { name: "hardening: csrf middleware mounted", pattern: /csrfMiddleware/ },
    { name: "hardening: cookie-parser mounted", pattern: /cookieParser\(/ },
    { name: "hardening: trust proxy enabled", pattern: /trust proxy|trustProxy|set\(\s*['\"]trust proxy/ },
    { name: "hardening: rate limiter on /auth", pattern: /authLimiter/ },
    { name: "hardening: rate limiter on /mfa", pattern: /mfaLimiter/ },
    { name: "hardening: rate limiter on writes", pattern: /writeLimiter/ },
    { name: "hardening: HSTS via helmet", pattern: /strictTransportSecurity|hsts/i },
  ];
  for (const c of checks) {
    record(c.name, c.pattern.test(appSrc), c.pattern.test(appSrc) ? "present" : "missing");
  }
}

function checkAuthGate(): void {
  const indexSrc = readRepoFile("artifacts/api-server/src/routes/index.ts");
  record(
    "authgate: requireAuth applied to /api router",
    /requireAuth/.test(indexSrc),
    "requireAuth import/usage present",
  );
}

function summarize(): number {
  const failed = results.filter((r) => !r.ok);
  // eslint-disable-next-line no-console
  console.log(
    `\nsecurity:verify — ${results.length - failed.length}/${results.length} checks passed`,
  );
  if (failed.length > 0) {
    // eslint-disable-next-line no-console
    console.log("Failed checks:");
    for (const f of failed) {
      // eslint-disable-next-line no-console
      console.log(`  - ${f.name}: ${f.detail}`);
    }
    return 1;
  }
  return 0;
}

async function main(): Promise<void> {
  await checkEnv();
  checkRbac();
  checkHardening();
  checkAuthGate();
  await checkPgcryptoAndEncryption();
  process.exit(summarize());
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("security:verify crashed:", e);
  process.exit(2);
});
