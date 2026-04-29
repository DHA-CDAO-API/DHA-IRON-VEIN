import { pgTable, text, varchar, customType, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const profiles = pgTable("profiles", {
  // One profile per authenticated user. Keyed on the Replit user id so
  // profile state is bound to the logged-in identity, not a shared row.
  userId: varchar("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  // Encrypted-at-rest with pgcrypto via lib/crypto.encryptedTextWrite.
  displayNameEnc: bytea("display_name_enc"),
  contactEmailEnc: bytea("contact_email_enc"),
  // Plaintext, non-sensitive.
  role: text("role").notNull().default("analyst"),
  theaterAssignment: text("theater_assignment").notNull().default("MARFORPAC J-4 (Forward)"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Profile = typeof profiles.$inferSelect;
