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
