import { Router, type IRouter } from "express";
import { resolve } from "node:path";

import { db } from "@workspace/db";
import {
  catalogEntries,
  nodes,
  supplyDemoV2Catalog,
  supplyDemoV2Facilities,
  supplyDemoV2Imports,
  supplyDemoV2Issues,
} from "@workspace/db";
import { sql, desc, eq, isNotNull } from "drizzle-orm";

import { runSupplyImport } from "../lib/supply-import/import";
import {
  runCatalogReconcile,
  deleteReconciledCatalogEntries,
} from "../lib/supply-import/reconcile";
import {
  runFacilityMapping,
  deleteMappedFacilityNodes,
} from "../lib/supply-import/map-facilities";

const router: IRouter = Router();

/**
 * Default staging directory the importer reads from when no path is
 * provided in the request body. Operators can override either with the
 * `SUPPLY_IMPORT_STAGING_DIR` env var or the `stagingDir` body field.
 */
function defaultStagingDir(): string {
  return (
    process.env.SUPPLY_IMPORT_STAGING_DIR ??
    resolve(process.cwd(), "tmp/supply-import-staging")
  );
}

function defaultSourceFile(): string | null {
  return process.env.SUPPLY_IMPORT_SOURCE ?? null;
}

interface RunBody {
  sourceFile?: string;
  stagingDir?: string;
}

router.post("/admin/supply-import/run", async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as RunBody;
    const stagingDir = body.stagingDir ?? defaultStagingDir();
    const sourceFile = body.sourceFile ?? defaultSourceFile();
    const summary = await runSupplyImport({ stagingDir, sourceFile });
    res.json(summary);
  } catch (err) {
    req.log?.error({ err }, "supply-import run failed");
    next(err);
  }
});

router.post("/admin/supply-import/reconcile", async (req, res, next) => {
  try {
    const summary = await runCatalogReconcile();
    res.json(summary);
  } catch (err) {
    req.log?.error({ err }, "supply-import reconcile failed");
    next(err);
  }
});

router.post("/admin/supply-import/map-facilities", async (req, res, next) => {
  try {
    const summary = await runFacilityMapping();
    res.json(summary);
  } catch (err) {
    req.log?.error({ err }, "supply-import map-facilities failed");
    next(err);
  }
});

router.get("/admin/supply-import/status", async (req, res, next) => {
  try {
    const [
      recentImports,
      [{ catalogStaging }],
      [{ facilityStaging }],
      [{ issueStaging }],
      [{ importsStaging }],
      [{ reconciledCatalogCount }],
      [{ mappedFacilitiesCount }],
      [{ hiddenNodeCount }],
    ] = await Promise.all([
      db
        .select()
        .from(supplyDemoV2Imports)
        .orderBy(desc(supplyDemoV2Imports.startedAt))
        .limit(10),
      db
        .select({ catalogStaging: sql<number>`count(*)::int` })
        .from(supplyDemoV2Catalog),
      db
        .select({ facilityStaging: sql<number>`count(*)::int` })
        .from(supplyDemoV2Facilities),
      db
        .select({ issueStaging: sql<number>`count(*)::int` })
        .from(supplyDemoV2Issues),
      db
        .select({ importsStaging: sql<number>`count(*)::int` })
        .from(supplyDemoV2Imports),
      db
        .select({
          reconciledCatalogCount: sql<number>`count(*) FILTER (WHERE source = 'supply_demo_v2')::int`,
        })
        .from(catalogEntries),
      db
        .select({ mappedFacilitiesCount: sql<number>`count(*)::int` })
        .from(supplyDemoV2Facilities)
        .where(isNotNull(supplyDemoV2Facilities.nodeId)),
      db
        .select({ hiddenNodeCount: sql<number>`count(*)::int` })
        .from(nodes)
        .where(eq(nodes.hiddenFromMap, true)),
    ]);

    res.json({
      checkedAt: new Date().toISOString(),
      tableCounts: {
        supply_demo_v2_catalog: catalogStaging,
        supply_demo_v2_facilities: facilityStaging,
        supply_demo_v2_issues: issueStaging,
        supply_demo_v2_imports: importsStaging,
      },
      reconciledCatalogCount,
      mappedFacilitiesCount,
      hiddenNodeCount,
      recentImports: recentImports.map((r) => ({
        id: r.id,
        sourceFile: r.sourceFile,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
        durationMs:
          r.startedAt && r.finishedAt
            ? r.finishedAt.getTime() - r.startedAt.getTime()
            : null,
        sourceRowsRead: r.sourceRowsRead,
        duplicatesCollapsed: r.duplicatesCollapsed,
        catalogUpserts: r.catalogUpserts,
        facilityUpserts: r.facilityUpserts,
        issueRowsInserted: r.issueRowsInserted,
        notes: r.notes,
      })),
    });
  } catch (err) {
    req.log?.error({ err }, "supply-import status failed");
    next(err);
  }
});

router.post("/admin/supply-import/rollback", async (req, res, next) => {
  try {
    // Order matters:
    //   1. Delete the placeholder nodes the facility-mapping step created
    //      (FK on supply_demo_v2_facilities.node_id is ON DELETE SET NULL,
    //      so dependent staging rows simply lose their reference).
    //   2. Delete the catalog_entries rows the reconciler created
    //      (gated by source = 'supply_demo_v2'; seed rows untouched).
    //   3. Truncate the four isolated supply_demo_v2_* tables.
    //
    // We snapshot staging counts before any DELETE/TRUNCATE so the response
    // reports exactly what was reverted.
    const [issuesRow] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(supplyDemoV2Issues);
    const [catalogRow] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(supplyDemoV2Catalog);
    const [facilitiesRow] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(supplyDemoV2Facilities);
    const [importsRow] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(supplyDemoV2Imports);

    const hiddenNodesDeleted = await deleteMappedFacilityNodes();
    const catalogEntriesReverted = await deleteReconciledCatalogEntries();

    await db.execute(sql`TRUNCATE TABLE
      ${supplyDemoV2Issues},
      ${supplyDemoV2Catalog},
      ${supplyDemoV2Facilities},
      ${supplyDemoV2Imports}
      RESTART IDENTITY`);

    res.json({
      deleted: {
        supply_demo_v2_issues: issuesRow.c,
        supply_demo_v2_catalog: catalogRow.c,
        supply_demo_v2_facilities: facilitiesRow.c,
        supply_demo_v2_imports: importsRow.c,
        catalog_entries_reconciled: catalogEntriesReverted,
        hidden_nodes: hiddenNodesDeleted,
      },
    });
  } catch (err) {
    req.log?.error({ err }, "supply-import rollback failed");
    next(err);
  }
});

// Re-export helper imports so unused-imports lint doesn't flag them.
void deleteReconciledCatalogEntries;
void deleteMappedFacilityNodes;

export default router;
