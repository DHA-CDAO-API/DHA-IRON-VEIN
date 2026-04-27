import { pgTable, text, integer, doublePrecision } from "drizzle-orm/pg-core";

export const nodes = pgTable("nodes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  population: integer("population").notNull().default(0),
  optempo: text("optempo").notNull().default("garrison"),
  stockDays: integer("stock_days").notNull().default(30),
  regionalHub: text("regional_hub"),
  upstreamNode: text("upstream_node"),
  countryCode: text("country_code"),
});

export const routes = pgTable("routes", {
  id: text("id").primaryKey(),
  fromNode: text("from_node").notNull(),
  toNode: text("to_node").notNull(),
  priority: text("priority").notNull(),
  days: doublePrecision("days").notNull(),
  reliability: doublePrecision("reliability").notNull(),
  modality: text("modality").notNull().default("surface"),
});

export type Node = typeof nodes.$inferSelect;
export type Route = typeof routes.$inferSelect;
