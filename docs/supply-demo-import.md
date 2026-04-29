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

# Supply demo v2 import — operator reference

## Overview

The Supply demo v2 import loads a single source workbook —
`attached_assets/Supply_Demo_Data_2_1777401753577.xlsx` — into the
Postgres database backing the IRON VEIN platform. The workbook is the
"Supply_Demo_Data_2" extract: 14 columns of issuance records covering
catalog metadata, military treatment facility (MTF) codes, and per-line
order quantities. It is dense with byte-identical duplicate rows.

Observed source size: roughly **1.05 million data rows**, which sits
right at Microsoft Excel's per-sheet row limit of 1,048,576. The
workbook itself is ~110 MB compressed and decompresses to ~1 GB across
its shared-strings and sheet streams, so the importer treats it as a
streaming source rather than loading it into memory.

**Non-destructive design guarantee.** The import lands in **four new
tables only**, all prefixed `supply_demo_v2_`. No existing table,
route, seed, or UI is read from, written to, or modified by the
import. A rollback endpoint truncates only those four tables. A
read-only verification script proves that every other table's row
count is unchanged before vs after a run.

---

## Schema

The schema is defined in `lib/db/src/schema/supply_demo_v2.ts` and
exported from `lib/db/src/schema/index.ts`. Migrations are generated
by the project's existing Drizzle tooling and contain only `CREATE
TABLE` / `CREATE INDEX` statements against the four new tables.

### `supply_demo_v2_catalog`

One row per unique catalog entry. **Natural key:** `(mfr_cat_no,
manufacturer_short)`.

| Column                 | Type                       | Notes                                       |
| ---------------------- | -------------------------- | ------------------------------------------- |
| `id`                   | `serial` PK                |                                             |
| `mfr_cat_no`           | `text` NOT NULL            | Manufacturer catalog number.                |
| `manufacturer_short`   | `text` NOT NULL            | Short manufacturer name from source.        |
| `manufacturer_long`    | `text`                     | GHX-canonical manufacturer name.            |
| `product_noun`         | `text`                     |                                             |
| `product_type`         | `text`                     |                                             |
| `item_dsc_short`       | `text`                     |                                             |
| `full_description`     | `text`                     |                                             |
| `product_ndc`          | `text`                     | National Drug Code, when present.           |
| `product_size`         | `text`                     | Free-text size string from source.          |
| `unspsc_commodity`     | `text`                     |                                             |
| `ghx_commodity_type`   | `text`                     |                                             |
| `sos_type_description` | `text`                     |                                             |
| `source`               | `text` NOT NULL            | Defaults to `'supply_demo_v2'`.             |
| `imported_at`          | `timestamptz` NOT NULL     | Defaults to `now()`.                        |

Unique index: `supply_demo_v2_catalog_mfr_cat_no_mfr_short_idx` on
`(mfr_cat_no, manufacturer_short)`.

### `supply_demo_v2_facilities`

One row per unique MTF code. **Natural key:** `code`.

| Column         | Type                   | Notes                                  |
| -------------- | ---------------------- | -------------------------------------- |
| `id`           | `serial` PK            |                                        |
| `code`         | `text` NOT NULL UNIQUE | MTF code as it appears in the source.  |
| `display_name` | `text` NOT NULL        | Currently a copy of `code`.            |
| `source`       | `text` NOT NULL        | Defaults to `'supply_demo_v2'`.        |
| `imported_at`  | `timestamptz` NOT NULL | Defaults to `now()`.                   |

### `supply_demo_v2_issues`

Dedup-and-rolled-up issuance records. **Natural key:** `(catalog_id,
facility_id, quantity)`.

| Column           | Type                         | Notes                                                                |
| ---------------- | ---------------------------- | -------------------------------------------------------------------- |
| `id`             | `serial` PK                  |                                                                      |
| `catalog_id`     | `int` NOT NULL FK            | References `supply_demo_v2_catalog(id)` ON DELETE CASCADE.           |
| `facility_id`    | `int` NOT NULL FK            | References `supply_demo_v2_facilities(id)` ON DELETE CASCADE.        |
| `quantity`       | `numeric` NOT NULL           | Per-line surviving quantity (one of the distinct quantities seen).   |
| `total_quantity` | `numeric` NOT NULL           | Sum of `orderQty` across all surviving lines for this catalog × facility. |
| `line_count`     | `int` NOT NULL               | Count of surviving lines that fed this catalog × facility pair.      |
| `source`         | `text` NOT NULL              | Defaults to `'supply_demo_v2'`.                                      |
| `imported_at`    | `timestamptz` NOT NULL       | Defaults to `now()`.                                                 |

Indexes:

- Unique: `supply_demo_v2_issues_catalog_facility_qty_idx` on
  `(catalog_id, facility_id, quantity)`.
- Lookup: `supply_demo_v2_issues_catalog_facility_idx` on
  `(catalog_id, facility_id)`.

### `supply_demo_v2_imports`

Run-level metadata, one row per importer invocation.

| Column                 | Type                   | Notes                                                                  |
| ---------------------- | ---------------------- | ---------------------------------------------------------------------- |
| `id`                   | `serial` PK            |                                                                        |
| `source_file`          | `text`                 | Path passed to the importer.                                           |
| `started_at`           | `timestamptz` NOT NULL | Defaults to `now()`.                                                   |
| `finished_at`          | `timestamptz`          | Set when the run completes (success or failure).                       |
| `source_rows_read`     | `int`                  | Surviving issue lines counted from the staged `issues.ndjson`.         |
| `duplicates_collapsed` | `int`                  | Reserved; the dedup pipeline reports this separately to its caller.    |
| `catalog_upserts`      | `int`                  | Number of catalog rows upserted.                                       |
| `facility_upserts`     | `int`                  | Number of facility rows upserted.                                      |
| `issue_rows_inserted`  | `int`                  | Number of new issue rows inserted (skips dedup conflicts).             |
| `notes`                | `text`                 | Failure reason or post-run skip count, if any.                         |

---

## Source-to-target mapping

The 14 columns of the source workbook map as follows. Source column
letters refer to columns A..N of `Supply_Demo_Data_2_1777401753577.xlsx`.

| # | Source column          | Source field name      | Target table                  | Target column          |
| - | ---------------------- | ---------------------- | ----------------------------- | ---------------------- |
| 1 | A `productNoun`        | Product noun           | `supply_demo_v2_catalog`      | `product_noun`         |
| 2 | B `productType`        | Product type           | `supply_demo_v2_catalog`      | `product_type`         |
| 3 | C `itemDscShort`       | Short item description | `supply_demo_v2_catalog`      | `item_dsc_short`       |
| 4 | D `manufacturer`       | Manufacturer (short)   | `supply_demo_v2_catalog`      | `manufacturer_short`   |
| 5 | E `ghxCommodityType`   | GHX commodity type     | `supply_demo_v2_catalog`      | `ghx_commodity_type`   |
| 6 | F `ghxManufacturerLong`| GHX manufacturer (long)| `supply_demo_v2_catalog`      | `manufacturer_long`    |
| 7 | G `fullDescription`    | Full description       | `supply_demo_v2_catalog`      | `full_description`     |
| 8 | H `mfrCatNo`           | Manufacturer cat. no.  | `supply_demo_v2_catalog`      | `mfr_cat_no`           |
| 9 | I `productNDC`         | National Drug Code     | `supply_demo_v2_catalog`      | `product_ndc`          |
| 10| J `sosTypeDescription` | SOS type description   | `supply_demo_v2_catalog`      | `sos_type_description` |
| 11| K `unspscCommodity`    | UNSPSC commodity       | `supply_demo_v2_catalog`      | `unspsc_commodity`     |
| 12| L `productSize`        | Product size           | `supply_demo_v2_catalog`      | `product_size`         |
| 13| M `orderQty`           | Order quantity         | `supply_demo_v2_issues`       | `quantity` (and rolled into `total_quantity`) |
| 14| N `mtfName`            | MTF name / code        | `supply_demo_v2_facilities`   | `code` (also `display_name`) |

`mtfName` is also used to derive `supply_demo_v2_issues.facility_id`
via the natural key on `supply_demo_v2_facilities.code`. Likewise
`mfrCatNo` + `manufacturer` derive `supply_demo_v2_issues.catalog_id`
via the natural key on `supply_demo_v2_catalog`.

---

## Dedup rules

Dedup is performed in
`artifacts/api-server/src/lib/supply-import/dedup.ts` before any data
reaches the database. The pipeline streams the parser's output through
an external sort (`sort -k1,1 -u` on a TSV intermediate) so it stays
within the ~512 MB heap budget on the full ~1 M-row workbook.

### The 5-tuple dedup key

Two source rows are treated as exact duplicates and collapsed into one
when they agree on **all five** of the following fields, byte for byte:

1. `mfrCatNo`
2. `manufacturer` (short)
3. `mtfName`
4. `productSize`
5. `orderQty`

Only one surviving row per 5-tuple is written to staging. The number
of duplicates collapsed is reported as `duplicatesCollapsed =
sourceRowsRead - uniqueSurvivingRows` in the dedup report.

### Per-`(catalog, facility)` rollup

After dedup, the surviving lines are bucketed by the
`(mfrCatNo, manufacturer)` × `mtfName` pair (the catalog × facility
pair). For each pair:

- `lineCount` = number of surviving lines in the pair.
- `totalQuantity` = sum of `orderQty` across those surviving lines
  (treating null quantities as zero).

Then **one issue row is emitted per distinct `quantity` within the
pair**, preserving first-seen order. Each emitted issue carries the
denormalized `lineCount` and `totalQuantity` for its pair, so
downstream consumers can read either the per-quantity slice or the
per-pair total without a separate query.

### `UNK` and whitespace handling

Per-cell normalization runs in the parser
(`artifacts/api-server/src/lib/supply-import/parse.ts`):

- Every text cell is `trim()`ed.
- A literal value of `UNK` (case-sensitive, after trim) is converted
  to `null`.
- The empty string and whitespace-only values are converted to `null`.
- `orderQty` is coerced to a finite `number`; non-numeric values
  become `null`.

`null` propagates into the dedup key. So two source rows that differ
only because one has `UNK` and the other has empty whitespace in the
same field will collide on the same dedup key (both become `null`)
and are collapsed.

The catalog and facility staging files are slightly stricter than the
issue stream:

- `catalog.ndjson` skips rows where **both** `mfrCatNo` and
  `manufacturer` are null — there's no usable catalog identity to
  store.
- `facilities.ndjson` skips rows where `mtfName` is null — there's no
  usable facility identity to store.
- `issues.ndjson` keeps every surviving post-dedup line; the importer
  drops issue rows whose catalog or facility key cannot be resolved
  and counts them in the run notes.

---

## How to run

The importer reads three NDJSON files (`catalog.ndjson`,
`facilities.ndjson`, `issues.ndjson`) from a staging directory. The
end-to-end flow is **stage, then import**.

### 1. Place the source workbook

The workbook is checked into the repo at:

```
attached_assets/Supply_Demo_Data_2_1777401753577.xlsx
```

If you're loading a different snapshot, drop it into `attached_assets/`
or any path the api-server process can read.

### 2. Stage: run the dedup pipeline (CLI)

The dedup pipeline is pure (no DB) and produces the three NDJSON
staging files. Run it from the repo root:

```bash
pnpm --filter @workspace/api-server exec tsx \
  src/lib/supply-import/dedup-cli.ts \
  attached_assets/Supply_Demo_Data_2_1777401753577.xlsx \
  tmp/supply-import-staging
```

Optional flags:

- `--max-rows N` — stop after N parser rows (useful for smoke runs).

The CLI prints a small report on completion:

```
sourceRowsRead:       1052673
duplicatesCollapsed:  ...
uniqueCatalogEntries: ...
uniqueFacilities:     ...
uniqueIssueLines:     ...
```

The pipeline shells out to GNU `sort` and requires GNU coreutils on
PATH (true on the Replit Linux runtime; on macOS install `gsort` or
run inside a Linux container).

### 3. Import: load the staging files

The importer is exposed as an admin HTTP endpoint registered in
`artifacts/api-server/src/routes/admin-supply-import.ts` and
mounted from `artifacts/api-server/src/routes/index.ts`:

```bash
curl -X POST "$API_BASE/admin/supply-import/run" \
  -H "Content-Type: application/json" \
  -d '{
    "stagingDir": "tmp/supply-import-staging",
    "sourceFile": "attached_assets/Supply_Demo_Data_2_1777401753577.xlsx"
  }'
```

Both body fields are optional. When omitted, the route falls back to:

- `stagingDir` ← `SUPPLY_IMPORT_STAGING_DIR` env var, else
  `tmp/supply-import-staging` under the api-server process CWD.
- `sourceFile` ← `SUPPLY_IMPORT_SOURCE` env var, else `null` (recorded
  as null on the import row, doesn't affect data loaded).

The endpoint returns an `ImportRunSummary` with the import id, start /
finish timestamps, and counters for catalog upserts, facility upserts,
issue rows inserted, and issue rows skipped.

The import is **idempotent**: re-running it against the same staging
directory produces zero net row changes. Catalog and facility writes
use `ON CONFLICT … DO UPDATE` on their natural keys; issue writes use
`ON CONFLICT (catalog_id, facility_id, quantity) DO NOTHING`.

---

## How to roll back

```bash
curl -X POST "$API_BASE/admin/supply-import/rollback"
```

The rollback endpoint runs a single transaction against the database
that:

1. Counts current rows in each of the four `supply_demo_v2_*` tables.
2. `TRUNCATE`s all four tables together (`supply_demo_v2_issues`,
   `supply_demo_v2_catalog`, `supply_demo_v2_facilities`,
   `supply_demo_v2_imports`) with `RESTART IDENTITY`.
3. Returns the per-table row counts that were deleted.

It touches **only** those four tables. No other table — and no file
on disk, including the staging NDJSON files — is read or modified.
Re-running the importer after a rollback re-loads the same data with
fresh ids.

---

## How to verify

There are three independently-runnable checks today. All four
artifact workflows (`api-server`, `web`, `scenario-brief`,
`mockup-sandbox`) should remain healthy throughout — if any fail to
restart after the import, that is a regression.

### 1. Parser smoke test (no DB)

Confirms the streaming parser opens the workbook, advances through
the shared-strings stream without OOM, and yields normalized rows:

```bash
pnpm --filter @workspace/api-server exec tsx \
  src/lib/supply-import/smoke-test.ts --rows 100
```

The script
(`artifacts/api-server/src/lib/supply-import/smoke-test.ts`) prints
the first N rows as JSON and exits 0. PASS = exits cleanly with the
requested number of rows printed and `heapUsedMB` reported well below
the container limit.

### 2. Dedup CLI report (no DB)

The dedup CLI prints `sourceRowsRead`, `duplicatesCollapsed`,
`uniqueCatalogEntries`, `uniqueFacilities`, and `uniqueIssueLines` on
completion. PASS = the totals are non-zero, `duplicatesCollapsed +
uniqueIssueLines + (issues with null catalog or facility key)` ties
back to `sourceRowsRead`, and the three NDJSON files in `stagingDir`
contain valid JSON on every line.

### 3. Importer + rollback round-trip (against the DB)

Because the import is non-destructive by construction, the
operationally-meaningful check is a row-count baseline of the
existing tables, taken before and after a run, plus a comparison of
the four isolated tables against the importer's returned summary.

Capture a baseline of every existing public-schema table, excluding
the four `supply_demo_v2_*` tables, e.g.:

```sql
SELECT table_name, (xpath('/row/c/text()',
  query_to_xml(format('SELECT COUNT(*) AS c FROM %I', table_name),
  false, true, '')))[1]::text::int AS row_count
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name NOT LIKE 'supply_demo_v2_%'
ORDER BY table_name;
```

Then:

1. Save the baseline.
2. Call `POST /admin/supply-import/run` and keep the returned
   `ImportRunSummary` (it contains `catalogUpserts`,
   `facilityUpserts`, `issueRowsInserted`).
3. Re-run the same SQL. Every row count must be **identical** to the
   baseline. Any drift on a non-`supply_demo_v2_*` table is a
   regression and the import should be rolled back immediately.
4. Run `SELECT COUNT(*)` on each of the four `supply_demo_v2_*`
   tables. Catalog and facility counts should equal the upsert counts
   in the summary on a fresh DB; issue count should equal
   `issueRowsInserted`.
5. Call `POST /admin/supply-import/rollback`. The returned per-table
   `deleted` counts should match what step 4 saw, and step 1's SQL
   should still report the original baseline.

**PASS means:** the baseline is unchanged across run and rollback,
the four isolated tables hold exactly the rows the importer's
summary claims, the rollback empties only those four tables, and all
running workflows continue to serve traffic. An automated wrapper
that runs this exact sequence and prints a single PASS/FAIL summary
is planned but not yet landed; until it does, the steps above are
the source of truth.

---

## Known caveats

- **Heavy duplication in source.** A double-digit percentage of rows
  in `Supply_Demo_Data_2_1777401753577.xlsx` are byte-identical
  duplicates of another row. The dedup pipeline collapses these
  before any DB write; do not be surprised when `uniqueIssueLines` is
  much smaller than `sourceRowsRead`.
- **`UNK` placeholders.** Source cells containing the literal string
  `UNK` are normalized to `null`. Treat null values in the staged /
  imported data as "unknown in the source", not "no value".
- **Free-text size strings.** `productSize` is stored as raw text and
  is part of the dedup key. Variations like `"100 mL"` vs
  `"100 ml "` vs `"100ML"` will be treated as different sizes.
  Whitespace is trimmed; case is preserved.
- **Mixed-case manufacturer names.** `manufacturer` (short) is
  preserved as-is. Two rows that differ only in casing
  (`"AcmeCo"` vs `"ACMECO"`) will produce two distinct catalog
  rows and two distinct catalog ids. No case-folding is applied.
- **MTF codes are opaque.** The pipeline treats every `mtfName` value
  as an opaque facility identifier — it is copied verbatim into both
  `supply_demo_v2_facilities.code` and `display_name`. There is no
  mapping to the existing logical `nodes` / `sites` tables; that
  reconciliation is a separate, future task.
- **`source_rows_read` on the import row.** The importer does not
  receive the dedup pipeline's parser-side row count, so it records
  `source_rows_read` as the count of staged issue lines (a faithful
  count of rows actually loaded), and leaves `duplicates_collapsed`
  null. The pipeline's own dedup report (printed by the CLI) is the
  authoritative source for parser-side counts.
