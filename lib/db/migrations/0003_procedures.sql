-- Migration for the medical-procedures feature.
-- Adds:
--   * procedures               — the clinician-curated procedure library.
--   * procedure_supplies       — per-procedure supply tiers (primary /
--                                secondary / tertiary).
--   * procedure_roles          — echelon-of-care tags (role_1/2/3) per
--                                procedure.
--   * nodes.role               — echelon-of-care tag for demand nodes.
--                                NULL for non-demand sites.
--
-- Applied via `pnpm --filter @workspace/db push` (drizzle-kit push) for the
-- schema changes. This file is committed for parity with the other
-- migrations in this directory and is safe to re-run.

CREATE TABLE IF NOT EXISTS "procedures" (
  "id" text PRIMARY KEY NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "clinical_category" text NOT NULL DEFAULT 'general'
);

CREATE TABLE IF NOT EXISTS "procedure_supplies" (
  "procedure_id" text NOT NULL,
  "item_id" text NOT NULL,
  "tier" text NOT NULL,
  "quantity_per_event" double precision NOT NULL DEFAULT 1,
  "notes" text NOT NULL DEFAULT '',
  PRIMARY KEY ("procedure_id", "item_id")
);

CREATE TABLE IF NOT EXISTS "procedure_roles" (
  "procedure_id" text NOT NULL,
  "role" text NOT NULL,
  PRIMARY KEY ("procedure_id", "role")
);

ALTER TABLE "nodes" ADD COLUMN IF NOT EXISTS "role" text;
