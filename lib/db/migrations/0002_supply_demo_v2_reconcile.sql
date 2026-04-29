-- Migration for the supply demo reconciliation + facility-mapping pipeline.
-- Adds:
--   * catalog_entries.source provenance column (default 'seed') and a
--     unique index on (mfr_cat_no, manufacturer) so the reconciler can
--     ON CONFLICT-upsert without overwriting curated seed rows.
--   * nodes.hidden_from_map column so the 25 placeholder nodes the
--     facility mapper creates can be filtered out of the network map
--     while remaining visible in the Sites list.
--   * supply_demo_v2_facilities.node_id text column + ON DELETE SET NULL
--     foreign key to nodes(id) so each imported facility carries a real
--     FK target after mapping.
--   * pg_trgm extension and five GIN trigram indexes on the searchable
--     catalog_entries columns so the existing 5-column ILIKE %term% browse
--     query stays under ~20 ms at ~62k rows.
--
-- Applied via `pnpm --filter @workspace/db push` (drizzle-kit push) for the
-- column / FK changes. The pg_trgm extension and the five GIN indexes are
-- applied directly via this file because drizzle-kit push does not manage
-- extensions or `USING gin (... gin_trgm_ops)` indexes. Re-running this
-- file is safe — every statement uses IF NOT EXISTS.

-- Provenance column on catalog_entries. 'seed' = curated import-script
-- rows (never overwritten). 'supply_demo_v2' = rows produced by the
-- supply demo reconciler.
ALTER TABLE "catalog_entries"
  ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'seed';

-- Required for the reconciler's ON CONFLICT (mfr_cat_no, manufacturer)
-- DO UPDATE clause.
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_entries_mfr_cat_no_mfr_idx"
  ON "catalog_entries" ("mfr_cat_no", "manufacturer");

-- Hidden-from-map flag on nodes. The 35 curated seed nodes remain at
-- false; placeholder nodes created by the facility mapping step are
-- inserted with true.
ALTER TABLE "nodes"
  ADD COLUMN IF NOT EXISTS "hidden_from_map" boolean NOT NULL DEFAULT false;

-- node_id reference on staging facilities. ON DELETE SET NULL lets the
-- rollback step delete placeholder nodes before truncating the staging
-- table.
ALTER TABLE "supply_demo_v2_facilities"
  ADD COLUMN IF NOT EXISTS "node_id" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'supply_demo_v2_facilities_node_id_fk'
  ) THEN
    ALTER TABLE "supply_demo_v2_facilities"
      ADD CONSTRAINT "supply_demo_v2_facilities_node_id_fk"
      FOREIGN KEY ("node_id") REFERENCES "nodes"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END$$;

-- Trigram extension + GIN indexes for fast ILIKE %term% browse against
-- ~62k catalog rows.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "catalog_entries_description_trgm_idx"
  ON "catalog_entries" USING gin ("description" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "catalog_entries_manufacturer_trgm_idx"
  ON "catalog_entries" USING gin ("manufacturer" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "catalog_entries_product_noun_trgm_idx"
  ON "catalog_entries" USING gin ("product_noun" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "catalog_entries_product_type_trgm_idx"
  ON "catalog_entries" USING gin ("product_type" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "catalog_entries_mfr_cat_no_trgm_idx"
  ON "catalog_entries" USING gin ("mfr_cat_no" gin_trgm_ops);
