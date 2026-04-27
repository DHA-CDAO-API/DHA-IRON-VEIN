import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const scenarios = pgTable("scenarios", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  summary: text("summary").notNull(),
  kind: text("kind").notNull(),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  inputs: jsonb("inputs").notNull(),
  result: jsonb("result").notNull(),
  aiProvider: text("ai_provider").notNull().default("openai"),
  aiModel: text("ai_model").notNull().default("gpt-5.4"),
  coaBrief: text("coa_brief").notNull().default(""),
});

export type Scenario = typeof scenarios.$inferSelect;
