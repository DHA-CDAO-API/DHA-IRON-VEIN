import {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  index,
} from "drizzle-orm/pg-core";

export const items = pgTable(
  "items",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    niinOrSku: text("niin_or_sku").notNull().default(""),
    unitOfIssue: text("unit_of_issue").notNull(),
    classOfSupply: text("class_of_supply").notNull().default("VIII"),
    category: text("category").notNull().default("other"),
    mandatory: boolean("mandatory").notNull().default(true),
    criticality: text("criticality").notNull().default("medium"),
    leadTimeDays: integer("lead_time_days").notNull().default(7),
    shelfLifeDays: integer("shelf_life_days").notNull().default(365),
    // Catalog unit price in USD. The order-create handler reads this column
    // to compute `total_usd` server-side instead of trusting client-supplied
    // prices, and refuses to write any PO whose computed total is $0.
    // Default 0 keeps the migration safe for legacy rows; the seed is the
    // authority for setting realistic prices on every catalog item.
    unitPriceUsd: doublePrecision("unit_price_usd").notNull().default(0),
    baseDemandPerEvent: doublePrecision("base_demand_per_event")
      .notNull()
      .default(1),
    wasteAdjustedDemand: doublePrecision("waste_adjusted_demand")
      .notNull()
      .default(1),
    trigger: text("trigger").notNull().default("phlebotomy_event"),
    // Commodity attributes (extension for the casualty / multi-class supply
    // model). These let the casualty planner and future consumer-type engines
    // group required materiel by commodity rather than by hand-curated id.
    commodityType: text("commodity_type").notNull().default(""),
    unspscCommodity: text("unspsc_commodity").notNull().default(""),
    size: text("size").notNull().default(""),
    productNoun: text("product_noun").notNull().default(""),
    // Optional structured tag set used by the staffing model to find PPE by
    // role/material kind (e.g. "ppe:gloves", "ppe:mask:n95"). When empty the
    // item is treated as a generic consumable.
    staffingTag: text("staffing_tag").notNull().default(""),
    // Rich attributes carried over from supply_demo_v2 catalog rows. All
    // nullable; seeded items do not populate them.
    manufacturer: text("manufacturer"),
    manufacturerLong: text("manufacturer_long"),
    mfrCatNo: text("mfr_cat_no"),
    ndc: text("ndc"),
    productType: text("product_type"),
    productSize: text("product_size"),
    ghxCommodityType: text("ghx_commodity_type"),
    sosTypeDescription: text("sos_type_description"),
    // Provenance flag. 'seed' for the curated rows; 'supply_demo_v2' for
    // rows promoted from catalog_entries by the activation step.
    source: text("source").notNull().default("seed"),
    // The catalog_entries.id this item was promoted from, when applicable.
    sourceCatalogEntryId: integer("source_catalog_entry_id"),
  },
  (t) => ({
    sourceIdx: index("items_source_idx").on(t.source),
    ndcIdx: index("items_ndc_idx").on(t.ndc),
    mfrCatIdx: index("items_mfr_cat_no_idx").on(t.mfrCatNo),
    unspscIdx: index("items_unspsc_idx").on(t.unspscCommodity),
  }),
);

export type Item = typeof items.$inferSelect;
