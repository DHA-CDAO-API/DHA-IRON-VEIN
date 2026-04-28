/**
 * Streaming importer for the deduped Supply demo v2 staging files.
 *
 * Consumes the three NDJSON files produced by `./dedup.ts` and writes them
 * idempotently into the four isolated `supply_demo_v2_*` tables defined in
 * the schema package. All operations are scoped to those tables; nothing
 * else in the database is touched.
 *
 * The importer is split into three streamed phases, each batched at
 * ~1000 rows so neither the Node heap nor the Postgres parameter limit
 * blows up on the full ~110 MB workbook output:
 *
 *   1. catalog.ndjson    -> supply_demo_v2_catalog (upsert on natural key)
 *   2. facilities.ndjson -> supply_demo_v2_facilities (upsert on code)
 *   3. issues.ndjson     -> supply_demo_v2_issues (insert + on conflict
 *                          do nothing). Catalog/facility ids are resolved
 *                          from in-memory maps loaded after phases 1+2.
 *
 * Phase 0 inserts an open `supply_demo_v2_imports` row; phase 4 closes it
 * with row counters and `finishedAt`. Re-running the importer against the
 * same staging directory produces zero net row changes (idempotent).
 */

import { createReadStream, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";

import { db } from "@workspace/db";
import {
  supplyDemoV2Catalog,
  supplyDemoV2Facilities,
  supplyDemoV2Imports,
  supplyDemoV2Issues,
} from "@workspace/db";
import { sql } from "drizzle-orm";

const BATCH_SIZE = 1000;

export interface ImportRunSummary {
  importId: number;
  sourceFile: string | null;
  stagingDir: string;
  startedAt: string;
  finishedAt: string;
  sourceRowsRead: number;
  duplicatesCollapsed: number;
  catalogUpserts: number;
  facilityUpserts: number;
  issueRowsInserted: number;
  issueRowsSkipped: number;
}

export interface RunSupplyImportOptions {
  /** Directory containing catalog.ndjson, facilities.ndjson, issues.ndjson. */
  stagingDir: string;
  /** Optional source workbook path; recorded on the import row. */
  sourceFile?: string | null;
}

interface CatalogStaged {
  mfrCatNo: string | null;
  manufacturerShort: string | null;
  productNoun: string | null;
  productType: string | null;
  itemDscShort: string | null;
  ghxCommodityType: string | null;
  ghxManufacturerLong: string | null;
  fullDescription: string | null;
  productNDC: string | null;
  sosTypeDescription: string | null;
  unspscCommodity: string | null;
  productSize: string | null;
}

interface FacilityStaged {
  mtfName: string | null;
}

interface IssueStaged {
  mfrCatNo: string | null;
  manufacturerShort: string | null;
  mtfName: string | null;
  orderQty: number | string | null;
  lineCount: number | null;
  totalQuantity: number | string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function catalogKey(mfrCatNo: string, manufacturerShort: string): string {
  return mfrCatNo + "\u0001" + manufacturerShort;
}

async function* readNdjson<T>(path: string): AsyncGenerator<T, void, void> {
  if (!existsSync(path)) {
    throw new Error(`Staging file not found: ${path}`);
  }
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let lineNo = 0;
  for await (const line of rl) {
    lineNo++;
    if (line.length === 0) continue;
    try {
      yield JSON.parse(line) as T;
    } catch (err) {
      throw new Error(
        `Malformed NDJSON at ${path}:${lineNo} — ${(err as Error).message}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 1: catalog upsert
// ---------------------------------------------------------------------------

async function importCatalog(stagingDir: string): Promise<number> {
  const path = join(stagingDir, "catalog.ndjson");
  let upserts = 0;
  let batch: Array<typeof supplyDemoV2Catalog.$inferInsert> = [];

  async function flush(): Promise<void> {
    if (batch.length === 0) return;
    await db
      .insert(supplyDemoV2Catalog)
      .values(batch)
      .onConflictDoUpdate({
        target: [
          supplyDemoV2Catalog.mfrCatNo,
          supplyDemoV2Catalog.manufacturerShort,
        ],
        set: {
          manufacturerLong: sql`excluded.manufacturer_long`,
          productNoun: sql`excluded.product_noun`,
          productType: sql`excluded.product_type`,
          itemDscShort: sql`excluded.item_dsc_short`,
          fullDescription: sql`excluded.full_description`,
          productNDC: sql`excluded.product_ndc`,
          productSize: sql`excluded.product_size`,
          unspscCommodity: sql`excluded.unspsc_commodity`,
          ghxCommodityType: sql`excluded.ghx_commodity_type`,
          sosTypeDescription: sql`excluded.sos_type_description`,
          source: sql`excluded.source`,
          importedAt: sql`excluded.imported_at`,
        },
      });
    upserts += batch.length;
    batch = [];
  }

  for await (const row of readNdjson<CatalogStaged>(path)) {
    if (row.mfrCatNo == null || row.manufacturerShort == null) continue;
    batch.push({
      mfrCatNo: row.mfrCatNo,
      manufacturerShort: row.manufacturerShort,
      manufacturerLong: row.ghxManufacturerLong ?? null,
      productNoun: row.productNoun ?? null,
      productType: row.productType ?? null,
      itemDscShort: row.itemDscShort ?? null,
      fullDescription: row.fullDescription ?? null,
      productNDC: row.productNDC ?? null,
      productSize: row.productSize ?? null,
      unspscCommodity: row.unspscCommodity ?? null,
      ghxCommodityType: row.ghxCommodityType ?? null,
      sosTypeDescription: row.sosTypeDescription ?? null,
    });
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();
  return upserts;
}

// ---------------------------------------------------------------------------
// Phase 2: facilities upsert
// ---------------------------------------------------------------------------

async function importFacilities(stagingDir: string): Promise<number> {
  const path = join(stagingDir, "facilities.ndjson");
  let upserts = 0;
  let batch: Array<typeof supplyDemoV2Facilities.$inferInsert> = [];

  async function flush(): Promise<void> {
    if (batch.length === 0) return;
    await db
      .insert(supplyDemoV2Facilities)
      .values(batch)
      .onConflictDoUpdate({
        target: supplyDemoV2Facilities.code,
        set: {
          displayName: sql`excluded.display_name`,
          source: sql`excluded.source`,
          importedAt: sql`excluded.imported_at`,
        },
      });
    upserts += batch.length;
    batch = [];
  }

  for await (const row of readNdjson<FacilityStaged>(path)) {
    if (row.mtfName == null) continue;
    batch.push({
      code: row.mtfName,
      displayName: row.mtfName,
    });
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();
  return upserts;
}

// ---------------------------------------------------------------------------
// Phase 3: issues insert (resolve catalog + facility ids first)
// ---------------------------------------------------------------------------

interface IdMaps {
  catalog: Map<string, number>;
  facility: Map<string, number>;
}

async function loadIdMaps(): Promise<IdMaps> {
  const catalogRows = await db
    .select({
      id: supplyDemoV2Catalog.id,
      mfrCatNo: supplyDemoV2Catalog.mfrCatNo,
      manufacturerShort: supplyDemoV2Catalog.manufacturerShort,
    })
    .from(supplyDemoV2Catalog);
  const catalog = new Map<string, number>();
  for (const r of catalogRows) {
    catalog.set(catalogKey(r.mfrCatNo, r.manufacturerShort), r.id);
  }
  const facilityRows = await db
    .select({
      id: supplyDemoV2Facilities.id,
      code: supplyDemoV2Facilities.code,
    })
    .from(supplyDemoV2Facilities);
  const facility = new Map<string, number>();
  for (const r of facilityRows) facility.set(r.code, r.id);
  return { catalog, facility };
}

async function importIssues(
  stagingDir: string,
  maps: IdMaps,
): Promise<{ inserted: number; skipped: number }> {
  const path = join(stagingDir, "issues.ndjson");
  let inserted = 0;
  let skipped = 0;
  let batch: Array<typeof supplyDemoV2Issues.$inferInsert> = [];

  async function flush(): Promise<void> {
    if (batch.length === 0) return;
    const result = await db
      .insert(supplyDemoV2Issues)
      .values(batch)
      .onConflictDoNothing({
        target: [
          supplyDemoV2Issues.catalogId,
          supplyDemoV2Issues.facilityId,
          supplyDemoV2Issues.quantity,
        ],
      })
      .returning({ id: supplyDemoV2Issues.id });
    inserted += result.length;
    batch = [];
  }

  for await (const row of readNdjson<IssueStaged>(path)) {
    if (
      row.mfrCatNo == null ||
      row.manufacturerShort == null ||
      row.mtfName == null ||
      row.orderQty == null ||
      row.lineCount == null ||
      row.totalQuantity == null
    ) {
      skipped++;
      continue;
    }
    const catalogId = maps.catalog.get(
      catalogKey(row.mfrCatNo, row.manufacturerShort),
    );
    const facilityId = maps.facility.get(row.mtfName);
    if (catalogId === undefined || facilityId === undefined) {
      skipped++;
      continue;
    }
    batch.push({
      catalogId,
      facilityId,
      quantity: String(row.orderQty),
      totalQuantity: String(row.totalQuantity),
      lineCount: row.lineCount,
    });
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();
  return { inserted, skipped };
}

// ---------------------------------------------------------------------------
// Optional: count source rows / duplicates from issues.ndjson for the
// import-run record. The dedup pipeline doesn't write a manifest, but the
// per-pair `lineCount` field on each issue row is the surviving line count
// for that (catalog × facility) pair. Summing it over distinct pairs gives
// total surviving rows; we don't have access to the original parser count
// here, so `sourceRowsRead` and `duplicatesCollapsed` remain null unless
// the caller passes them explicitly via the import row update path.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function runSupplyImport(
  options: RunSupplyImportOptions,
): Promise<ImportRunSummary> {
  const stagingDir = resolve(options.stagingDir);
  const sourceFile = options.sourceFile ?? null;

  // Phase 0: open run record.
  const [openRow] = await db
    .insert(supplyDemoV2Imports)
    .values({ sourceFile })
    .returning({
      id: supplyDemoV2Imports.id,
      startedAt: supplyDemoV2Imports.startedAt,
    });
  const importId = openRow.id;
  const startedAt = openRow.startedAt;

  let catalogUpserts = 0;
  let facilityUpserts = 0;
  let issueInserted = 0;
  let issueSkipped = 0;
  let sourceRowsRead = 0;
  try {
    catalogUpserts = await importCatalog(stagingDir);
    facilityUpserts = await importFacilities(stagingDir);
    const maps = await loadIdMaps();
    const issueResult = await importIssues(stagingDir, maps);
    issueInserted = issueResult.inserted;
    issueSkipped = issueResult.skipped;

    // The total surviving (post-dedup) rows == sum of lineCount across all
    // staged issue NDJSON lines, divided by the number of distinct quantities
    // per pair. The simpler honest answer is: count the staged issue lines
    // as our `sourceRowsRead` proxy. We re-stream to get a stable number.
    sourceRowsRead = await countLines(join(stagingDir, "issues.ndjson"));
  } catch (err) {
    const finishedAt = new Date();
    await db
      .update(supplyDemoV2Imports)
      .set({
        finishedAt,
        catalogUpserts,
        facilityUpserts,
        issueRowsInserted: issueInserted,
        notes: `failed: ${(err as Error).message}`,
      })
      .where(sql`${supplyDemoV2Imports.id} = ${importId}`);
    throw err;
  }

  const finishedAt = new Date();
  await db
    .update(supplyDemoV2Imports)
    .set({
      finishedAt,
      sourceRowsRead,
      duplicatesCollapsed: null,
      catalogUpserts,
      facilityUpserts,
      issueRowsInserted: issueInserted,
      notes:
        issueSkipped > 0
          ? `skipped ${issueSkipped} issue rows with missing keys or unresolved catalog/facility`
          : null,
    })
    .where(sql`${supplyDemoV2Imports.id} = ${importId}`);

  return {
    importId,
    sourceFile,
    stagingDir,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    sourceRowsRead,
    duplicatesCollapsed: 0,
    catalogUpserts,
    facilityUpserts,
    issueRowsInserted: issueInserted,
    issueRowsSkipped: issueSkipped,
  };
}

async function countLines(path: string): Promise<number> {
  if (!existsSync(path)) return 0;
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let n = 0;
  for await (const line of rl) {
    if (line.length > 0) n++;
  }
  return n;
}
