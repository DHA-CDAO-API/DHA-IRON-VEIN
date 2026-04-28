import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const theaterZones = pgTable("theater_zones", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  severity: text("severity").notNull().default("WATCH"),
  kind: text("kind").notNull().default("custom"),
  polygon: jsonb("polygon").notNull().$type<number[][]>(),
  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TheaterZone = typeof theaterZones.$inferSelect;
export type NewTheaterZone = typeof theaterZones.$inferInsert;
