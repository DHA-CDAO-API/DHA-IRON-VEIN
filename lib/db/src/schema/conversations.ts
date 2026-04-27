import { pgTable, text, jsonb, timestamp, serial } from "drizzle-orm/pg-core";

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("New conversation"),
  role: text("role").notNull().default("commander"),
  aiProvider: text("ai_provider").notNull().default("openai"),
  aiModel: text("ai_model").notNull().default("gpt-5.4"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversationMessages = pgTable("conversation_messages", {
  id: serial("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  citations: jsonb("citations").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Conversation = typeof conversations.$inferSelect;
export type ConversationMessage = typeof conversationMessages.$inferSelect;
