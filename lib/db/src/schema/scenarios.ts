import { pgTable, text, jsonb, timestamp, customType, varchar } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const scenarios = pgTable("scenarios", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // DEPRECATED: legacy plaintext columns. Kept in the schema (without
  // .notNull) so drizzle-kit treats them as still-present and does not
  // ask whether `summary_enc` / `coa_brief_enc` are renames of these.
  // New writes go through summaryEnc / coaBriefEnc below.
  summary: text("summary"),
  // Free-text scenario narrative. Encrypted at rest with pgcrypto via the
  // encryption helper. Read with pgp_sym_decrypt.
  summaryEnc: bytea("summary_enc"),
  kind: text("kind").notNull(),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  inputs: jsonb("inputs").notNull(),
  result: jsonb("result").notNull(),
  aiProvider: text("ai_provider").notNull().default("openai"),
  aiModel: text("ai_model").notNull().default("gpt-5.4"),
  // DEPRECATED: legacy plaintext column (see note above on `summary`).
  coaBrief: text("coa_brief"),
  // Free-text COA brief / cascade story. Encrypted at rest.
  coaBriefEnc: bytea("coa_brief_enc"),
  // Audit trail of which authenticated user persisted the scenario.
  createdByUserId: varchar("created_by_user_id"),
});

export type Scenario = typeof scenarios.$inferSelect;
