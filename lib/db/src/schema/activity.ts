import { pgTable, text, timestamp, serial, jsonb } from "drizzle-orm/pg-core";

export const activityEntries = pgTable("activity_entries", {
  id: serial("id").primaryKey(),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  kind: text("kind").notNull(),
  actor: text("actor").notNull().default("system"),
  message: text("message").notNull(),
  refType: text("ref_type"),
  refId: text("ref_id"),
  meta: jsonb("meta").notNull().default({}),
});

export type ActivityEntry = typeof activityEntries.$inferSelect;
