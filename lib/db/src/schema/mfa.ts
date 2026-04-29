import { pgTable, text, varchar, timestamp, integer, customType } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const userMfa = pgTable("user_mfa", {
  userId: varchar("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  secretEnc: bytea("secret_enc"),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  failureCount: integer("failure_count").notNull().default(0),
  lockoutUntil: timestamp("lockout_until", { withTimezone: true }),
  recoveryCodesHashes: text("recovery_codes_hashes").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const mfaAudit = pgTable("mfa_audit", {
  id: varchar("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id"),
  event: text("event").notNull(),
  ip: text("ip"),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserMfa = typeof userMfa.$inferSelect;
export type MfaAudit = typeof mfaAudit.$inferSelect;
