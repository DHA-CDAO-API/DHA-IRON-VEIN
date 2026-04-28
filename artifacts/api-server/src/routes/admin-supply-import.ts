import { Router, type IRouter } from "express";
import { resolve } from "node:path";

import { db } from "@workspace/db";
import {
  supplyDemoV2Catalog,
  supplyDemoV2Facilities,
  supplyDemoV2Imports,
  supplyDemoV2Issues,
} from "@workspace/db";
import { sql } from "drizzle-orm";

import { runSupplyImport } from "../lib/supply-import/import";

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

router.post("/admin/supply-import/rollback", async (req, res, next) => {
  try {
    // Order matters: issues references catalog + facilities, imports is standalone.
    // Use TRUNCATE ... RESTART IDENTITY for fast, idempotent reset of the
    // four isolated tables. Wrapped in a single statement (CASCADE not
    // needed because we list every dependent table explicitly).
    const counts = await db.transaction(async (tx) => {
      const [issuesRow] = await tx
        .select({ c: sql<number>`count(*)::int` })
        .from(supplyDemoV2Issues);
      const [catalogRow] = await tx
        .select({ c: sql<number>`count(*)::int` })
        .from(supplyDemoV2Catalog);
      const [facilitiesRow] = await tx
        .select({ c: sql<number>`count(*)::int` })
        .from(supplyDemoV2Facilities);
      const [importsRow] = await tx
        .select({ c: sql<number>`count(*)::int` })
        .from(supplyDemoV2Imports);

      await tx.execute(sql`TRUNCATE TABLE
        ${supplyDemoV2Issues},
        ${supplyDemoV2Catalog},
        ${supplyDemoV2Facilities},
        ${supplyDemoV2Imports}
        RESTART IDENTITY`);

      return {
        supply_demo_v2_issues: issuesRow.c,
        supply_demo_v2_catalog: catalogRow.c,
        supply_demo_v2_facilities: facilitiesRow.c,
        supply_demo_v2_imports: importsRow.c,
      };
    });
    res.json({ deleted: counts });
  } catch (err) {
    req.log?.error({ err }, "supply-import rollback failed");
    next(err);
  }
});

export default router;
