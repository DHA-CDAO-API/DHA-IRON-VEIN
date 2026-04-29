-- Migration for task #143: Editable Population at Risk per site.
-- Adds `seeded_active_supported_population` to `demand_profiles` so an
-- operator-edited PAR can be reverted to its originally-seeded baseline
-- without remembering the original number. Backfills existing rows from
-- the current `active_supported_population` so the "reset to seeded value"
-- affordance behaves correctly for already-seeded sites.
--
-- Applied via `pnpm --filter @workspace/db push` (drizzle-kit push). This
-- file is the equivalent SQL extracted for review/audit purposes.

ALTER TABLE "demand_profiles"
  ADD COLUMN IF NOT EXISTS "seeded_active_supported_population" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE "demand_profiles"
   SET "seeded_active_supported_population" = "active_supported_population"
 WHERE "seeded_active_supported_population" = 0
   AND "active_supported_population" > 0;
