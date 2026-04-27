import { pgTable, text, serial } from "drizzle-orm/pg-core";

export const profiles = pgTable("profiles", {
  id: serial("id").primaryKey(),
  displayName: text("display_name").notNull().default("LtCol J. Reyes"),
  role: text("role").notNull().default("commander"),
  theaterAssignment: text("theater_assignment").notNull().default("MARFORPAC J-4 (Forward)"),
  contactEmail: text("contact_email").notNull().default("j.reyes@marforpac.usmc.mil"),
});

export type Profile = typeof profiles.$inferSelect;
