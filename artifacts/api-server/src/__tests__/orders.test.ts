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
  activityEntries,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import ordersRouter from "../routes/orders";
import { backfillZeroTotalOrders } from "../lib/backfill-order-prices";

// Unique per-run prefix so parallel test runs (and any stray leftover rows
// from a previous failed run) do not collide. Cleanup at the end of the
// suite is keyed off this prefix.
const RUN_ID = `t-bulk-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 6)}`;

const TO_NODE_ID = `${RUN_ID}-site`;
const SUPPLIER_A = `${RUN_ID}-supA`;
const SUPPLIER_B = `${RUN_ID}-supB`;
const ITEM_1 = `${RUN_ID}-item1`;
const ITEM_2 = `${RUN_ID}-item2`;
const ITEM_3 = `${RUN_ID}-item3`;
// Catalog has no price for ITEM_NO_PRICE — the order-create handler must
// reject any PO whose total computes to $0 because of it (task #222).
const ITEM_NO_PRICE = `${RUN_ID}-item-noprice`;

let server: Server;
let baseUrl: string;
const createdOrderIds: string[] = [];

async function postOrder(body: unknown) {
  const res = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (res.status === 201 && typeof json.id === "string") {
    createdOrderIds.push(json.id);
  }
  return { status: res.status, body: json };
}

before(async () => {
  // Mount only the orders router so this test does not transitively load
  // every other route module (copilot, admin, etc.).
  const app: Express = express();
  app.use(express.json());
  app.use("/api", ordersRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  // Seed minimal fixtures: one destination node, two suppliers, three items.
  await db.insert(nodes).values({
    id: TO_NODE_ID,
    name: "Test Site",
    type: "treatment",
    latitude: 0,
    longitude: 0,
  });
  await db.insert(suppliers).values([
    { id: SUPPLIER_A, name: "Test Supplier A", channel: "DLA" },
    { id: SUPPLIER_B, name: "Test Supplier B", channel: "Commercial" },
  ]);
  await db.insert(items).values([
    // Distinct prices per item so the assertions can verify the server
    // computed totals from the catalog instead of summing identical values
    // by accident.
    { id: ITEM_1, name: "Test Item 1", unitOfIssue: "ea", unitPriceUsd: 10 },
    { id: ITEM_2, name: "Test Item 2", unitOfIssue: "ea", unitPriceUsd: 25 },
    { id: ITEM_3, name: "Test Item 3", unitOfIssue: "ea", unitPriceUsd: 4 },
    {
      id: ITEM_NO_PRICE,
      name: "Test Item No Price",
      unitOfIssue: "ea",
      unitPriceUsd: 0,
    },
  ]);
});

after(async () => {
  // Tear down in dependency order. Use the run-scoped IDs so a leaked row
  // from a different test run is never touched.
  if (createdOrderIds.length > 0) {
    await db
      .delete(orderLines)
      .where(inArray(orderLines.orderId, createdOrderIds));
    await db
      .delete(activityEntries)
      .where(inArray(activityEntries.refId, createdOrderIds));
    await db.delete(orders).where(inArray(orders.id, createdOrderIds));
  }
  await db
    .delete(items)
    .where(inArray(items.id, [ITEM_1, ITEM_2, ITEM_3, ITEM_NO_PRICE]));
  await db
    .delete(suppliers)
    .where(inArray(suppliers.id, [SUPPLIER_A, SUPPLIER_B]));
  await db.delete(nodes).where(eq(nodes.id, TO_NODE_ID));

  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  // NOTE: do NOT call pool.end() here. The pg pool is shared across
  // @workspace/db consumers; tearing it down would break any sibling test
  // file that runs in the same process. node:test exits cleanly once the
  // server is closed and there are no pending handles.
});

test("POST /api/orders bulk shape: creates one order with all lines attached", async () => {
  const { status, body } = await postOrder({
    toNodeId: TO_NODE_ID,
    supplierId: SUPPLIER_A,
    priority: "URGENT",
    rationale: "bulk regression test",
    lines: [
      { itemId: ITEM_1, quantity: 5 },
      { itemId: ITEM_2, quantity: 3 },
      { itemId: ITEM_3, quantity: 7 },
    ],
  });

  assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert.ok(typeof body.id === "string", "response should have an order id");
  const orderId = body.id as string;

  // Single envelope summary should reflect aggregate quantity + line count.
  assert.equal(body.toNodeId, TO_NODE_ID);
  assert.equal(body.supplierId, SUPPLIER_A);
  assert.equal(body.priority, "URGENT");
  assert.equal(body.lineCount, 3, "envelope should report 3 lines");
  assert.equal(body.quantity, 15, "envelope quantity should sum across lines");

  // Database side: exactly one order row, with all three lines attached.
  const orderRows = await db.select().from(orders).where(eq(orders.id, orderId));
  assert.equal(orderRows.length, 1, "exactly one order row should be created");
  assert.equal(orderRows[0]!.supplierId, SUPPLIER_A);
  assert.equal(orderRows[0]!.nodeId, TO_NODE_ID);

  const lineRows = await db
    .select()
    .from(orderLines)
    .where(eq(orderLines.orderId, orderId));
  assert.equal(lineRows.length, 3, "all three lines should be attached to the same order");
  const byItem = new Map(lineRows.map((l) => [l.itemId, l.quantity]));
  assert.equal(byItem.get(ITEM_1), 5);
  assert.equal(byItem.get(ITEM_2), 3);
  assert.equal(byItem.get(ITEM_3), 7);
});

test("POST /api/orders bulk shape: two suppliers with overlapping items produce two distinct POs", async () => {
  // Mirror what the Casualty Planner's grouping does when two shortfalls
  // share an item but have different top suppliers — each supplier should
  // get its own PO, even though the item lists overlap.
  const first = await postOrder({
    toNodeId: TO_NODE_ID,
    supplierId: SUPPLIER_A,
    priority: "URGENT",
    lines: [
      { itemId: ITEM_1, quantity: 4 },
      { itemId: ITEM_2, quantity: 2 },
    ],
  });
  assert.equal(first.status, 201, `first POST should succeed: ${JSON.stringify(first.body)}`);
  const firstId = first.body.id as string;

  const second = await postOrder({
    toNodeId: TO_NODE_ID,
    supplierId: SUPPLIER_B,
    priority: "URGENT",
    lines: [
      { itemId: ITEM_2, quantity: 6 }, // overlaps with first PO
      { itemId: ITEM_3, quantity: 1 },
    ],
  });
  assert.equal(second.status, 201, `second POST should succeed: ${JSON.stringify(second.body)}`);
  const secondId = second.body.id as string;

  assert.notEqual(firstId, secondId, "the two POs must be distinct order rows");

  const rows = await db
    .select()
    .from(orders)
    .where(inArray(orders.id, [firstId, secondId]));
  assert.equal(rows.length, 2, "both order rows must exist independently");

  const bySupplier = new Map(rows.map((r) => [r.supplierId, r]));
  assert.ok(bySupplier.has(SUPPLIER_A), "supplier A should have its own PO");
  assert.ok(bySupplier.has(SUPPLIER_B), "supplier B should have its own PO");

  // And each PO carries only its own lines (no cross-contamination of the
  // overlapping item).
  const firstLines = await db
    .select()
    .from(orderLines)
    .where(eq(orderLines.orderId, firstId));
  const secondLines = await db
    .select()
    .from(orderLines)
    .where(eq(orderLines.orderId, secondId));
  assert.equal(firstLines.length, 2);
  assert.equal(secondLines.length, 2);

  const firstQtyForOverlap = firstLines.find((l) => l.itemId === ITEM_2)?.quantity;
  const secondQtyForOverlap = secondLines.find((l) => l.itemId === ITEM_2)?.quantity;
  assert.equal(firstQtyForOverlap, 2, "supplier A keeps its own qty for the overlapping item");
  assert.equal(secondQtyForOverlap, 6, "supplier B keeps its own qty for the overlapping item");
});

test("POST /api/orders computes total_usd from the catalog and ignores client-supplied prices", async () => {
  // The client used to control prices on each line, which let an honest
  // bug or a tampered request push a PO through with a fake total. Task
  // #222 made the server authoritative — the catalog is the only source.
  // ITEM_1=$10 (qty 3) + ITEM_2=$25 (qty 2) = $80, regardless of the
  // bogus 9999 the request sends below.
  const { status, body } = await postOrder({
    toNodeId: TO_NODE_ID,
    supplierId: SUPPLIER_A,
    priority: "URGENT",
    rationale: "server-side pricing test",
    lines: [
      { itemId: ITEM_1, quantity: 3, unitPriceUsd: 9999 },
      { itemId: ITEM_2, quantity: 2, unitPriceUsd: 9999 },
    ],
  });

  assert.equal(status, 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
  const orderId = body.id as string;

  assert.equal(body.totalUsd, 80, "envelope totalUsd should reflect catalog * qty");
  assert.equal(body.totalCost, 80, "legacy totalCost mirror should match");

  const lineRows = await db
    .select()
    .from(orderLines)
    .where(eq(orderLines.orderId, orderId));
  const byItem = new Map(lineRows.map((l) => [l.itemId, l]));
  assert.equal(
    Number(byItem.get(ITEM_1)!.unitPriceUsd),
    10,
    "stored line price must come from the catalog, not the request body",
  );
  assert.equal(Number(byItem.get(ITEM_1)!.lineTotalUsd), 30);
  assert.equal(Number(byItem.get(ITEM_2)!.unitPriceUsd), 25);
  assert.equal(Number(byItem.get(ITEM_2)!.lineTotalUsd), 50);
});

test("POST /api/orders rejects a $0 PO with missingPriceItemIds when the catalog has no price", async () => {
  // Catalog has no price for ITEM_NO_PRICE. The handler must refuse the
  // PO with HTTP 400 and surface the offending item ids so the UI can
  // tell the operator exactly which line is unpriced (task #222).
  const { status, body } = await postOrder({
    toNodeId: TO_NODE_ID,
    supplierId: SUPPLIER_A,
    priority: "URGENT",
    rationale: "zero-total rejection test",
    lines: [{ itemId: ITEM_NO_PRICE, quantity: 5 }],
  });

  assert.equal(status, 400, `expected 400, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.error, "zero_total_order");
  assert.ok(Array.isArray(body.missingPriceItemIds), "should return missingPriceItemIds array");
  assert.ok(
    (body.missingPriceItemIds as string[]).includes(ITEM_NO_PRICE),
    "the unpriced item id must appear in the response",
  );

  // And the rejection must be a true rollback — no order or lines may be
  // persisted for a request that failed pricing validation.
  const stranded = await db
    .select()
    .from(orderLines)
    .where(eq(orderLines.itemId, ITEM_NO_PRICE));
  assert.equal(stranded.length, 0, "no orderLines should leak through on a rejected PO");
});

test("backfillZeroTotalOrders repairs a legacy $0 order from the live catalog", async () => {
  // Simulate a pre-task-#222 row: an order with totalUsd=0 and a line
  // whose unit price was never set. After running the backfill, both the
  // line and the parent order should be repriced from the catalog and an
  // ORDER_BACKFILLED activity entry should be written.
  const orderId = `${RUN_ID}-legacy-order`;
  const orderNo = `PO-LEGACY-${RUN_ID}`;
  await db.insert(orders).values({
    id: orderId,
    orderNo,
    supplierId: SUPPLIER_A,
    nodeId: TO_NODE_ID,
    priority: "URGENT",
    status: "PENDING",
    totalUsd: 0,
    requestedDeliveryAt: new Date(),
  });
  createdOrderIds.push(orderId);
  await db.insert(orderLines).values([
    // ITEM_1 = $10 * 4 = $40, ITEM_3 = $4 * 2 = $8 → total $48.
    { orderId, itemId: ITEM_1, quantity: 4, unitPriceUsd: 0, lineTotalUsd: 0 },
    { orderId, itemId: ITEM_3, quantity: 2, unitPriceUsd: 0, lineTotalUsd: 0 },
  ]);

  const result = await backfillZeroTotalOrders();
  assert.ok(result.scanned >= 1, "backfill should scan at least our seeded row");
  assert.ok(result.repaired >= 1, "backfill should repair at least our seeded row");

  const [repaired] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId));
  assert.ok(repaired, "the legacy order should still exist");
  assert.equal(Number(repaired!.totalUsd), 48, "totalUsd should be repriced from catalog");

  const repairedLines = await db
    .select()
    .from(orderLines)
    .where(eq(orderLines.orderId, orderId));
  const byItem = new Map(repairedLines.map((l) => [l.itemId, l]));
  assert.equal(Number(byItem.get(ITEM_1)!.unitPriceUsd), 10);
  assert.equal(Number(byItem.get(ITEM_1)!.lineTotalUsd), 40);
  assert.equal(Number(byItem.get(ITEM_3)!.unitPriceUsd), 4);
  assert.equal(Number(byItem.get(ITEM_3)!.lineTotalUsd), 8);

  const activity = await db
    .select()
    .from(activityEntries)
    .where(eq(activityEntries.refId, orderId));
  assert.ok(
    activity.some((a) => a.kind === "ORDER_BACKFILLED"),
    "an ORDER_BACKFILLED activity entry should be written",
  );
});
