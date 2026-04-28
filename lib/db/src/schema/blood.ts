import {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  serial,
} from "drizzle-orm/pg-core";

// Per-unit blood lots held at a node. Each row represents a homogeneous batch
// of one component / ABO / Rh that all expire on the same day.
export const bloodLots = pgTable("blood_lots", {
  id: text("id").primaryKey(),
  nodeId: text("node_id").notNull(),
  itemId: text("item_id").notNull(),
  // Component family — LTOWB | PRBC | FFP | PLASMA | PLATELETS | CRYO | FDP
  component: text("component").notNull(),
  // ABO group: O | A | B | AB | UNIVERSAL (FDP/cryo) | null
  aboGroup: text("abo_group"),
  // Rh factor: POS | NEG | null
  rhFactor: text("rh_factor"),
  units: integer("units").notNull().default(0),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  // VIABLE | NEAR_EXPIRY | EXPIRED | COMPROMISED
  status: text("status").notNull().default("VIABLE"),
  coldChainAssetId: text("cold_chain_asset_id"),
});

// Per-site cold-chain assets (refrigerators, freezers, cryopreservers,
// platelet incubators, transport coolers) and the generator backing them.
export const coldChainAssets = pgTable("cold_chain_assets", {
  id: text("id").primaryKey(),
  nodeId: text("node_id").notNull(),
  // refrigerator | freezer | cryopreserver | platelet_incubator | transport_cooler | generator
  assetType: text("asset_type").notNull(),
  name: text("name").notNull(),
  // NOMINAL | EXCURSION | FAILED
  status: text("status").notNull().default("NOMINAL"),
  currentTempC: doublePrecision("current_temp_c").notNull().default(4),
  targetTempMinC: doublePrecision("target_temp_min_c").notNull().default(2),
  targetTempMaxC: doublePrecision("target_temp_max_c").notNull().default(6),
  hasGenerator: boolean("has_generator").notNull().default(false),
  fuelDaysRemaining: doublePrecision("fuel_days_remaining").notNull().default(0),
  capacityUnits: integer("capacity_units").notNull().default(0),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull().defaultNow(),
});

// Donor pool for a node. Tracks total eligible donors plus the
// walking-blood-bank-ready subset broken out by ABO/Rh.
export const donorPools = pgTable("donor_pools", {
  nodeId: text("node_id").primaryKey(),
  eligibleDonors: integer("eligible_donors").notNull().default(0),
  weeklyCollectionCapacity: integer("weekly_collection_capacity").notNull().default(0),
  wbbReadyOPos: integer("wbb_ready_o_pos").notNull().default(0),
  wbbReadyONeg: integer("wbb_ready_o_neg").notNull().default(0),
  wbbReadyAPos: integer("wbb_ready_a_pos").notNull().default(0),
  wbbReadyANeg: integer("wbb_ready_a_neg").notNull().default(0),
  wbbReadyBPos: integer("wbb_ready_b_pos").notNull().default(0),
  wbbReadyBNeg: integer("wbb_ready_b_neg").notNull().default(0),
  wbbReadyAbPos: integer("wbb_ready_ab_pos").notNull().default(0),
  wbbReadyAbNeg: integer("wbb_ready_ab_neg").notNull().default(0),
  lastDriveAt: timestamp("last_drive_at", { withTimezone: true }).notNull().defaultNow(),
});

// Recorded temperature excursion events on cold-chain assets.
export const temperatureEvents = pgTable("temperature_events", {
  id: serial("id").primaryKey(),
  assetId: text("asset_id").notNull(),
  nodeId: text("node_id").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  recordedTempC: doublePrecision("recorded_temp_c").notNull(),
  // WATCH | WARNING | CRITICAL
  severity: text("severity").notNull().default("WATCH"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  notes: text("notes").notNull().default(""),
});

export type BloodLot = typeof bloodLots.$inferSelect;
export type ColdChainAsset = typeof coldChainAssets.$inferSelect;
export type DonorPool = typeof donorPools.$inferSelect;
export type TemperatureEvent = typeof temperatureEvents.$inferSelect;
