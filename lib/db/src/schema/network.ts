import {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  index,
} from "drizzle-orm/pg-core";

export const nodes = pgTable(
  "nodes",
  {
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
    // Operational AOR string used by the activation step to spread imported
    // facilities across the INDOPACOM theater. Free-text label like
    // "INDOPACOM-North" / "INDOPACOM-South" / "INDOPACOM-Central".
    aor: text("aor"),
    // True when the node's lat/lng was synthesized by activation (not from
    // a real coordinate source). UI surfaces this as an advisory badge.
    coordsApproximate: boolean("coords_approximate").notNull().default(false),
  },
  (t) => ({
    hiddenIdx: index("nodes_hidden_from_map_idx").on(t.hiddenFromMap),
  }),
);

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
