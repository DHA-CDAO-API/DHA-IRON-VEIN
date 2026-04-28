import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  catalogEntries,
  nodes,
  routes,
  items,
  inventoryBalances,
  orders,
  suppliers,
} from "@workspace/db";
import { runSeed } from "../seed/run";
import { invalidateSimCache } from "../lib/ctx";
import { sql } from "drizzle-orm";

const DB_PROBE_TIMEOUT_MS = 2_000;
const DB_DEGRADED_LATENCY_MS = 500;

type DbHealthStatus = "healthy" | "degraded" | "offline";

interface DbHealth {
  name: string;
  kind: string;
  endpoint: string;
  status: DbHealthStatus;
  latencyMs: number | null;
  detail: string | null;
}

/**
 * Mask credentials in a connection string so it can be safely shown to the
 * client. e.g. `postgres://user:secret@host:5432/db` -> `postgres://***@host:5432/db`.
 * Falls back to a fully-redacted placeholder if the URL is unparseable.
 */
function sanitizeConnectionString(raw: string | undefined): string {
  if (!raw) return "(not configured)";
  try {
    const u = new URL(raw);
    const hasCreds = Boolean(u.username || u.password);
    u.username = "";
    u.password = "";
    let out = u.toString();
    if (hasCreds) {
      out = out.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)/, "$1***@");
    }
    return out;
  } catch {
    return "(redacted)";
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function probePostgres(): Promise<DbHealth> {
  const endpoint = sanitizeConnectionString(process.env.DATABASE_URL);
  const base = {
    name: "Primary PostgreSQL",
    kind: "postgres",
    endpoint,
  } as const;
  const start = Date.now();
  try {
    await withTimeout(
      db.execute(sql`select 1`),
      DB_PROBE_TIMEOUT_MS,
      "postgres probe",
    );
    const latencyMs = Date.now() - start;
    const status: DbHealthStatus =
      latencyMs > DB_DEGRADED_LATENCY_MS ? "degraded" : "healthy";
    const detail =
      status === "degraded"
        ? `High round-trip latency (${latencyMs} ms, threshold ${DB_DEGRADED_LATENCY_MS} ms)`
        : `SELECT 1 succeeded in ${latencyMs} ms`;
    return { ...base, status, latencyMs, detail };
  } catch (err) {
    return {
      ...base,
      status: "offline",
      latencyMs: null,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

const router: IRouter = Router();

let lastSeedStartedAt: Date | null = null;
let lastSeedCompletedAt: Date | null = null;

async function gatherStatus() {
  const [
    [{ c: itemsCount }],
    [{ c: nodesCount }],
    [{ c: routesCount }],
    [{ c: balancesCount }],
    [{ c: ordersCount }],
    [{ c: suppliersCount }],
    [{ c: catalogCount }],
  ] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` }).from(items),
    db.select({ c: sql<number>`count(*)::int` }).from(nodes),
    db.select({ c: sql<number>`count(*)::int` }).from(routes),
    db.select({ c: sql<number>`count(*)::int` }).from(inventoryBalances),
    db.select({ c: sql<number>`count(*)::int` }).from(orders),
    db.select({ c: sql<number>`count(*)::int` }).from(suppliers),
    db.select({ c: sql<number>`count(*)::int` }).from(catalogEntries),
  ]);
  return {
    seeded: nodesCount > 0,
    items: itemsCount,
    nodes: nodesCount,
    routes: routesCount,
    balances: balancesCount,
    orders: ordersCount,
    suppliers: suppliersCount,
    catalogEntries: catalogCount,
    startedAt: lastSeedStartedAt ? lastSeedStartedAt.toISOString() : null,
    completedAt: lastSeedCompletedAt ? lastSeedCompletedAt.toISOString() : null,
  };
}

router.get("/admin/seed-status", async (_req, res, next) => {
  try {
    res.json(await gatherStatus());
  } catch (err) {
    next(err);
  }
});

router.get("/admin/databases", async (_req, res, next) => {
  try {
    const databases = await Promise.all([probePostgres()]);
    res.json({
      databases,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

type TableHealthStatus = "healthy" | "degraded" | "empty";

interface TableHealth {
  schema: string;
  name: string;
  rowCount: number;
  sizeBytes: number;
  indexBytes: number;
  indexCount: number;
  sequentialScans: number;
  indexScans: number;
  lastVacuum: string | null;
  lastAutovacuum: string | null;
  lastAnalyze: string | null;
  lastAutoanalyze: string | null;
  status: TableHealthStatus;
  detail: string | null;
}

interface TableStatsRow {
  schemaname: string;
  relname: string;
  n_live_tup: string | number | null;
  total_bytes: string | number | null;
  index_bytes: string | number | null;
  index_count: string | number | null;
  seq_scan: string | number | null;
  idx_scan: string | number | null;
  last_vacuum: Date | string | null;
  last_autovacuum: Date | string | null;
  last_analyze: Date | string | null;
  last_autoanalyze: Date | string | null;
}

function toNum(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toIsoOrNull(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function classifyTable(t: Omit<TableHealth, "status" | "detail">): {
  status: TableHealthStatus;
  detail: string | null;
} {
  if (t.rowCount === 0) {
    return { status: "empty", detail: "No rows yet — awaiting seed or write." };
  }
  // Heavy sequential-scan ratio on a meaningfully-sized table that's
  // actually being queried. We require all three: enough rows that a
  // seq scan would hurt, enough total scans that the ratio is
  // statistically meaningful, and a strongly seq-dominant ratio.
  // Autoanalyze recency is intentionally NOT flagged — autovacuum
  // handles that on its own and surfacing it would alarm-bomb the
  // panel right after a fresh seed.
  const totalScans = t.sequentialScans + t.indexScans;
  if (t.rowCount >= 1000 && totalScans >= 100) {
    const seqRatio = t.sequentialScans / totalScans;
    if (seqRatio >= 0.9) {
      return {
        status: "degraded",
        detail: `Mostly sequential scans (${Math.round(seqRatio * 100)}% of ${totalScans}) — consider indexing.`,
      };
    }
  }
  return { status: "healthy", detail: null };
}

router.get("/admin/tables", async (_req, res, next) => {
  try {
    const result = await db.execute(sql`
      SELECT
        s.schemaname,
        s.relname,
        GREATEST(c.reltuples, 0)::bigint AS n_live_tup,
        pg_total_relation_size(c.oid) AS total_bytes,
        pg_indexes_size(c.oid) AS index_bytes,
        (
          SELECT COUNT(*) FROM pg_index i WHERE i.indrelid = c.oid
        ) AS index_count,
        s.seq_scan,
        s.idx_scan,
        s.last_vacuum,
        s.last_autovacuum,
        s.last_analyze,
        s.last_autoanalyze
      FROM pg_stat_user_tables s
      JOIN pg_class c ON c.oid = s.relid
      WHERE s.schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY s.schemaname, s.relname
    `);
    const rows = (result.rows ?? []) as unknown as TableStatsRow[];
    const tables: TableHealth[] = rows.map((r) => {
      const base = {
        schema: r.schemaname,
        name: r.relname,
        rowCount: toNum(r.n_live_tup),
        sizeBytes: toNum(r.total_bytes),
        indexBytes: toNum(r.index_bytes),
        indexCount: toNum(r.index_count),
        sequentialScans: toNum(r.seq_scan),
        indexScans: toNum(r.idx_scan),
        lastVacuum: toIsoOrNull(r.last_vacuum),
        lastAutovacuum: toIsoOrNull(r.last_autovacuum),
        lastAnalyze: toIsoOrNull(r.last_analyze),
        lastAutoanalyze: toIsoOrNull(r.last_autoanalyze),
      };
      const { status, detail } = classifyTable(base);
      return { ...base, status, detail };
    });
    res.json({
      tables,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/admin/reseed", async (req, res, next) => {
  try {
    lastSeedStartedAt = new Date();
    lastSeedCompletedAt = null;
    await runSeed({ truncate: true });
    invalidateSimCache();
    lastSeedCompletedAt = new Date();
    res.json(await gatherStatus());
  } catch (err) {
    req.log?.error({ err }, "reseed failed");
    next(err);
  }
});

export default router;
