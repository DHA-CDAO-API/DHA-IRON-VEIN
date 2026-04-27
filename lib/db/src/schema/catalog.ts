import { pgTable, text, integer, doublePrecision, boolean, serial } from "drizzle-orm/pg-core";

export const catalogEntries = pgTable("catalog_entries", {
  id: serial("id").primaryKey(),
  mfrCatNo: text("mfr_cat_no").notNull(),
  appItemId: text("app_item_id"),
  mapped: boolean("mapped").notNull().default(false),
  orderLines: integer("order_lines").notNull().default(0),
  totalQty: doublePrecision("total_qty").notNull().default(0),
  description: text("description").notNull(),
  manufacturer: text("manufacturer").notNull(),
  productNoun: text("product_noun").notNull(),
  productType: text("product_type").notNull(),
  unspscCommodity: text("unspsc_commodity"),
  productSize: text("product_size"),
  ghxCommodityType: text("ghx_commodity_type"),
  fullDescription: text("full_description"),
});

export type CatalogEntry = typeof catalogEntries.$inferSelect;
