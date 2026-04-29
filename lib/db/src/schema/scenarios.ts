import { pgTable, text, jsonb, timestamp, customType, varchar } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const scenarios = pgTable("scenarios", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // Free-text scenario narrative. Encrypted at rest with pgcrypto via the
  // encryption helper. Read with pgp_sym_decrypt.
  summaryEnc: bytea("summary_enc"),
  kind: text("kind").notNull(),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  inputs: jsonb("inputs").notNull(),
  result: jsonb("result").notNull(),
  aiProvider: text("ai_provider").notNull().default("openai"),
  aiModel: text("ai_model").notNull().default("gpt-5.4"),
  // Free-text COA brief / cascade story. Encrypted at rest.
  coaBriefEnc: bytea("coa_brief_enc"),
  // Audit trail of which authenticated user persisted the scenario.
  createdByUserId: varchar("created_by_user_id"),
});

export type Scenario = typeof scenarios.$inferSelect;
