import {
  pgTable,
  text,
  integer,
  numeric,
  timestamp,
  serial,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// Isolated staging tables for the Supply demo v2 dataset. These tables are
// populated by the dedup pipeline + importer in
// `artifacts/api-server/src/lib/supply-import/`. They live alongside the
// existing logical catalog/items/orders schema but never replace it; a
// follow-on task will reconcile entries here into the canonical
// `catalog_entries` / `items` rows.

export const supplyDemoV2Catalog = pgTable(
  "supply_demo_v2_catalog",
  {
    id: serial("id").primaryKey(),
    mfrCatNo: text("mfr_cat_no").notNull(),
    manufacturerShort: text("manufacturer_short").notNull(),
    manufacturerLong: text("manufacturer_long"),
    productNoun: text("product_noun"),
    productType: text("product_type"),
    itemDscShort: text("item_dsc_short"),
    fullDescription: text("full_description"),
    productNDC: text("product_ndc"),
    productSize: text("product_size"),
    unspscCommodity: text("unspsc_commodity"),
    ghxCommodityType: text("ghx_commodity_type"),
    sosTypeDescription: text("sos_type_description"),
    source: text("source").notNull().default("supply_demo_v2"),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    mfrCatNoMfrShortIdx: uniqueIndex(
      "supply_demo_v2_catalog_mfr_cat_no_mfr_short_idx",
    ).on(t.mfrCatNo, t.manufacturerShort),
  }),
);

// NOTE: we intentionally do not import `nodes` here to avoid coupling this
// staging schema to the runtime network schema. The `nodeId` column carries
// the foreign key id as a plain text reference; the real FK constraint is
// added via raw SQL in the migration step rather than in the Drizzle table
// definition, so the staging file can stand alone.
export const supplyDemoV2Facilities = pgTable("supply_demo_v2_facilities", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  displayName: text("display_name").notNull(),
  source: text("source").notNull().default("supply_demo_v2"),
  importedAt: timestamp("imported_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Set by the facility-mapping step to the id of the corresponding row in
  // `nodes` (always created with `hidden_from_map = true`). Nullable until
  // the mapping step runs.
  nodeId: text("node_id"),
});

export const supplyDemoV2Issues = pgTable(
  "supply_demo_v2_issues",
  {
    id: serial("id").primaryKey(),
    catalogId: integer("catalog_id")
      .notNull()
      .references(() => supplyDemoV2Catalog.id, { onDelete: "cascade" }),
    facilityId: integer("facility_id")
      .notNull()
      .references(() => supplyDemoV2Facilities.id, { onDelete: "cascade" }),
    quantity: numeric("quantity").notNull(),
    totalQuantity: numeric("total_quantity").notNull(),
    lineCount: integer("line_count").notNull(),
    source: text("source").notNull().default("supply_demo_v2"),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    catalogFacilityQtyIdx: uniqueIndex(
      "supply_demo_v2_issues_catalog_facility_qty_idx",
    ).on(t.catalogId, t.facilityId, t.quantity),
    catalogFacilityIdx: index("supply_demo_v2_issues_catalog_facility_idx").on(
      t.catalogId,
      t.facilityId,
    ),
  }),
);

export const supplyDemoV2Imports = pgTable("supply_demo_v2_imports", {
  id: serial("id").primaryKey(),
  sourceFile: text("source_file"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  sourceRowsRead: integer("source_rows_read"),
  duplicatesCollapsed: integer("duplicates_collapsed"),
  catalogUpserts: integer("catalog_upserts"),
  facilityUpserts: integer("facility_upserts"),
  issueRowsInserted: integer("issue_rows_inserted"),
  notes: text("notes"),
});

export type SupplyDemoV2Catalog = typeof supplyDemoV2Catalog.$inferSelect;
export type SupplyDemoV2Facility = typeof supplyDemoV2Facilities.$inferSelect;
export type SupplyDemoV2Issue = typeof supplyDemoV2Issues.$inferSelect;
export type SupplyDemoV2Import = typeof supplyDemoV2Imports.$inferSelect;
