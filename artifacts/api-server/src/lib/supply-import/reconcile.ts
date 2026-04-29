import { db } from "@workspace/db";
import { catalogEntries, supplyDemoV2Catalog } from "@workspace/db";
import { sql, eq, and } from "drizzle-orm";

export interface ReconcileSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  staged: number;
  inserted: number;
  updated: number;
  skipped: number;
  totalAfter: number;
  reconciledAfter: number;
}

const BATCH_SIZE = 1000;

/**
 * Reconcile every row in the isolated supply_demo_v2_catalog staging table
 * into the canonical catalog_entries list.
 *
 * - Upsert by (mfr_cat_no, manufacturer). Pre-existing seed rows are NEVER
 *   overwritten because the ON CONFLICT UPDATE is gated by
 *   catalog_entries.source = 'supply_demo_v2'.
 * - All inserted/updated rows are stamped with source = 'supply_demo_v2',
 *   which is what the rollback endpoint uses to clean up.
 * - Streams the staging table in BATCH_SIZE-row pages so memory stays flat
 *   even at 60k+ rows.
 * - Idempotent: re-running after a fresh import produces zero net new rows.
 */
export async function runCatalogReconcile(): Promise<ReconcileSummary> {
  const startedAtDate = new Date();

  let staged = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  let lastId = 0;

  // Pre-count what's currently reconciled to compute deltas.
  const [{ before }] = await db
    .select({
      before: sql<number>`count(*) FILTER (WHERE source = 'supply_demo_v2')::int`,
    })
    .from(catalogEntries);

  // Stream the staging table in id-ordered pages.
  while (true) {
    const page = await db
      .select()
      .from(supplyDemoV2Catalog)
      .where(sql`${supplyDemoV2Catalog.id} > ${lastId}`)
      .orderBy(supplyDemoV2Catalog.id)
      .limit(BATCH_SIZE);

    if (page.length === 0) break;

    staged += page.length;
    lastId = page[page.length - 1].id;

    // Build the values array. Some staging rows may have an empty/null
    // manufacturer or mfr_cat_no — skip those because they can't satisfy
    // the unique key.
    type RowValue = typeof catalogEntries.$inferInsert;
    const values: RowValue[] = [];
    for (const row of page) {
      const mfrCatNo = (row.mfrCatNo ?? "").trim();
      const manufacturer = (row.manufacturerShort ?? "").trim();
      if (!mfrCatNo || !manufacturer) {
        skipped += 1;
        continue;
      }
      // Pick the most informative description we have.
      const description =
        (row.fullDescription && row.fullDescription.trim()) ||
        (row.itemDscShort && row.itemDscShort.trim()) ||
        (row.productNoun && row.productNoun.trim()) ||
        mfrCatNo;
      values.push({
        mfrCatNo,
        manufacturer,
        description,
        productNoun: (row.productNoun ?? "").trim() || description,
        productType: (row.productType ?? "").trim() || "Supply Item",
        unspscCommodity: row.unspscCommodity ?? null,
        productSize: row.productSize ?? null,
        ghxCommodityType: row.ghxCommodityType ?? null,
        fullDescription: row.fullDescription ?? null,
        source: "supply_demo_v2",
        // Keep all existing operational fields at their defaults; orders /
        // PAR / alerts continue to ignore source='supply_demo_v2' rows
        // because mapped is false and app_item_id is null.
        mapped: false,
        appItemId: null,
        orderLines: 0,
        totalQty: 0,
      });
    }

    if (values.length === 0) continue;

    // Upsert with `xmax = 0` trick to count inserts vs updates in a single
    // round-trip. xmax is 0 for newly-inserted rows; non-zero for updated
    // rows in PostgreSQL.
    const result = await db
      .insert(catalogEntries)
      .values(values)
      .onConflictDoUpdate({
        target: [catalogEntries.mfrCatNo, catalogEntries.manufacturer],
        // Only overwrite previously-imported rows. Seed rows with the same
        // (mfr_cat_no, manufacturer) are protected by the WHERE clause.
        setWhere: sql`${catalogEntries.source} = 'supply_demo_v2'`,
        set: {
          description: sql`excluded.description`,
          productNoun: sql`excluded.product_noun`,
          productType: sql`excluded.product_type`,
          unspscCommodity: sql`excluded.unspsc_commodity`,
          productSize: sql`excluded.product_size`,
          ghxCommodityType: sql`excluded.ghx_commodity_type`,
          fullDescription: sql`excluded.full_description`,
          source: sql`'supply_demo_v2'`,
        },
      })
      .returning({
        id: catalogEntries.id,
        // xmax=0 means inserted; non-zero means updated.
        wasInsert: sql<boolean>`(xmax = 0)`,
      });

    for (const r of result) {
      if (r.wasInsert) inserted += 1;
      else updated += 1;
    }
    // Conflicts that hit a seed row (source != 'supply_demo_v2') are
    // silently dropped by the WHERE-gated UPDATE; they don't appear in
    // RETURNING. Compute that as the leftover.
    const accountedFor = result.length;
    const leftover = values.length - accountedFor;
    if (leftover > 0) skipped += leftover;
  }

  const [{ totalAfter }] = await db
    .select({ totalAfter: sql<number>`count(*)::int` })
    .from(catalogEntries);
  const [{ reconciledAfter }] = await db
    .select({
      reconciledAfter: sql<number>`count(*) FILTER (WHERE source = 'supply_demo_v2')::int`,
    })
    .from(catalogEntries);

  const finishedAtDate = new Date();
  return {
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAtDate.toISOString(),
    durationMs: finishedAtDate.getTime() - startedAtDate.getTime(),
    staged,
    inserted,
    updated,
    skipped,
    totalAfter,
    reconciledAfter,
  };
}

/**
 * Delete every catalog_entries row that was created by the reconciler,
 * leaving seed rows untouched. Used by the rollback endpoint.
 */
export async function deleteReconciledCatalogEntries(): Promise<number> {
  const deleted = await db
    .delete(catalogEntries)
    .where(eq(catalogEntries.source, "supply_demo_v2"))
    .returning({ id: catalogEntries.id });
  return deleted.length;
}

// Re-export `and` to avoid an unused import lint failure in case the
// reconciler grows additional gated conditions later.
void and;
