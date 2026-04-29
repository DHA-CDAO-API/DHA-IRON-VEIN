# Supply Demo Data v2 — Import, Reconciliation, and Map Integration

This document describes the end-to-end pipeline that brings the
`Supply_Demo_Data_2.xlsx` dataset (~389k unique issue rows, 61.9k catalog
entries, 25 MTF facilities) into the application without disturbing the
curated demo data, the operational schema, or any existing UI surface.

The pipeline has four stages, each owned by its own admin endpoint and
each independently reversible by the rollback endpoint:

1. **Import** — parse the spreadsheet and load it into isolated staging
   tables (`supply_demo_v2_*`).
2. **Reconcile** — fold the staging catalog rows into the canonical
   `catalog_entries` table.
3. **Map facilities** — create one hidden `nodes` row per imported facility
   so we have a real foreign-key target for downstream joins.
4. **Status panel** — read-only view of the pipeline state on the existing
   admin page.

All endpoints are mounted under `/api/admin/supply-import/`. They are
intentionally unauthenticated for the hackathon scope; locking them down is
tracked separately.

---

## 1. Import

### Source

The XLSX file lives in `attached_assets/Supply_Demo_Data_2_<timestamp>.xlsx`
(~114 MB, ~1.05 M raw rows). The pipeline uses an out-of-process dedup CLI
to collapse near-duplicates, then streams the deduped output into the
isolated staging tables.

### Staging schema

Four tables in `lib/db/src/schema/supply_demo_v2.ts`:

- `supply_demo_v2_catalog` — one row per unique
  `(mfr_cat_no, manufacturer_short)` pair from the spreadsheet.
- `supply_demo_v2_facilities` — one row per MTF code (e.g.
  `MTF-AAorin, AArel`). Carries a nullable `node_id` text column that the
  facility-mapping step populates.
- `supply_demo_v2_issues` — one row per `(catalog_id, facility_id, qty)`
  triple, deduplicated.
- `supply_demo_v2_imports` — one row per import run with timing, source
  file, and per-table counters.

These four tables are completely isolated from the operational schema
(`items`, `orders`, `inventory_balances`, `blood_lots`, etc.). No
operational query joins to them.

### Endpoints

```
POST /api/admin/supply-import/run
     body: { stagingDir?: string, sourceFile?: string }
     -> imports the deduped staging files into the four supply_demo_v2_*
        tables and writes one row to supply_demo_v2_imports.

POST /api/admin/supply-import/rollback
     -> truncates the four supply_demo_v2_* tables AND cleans up everything
        the reconcile / map-facilities steps produced (see below).
```

### Operating the import

```bash
# 1. Run the dedup CLI (out of process, ~57 sec for 114 MB / 1 M rows).
pnpm --filter @workspace/api-server exec tsx \
  src/scripts/supply-import-dedup-cli.ts \
  --in attached_assets/Supply_Demo_Data_2_<timestamp>.xlsx \
  --out /tmp/supply-staging

# 2. Run the import.
curl -X POST http://localhost:8080/api/admin/supply-import/run \
  -H 'content-type: application/json' \
  -d '{"stagingDir":"/tmp/supply-staging","sourceFile":"attached_assets/Supply_Demo_Data_2_<timestamp>.xlsx"}'
```

---

## 2. Reconciliation into `catalog_entries`

The 61.9k staging catalog rows live in `supply_demo_v2_catalog` after the
import. The reconciliation step folds them into the canonical
`catalog_entries` table so they're browsable and searchable through the
existing `/api/catalog` endpoint without disturbing the 1,664 curated seed
rows or the 35 curated `items` rows.

### What it touches

- Adds (or skips) rows in `catalog_entries`.
- Stamps every reconciled row with `source = 'supply_demo_v2'`.
- Never overwrites a seed row: the `ON CONFLICT (mfr_cat_no, manufacturer)
  DO UPDATE SET ... WHERE catalog_entries.source = 'supply_demo_v2'` clause
  drops conflicts that hit a seed row.

### Schema additions

- `catalog_entries.source TEXT NOT NULL DEFAULT 'seed'` — provenance tag.
- `UNIQUE INDEX catalog_entries_mfr_cat_no_mfr_idx
  ON catalog_entries(mfr_cat_no, manufacturer)` — required for the upsert.
- Postgres extension `pg_trgm` enabled.
- Five GIN trigram indexes (one each on `description`, `manufacturer`,
  `product_noun`, `product_type`, `mfr_cat_no`) so the existing catalog
  browse `ILIKE %term%` query stays under ~20 ms even at ~62k rows.

### Performance verified

`EXPLAIN ANALYZE` on the canonical browse query (5-column ILIKE OR with
`LIMIT 50`) shows execution time ~16 ms with bitmap-scan fan-out across
all five trigram indexes:

```
Limit  (actual time=16.2..16.3 rows=50 loops=1)
  ->  Bitmap Heap Scan on catalog_entries (...)
        ->  BitmapOr
              ->  Bitmap Index Scan on catalog_entries_description_trgm_idx
              ->  Bitmap Index Scan on catalog_entries_manufacturer_trgm_idx
              ->  Bitmap Index Scan on catalog_entries_product_noun_trgm_idx
              ->  Bitmap Index Scan on catalog_entries_product_type_trgm_idx
              ->  Bitmap Index Scan on catalog_entries_mfr_cat_no_trgm_idx
Execution Time: 16.5 ms
```

### What it does NOT touch

- The curated `items` table (35 rows). Imported catalog rows have
  `mapped = false` and `app_item_id = null`, so they never appear in
  orders, PAR, alerts, recommendations, scenarios, or dashboards. An
  operator must explicitly promote one (using the existing `mapped` /
  `app_item_id` flow) before it becomes operational.
- Any of the 1,664 seed `catalog_entries` rows.

### Endpoint

```
POST /api/admin/supply-import/reconcile
     -> upserts every supply_demo_v2_catalog row into catalog_entries with
        source = 'supply_demo_v2'. Returns counters:
        { staged, inserted, updated, skipped, totalAfter, reconciledAfter,
          startedAt, finishedAt, durationMs }.
```

Idempotent: re-running produces zero net new rows.

### Rollback behavior

The `POST /api/admin/supply-import/rollback` endpoint, in the same
transaction as the staging-table truncates, runs:

```sql
DELETE FROM catalog_entries WHERE source = 'supply_demo_v2';
```

Seed rows are untouched.

---

## 3. Facility node mapping

The 25 imported facility codes don't match any of the 35 curated NATO-letter
nodes (`mtfDelta`, `mtfEcho`, ..., `mtfVictor`). We create one new `nodes`
row per imported facility so `supply_demo_v2_facilities.node_id` carries a
real foreign-key reference, while keeping the imported nodes invisible on
the network map (per operator preference).

### Schema additions

- `nodes.hidden_from_map BOOLEAN NOT NULL DEFAULT false`. The 35 seed nodes
  remain at `false`; new placeholder nodes are inserted with `true`.
- `supply_demo_v2_facilities.node_id TEXT` (nullable) with a foreign key to
  `nodes(id) ON DELETE SET NULL`.

### What the mapping does

For each `supply_demo_v2_facilities` row whose `node_id` is null:

1. Generate a deterministic id `supplyV2_<sluggified-code>`.
2. Insert a `nodes` row with `hidden_from_map = true`,
   `name = display_name || code`, `type = 'mtf'`, `latitude = 0`,
   `longitude = 0`, all other fields at their column defaults.
3. Set `supply_demo_v2_facilities.node_id` to that node id.

Idempotent: rows with an existing `node_id` are skipped.

### Where the placeholder nodes appear and don't appear

- **Network map** (`/api/network/nodes`, `/api/network/snapshot`,
  `/api/dashboard/overview`) — filtered out by
  `WHERE hidden_from_map = false`. The map continues to render exactly the
  35 curated nodes.
- **Sites list page** (`/api/sites`) — NOT filtered. The 25 imported
  facilities show up in the list so an operator can see them and decide
  whether to promote any of them. Their location reads as `0, 0`; the UI
  treats those as "unplaced".
- **Orders destination picker, snapshot risk computation, scenario engine**
  — receive all nodes (no filter), but in practice the imported nodes
  never get assigned inventory or orders, so they don't surface in those
  flows.

### Endpoint

```
POST /api/admin/supply-import/map-facilities
     -> creates one hidden node per facility row that lacks one and
        backfills facility.node_id. Returns counters:
        { facilitiesProcessed, nodesCreated, alreadyMapped,
          hiddenNodesAfter, mappedFacilitiesAfter,
          startedAt, finishedAt, durationMs }.
```

### Rollback behavior

The rollback endpoint deletes every node where
`hidden_from_map = true AND id LIKE 'supplyV2_%'` before truncating the
staging tables. The FK on `supply_demo_v2_facilities.node_id` is
`ON DELETE SET NULL`, so the staging rows lose their reference cleanly
before being truncated.

---

## 4. Read-only admin status panel

The existing `/data` admin page (component
`artifacts/command/src/pages/DataAdmin.tsx`) renders a new
`SupplyImportPanel` card alongside the existing Tables panel.

### What it shows

- Seven count chips:
  - `supply_demo_v2_catalog` row count
  - `supply_demo_v2_facilities` row count
  - `supply_demo_v2_issues` row count
  - `supply_demo_v2_imports` row count
  - Reconciled catalog rows (`catalog_entries.source = 'supply_demo_v2'`)
  - Mapped facilities (`supply_demo_v2_facilities.node_id IS NOT NULL`)
  - Hidden map nodes (`nodes.hidden_from_map = true`)
- A history table with the last 10 import runs from
  `supply_demo_v2_imports` — Started, Duration, Source, Rows read, Catalog
  upserts, Facility upserts, Issues inserted, Notes.
- A "Read-only" badge in the card header. The panel never triggers
  imports, reconciles, mappings, or rollbacks; operators continue to use
  the four `POST /api/admin/supply-import/*` endpoints from `curl`.
- Auto-refreshes every 30 seconds, the same cadence as the existing Tables
  panel.

### Underlying endpoint

```
GET /api/admin/supply-import/status
    -> {
         checkedAt,
         tableCounts: { ...four supply_demo_v2_* counts },
         reconciledCatalogCount,
         mappedFacilitiesCount,
         hiddenNodeCount,
         recentImports: [...up to 10 runs sorted newest first]
       }
```

The endpoint and its `SupplyImportStatus` schema are declared in
`lib/api-spec/openapi.yaml`. The typed React Query hook
`useGetSupplyImportStatus` is generated by the existing `orval` codegen
(`pnpm --filter @workspace/api-spec run codegen`) and consumed by
`SupplyImportPanel`.

---

## End-to-end smoke test

```bash
API=http://localhost:8080/api

curl -X POST $API/admin/supply-import/run \
  -H 'content-type: application/json' \
  -d '{"stagingDir":"/tmp/supply-staging","sourceFile":"attached_assets/Supply_Demo_Data_2_<timestamp>.xlsx"}'

curl -X POST $API/admin/supply-import/reconcile        # ~16 sec for 61.9k rows
curl -X POST $API/admin/supply-import/map-facilities   # ~150 ms for 25 facilities
curl    -s   $API/admin/supply-import/status | jq .

# Spot-check the operational surfaces are unaffected:
curl -s $API/network/nodes  | jq 'length'              # 35 (no hidden nodes)
curl -s $API/sites          | jq 'length'              # 60 (35 + 25)
curl -s "$API/catalog/items?search=bandage&limit=10" | jq 'length'  # ~10, fast

# Tear it all down:
curl -X POST $API/admin/supply-import/rollback | jq .
# All four supply_demo_v2_* tables empty, catalog_entries back to 1664,
# nodes back to 35.
```
