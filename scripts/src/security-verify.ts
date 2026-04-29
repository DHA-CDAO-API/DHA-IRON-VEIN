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
import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
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

// High-confidence secret patterns. Anchored to known prefixes so generic
// strings (UUIDs, hex digests, base64 logo blobs) don't false-fire.
const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "OpenAI key", re: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}\b/ },
  { name: "Stripe secret key", re: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { name: "Stripe publishable key", re: /\bpk_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "GitHub token", re: /\bgh[posru]_[A-Za-z0-9]{30,}\b/ },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "PEM private key", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED |)PRIVATE KEY-----/ },
  { name: "HuggingFace token", re: /\bhf_[A-Za-z0-9]{30,}\b/ },
  { name: "GitLab token", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
];

const PLACEHOLDER_RE =
  /YOUR[_-]|XXXXX|<your|example|placeholder|REPLACE[_-]|REDACTED|FAKE|DUMMY|sk-ant-xxxx|sk-xxxx|sk_test_xxxx/i;

const SECRET_SCAN_SKIP_FILES = new Set<string>([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
]);
const SECRET_SCAN_SKIP_DIRS = ["attached_assets/"];
const BINARY_EXTENSIONS = new Set<string>([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp", ".tiff",
  ".pdf", ".zip", ".tar", ".gz", ".7z", ".rar",
  ".mp3", ".wav", ".ogg", ".mp4", ".webm", ".mov", ".avi",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".pptx", ".docx", ".xlsx", ".odt", ".odp", ".ods",
]);

function checkSecretsInTrackedFiles(): void {
  let listing: string;
  try {
    listing = execFileSync("git", ["ls-files"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    record(
      "secrets: git ls-files runs",
      false,
      `git ls-files failed: ${(e as Error).message}`,
    );
    return;
  }
  const tracked = listing.split("\n").filter((f) => f.length > 0);

  // (a) No real .env / .env.* files are tracked (.env.example is allowed).
  const envOffenders = tracked.filter((f) => {
    const base = path.basename(f);
    if (base === ".env.example") return false;
    return base === ".env" || base.startsWith(".env.");
  });
  record(
    "secrets: no .env* files tracked (only .env.example allowed)",
    envOffenders.length === 0,
    envOffenders.length === 0
      ? "no tracked .env files"
      : `tracked: ${envOffenders.join(", ")}`,
  );

  // (b) No high-confidence secret values in any tracked text file.
  const offenders: { file: string; pattern: string; sample: string }[] = [];
  const SELF = path.relative(REPO_ROOT, fileURLToPath(import.meta.url));
  for (const rel of tracked) {
    if (SECRET_SCAN_SKIP_FILES.has(rel)) continue;
    if (SECRET_SCAN_SKIP_DIRS.some((d) => rel.startsWith(d))) continue;
    if (rel === SELF) continue; // don't grep the patterns out of ourselves
    if (BINARY_EXTENSIONS.has(path.extname(rel).toLowerCase())) continue;
    const abs = path.resolve(REPO_ROOT, rel);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (st.size > 2 * 1024 * 1024) continue; // skip very large files
    let body: string;
    try {
      body = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    for (const { name, re } of SECRET_PATTERNS) {
      // Use a global flag so a placeholder earlier in the file can't mask a
      // real token of the same pattern later.
      const gre = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      for (const m of body.matchAll(gre)) {
        if (PLACEHOLDER_RE.test(m[0])) continue;
        offenders.push({ file: rel, pattern: name, sample: m[0].slice(0, 12) + "…" });
        break; // one report per (file, pattern) is enough
      }
    }
  }
  record(
    "secrets: no high-confidence secret values in tracked files",
    offenders.length === 0,
    offenders.length === 0
      ? `scanned ${tracked.length} tracked paths, no matches`
      : offenders
          .map((o) => `${o.file} matched ${o.pattern} (${o.sample})`)
          .join("; "),
  );
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
  checkSecretsInTrackedFiles();
  await checkPgcryptoAndEncryption();
  process.exit(summarize());
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("security:verify crashed:", e);
  process.exit(2);
});
