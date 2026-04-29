import { db } from "@workspace/db";
import { nodes, supplyDemoV2Facilities } from "@workspace/db";
import { sql, eq, and, isNotNull, like } from "drizzle-orm";

export interface FacilityMappingSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  facilitiesProcessed: number;
  nodesCreated: number;
  alreadyMapped: number;
  hiddenNodesAfter: number;
  mappedFacilitiesAfter: number;
}

const NODE_ID_PREFIX = "supplyV2_";

function slugifyCode(code: string): string {
  // The imported codes look like "MTF-AAorin, AArel" — strip everything
  // that isn't a letter / digit / hyphen and lowercase. Truncate to keep
  // node ids reasonable.
  const cleaned = code
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return cleaned.slice(0, 80) || "unknown";
}

/**
 * For every supply_demo_v2_facilities row whose node_id is null, create a
 * matching `nodes` row with hidden_from_map = true and write the FK back
 * to the staging table. Idempotent: rows that already have a node_id are
 * skipped.
 */
export async function runFacilityMapping(): Promise<FacilityMappingSummary> {
  const startedAtDate = new Date();

  const facilities = await db.select().from(supplyDemoV2Facilities);

  let nodesCreated = 0;
  let alreadyMapped = 0;

  for (const f of facilities) {
    if (f.nodeId) {
      alreadyMapped += 1;
      continue;
    }

    const nodeId = `${NODE_ID_PREFIX}${slugifyCode(f.code)}`;

    await db.transaction(async (tx) => {
      // Insert the node. If a previous partial run already created this
      // exact id, just leave it in place.
      await tx
        .insert(nodes)
        .values({
          id: nodeId,
          name: f.displayName || f.code,
          type: "mtf",
          // Sentinel coordinates. The hidden_from_map flag means the map
          // page never renders these rows, so the values don't appear
          // anywhere on screen. The Sites list page does show them but
          // displays the location as "—" when both coords are 0.
          latitude: 0,
          longitude: 0,
          population: 0,
          optempo: "garrison",
          stockDays: 30,
          regionalHub: null,
          upstreamNode: null,
          countryCode: null,
          hiddenFromMap: true,
        })
        .onConflictDoNothing();

      await tx
        .update(supplyDemoV2Facilities)
        .set({ nodeId })
        .where(eq(supplyDemoV2Facilities.id, f.id));

      nodesCreated += 1;
    });
  }

  const [{ hiddenNodesAfter }] = await db
    .select({ hiddenNodesAfter: sql<number>`count(*)::int` })
    .from(nodes)
    .where(eq(nodes.hiddenFromMap, true));

  const [{ mappedFacilitiesAfter }] = await db
    .select({ mappedFacilitiesAfter: sql<number>`count(*)::int` })
    .from(supplyDemoV2Facilities)
    .where(isNotNull(supplyDemoV2Facilities.nodeId));

  const finishedAtDate = new Date();
  return {
    startedAt: startedAtDate.toISOString(),
    finishedAt: finishedAtDate.toISOString(),
    durationMs: finishedAtDate.getTime() - startedAtDate.getTime(),
    facilitiesProcessed: facilities.length,
    nodesCreated,
    alreadyMapped,
    hiddenNodesAfter,
    mappedFacilitiesAfter,
  };
}

/**
 * Delete every node that was created by the facility mapping step, leaving
 * the curated 35 seed nodes untouched. The FK on
 * supply_demo_v2_facilities.node_id is ON DELETE SET NULL so the staging
 * rows simply lose their reference; the next rollback step truncates them
 * anyway.
 */
export async function deleteMappedFacilityNodes(): Promise<number> {
  const deleted = await db
    .delete(nodes)
    .where(
      and(
        eq(nodes.hiddenFromMap, true),
        like(nodes.id, `${NODE_ID_PREFIX}%`),
      ),
    )
    .returning({ id: nodes.id });
  return deleted.length;
}
