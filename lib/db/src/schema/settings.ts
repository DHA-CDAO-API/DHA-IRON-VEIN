import {
  pgTable,
  text,
  doublePrecision,
  boolean,
  integer,
  serial,
  customType,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const appSettings = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  aiProvider: text("ai_provider").notNull().default("openai"),
  aiModel: text("ai_model").notNull().default("gpt-5.4"),
  // Optional secret/api-key style override for the AI provider — encrypted at
  // rest with pgcrypto via the encryption helper.
  aiProviderApiKeyEnc: bytea("ai_provider_api_key_enc"),
  autoFlyMap: boolean("auto_fly_map").notNull().default(true),
  demandPaddingDays: integer("demand_padding_days").notNull().default(7),
  wasteFactor: doublePrecision("waste_factor").notNull().default(1.1),
  dmlssConnectorEnabled: boolean("dmlss_connector_enabled").notNull().default(false),
  alertWatchThresholdDays: integer("alert_watch_threshold_days").notNull().default(14),
  alertCriticalThresholdDays: integer("alert_critical_threshold_days").notNull().default(5),
});

export type AppSettings = typeof appSettings.$inferSelect;
