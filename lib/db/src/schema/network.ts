import { pgTable, text, integer, doublePrecision, boolean } from "drizzle-orm/pg-core";

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
  // When true, this node represents a placeholder created by the supply
  // demo facility import. It carries no real geography and must NOT be
  // rendered on the network map. The Sites list page still shows it so an
  // operator can choose to promote it later.
  hiddenFromMap: boolean("hidden_from_map").notNull().default(false),
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
