import { pgTable, text, integer, doublePrecision, boolean } from "drizzle-orm/pg-core";

export const items = pgTable("items", {
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
  baseDemandPerEvent: doublePrecision("base_demand_per_event").notNull().default(1),
  wasteAdjustedDemand: doublePrecision("waste_adjusted_demand").notNull().default(1),
  trigger: text("trigger").notNull().default("phlebotomy_event"),
});

export type Item = typeof items.$inferSelect;
