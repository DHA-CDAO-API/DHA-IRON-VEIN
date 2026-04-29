import {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  serial,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const catalogEntries = pgTable(
  "catalog_entries",
  {
    id: serial("id").primaryKey(),
    mfrCatNo: text("mfr_cat_no").notNull(),
    appItemId: text("app_item_id"),
    mapped: boolean("mapped").notNull().default(false),
    orderLines: integer("order_lines").notNull().default(0),
    totalQty: doublePrecision("total_qty").notNull().default(0),
    description: text("description").notNull(),
    manufacturer: text("manufacturer").notNull(),
    manufacturerLong: text("manufacturer_long"),
    productNoun: text("product_noun").notNull(),
    productType: text("product_type").notNull(),
    unspscCommodity: text("unspsc_commodity"),
    productSize: text("product_size"),
    ghxCommodityType: text("ghx_commodity_type"),
    fullDescription: text("full_description"),
    ndc: text("ndc"),
    sosTypeDescription: text("sos_type_description"),
    // Provenance tag. 'seed' for the curated rows that come from the
    // application seeder; 'supply_demo_v2' for rows reconciled in from the
    // isolated supply_demo_v2_catalog staging table. Used by the rollback
    // endpoint to clean up imported rows without disturbing seed data.
    source: text("source").notNull().default("seed"),
  },
  (t) => ({
    mfrCatNoMfrIdx: uniqueIndex("catalog_entries_mfr_cat_no_mfr_idx").on(
      t.mfrCatNo,
      t.manufacturer,
    ),
  }),
);

export type CatalogEntry = typeof catalogEntries.$inferSelect;
