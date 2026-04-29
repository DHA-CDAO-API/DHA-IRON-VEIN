/**
 * Integration tests for the Order envelope's `triggerNote` field.
 *
 * Background — task #240. The Order Detail "Triggered by" card was
 * collapsing AI-promoted orders to a generic line because some rows had an
 * empty `notes_enc` column at read time. The fix layered three things:
 *   1. The promote handler now encrypts the same text it writes to the
 *      legacy plaintext column, so the two never diverge.
 *   2. The order envelope falls back to the originating recommendation's
 *      `reason` when the decrypted note is empty.
 *   3. Both list and detail endpoints wire that fallback in.
 *
 * These tests pin down the read-side contract directly against the
 * envelope route so a future regression that drops the fallback (or
 * misroutes the encrypted note) fails loudly here instead of only being
 * caught by an end-to-end browser run.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  db,
  nodes,
  suppliers,
  items,
  orders,
  orderLines,
  recommendations as recsTable,
  activityEntries,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import ordersRouter from "../routes/orders";
import predictiveRouter from "../routes/predictive";
import { encryptText, decryptText } from "../lib/crypto";
import { invalidateSimCache } from "../lib/ctx";

const RUN_ID = `t-trig-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 6)}`;

const TO_NODE_ID = `${RUN_ID}-site`;
const SUPPLIER_ID = `${RUN_ID}-sup`;
const ITEM_ID = `${RUN_ID}-item`;

// Three fixture orders, each exercising a different code path.
const ORDER_AI_WITH_NOTE = `${RUN_ID}-ai-note`;
const ORDER_AI_NO_NOTE = `${RUN_ID}-ai-fallback`;
const ORDER_MANUAL = `${RUN_ID}-manual`;
const REC_WITH_NOTE = `${RUN_ID}-rec-with`;
const REC_NO_NOTE = `${RUN_ID}-rec-without`;

const RATIONALE_WITH_NOTE =
  "Blood Collection Bag CPD-A1 450mL at Test Site: projected DOS 1.3 d (target 180 d).";
const RATIONALE_REC_ONLY =
  "Skin Antiseptic Chlorhexidine at Test Site: projected DOS 1.1 d (target 180 d). Daily burn 48.8 ea.";

let server: Server;
let baseUrl: string;

before(async () => {
  const app: Express = express();
  app.use(express.json());

  // Inject a fake authenticated commander for the predictive promote
  // route, which is gated behind requireRole("commander", "logistician").
  // The orders router itself is not behind requireRole at module level, so
  // this middleware only matters for /api/predictive/* requests.
  app.use((req, _res, next) => {
    (req as unknown as { user: unknown }).user = {
      id: `${RUN_ID}-tester`,
      role: "commander",
      email: "tester@example.test",
      displayName: "Trigger Note Tester",
    };
    // requireRole() also gates on req.isAuthenticated(), which is normally
    // installed by passport. Stub it to true since we're not booting the
    // full app (no passport, no session) for this isolated route test.
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated =
      () => true;
    next();
  });

  app.use("/api", ordersRouter);
  app.use("/api", predictiveRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  await db.insert(nodes).values({
    id: TO_NODE_ID,
    name: "Test Site",
    type: "treatment",
    latitude: 0,
    longitude: 0,
  });
  await db.insert(suppliers).values({
    id: SUPPLIER_ID,
    name: "Test Supplier",
    channel: "DLA",
  });
  await db.insert(items).values({
    id: ITEM_ID,
    name: "Test Item",
    unitOfIssue: "ea",
    unitPriceUsd: 10,
  });

  // Two recommendations: one whose order will carry an encrypted note
  // (the note should win), one whose order will have a NULL notes_enc
  // (the rec.reason fallback should win).
  const now = new Date();
  await db.insert(recsTable).values([
    {
      id: REC_WITH_NOTE,
      kind: "REORDER",
      nodeId: TO_NODE_ID,
      itemId: ITEM_ID,
      suggestedQty: 100,
      reason: RATIONALE_WITH_NOTE,
      sourceSupplierId: SUPPLIER_ID,
      etaDays: 4,
      expectedRiskReduction: 0.42,
      createdAt: now,
    },
    {
      id: REC_NO_NOTE,
      kind: "REROUTE",
      nodeId: TO_NODE_ID,
      itemId: ITEM_ID,
      suggestedQty: 50,
      reason: RATIONALE_REC_ONLY,
      sourceSupplierId: SUPPLIER_ID,
      etaDays: 3,
      expectedRiskReduction: 0.18,
      createdAt: now,
    },
  ]);

  const requestedDeliveryAt = new Date(now.getTime() + 5 * 86_400_000);

  // Order #1: AI-promoted, has a real encrypted note. Persist via the same
  // crypto helper the route uses so we exercise the round-trip exactly the
  // way production does.
  await db.insert(orders).values({
    id: ORDER_AI_WITH_NOTE,
    orderNo: `${RUN_ID}-PO1`,
    nodeId: TO_NODE_ID,
    supplierId: SUPPLIER_ID,
    status: "SUBMITTED",
    priority: "URGENT",
    requestedDeliveryAt,
    totalUsd: 1000,
    promotedFromRecommendationId: REC_WITH_NOTE,
    notes: null,
    notesEnc: encryptText(RATIONALE_WITH_NOTE) as unknown as Buffer | undefined,
    createdAt: now,
  });

  // Order #2: AI-promoted but `notes_enc` is intentionally NULL — this is
  // the legacy-data shape the read-time fallback exists to handle.
  await db.insert(orders).values({
    id: ORDER_AI_NO_NOTE,
    orderNo: `${RUN_ID}-PO2`,
    nodeId: TO_NODE_ID,
    supplierId: SUPPLIER_ID,
    status: "SUBMITTED",
    priority: "PRIORITY",
    requestedDeliveryAt,
    totalUsd: 500,
    promotedFromRecommendationId: REC_NO_NOTE,
    notes: null,
    notesEnc: null,
    createdAt: now,
  });

  // Order #3: manual, no recommendation, with an encrypted operator note.
  await db.insert(orders).values({
    id: ORDER_MANUAL,
    orderNo: `${RUN_ID}-PO3`,
    nodeId: TO_NODE_ID,
    supplierId: SUPPLIER_ID,
    status: "SUBMITTED",
    priority: "ROUTINE",
    requestedDeliveryAt,
    totalUsd: 250,
    promotedFromRecommendationId: null,
    notes: null,
    notesEnc: encryptText("Manual operator note for QA") as unknown as
      | Buffer
      | undefined,
    createdAt: now,
  });

  await db.insert(orderLines).values([
    {
      orderId: ORDER_AI_WITH_NOTE,
      itemId: ITEM_ID,
      quantity: 100,
      unitPriceUsd: 10,
      lineTotalUsd: 1000,
    },
    {
      orderId: ORDER_AI_NO_NOTE,
      itemId: ITEM_ID,
      quantity: 50,
      unitPriceUsd: 10,
      lineTotalUsd: 500,
    },
    {
      orderId: ORDER_MANUAL,
      itemId: ITEM_ID,
      quantity: 25,
      unitPriceUsd: 10,
      lineTotalUsd: 250,
    },
  ]);
});

after(async () => {
  const allOrderIds = [ORDER_AI_WITH_NOTE, ORDER_AI_NO_NOTE, ORDER_MANUAL];
  await db
    .delete(orderLines)
    .where(inArray(orderLines.orderId, allOrderIds));
  await db
    .delete(activityEntries)
    .where(inArray(activityEntries.refId, allOrderIds));
  await db.delete(orders).where(inArray(orders.id, allOrderIds));
  await db
    .delete(recsTable)
    .where(inArray(recsTable.id, [REC_WITH_NOTE, REC_NO_NOTE]));
  await db.delete(items).where(eq(items.id, ITEM_ID));
  await db.delete(suppliers).where(eq(suppliers.id, SUPPLIER_ID));
  await db.delete(nodes).where(eq(nodes.id, TO_NODE_ID));

  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

async function getDetail(orderId: string) {
  const res = await fetch(`${baseUrl}/api/orders/${orderId}`);
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

test("GET /api/orders/:id returns the decrypted note as triggerNote on AI orders that have notes_enc", async () => {
  // Pre-flight DB assertion: prove the fixture truly persisted an
  // encrypted blob and that pgcrypto can decrypt it back to the source
  // rationale. Without this, the API-level assertion below could be
  // satisfied by the rec.reason fallback if the insert silently failed.
  const [raw] = await db
    .select({
      hasEnc: sql<boolean>`${orders.notesEnc} IS NOT NULL`,
      decrypted: decryptText(orders.notesEnc),
    })
    .from(orders)
    .where(eq(orders.id, ORDER_AI_WITH_NOTE));
  assert.equal(
    raw?.hasEnc,
    true,
    "fixture row must persist a non-null notes_enc bytea",
  );
  assert.equal(
    raw?.decrypted,
    RATIONALE_WITH_NOTE,
    "pgcrypto must decrypt notes_enc back to the original rationale",
  );

  const { status, body } = await getDetail(ORDER_AI_WITH_NOTE);
  assert.equal(status, 200, `expected 200, got ${status}`);
  const order = body.order as Record<string, unknown>;
  assert.equal(order.triggerSource, "ai", "AI-promoted order");
  assert.equal(
    order.triggerNote,
    RATIONALE_WITH_NOTE,
    "triggerNote must come from the encrypted note when present",
  );

  // Recommendation envelope sanity: kind, suggested supplier and the
  // expectedRiskReduction we added must be present so the rebuilt
  // "Triggered by" card can render its qualitative chip and supplier line.
  const rec = body.recommendation as Record<string, unknown>;
  assert.equal(rec.kind, "REORDER");
  assert.equal(rec.suggestedSupplierName, "Test Supplier");
  assert.equal(rec.etaDays, 4);
  assert.equal(rec.expectedRiskReduction, 0.42);
});

test("GET /api/orders/:id falls back to recommendation.rationale when notes_enc is null", async () => {
  const { status, body } = await getDetail(ORDER_AI_NO_NOTE);
  assert.equal(status, 200, `expected 200, got ${status}`);
  const order = body.order as Record<string, unknown>;
  assert.equal(order.triggerSource, "ai");
  assert.equal(
    order.triggerNote,
    RATIONALE_REC_ONLY,
    "triggerNote must fall back to rec.reason for legacy AI orders without notes_enc",
  );
  // Sanity-check the underlying row really has no encrypted note — if a
  // future change starts populating it on insert, this test should be
  // updated rather than silently still passing.
  const [raw] = await db
    .select({
      hasEnc: sql<boolean>`${orders.notesEnc} IS NOT NULL`,
    })
    .from(orders)
    .where(eq(orders.id, ORDER_AI_NO_NOTE));
  assert.equal(raw?.hasEnc, false, "fixture row must have NULL notes_enc");
});

test("GET /api/orders returns triggerNote for both shapes in the list endpoint", async () => {
  const res = await fetch(`${baseUrl}/api/orders?limit=500`);
  assert.equal(res.status, 200);
  const list = (await res.json()) as Array<Record<string, unknown>>;
  const byId = new Map(list.map((o) => [o.id as string, o]));

  const aiWithNote = byId.get(ORDER_AI_WITH_NOTE);
  assert.ok(aiWithNote, "list should include the AI order with note");
  assert.equal(aiWithNote!.triggerNote, RATIONALE_WITH_NOTE);

  const aiNoNote = byId.get(ORDER_AI_NO_NOTE);
  assert.ok(aiNoNote, "list should include the AI order without note");
  assert.equal(
    aiNoNote!.triggerNote,
    RATIONALE_REC_ONLY,
    "list endpoint must batch-load rec.reason and apply the fallback",
  );

  const manual = byId.get(ORDER_MANUAL);
  assert.ok(manual, "list should include the manual order");
  assert.equal(manual!.triggerSource, "manual");
  assert.equal(
    manual!.triggerNote,
    "Manual operator note for QA",
    "manual orders must surface their decrypted operator note",
  );
});

test("POST /api/predictive/recommendations/:id/promote round-trips both notes and notes_enc", async () => {
  // End-to-end coverage of the path that originally caused #240: promote a
  // recommendation through the real handler and prove the resulting order
  // row carries an encrypted note that decrypts back to the same string
  // also written to the legacy plaintext column. This guards against any
  // future change that updates one column but forgets the other.
  const RECID_PROMOTE = `${RUN_ID}-rec-promote`;
  const promoteRationale =
    "Test Item at Test Site: projected DOS 0.9 d (target 180 d).";
  await db.insert(recsTable).values({
    id: RECID_PROMOTE,
    kind: "REORDER",
    nodeId: TO_NODE_ID,
    itemId: ITEM_ID,
    suggestedQty: 75,
    reason: promoteRationale,
    sourceSupplierId: SUPPLIER_ID,
    etaDays: 5,
    expectedRiskReduction: 0.27,
    createdAt: new Date(),
  });
  // The promote handler reads from a 5-second-cached sim context; bust it
  // so our just-inserted recommendation/site/item/supplier are visible.
  invalidateSimCache();

  const res = await fetch(
    `${baseUrl}/api/predictive/recommendations/${RECID_PROMOTE}/promote`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(res.status, 201, `promote should succeed: ${JSON.stringify(body)}`);
  const promotedOrderId = (body.orderId ?? body.id) as string;
  assert.ok(promotedOrderId, "promote response must include the new order id");

  try {
    // Inspect the persisted row directly: both `notes` and `notes_enc`
    // must be populated, and pgcrypto must decrypt notes_enc back to the
    // exact same string the plaintext column holds.
    const [row] = await db
      .select({
        notes: orders.notes,
        hasEnc: sql<boolean>`${orders.notesEnc} IS NOT NULL`,
        decrypted: decryptText(orders.notesEnc),
        promotedFromRecommendationId: orders.promotedFromRecommendationId,
      })
      .from(orders)
      .where(eq(orders.id, promotedOrderId));
    assert.ok(row, "promoted order row must exist");
    assert.equal(
      row!.promotedFromRecommendationId,
      RECID_PROMOTE,
      "order must be linked back to the originating recommendation",
    );
    assert.equal(
      row!.hasEnc,
      true,
      "promote handler must populate notes_enc, not just plaintext notes",
    );
    assert.ok(
      typeof row!.notes === "string" && row!.notes.length > 0,
      "promote handler must also write the legacy plaintext notes column",
    );
    assert.equal(
      row!.decrypted,
      row!.notes,
      "decrypted notes_enc must exactly match the plaintext notes column",
    );
    assert.ok(
      row!.notes!.includes(promoteRationale),
      `plaintext notes must contain the recommendation rationale; got: ${row!.notes}`,
    );

    // And the read-side surfacing: the order envelope must echo that
    // same note as triggerNote (no fallback needed because notes_enc
    // is now real).
    const detail = await getDetail(promotedOrderId);
    assert.equal(detail.status, 200);
    const order = detail.body.order as Record<string, unknown>;
    assert.equal(order.triggerSource, "ai");
    assert.equal(
      order.triggerNote,
      row!.notes,
      "envelope triggerNote must match the persisted note exactly",
    );
  } finally {
    // Clean up the promoted order and its lines so this test stays
    // hermetic even when run repeatedly.
    await db.delete(orderLines).where(eq(orderLines.orderId, promotedOrderId));
    await db
      .delete(activityEntries)
      .where(eq(activityEntries.refId, promotedOrderId));
    await db.delete(orders).where(eq(orders.id, promotedOrderId));
    await db.delete(recsTable).where(eq(recsTable.id, RECID_PROMOTE));
  }
});
