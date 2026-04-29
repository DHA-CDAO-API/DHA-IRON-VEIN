import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  db,
  nodes,
  items,
  patientTypes,
  patientItemRequirements,
  eventTypes,
  eventPatientMix,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import casualtyRouter from "../routes/casualty";
import { seedCasualtyReferenceData } from "../seed/casualty-reference";

// The casualty endpoint reads from the simulation context (nodes, items,
// balances, suppliers — already seeded with the dev INDOPACOM data) plus
// reference data (patient types, patient item requirements). To stay
// isolated from the rest of the seed lifecycle, this suite seeds one
// scratch patient type with a single per-patient requirement against an
// already-seeded item, then tears it back down. All other context (sites,
// inventory) is read-only.

const RUN_ID = `t-cas-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 6)}`;
const PT_ID = `${RUN_ID}-pt`;

let server: Server;
let baseUrl: string;
let siteIdA: string;
let siteIdB: string;
let siteIdC: string;
const patientTypeId: string = PT_ID;

async function postEvaluate(body: unknown) {
  const res = await fetch(`${baseUrl}/api/casualty/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body: json };
}

before(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use("/api", casualtyRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  // Pull three real sites from the seeded data so the test runs against
  // the same context the live UI uses. The /sites endpoint surfaces every
  // node, so we mirror that and just take the first 3 by id (deterministic
  // so failures are reproducible). We exclude any nodes hidden from the
  // map since those aren't selectable in the planner UI either.
  const siteRows = await db
    .select()
    .from(nodes)
    .then((rows) =>
      rows
        .filter((n) => !n.hiddenFromMap)
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
  assert.ok(
    siteRows.length >= 3,
    `casualty multi-site test needs >= 3 visible sites in the seed, found ${siteRows.length}`,
  );
  siteIdA = siteRows[0]!.id;
  siteIdB = siteRows[1]!.id;
  siteIdC = siteRows[2]!.id;

  // Pick any seeded item to attach a requirement to, so the demand
  // computation actually produces a non-empty `requiredItems` list.
  const itemRows = await db.select().from(items);
  assert.ok(itemRows.length > 0, "casualty test expects at least one seeded item");
  const reqItemId = itemRows[0]!.id;

  // Seed a scratch patient type + one requirement so the test owns its
  // own minimal demand profile, regardless of whether the broader
  // casualty reference data has been seeded on this DB.
  await db.insert(patientTypes).values({
    id: PT_ID,
    name: "Test Patient Type",
    severity: "urgent",
    careCategory: "trauma",
    avgClinicianMinutes: 30,
    description: "Casualty test fixture",
  });
  await db.insert(patientItemRequirements).values({
    patientTypeId: PT_ID,
    itemId: reqItemId,
    quantityPerPatient: 2,
    notes: "casualty test fixture requirement",
  });
});

after(async () => {
  await db
    .delete(patientItemRequirements)
    .where(eq(patientItemRequirements.patientTypeId, PT_ID));
  await db.delete(patientTypes).where(eq(patientTypes.id, PT_ID));

  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  // NOTE: do NOT call pool.end() — the pg pool is shared.
});

test("POST /api/casualty/evaluate single-site (legacy siteId): returns sufficiency for that one site and echoes 'single' mode", async () => {
  const { status, body } = await postEvaluate({
    siteId: siteIdA,
    patientCounts: { [patientTypeId]: 10 },
    arrivalWindowHours: 48,
  });
  assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.multiSiteMode, "single", "single-siteId path should resolve to 'single' mode");
  assert.deepEqual(body.selectedSiteIds, [siteIdA]);
  assert.equal(body.primarySiteId, null);
  assert.ok(body.sufficiency, "sufficiency should be present in single mode");
  assert.deepEqual(body.comparison, [], "comparison must be empty in single mode");
});

test("POST /api/casualty/evaluate combined: pools on-hand + inbound across sites, single sufficiency block", async () => {
  const { status, body } = await postEvaluate({
    siteIds: [siteIdA, siteIdB, siteIdC],
    multiSiteMode: "combined",
    patientCounts: { [patientTypeId]: 10 },
    arrivalWindowHours: 48,
  });
  assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.multiSiteMode, "combined");
  assert.deepEqual(body.selectedSiteIds, [siteIdA, siteIdB, siteIdC]);
  assert.equal(body.primarySiteId, null);
  assert.ok(body.sufficiency, "combined mode must return one pooled sufficiency block");
  assert.deepEqual(body.comparison, [], "combined mode must not return per-site comparison");

  // Combined sufficiency should never report fewer on-hand than the single
  // best-stocked site — pooling can only add inventory, never remove it.
  // We sanity-check the surplus relationship rather than absolute numbers,
  // since seed data evolves.
  const singleA = await postEvaluate({
    siteIds: [siteIdA],
    patientCounts: { [patientTypeId]: 10 },
    arrivalWindowHours: 48,
  });
  const singleARows = (singleA.body.sufficiency as { rows: Array<{ itemId: string; onHand: number }> } | null)?.rows ?? [];
  const combinedRows = (body.sufficiency as { rows: Array<{ itemId: string; onHand: number }> }).rows;
  for (const cr of combinedRows) {
    const sa = singleARows.find((r) => r.itemId === cr.itemId);
    if (!sa) continue;
    assert.ok(
      cr.onHand >= sa.onHand,
      `combined onHand for ${cr.itemId} (${cr.onHand}) must be >= single-site A (${sa.onHand})`,
    );
  }
});

test("POST /api/casualty/evaluate compare: returns one entry per site, top-level sufficiency null", async () => {
  const { status, body } = await postEvaluate({
    siteIds: [siteIdA, siteIdB, siteIdC],
    multiSiteMode: "compare",
    patientCounts: { [patientTypeId]: 10 },
    arrivalWindowHours: 48,
  });
  assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.multiSiteMode, "compare");
  assert.equal(body.sufficiency, null, "compare mode must not return a top-level sufficiency");
  assert.deepEqual(body.reroutes, [], "compare mode must not surface a single reroute list");

  const comparison = body.comparison as Array<{
    siteId: string;
    siteName: string;
    sufficiency: { summary: { verdict: string }; rows: unknown[] };
  }>;
  assert.equal(comparison.length, 3, "compare must return one entry per selected site");
  // Order should match selectedSiteIds order (echo-back contract).
  assert.deepEqual(
    comparison.map((c) => c.siteId),
    [siteIdA, siteIdB, siteIdC],
  );
  for (const c of comparison) {
    assert.ok(c.siteName && typeof c.siteName === "string", "each entry has a resolved site name");
    assert.ok(c.sufficiency.summary, "each entry carries a sufficiency summary");
    assert.ok(Array.isArray(c.sufficiency.rows), "each entry carries sufficiency rows");
  }
});

test("POST /api/casualty/evaluate primary: scores the primary site and constrains reroutes to the other selected sites", async () => {
  const { status, body } = await postEvaluate({
    siteIds: [siteIdA, siteIdB, siteIdC],
    multiSiteMode: "primary",
    primarySiteId: siteIdB,
    patientCounts: { [patientTypeId]: 50 }, // larger load to force shortfalls + reroute candidates
    arrivalWindowHours: 48,
  });
  assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.multiSiteMode, "primary");
  assert.equal(body.primarySiteId, siteIdB, "primary site echoed back");
  assert.ok(body.sufficiency, "primary mode must return one sufficiency block (for the primary site)");
  assert.deepEqual(body.comparison, []);

  // If the engine returned reroutes at all, every candidate must be one of
  // the *other* selected sites (siteIdA or siteIdC) — never the primary
  // itself, and never a site outside the selection.
  const reroutes = body.reroutes as Array<{ candidates: Array<{ siteId: string }> }>;
  const allowed = new Set([siteIdA, siteIdC]);
  for (const r of reroutes) {
    for (const c of r.candidates ?? []) {
      assert.ok(
        allowed.has(c.siteId),
        `reroute candidate ${c.siteId} should be one of the non-primary selected sites (${[...allowed].join(", ")})`,
      );
    }
  }
});

test("POST /api/casualty/evaluate primary with invalid primarySiteId falls back to the first selected site", async () => {
  const { status, body } = await postEvaluate({
    siteIds: [siteIdA, siteIdB],
    multiSiteMode: "primary",
    primarySiteId: "this-id-is-not-in-the-selection",
    patientCounts: { [patientTypeId]: 5 },
    arrivalWindowHours: 24,
  });
  assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.primarySiteId, siteIdA, "invalid primarySiteId should fall back to selectedSiteIds[0]");
});

test("POST /api/casualty/evaluate with no sites returns the unscoped requirements view", async () => {
  const { status, body } = await postEvaluate({
    patientCounts: { [patientTypeId]: 4 },
    arrivalWindowHours: 24,
  });
  assert.equal(status, 200);
  assert.deepEqual(body.selectedSiteIds, []);
  assert.equal(body.sufficiency, null);
  assert.deepEqual(body.comparison, []);
  assert.ok(Array.isArray(body.requiredItems), "requiredItems should always be present");
});

// Self-heal regression: truncating only the four casualty reference tables
// and then calling the helper must end with all four populated. This locks
// in the boot self-heal contract introduced for task #243 — a future
// refactor that drops one of the tables (or breaks the per-table empty
// check) would fail this test.
//
// Runs LAST in this file so its truncate doesn't yank the scratch
// patient_type/requirement that the casualty endpoint tests above rely on.
// The helper repopulates with the canonical seed data — the trailing
// `after()` will still no-op-delete the (now-absent) scratch fixture and
// leave the DB in a clean, fully-seeded state.
test("seedCasualtyReferenceData heals the four casualty reference tables when empty", async () => {
  // Truncate inside one statement so we can use CASCADE in case future
  // schema changes add FK constraints between these tables. RESTART
  // IDENTITY isn't strictly necessary (these tables use text PKs), but
  // mirrors the runSeed `truncate: true` pattern.
  await db.execute(sql`TRUNCATE TABLE
    event_patient_mix, event_types,
    patient_item_requirements, patient_types
    CASCADE`);

  // Sanity: all four tables really are empty before we call the helper.
  const empty = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` }).from(patientTypes),
    db.select({ c: sql<number>`count(*)::int` }).from(patientItemRequirements),
    db.select({ c: sql<number>`count(*)::int` }).from(eventTypes),
    db.select({ c: sql<number>`count(*)::int` }).from(eventPatientMix),
  ]);
  for (const [{ c }] of empty) assert.equal(c, 0, "table should be empty pre-heal");

  const r = await seedCasualtyReferenceData();
  assert.equal(r.inserted, true, "first call should report inserted=true");
  assert.equal(r.patientTypes, 9, "patient_types row count");
  assert.equal(r.patientItemRequirements, 98, "patient_item_requirements row count");
  assert.equal(r.eventTypes, 8, "event_types row count");
  assert.equal(r.eventPatientMix, 40, "event_patient_mix row count");

  // Verify against the database too — guards against a helper that
  // returns the right shape but doesn't actually insert.
  const after = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` }).from(patientTypes),
    db.select({ c: sql<number>`count(*)::int` }).from(patientItemRequirements),
    db.select({ c: sql<number>`count(*)::int` }).from(eventTypes),
    db.select({ c: sql<number>`count(*)::int` }).from(eventPatientMix),
  ]);
  assert.equal(after[0]![0]!.c, 9);
  assert.equal(after[1]![0]!.c, 98);
  assert.equal(after[2]![0]!.c, 8);
  assert.equal(after[3]![0]!.c, 40);

  // Idempotency: second call must be a no-op (no extra rows, inserted=false).
  const r2 = await seedCasualtyReferenceData();
  assert.equal(r2.inserted, false, "second call should be a no-op");
  const after2 = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(patientTypes);
  assert.equal(after2[0]!.c, 9, "second call must not double-insert");
});
