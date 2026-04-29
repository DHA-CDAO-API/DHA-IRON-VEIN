import { pgTable, text, varchar, customType, timestamp, serial } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const profiles = pgTable("profiles", {
  // DEPRECATED: legacy integer surrogate key. Kept in the schema as the
  // primary key to match the existing database structure and avoid a
  // destructive ALTER TABLE during db:push. New rows still bind to a
  // Replit user via `userId` below.
  id: serial("id").primaryKey(),
  // One profile per authenticated user. Bound to the Replit user id so
  // profile state is per-identity. Marked unique so upserts by user_id
  // remain conflict-safe.
  userId: varchar("user_id")
    .unique()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  // DEPRECATED: legacy plaintext columns. Kept in the schema (without
  // .notNull) so drizzle-kit treats them as still-present and does not
  // ask whether the *_enc columns below are renames of these. New
  // writes go through the encrypted columns.
  displayName: text("display_name"),
  contactEmail: text("contact_email"),
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
