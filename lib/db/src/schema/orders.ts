import {
  pgTable,
  text,
  doublePrecision,
  timestamp,
  serial,
  customType,
  varchar,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const orders = pgTable("orders", {
  id: text("id").primaryKey(),
  orderNo: text("order_no").notNull(),
  nodeId: text("node_id").notNull(),
  supplierId: text("supplier_id").notNull(),
  status: text("status").notNull().default("DRAFT"),
  priority: text("priority").notNull().default("ROUTINE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  requestedDeliveryAt: timestamp("requested_delivery_at", { withTimezone: true }).notNull(),
  totalUsd: doublePrecision("total_usd").notNull().default(0),
  // DEPRECATED: legacy plaintext column. Kept in the schema (without
  // .notNull) so drizzle-kit treats it as still-present and does not
  // ask whether `notes_enc` is a rename of it. New writes go through
  // notesEnc below.
  notes: text("notes"),
  // Operator-entered free text (notes/rationale/contact). Encrypted at rest
  // with pgcrypto via the encryption helper.
  notesEnc: bytea("notes_enc"),
  promotedFromRecommendationId: text("promoted_from_recommendation_id"),
  // Audit trail of who placed the order.
  createdByUserId: varchar("created_by_user_id"),
  createdByRole: text("created_by_role"),
});

export const orderLines = pgTable("order_lines", {
  id: serial("id").primaryKey(),
  orderId: text("order_id").notNull(),
  itemId: text("item_id").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  unitPriceUsd: doublePrecision("unit_price_usd").notNull().default(0),
  lineTotalUsd: doublePrecision("line_total_usd").notNull().default(0),
});

export const shipments = pgTable("shipments", {
  id: text("id").primaryKey(),
  orderId: text("order_id"),
  fromNode: text("from_node").notNull(),
  toNode: text("to_node").notNull(),
  itemId: text("item_id").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  departedAt: timestamp("departed_at", { withTimezone: true }).notNull().defaultNow(),
  etaAt: timestamp("eta_at", { withTimezone: true }).notNull(),
  priority: text("priority").notNull().default("ROUTINE"),
});

export type Order = typeof orders.$inferSelect;
export type OrderLine = typeof orderLines.$inferSelect;
export type Shipment = typeof shipments.$inferSelect;
