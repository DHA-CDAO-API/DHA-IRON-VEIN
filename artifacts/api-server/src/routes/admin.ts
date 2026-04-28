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
