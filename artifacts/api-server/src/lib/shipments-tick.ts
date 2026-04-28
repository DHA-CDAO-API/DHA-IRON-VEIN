import {
  db,
  shipments as shipmentsTable,
  routes as routesTable,
  items as itemsTable,
  nodes as nodesTable,
} from "@workspace/db";
import { gte, lt, sql } from "drizzle-orm";
import { logger } from "./logger";

// Target window of in-flight shipments to maintain across the AOR.
export const TARGET_MIN = 30;
export const TARGET_MAX = 45;

const CATEGORY_WEIGHTS: Record<string, number> = {
  blood_products: 0.32,
  supplies: 0.42,
  ppe: 0.18,
  other: 0.08,
};

const PRIORITIES = ["FLASH", "URGENT", "PRIORITY", "ROUTINE", "ROUTINE"];

// Deterministic-but-varied id helper.
function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function pickWeighted<T>(buckets: Map<string, T[]>, weights: Record<string, number>): T | null {
  const entries = Array.from(buckets.entries()).filter(([k, arr]) => arr.length > 0 && (weights[k] ?? 0) > 0);
  if (entries.length === 0) return null;
  const total = entries.reduce((s, [k]) => s + (weights[k] ?? 0), 0);
  let r = Math.random() * total;
  for (const [k, arr] of entries) {
    r -= weights[k] ?? 0;
    if (r <= 0) {
      return arr[Math.floor(Math.random() * arr.length)] ?? null;
    }
  }
  const last = entries[entries.length - 1]![1];
  return last[Math.floor(Math.random() * last.length)] ?? null;
}

type RouteRow = typeof routesTable.$inferSelect;
type ItemRow = typeof itemsTable.$inferSelect;

export type ShipmentSeedOptions = {
  // When true, only inserts what's missing to reach the lower bound.
  // When false, inserts up to the upper bound.
  topUpOnly?: boolean;
};

/**
 * Generate a single in-flight shipment row with a randomized progress
 * (so the map shows trips at varied points along their routes).
 */
function buildShipment(args: {
  route: RouteRow;
  item: ItemRow;
  nowMs: number;
}): typeof shipmentsTable.$inferInsert {
  const { route, item, nowMs } = args;
  // Total trip duration is the route's nominal days, with up to ±25% jitter.
  const baseHours = Math.max(8, route.days * 24);
  const jitter = 0.75 + Math.random() * 0.5;
  const totalMs = baseHours * 3600_000 * jitter;
  // Pick a progress in [0.05, 0.85] so trips look in-flight (not just-departed
  // or about-to-arrive — those churn too fast).
  const progress = 0.05 + Math.random() * 0.8;
  const departedAt = new Date(nowMs - totalMs * progress);
  const etaAt = new Date(nowMs + totalMs * (1 - progress));
  const priority = PRIORITIES[Math.floor(Math.random() * PRIORITIES.length)] ?? "ROUTINE";
  // Quantities scale with item type.
  const qtyBase =
    item.category === "blood_products"
      ? 8 + Math.floor(Math.random() * 24)
      : item.category === "ppe"
        ? 200 + Math.floor(Math.random() * 800)
        : 50 + Math.floor(Math.random() * 250);
  return {
    id: makeId("sh-tick"),
    orderId: null,
    fromNode: route.fromNode,
    toNode: route.toNode,
    itemId: item.id,
    quantity: qtyBase,
    departedAt,
    etaAt,
    priority,
  };
}

/**
 * Maintain a healthy population of in-flight shipments across the AOR.
 *
 * 1. Cull shipments that have arrived (etaAt < now).
 * 2. If the active count is below TARGET_MIN, top up to TARGET_MIN..TARGET_MAX.
 *
 * Safe to call repeatedly. Idempotent within a tick.
 */
export async function tickShipments(opts: ShipmentSeedOptions = {}): Promise<{
  removed: number;
  added: number;
  active: number;
}> {
  const now = new Date();

  // 1. Remove arrived shipments (don't keep delivered convoys forever — they
  //    bloat the table and are no longer "in flight"). Keep a 6-hour grace
  //    window so the snapshot doesn't blink as shipments transition.
  const cutoff = new Date(now.getTime() - 6 * 3600_000);
  const removedRows = await db
    .delete(shipmentsTable)
    .where(lt(shipmentsTable.etaAt, cutoff))
    .returning({ id: shipmentsTable.id });
  const removed = removedRows.length;

  // 2. Count currently active in-flight shipments.
  const activeRows = await db
    .select({ id: shipmentsTable.id })
    .from(shipmentsTable)
    .where(gte(shipmentsTable.etaAt, now));
  const activeCount = activeRows.length;

  let added = 0;
  if (activeCount < TARGET_MIN) {
    const targetCount = TARGET_MIN + Math.floor(Math.random() * (TARGET_MAX - TARGET_MIN + 1));
    const need = Math.max(0, targetCount - activeCount);

    const [allRoutes, allItems, allNodes] = await Promise.all([
      db.select().from(routesTable),
      db.select().from(itemsTable),
      db.select().from(nodesTable),
    ]);

    if (allRoutes.length === 0 || allItems.length === 0) {
      logger.warn("tickShipments: no routes or items to draw from");
      return { removed, added: 0, active: activeCount };
    }

    // Filter to routes between known geographic nodes — exclude
    // supplier→DLA chains because those endpoints have no real lat/long
    // (they sit at the abstract head of the network) and the map can't
    // animate them coherently.
    const nodeIds = new Set(allNodes.map((n) => n.id));
    const animatableRoutes = allRoutes.filter(
      (r) => nodeIds.has(r.fromNode) && nodeIds.has(r.toNode) && r.fromNode !== "supplier",
    );
    const routesPool = animatableRoutes.length > 0 ? animatableRoutes : allRoutes;

    // Bucket items by category so we can sample category-mix per the weights.
    const itemsByCategory = new Map<string, ItemRow[]>();
    for (const it of allItems) {
      const cat = it.category ?? "other";
      const arr = itemsByCategory.get(cat) ?? [];
      arr.push(it);
      itemsByCategory.set(cat, arr);
    }

    // Tally what's already in the active pool so we can rebalance against
    // the target weights below.
    const itemRowById = new Map(allItems.map((it) => [it.id, it]));
    const activeFull = await db
      .select()
      .from(shipmentsTable)
      .where(gte(shipmentsTable.etaAt, now));
    const liveCountByCat: Record<string, number> = {};
    for (const s of activeFull) {
      const cat = itemRowById.get(s.itemId)?.category ?? "other";
      liveCountByCat[cat] = (liveCountByCat[cat] ?? 0) + 1;
    }

    // Target counts so the pool roughly matches CATEGORY_WEIGHTS. Operators
    // expect to always see *some* particles for each filterable category
    // (Blood Products, Supplies, PPE) so the layer-filter actually surfaces
    // motion when toggled.
    const totalAfter = activeCount + need;
    const targetByCat: Record<string, number> = {};
    for (const [cat, w] of Object.entries(CATEGORY_WEIGHTS)) {
      // Minimum floor of 3 trips per filterable category so the layer
      // panel never collapses to an empty map.
      const floor = cat === "other" ? 0 : 3;
      targetByCat[cat] = Math.max(floor, Math.round(totalAfter * w));
    }

    // Build a queue of category picks sized to `need`: under-represented
    // categories first, then random weighted picks for the remainder.
    const categoryPicks: string[] = [];
    for (const [cat, target] of Object.entries(targetByCat)) {
      const have = liveCountByCat[cat] ?? 0;
      const deficit = Math.max(0, target - have);
      for (let k = 0; k < deficit && categoryPicks.length < need; k++) {
        categoryPicks.push(cat);
      }
    }
    while (categoryPicks.length < need) {
      const item = pickWeighted(itemsByCategory, CATEGORY_WEIGHTS);
      if (!item) break;
      categoryPicks.push(item.category ?? "other");
    }

    const inserts: Array<typeof shipmentsTable.$inferInsert> = [];
    for (const cat of categoryPicks) {
      const pool = itemsByCategory.get(cat);
      if (!pool || pool.length === 0) continue;
      const item = pool[Math.floor(Math.random() * pool.length)]!;
      const route = routesPool[Math.floor(Math.random() * routesPool.length)]!;
      inserts.push(buildShipment({ route, item, nowMs: now.getTime() }));
    }
    if (inserts.length > 0) {
      await db.insert(shipmentsTable).values(inserts);
      added = inserts.length;
    }
  }

  // Suppress unused-warning when topUpOnly is set but unused below.
  void opts;

  return { removed, added, active: activeCount + added };
}

let intervalHandle: NodeJS.Timeout | null = null;

/**
 * Start a background interval that keeps the in-flight shipment count topped
 * up. Called once at server startup. Re-entry is safe (no-op if already running).
 */
export function startShipmentsTick(intervalMs = 60_000): void {
  if (intervalHandle) return;
  // Run once immediately so the first request after restart already sees a
  // populated map.
  tickShipments()
    .then(({ removed, added, active }) => {
      logger.info({ removed, added, active }, "shipments tick (initial)");
    })
    .catch((err) => {
      logger.error({ err }, "initial shipments tick failed");
    });
  intervalHandle = setInterval(() => {
    tickShipments()
      .then(({ removed, added, active }) => {
        if (removed > 0 || added > 0) {
          logger.info({ removed, added, active }, "shipments tick");
        }
      })
      .catch((err) => {
        logger.error({ err }, "shipments tick failed");
      });
  }, intervalMs);
  if (typeof intervalHandle.unref === "function") intervalHandle.unref();
}

export function stopShipmentsTick(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
