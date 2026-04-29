import { db } from "@workspace/db";
import {
  catalogEntries,
  inventoryBalances,
  itemFacilityDemandRollup,
  items,
  nodes,
  supplyDemoV2Catalog,
  supplyDemoV2Facilities,
  supplyDemoV2Issues,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

/**
 * Activation step for the supply demo dataset.
 *
 * Three things happen here:
 *
 *  1. Catalog promotion: every reconciled `catalog_entries` row (source =
 *     'supply_demo_v2') is promoted into the operational `items` table with
 *     id `cat_<entry_id>`. The new item picks up the rich attributes
 *     (manufacturer, NDC, MFR cat #, product noun, etc.) that the staging
 *     row carries. Idempotent: rows already promoted are skipped.
 *
 *  2. Facility surfacing: every `supply_demo_v2_facilities.node_id` is
 *     un-hidden, classified, and given a deterministic lat/lng spread
 *     across the INDOPACOM AOR. Marked `coords_approximate = true` so the
 *     UI can flag synthesized geo. Idempotent: already-active rows are
 *     skipped.
 *
 *  3. Demand + inventory: aggregates `supply_demo_v2_issues` into the
 *     `item_facility_demand_rollup` table per (node, item), then derives
 *     initial on-hand inventory as `target_dos × dailyBurn`. Inventory
 *     rows are stamped with `source = 'derived'`.
 *
 * Reversible by `revertActivation` (called from the rollback endpoint).
 */

export interface ActivationSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  itemsPromoted: number;
  itemsAlreadyPromoted: number;
  facilitiesActivated: number;
  facilitiesAlreadyActive: number;
  rollupRowsWritten: number;
  inventoryRowsWritten: number;
  facilityCount: number;
  promotedItemCount: number;
}

export interface ActivationOptions {
  /**
   * Target initial days-of-supply when deriving on_hand from the daily
   * burn rate. Defaults to 21 days.
   */
  targetDaysOfSupply?: number;
  /**
   * Number of days the issue history is assumed to span. The dataset has
   * no per-row date, so we treat the aggregate `quantity` as a 365-day
   * total by default.
   */
  observedDays?: number;
  /**
   * Cap on inventory rows derived per facility (top-N items by line_count).
   * Keeps the operational inventory table at a manageable size while still
   * exercising the full activation path. Default 80.
   */
  maxItemsPerFacility?: number;
  /**
   * Minimum line_count before a (facility, item) pair is considered
   * worth giving inventory to. Default 3.
   */
  minLineCount?: number;
}

const DEFAULT_OPTS: Required<ActivationOptions> = {
  targetDaysOfSupply: 21,
  observedDays: 365,
  maxItemsPerFacility: 80,
  minLineCount: 3,
};

// INDOPACOM-friendly bounding box for synthesized facility geography. The
// box is chosen to keep the imported sites visible alongside the curated
// 35 nodes without falling outside the existing map viewport.
const AOR_REGIONS: Array<{
  id: string;
  label: string;
  centerLat: number;
  centerLng: number;
  spreadLat: number;
  spreadLng: number;
  regionalHub: string;
}> = [
  {
    id: "INDOPACOM-North",
    label: "INDOPACOM-North",
    centerLat: 33,
    centerLng: 130,
    spreadLat: 6,
    spreadLng: 8,
    regionalHub: "northHub",
  },
  {
    id: "INDOPACOM-Central",
    label: "INDOPACOM-Central",
    centerLat: 12,
    centerLng: 125,
    spreadLat: 8,
    spreadLng: 10,
    regionalHub: "centralHub",
  },
  {
    id: "INDOPACOM-South",
    label: "INDOPACOM-South",
    centerLat: -8,
    centerLng: 140,
    spreadLat: 6,
    spreadLng: 12,
    regionalHub: "southHub",
  },
];

/**
 * Cheap, deterministic 32-bit string hash. Used to spread imported
 * facilities deterministically across the INDOPACOM AOR — same input ->
 * same lat/lng on every activation run.
 */
function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function classifyFacility(displayName: string, code: string): string {
  const text = `${displayName} ${code}`.toLowerCase();
  if (text.includes("hosp")) return "Large MTF";
  if (text.includes("clinic")) return "Clinic";
  if (text.includes("hub") || text.includes("depot")) return "Regional hub";
  if (text.includes("tlamm")) return "Theater hub";
  // The supply demo dataset uses anonymized "MTF-XXorin, YYrel" codes —
  // treat them as standard MTFs by default.
  return "Standard MTF";
}

function deriveAorAndCoords(code: string): {
  aor: string;
  regionalHub: string;
  latitude: number;
  longitude: number;
} {
  const h = hash32(code);
  const region = AOR_REGIONS[h % AOR_REGIONS.length];
  // Pull two more uniform-ish offsets out of the hash bits so the spread
  // around the region center is deterministic but not all clustered on
  // one point.
  const u1 = ((h >>> 8) & 0xffff) / 0xffff; // 0..1
  const u2 = ((h >>> 16) & 0xffff) / 0xffff; // 0..1
  const lat = region.centerLat + (u1 - 0.5) * 2 * region.spreadLat;
  const lng = region.centerLng + (u2 - 0.5) * 2 * region.spreadLng;
  return {
    aor: region.label,
    regionalHub: region.regionalHub,
    latitude: Number(lat.toFixed(4)),
    longitude: Number(lng.toFixed(4)),
  };
}

function deriveItemDefaults(args: {
  productNoun: string | null;
  productType: string | null;
  unspsc: string | null;
  ghx: string | null;
}): {
  category: "blood_products" | "supplies" | "other";
  criticality: "critical" | "medium" | "low";
  shelfLifeDays: number;
  leadTimeDays: number;
  trigger: string;
} {
  const text = `${args.productNoun ?? ""} ${args.productType ?? ""} ${args.unspsc ?? ""} ${args.ghx ?? ""}`.toLowerCase();
  if (
    text.includes("blood") ||
    text.includes("plasma") ||
    text.includes("platelet") ||
    text.includes("transfusion")
  ) {
    return {
      category: "blood_products",
      criticality: "critical",
      shelfLifeDays: 35,
      leadTimeDays: 3,
      trigger: "transfusion_event",
    };
  }
  if (
    text.includes("ppe") ||
    text.includes("glove") ||
    text.includes("mask") ||
    text.includes("gown") ||
    text.includes("syringe") ||
    text.includes("needle") ||
    text.includes("bandage") ||
    text.includes("gauze") ||
    text.includes("iv ") ||
    text.includes("med")
  ) {
    return {
      category: "supplies",
      criticality: "medium",
      shelfLifeDays: 730,
      leadTimeDays: 7,
      trigger: "encounter",
    };
  }
  return {
    category: "other",
    criticality: "low",
    shelfLifeDays: 1095,
    leadTimeDays: 14,
    trigger: "population",
  };
}

const ITEM_ID_PREFIX = "cat_";

export async function runActivation(
  options: ActivationOptions = {},
): Promise<ActivationSummary> {
  const opts = { ...DEFAULT_OPTS, ...options };
  const startedAt = new Date();

  // ---------------------------------------------------------------------
  // 1. Promote reconciled catalog → items.
  // ---------------------------------------------------------------------
  // We join catalog_entries (which has the canonical (mfr_cat_no,
  // manufacturer) uniqueness) to the staging row that produced it so the
  // promoted item can carry the richer attributes (NDC, manufacturerLong,
  // etc.) the staging table preserves.
  const catalogRows = await db.execute<{
    id: number;
    mfr_cat_no: string;
    manufacturer: string;
    manufacturer_long: string | null;
    description: string;
    product_noun: string | null;
    product_type: string | null;
    unspsc_commodity: string | null;
    product_size: string | null;
    ghx_commodity_type: string | null;
    full_description: string | null;
    ndc: string | null;
    sos_type_description: string | null;
    s_ndc: string | null;
    s_long: string | null;
    s_sos: string | null;
  }>(sql`
    SELECT
      ce.id,
      ce.mfr_cat_no,
      ce.manufacturer,
      ce.manufacturer_long,
      ce.description,
      ce.product_noun,
      ce.product_type,
      ce.unspsc_commodity,
      ce.product_size,
      ce.ghx_commodity_type,
      ce.full_description,
      ce.ndc,
      ce.sos_type_description,
      sc.product_ndc        AS s_ndc,
      sc.manufacturer_long  AS s_long,
      sc.sos_type_description AS s_sos
    FROM catalog_entries ce
    LEFT JOIN supply_demo_v2_catalog sc
      ON sc.mfr_cat_no = ce.mfr_cat_no
     AND sc.manufacturer_short = ce.manufacturer
    WHERE ce.source = 'supply_demo_v2'
  `);

  const existingItemIds = new Set<string>();
  const existingPromotedRows = await db
    .select({ id: items.id })
    .from(items)
    .where(eq(items.source, "supply_demo_v2"));
  for (const r of existingPromotedRows) existingItemIds.add(r.id);

  let itemsPromoted = 0;
  let itemsAlreadyPromoted = 0;

  type ItemInsert = typeof items.$inferInsert;
  const itemBatch: ItemInsert[] = [];
  const promotedIdByCatalogId = new Map<number, string>();

  for (const row of catalogRows.rows) {
    const itemId = `${ITEM_ID_PREFIX}${row.id}`;
    promotedIdByCatalogId.set(row.id, itemId);
    if (existingItemIds.has(itemId)) {
      itemsAlreadyPromoted += 1;
      continue;
    }
    const ndc = row.ndc ?? row.s_ndc ?? null;
    const long = row.manufacturer_long ?? row.s_long ?? null;
    const sos = row.sos_type_description ?? row.s_sos ?? null;
    const defaults = deriveItemDefaults({
      productNoun: row.product_noun,
      productType: row.product_type,
      unspsc: row.unspsc_commodity,
      ghx: row.ghx_commodity_type,
    });
    itemBatch.push({
      id: itemId,
      name: row.description.slice(0, 200),
      niinOrSku: ndc ?? row.mfr_cat_no,
      unitOfIssue: row.product_size && row.product_size.length < 20 ? row.product_size : "ea",
      classOfSupply: "VIII",
      category: defaults.category,
      mandatory: false,
      criticality: defaults.criticality,
      leadTimeDays: defaults.leadTimeDays,
      shelfLifeDays: defaults.shelfLifeDays,
      baseDemandPerEvent: 1,
      wasteAdjustedDemand: 1.05,
      trigger: defaults.trigger,
      manufacturer: row.manufacturer,
      manufacturerLong: long,
      mfrCatNo: row.mfr_cat_no,
      ndc,
      productNoun: row.product_noun ?? "",
      productType: row.product_type,
      productSize: row.product_size,
      unspscCommodity: row.unspsc_commodity ?? "",
      ghxCommodityType: row.ghx_commodity_type,
      sosTypeDescription: sos,
      source: "supply_demo_v2",
      sourceCatalogEntryId: row.id,
    });
    itemsPromoted += 1;
  }

  // Bulk-insert items in chunks. ON CONFLICT DO NOTHING means re-runs on
  // a partially-promoted state are safe.
  const ITEM_CHUNK = 1000;
  for (let i = 0; i < itemBatch.length; i += ITEM_CHUNK) {
    const chunk = itemBatch.slice(i, i + ITEM_CHUNK);
    await db.insert(items).values(chunk).onConflictDoNothing();
  }

  // ---------------------------------------------------------------------
  // 2. Activate facility nodes (un-hide, geo-spread, classify).
  // ---------------------------------------------------------------------
  const facilityRows = await db.select().from(supplyDemoV2Facilities);
  let facilitiesActivated = 0;
  let facilitiesAlreadyActive = 0;
  const nodeIdByFacilityId = new Map<number, string>();

  for (const f of facilityRows) {
    if (!f.nodeId) continue;
    nodeIdByFacilityId.set(f.id, f.nodeId);
    const [existing] = await db
      .select({
        id: nodes.id,
        hidden: nodes.hiddenFromMap,
        coordsApproximate: nodes.coordsApproximate,
      })
      .from(nodes)
      .where(eq(nodes.id, f.nodeId));
    if (!existing) continue;
    if (!existing.hidden) {
      facilitiesAlreadyActive += 1;
      continue;
    }
    const { aor, regionalHub, latitude, longitude } = deriveAorAndCoords(
      f.code,
    );
    const type = classifyFacility(f.displayName, f.code);
    // Population sized so the synthetic-fallback demand path produces
    // sensible burn rates for items that don't have historical issues
    // recorded for them. Hash gives spread 800..2400.
    const population = 800 + (hash32(`${f.code}_pop`) % 1600);
    await db
      .update(nodes)
      .set({
        hiddenFromMap: false,
        latitude,
        longitude,
        type,
        aor,
        regionalHub,
        coordsApproximate: true,
        population,
        stockDays: 30,
        upstreamNode: regionalHub,
      })
      .where(eq(nodes.id, f.nodeId));
    facilitiesActivated += 1;
  }

  // ---------------------------------------------------------------------
  // 3. Demand rollup + inventory derivation.
  // ---------------------------------------------------------------------
  // Aggregate every issue row to one (facility, catalog) total, ranked
  // per facility by line_count so we can keep just the top-N for the
  // operational inventory table.
  const aggRows = await db.execute<{
    facility_id: number;
    catalog_id: number;
    total_qty: number;
    line_count: number;
    rank_in_facility: number;
  }>(sql`
    WITH agg AS (
      SELECT facility_id,
             catalog_id,
             SUM(quantity)::float8     AS total_qty,
             SUM(line_count)::int      AS line_count
      FROM supply_demo_v2_issues
      GROUP BY facility_id, catalog_id
    ),
    ranked AS (
      SELECT *,
             ROW_NUMBER() OVER (
               PARTITION BY facility_id ORDER BY line_count DESC, total_qty DESC
             ) AS rank_in_facility
      FROM agg
    )
    SELECT facility_id, catalog_id, total_qty, line_count, rank_in_facility
    FROM ranked
    WHERE line_count >= ${opts.minLineCount}
      AND rank_in_facility <= ${opts.maxItemsPerFacility}
  `);

  // Wipe and rewrite the rollup table so re-runs leave no stale rows.
  await db.delete(itemFacilityDemandRollup);

  const inventoryToInsert: Array<{
    nodeId: string;
    itemId: string;
    onHand: number;
  }> = [];
  const rollupToInsert: Array<typeof itemFacilityDemandRollup.$inferInsert> =
    [];

  for (const r of aggRows.rows) {
    const nodeId = nodeIdByFacilityId.get(r.facility_id);
    const itemId = promotedIdByCatalogId.get(r.catalog_id);
    if (!nodeId || !itemId) continue;
    const dailyBurn = r.total_qty / opts.observedDays;
    rollupToInsert.push({
      nodeId,
      itemId,
      facilityId: r.facility_id,
      catalogEntryId: r.catalog_id,
      totalQuantity: r.total_qty,
      lineCount: r.line_count,
      observedDays: opts.observedDays,
      dailyBurn,
    });
    // Derive on_hand. We aim for the facility to start "near target" so
    // some items show healthy DOS and only the heavy-burn ones light up
    // as warn / critical — that's exactly what makes the UI feel real.
    // Use a deterministic hash-based jitter so the same activation run
    // produces the same starting state every time.
    const j = (hash32(`${nodeId}:${itemId}`) % 1000) / 1000; // 0..1
    const dosJitter = 0.4 + j * 1.4; // 0.4x..1.8x of target
    const onHandRaw = dailyBurn * opts.targetDaysOfSupply * dosJitter;
    const onHand = Math.max(1, Math.round(onHandRaw));
    inventoryToInsert.push({ nodeId, itemId, onHand });
  }

  // Stream the rollup writes in chunks.
  const ROLLUP_CHUNK = 1000;
  let rollupRowsWritten = 0;
  for (let i = 0; i < rollupToInsert.length; i += ROLLUP_CHUNK) {
    const chunk = rollupToInsert.slice(i, i + ROLLUP_CHUNK);
    if (chunk.length > 0) {
      await db.insert(itemFacilityDemandRollup).values(chunk);
      rollupRowsWritten += chunk.length;
    }
  }

  // Wipe existing derived inventory so re-runs are idempotent. Seeded
  // inventory is preserved (source = 'seeded').
  await db
    .delete(inventoryBalances)
    .where(eq(inventoryBalances.source, "derived"));

  let inventoryRowsWritten = 0;
  const INV_CHUNK = 1000;
  for (let i = 0; i < inventoryToInsert.length; i += INV_CHUNK) {
    const chunk = inventoryToInsert.slice(i, i + INV_CHUNK);
    const values = chunk.map((c) => ({
      nodeId: c.nodeId,
      itemId: c.itemId,
      onHand: c.onHand,
      dueIn: 0,
      dueOut: 0,
      allocated: 0,
      source: "derived",
    }));
    await db.insert(inventoryBalances).values(values);
    inventoryRowsWritten += chunk.length;
  }

  const finishedAt = new Date();

  const [{ promotedItemCount }] = await db
    .select({
      promotedItemCount: sql<number>`count(*)::int`,
    })
    .from(items)
    .where(eq(items.source, "supply_demo_v2"));
  const [{ facilityCount }] = await db
    .select({
      facilityCount: sql<number>`count(*)::int`,
    })
    .from(supplyDemoV2Facilities);

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    itemsPromoted,
    itemsAlreadyPromoted,
    facilitiesActivated,
    facilitiesAlreadyActive,
    rollupRowsWritten,
    inventoryRowsWritten,
    facilityCount,
    promotedItemCount,
  };
}

/**
 * Reverse the effect of `runActivation`. Called from the rollback
 * endpoint before the staging tables are truncated.
 *
 *   - Re-hides every imported facility node and zeroes its coordinates.
 *   - Deletes derived `inventory_balances` rows (source = 'derived').
 *   - Deletes every row from `item_facility_demand_rollup`.
 *   - Deletes every promoted item (source = 'supply_demo_v2').
 *
 * Seed items, seed nodes, and seeded inventory are untouched.
 */
export interface ActivationRevertSummary {
  facilitiesRehidden: number;
  inventoryRowsDeleted: number;
  rollupRowsDeleted: number;
  itemsDeleted: number;
}

export async function revertActivation(): Promise<ActivationRevertSummary> {
  // Re-hide imported facility nodes (the placeholder ids start with
  // 'supplyV2_'). Reset coords so the next activation re-spreads cleanly.
  const facilitiesRehidden = await db
    .update(nodes)
    .set({
      hiddenFromMap: true,
      latitude: 0,
      longitude: 0,
      coordsApproximate: false,
      aor: null,
      regionalHub: null,
      upstreamNode: null,
      population: 0,
    })
    .where(
      and(
        eq(nodes.hiddenFromMap, false),
        sql`${nodes.id} LIKE 'supplyV2_%'`,
      ),
    )
    .returning({ id: nodes.id });

  const inventoryDeleted = await db
    .delete(inventoryBalances)
    .where(eq(inventoryBalances.source, "derived"))
    .returning({ id: inventoryBalances.id });

  const rollupDeleted = await db
    .delete(itemFacilityDemandRollup)
    .returning({ id: itemFacilityDemandRollup.id });

  const itemsDeleted = await db
    .delete(items)
    .where(eq(items.source, "supply_demo_v2"))
    .returning({ id: items.id });

  return {
    facilitiesRehidden: facilitiesRehidden.length,
    inventoryRowsDeleted: inventoryDeleted.length,
    rollupRowsDeleted: rollupDeleted.length,
    itemsDeleted: itemsDeleted.length,
  };
}

// Surface the suppress-unused warning for the imported but currently
// unused supplyDemoV2Catalog / supplyDemoV2Issues tables — they are
// referenced via raw SQL above and we want their drizzle types kept in
// scope so future refactors stay type-safe.
void supplyDemoV2Catalog;
void supplyDemoV2Issues;
