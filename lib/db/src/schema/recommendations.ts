import { pgTable, text, doublePrecision, timestamp } from "drizzle-orm/pg-core";

export const recommendations = pgTable("recommendations", {
  id: text("id").primaryKey(),
  nodeId: text("node_id").notNull(),
  itemId: text("item_id").notNull(),
  kind: text("kind").notNull(),
  suggestedQty: doublePrecision("suggested_qty").notNull(),
  reason: text("reason").notNull(),
  expectedRiskReduction: doublePrecision("expected_risk_reduction").notNull().default(0),
  sourceSupplierId: text("source_supplier_id"),
  etaDays: doublePrecision("eta_days").notNull().default(7),
  status: text("status").notNull().default("OPEN"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  promotedOrderId: text("promoted_order_id"),
  scenarioId: text("scenario_id"),
  sourceChannel: text("source_channel"),
  estimatedUnitCostUsd: doublePrecision("estimated_unit_cost_usd").notNull().default(0),
  estimatedTotalCostUsd: doublePrecision("estimated_total_cost_usd").notNull().default(0),
});

export type Recommendation = typeof recommendations.$inferSelect;
