# Supply Demo Data v2 — Import, Reconciliation, Activation, and Map Integration

This document describes the end-to-end pipeline that brings the
`Supply_Demo_Data_2.xlsx` dataset (~389k unique issue rows, 61.9k catalog
entries, 25 MTF facilities) into the application without disturbing the
curated demo data, the operational schema, or any existing UI surface.

The pipeline has five stages, each owned by its own admin endpoint and
each independently reversible by the rollback endpoint:

1. **Import** — parse the spreadsheet and load it into isolated staging
   tables (`supply_demo_v2_*`).
2. **Reconcile** — fold the staging catalog rows into the canonical
   `catalog_entries` table (capturing NDC, manufacturer-long, SOS type).
3. **Map facilities** — create one hidden `nodes` row per imported facility
   so we have a real foreign-key target for downstream joins.
4. **Activate** — promote reconciled catalog rows into `items`, un-hide
   facility nodes onto the network map, derive on-hand inventory from
   real issues data, and roll up per-(node,item) demand for the forecast
   engine.
5. **Status panel** — read-only view of the pipeline state on the existing
   admin page, plus an **Activate** button that calls the activation step.

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

## 4. Activation — promoting catalog → items + deriving inventory

Reconciliation and facility-mapping leave the dataset *visible* (browsable
in `/api/catalog`, foreign-key-able from staging) but *inactive*: the
imported catalog rows aren't `items`, the facility nodes are hidden from
the map, no inventory exists for them, and the forecast engine has no
real demand history. The activation step is what turns the dataset on.

### What it does

`artifacts/api-server/src/lib/supply-import/activate.ts` implements
`runActivation` and `revertActivation`. A single `runActivation` pass:

1. **Promote items.** For every `catalog_entries` row with
   `source = 'supply_demo_v2'`, insert (or update) an `items` row with id
   `cat_<entry_id>` carrying:
   - `source = 'supply_demo_v2'` and `sourceCatalogEntryId`
   - manufacturer, manufacturerLong, mfrCatNo, ndc, productNoun,
     productType, productSize, unspscCommodity, ghxCommodityType,
     sosTypeDescription (from the catalog row joined to the staging
     `supply_demo_v2_catalog`)
   - sensible defaults for criticality, usagePerDraw, usageRate,
     demandBasis, trigger, wasteAdjustedDemand, leadTimeDays,
     shelfLifeDays
2. **Activate facility nodes.** Flip every node whose id starts with
   `supplyV2_` from `hiddenFromMap = true` to `false`. Assign each one a
   deterministic location across the three INDOPACOM AOR buckets
   (`INDOPACOM-North`, `INDOPACOM-Central`, `INDOPACOM-South`) by hashing
   the facility code; jitter lat/lng inside the AOR; mark
   `coordsApproximate = true`. Classify type/regional hub/active
   population/stock days from the display name.
3. **Roll up demand.** From `supply_demo_v2_issues` joined to facilities
   (with a real `node_id`), aggregate `(node_id, item_id) → totalQuantity,
   lineCount, dailyBurn = totalQuantity / 365` into the new
   `item_facility_demand_rollup` table. The forecast engine reads this
   table on every request (see "Forecast integration" below).
4. **Derive inventory.** For each facility, pick its top 80 items by line
   count (cap to items with `lineCount >= 3` so we don't conjure stock
   for noise) and write one `inventory_balances` row per (node, item)
   with:
   ```
   onHand = round(dailyBurn * 21d * jitter)        # target_dos = 21 days
   par    = round(dailyBurn * 14d)
   reorderPoint = round(dailyBurn * 7d)
   source = 'derived'
   ```
   Existing seeded balances (`source = 'seeded'`) are never touched.

The function is **idempotent**: re-running produces zero net new rows on
items/inventory/rollup and zero net flips on nodes. It returns a summary
with counters used by the admin panel:

```ts
{
  itemsPromoted, itemsAlreadyPromoted,
  facilitiesActivated, facilitiesAlreadyActive,
  rollupRowsWritten, inventoryRowsWritten,
  durationMs
}
```

### Schema additions used by activation

- `items` — `manufacturer`, `manufacturerLong`, `mfrCatNo`, `ndc`,
  `productNoun`, `productType`, `productSize`, `unspscCommodity`,
  `ghxCommodityType`, `sosTypeDescription`, `source`
  ('seed'|'supply_demo_v2'), `sourceCatalogEntryId`.
- `nodes` — `aor`, `coordsApproximate`.
- `inventory_balances` — `source` ('seeded'|'derived'|'imported').
- `item_facility_demand_rollup` (new): `(nodeId, itemId, totalQuantity,
  lineCount, dailyBurn)` with PK `(nodeId, itemId)` and a covering index
  on `(nodeId)`.

Indexes added for the activation read paths:

- `items(source)`, `items(ndc)`, `items(mfrCatNo)`, `items(unspscCommodity)`
- `nodes(hiddenFromMap)`
- `inventory_balances(node_id, item_id)`

### Forecast integration (real demand history)

`artifacts/api-server/src/lib/ctx.ts` loads the rollup once per request
into `historicalBurn: Map<nodeId, Map<itemId, dailyBurn>>`.

The shared sim helper `computeDailyDemand` accepts an optional
`historicalBurnByItem` argument: when an item has a non-zero historical
burn rate at that node, the forecast uses that rate directly (still
flexed by the operational-state encounter multiplier and any encounter
override so scenario knobs continue to work). Items without history fall
back to the synthetic per-encounter math.

All callers — `/sites`, `/items`, `/inventory`, `/dashboard/overview`,
`/predictive`, `/overview`, `lib/snapshot`, `lib/blood-readiness`, and
`recommendations` — pass the per-node historical-burn map through.

### Endpoint

```
POST /api/admin/supply-import/activate
     -> runs runActivation(); returns the counters above. Idempotent.
```

The admin panel exposes a one-click **Activate** button in the
`SupplyImportPanel` card header that POSTs this endpoint and renders the
returned counters.

### Rollback behavior

`POST /api/admin/supply-import/rollback` now runs `revertActivation` *first*
inside the same transaction, then performs the existing reconcile/map
cleanup. `revertActivation`:

1. Deletes `inventory_balances` rows where `source = 'derived'`.
2. Truncates `item_facility_demand_rollup`.
3. Deletes `items` rows where `source = 'supply_demo_v2'`.
4. Re-hides `supplyV2_*` nodes (`hiddenFromMap = true`) and clears their
   AOR / approximate-coord flags.
5. Invalidates the in-memory simulation context cache so the next request
   reads a clean slate.

Seeded items, seeded balances, and the 35 curated nodes are untouched.

---

## 5. Read-only admin status panel

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
