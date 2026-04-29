import {
  pgTable,
  text,
  integer,
  doublePrecision,
  timestamp,
  serial,
  index,
} from "drizzle-orm/pg-core";

export const inventoryBalances = pgTable(
  "inventory_balances",
  {
    id: serial("id").primaryKey(),
    nodeId: text("node_id").notNull(),
    itemId: text("item_id").notNull(),
    onHand: doublePrecision("on_hand").notNull().default(0),
    dueIn: doublePrecision("due_in").notNull().default(0),
    dueOut: doublePrecision("due_out").notNull().default(0),
    allocated: doublePrecision("allocated").notNull().default(0),
    lastCountedAt: timestamp("last_counted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Provenance: 'seeded' for rows the canonical seeder lays down,
    // 'derived' for rows the activation step computes from issues data,
    // 'imported' for rows that come back from a real EHR-style feed.
    source: text("source").notNull().default("seeded"),
  },
  (t) => ({
    nodeItemIdx: index("inventory_balances_node_item_idx").on(
      t.nodeId,
      t.itemId,
    ),
    sourceIdx: index("inventory_balances_source_idx").on(t.source),
  }),
);

export type InventoryBalance = typeof inventoryBalances.$inferSelect;

// Pre-aggregated demand rollup keyed by (node, item). Computed by the
// activation step from `supply_demo_v2_issues` so dashboard and forecast
// queries can read a single row per (node, item) instead of fanning out
// across hundreds of thousands of issue rows.
//
// `dailyBurn` is `totalQuantity / observedDays`, where observedDays is a
// constant (default 365) embedded by the activation step. It feeds the
// forecast engine's historical-burn override path.
export const itemFacilityDemandRollup = pgTable(
  "item_facility_demand_rollup",
  {
    id: serial("id").primaryKey(),
    nodeId: text("node_id").notNull(),
    itemId: text("item_id").notNull(),
    facilityId: integer("facility_id"),
    catalogEntryId: integer("catalog_entry_id"),
    totalQuantity: doublePrecision("total_quantity").notNull().default(0),
    lineCount: integer("line_count").notNull().default(0),
    observedDays: integer("observed_days").notNull().default(365),
    dailyBurn: doublePrecision("daily_burn").notNull().default(0),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    nodeItemIdx: index("item_facility_demand_rollup_node_item_idx").on(
      t.nodeId,
      t.itemId,
    ),
    nodeIdx: index("item_facility_demand_rollup_node_idx").on(t.nodeId),
  }),
);

export type ItemFacilityDemandRollup =
  typeof itemFacilityDemandRollup.$inferSelect;
