import { pgTable, text, doublePrecision, integer, jsonb } from "drizzle-orm/pg-core";

export const operationalStates = pgTable("operational_states", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  encounterMultiplier: doublePrecision("encounter_multiplier").notNull().default(1),
  populationMultiplier: doublePrecision("population_multiplier").notNull().default(1),
  description: text("description").notNull().default(""),
});

export const demandProfiles = pgTable("demand_profiles", {
  nodeId: text("node_id").primaryKey(),
  activeSupportedPopulation: integer("active_supported_population").notNull().default(0),
  dailyEncounterRate: doublePrecision("daily_encounter_rate").notNull().default(0),
  phlebotomyProbability: doublePrecision("phlebotomy_probability").notNull().default(0),
  specimensPerPhlebotomy: doublePrecision("specimens_per_phlebotomy").notNull().default(1),
  operationalState: text("operational_state").notNull().default("garrison"),
  wasteFactor: doublePrecision("waste_factor").notNull().default(1.1),
});

export const presetEvents = pgTable("preset_events", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  summary: text("summary").notNull(),
  durationDays: integer("duration_days").notNull().default(14),
  displayOrder: integer("display_order").notNull().default(100),
  parameters: jsonb("parameters").notNull(),
});

export const itemSkewFactors = pgTable("item_skew_factors", {
  itemId: text("item_id").primaryKey(),
  factor: doublePrecision("factor").notNull().default(1),
});

export type OperationalState = typeof operationalStates.$inferSelect;
export type DemandProfile = typeof demandProfiles.$inferSelect;
export type PresetEvent = typeof presetEvents.$inferSelect;
