import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const alerts = pgTable("alerts", {
  id: text("id").primaryKey(),
  nodeId: text("node_id").notNull(),
  itemId: text("item_id"),
  severity: text("severity").notNull(),
  category: text("category").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("OPEN"),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  ackedBy: text("acked_by"),
  ackedAt: timestamp("acked_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  notes: text("notes"),
});

export type Alert = typeof alerts.$inferSelect;
