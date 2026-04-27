import { pgTable, text, doublePrecision, integer } from "drizzle-orm/pg-core";

export const suppliers = pgTable("suppliers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  channel: text("channel").notNull(),
  country: text("country").notNull().default("US"),
  leadTimeDaysMean: doublePrecision("lead_time_days_mean").notNull().default(7),
  reliabilityScore: doublePrecision("reliability_score").notNull().default(0.9),
  notes: text("notes"),
  itemsCovered: integer("items_covered").notNull().default(0),
});

export type Supplier = typeof suppliers.$inferSelect;
