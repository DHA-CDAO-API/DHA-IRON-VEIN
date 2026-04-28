import { pgTable, text, doublePrecision, integer, jsonb, primaryKey } from "drizzle-orm/pg-core";
import { items } from "./items";

export const suppliers = pgTable("suppliers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  channel: text("channel").notNull(),
  country: text("country").notNull().default("US"),
  leadTimeDaysMean: doublePrecision("lead_time_days_mean").notNull().default(7),
  reliabilityScore: doublePrecision("reliability_score").notNull().default(0.9),
  notes: text("notes"),
  itemsCovered: integer("items_covered").notNull().default(0),
  itemsCoveredIds: jsonb("items_covered_ids").$type<string[]>().notNull().default([]),
});

export type Supplier = typeof suppliers.$inferSelect;

export const supplierItems = pgTable(
  "supplier_items",
  {
    supplierId: text("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.supplierId, t.itemId] }),
  }),
);

export type SupplierItem = typeof supplierItems.$inferSelect;
