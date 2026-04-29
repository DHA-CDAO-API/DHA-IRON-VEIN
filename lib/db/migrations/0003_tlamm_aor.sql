-- Migration for the TLAMM (Theater Lead Agent for Medical Materiel)
-- feature: AORs (Areas of Responsibility) and the TLAMM/AOR membership
-- columns on nodes that drive intra-theater first-look sourcing.
--
-- Adds:
--   * `aors` table — the seeded Northeast Asia / Southeast Asia /
--     Oceania / Indian Ocean AORs that the four INDOPACOM hubs cover.
--   * `nodes.is_tlamm` — true on the four hub nodes that act as their
--     AOR's TLAMM, false on every other node.
--   * `nodes.aor_id` — every node's AOR membership (nullable, joins on
--     `aors.id` in application code; the `nodes` table currently has no
--     declared FK constraints to keep reseed truncate-cascade ordering
--     simple, matching the rest of the schema).
--   * `nodes.primary_tlamm_node_id` — for downstream MTFs, the TLAMM
--     they should pull from first. Nullable for TLAMMs and depots.
--
-- Applied via `pnpm --filter @workspace/db push` (drizzle-kit push) for
-- the column / table changes — drizzle-kit is the source of truth for
-- this schema. This file documents and provides parity for environments
-- (e.g. production replays) where migrations are applied directly. Every
-- statement uses IF NOT EXISTS, so it is safe to re-run.

CREATE TABLE IF NOT EXISTS "aors" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text
);

ALTER TABLE "nodes"
  ADD COLUMN IF NOT EXISTS "is_tlamm" boolean NOT NULL DEFAULT false;

ALTER TABLE "nodes"
  ADD COLUMN IF NOT EXISTS "aor_id" text;

ALTER TABLE "nodes"
  ADD COLUMN IF NOT EXISTS "primary_tlamm_node_id" text;
