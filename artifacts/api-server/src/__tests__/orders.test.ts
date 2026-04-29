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
    { id: ITEM_1, name: "Test Item 1", unitOfIssue: "ea" },
    { id: ITEM_2, name: "Test Item 2", unitOfIssue: "ea" },
    { id: ITEM_3, name: "Test Item 3", unitOfIssue: "ea" },
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
    .where(inArray(items.id, [ITEM_1, ITEM_2, ITEM_3]));
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
