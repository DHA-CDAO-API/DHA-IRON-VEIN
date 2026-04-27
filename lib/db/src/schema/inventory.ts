import { pgTable, text, integer, doublePrecision, timestamp, serial } from "drizzle-orm/pg-core";

export const inventoryBalances = pgTable("inventory_balances", {
  id: serial("id").primaryKey(),
  nodeId: text("node_id").notNull(),
  itemId: text("item_id").notNull(),
  onHand: doublePrecision("on_hand").notNull().default(0),
  dueIn: doublePrecision("due_in").notNull().default(0),
  dueOut: doublePrecision("due_out").notNull().default(0),
  allocated: doublePrecision("allocated").notNull().default(0),
  lastCountedAt: timestamp("last_counted_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InventoryBalance = typeof inventoryBalances.$inferSelect;
