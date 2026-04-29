import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { db, items, profiles, activityEntries } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import itemsRouter from "../routes/items";

// Per-run prefix so parallel runs / leaked rows from prior runs cannot
// collide with this suite's fixtures.
const RUN_ID = `t-itemsadmin-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 6)}`;

const ITEM_OK = `${RUN_ID}-ok`;
const ITEM_NO_PRICE = `${RUN_ID}-nop`;

let server: Server;
let baseUrl: string;
let savedProfileRole: string | null = null;
let createdProfile = false;

async function setActiveRole(role: string) {
  const rows = await db.select().from(profiles);
  if (rows.length === 0) {
    await db.insert(profiles).values({ role });
    createdProfile = true;
  } else {
    await db.update(profiles).set({ role }).where(eq(profiles.id, rows[0]!.id));
  }
}

async function patchItem(itemId: string, body: unknown) {
  const res = await fetch(`${baseUrl}/api/items/${itemId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body: json };
}

before(async () => {
  // Mount only the items router so this test does not transitively load
  // every other route module.
  const app: Express = express();
  app.use(express.json());
  app.use("/api", itemsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;

  // Snapshot whatever role the singleton profile is currently set to so
  // we can restore it in `after`. The profile row is shared with the
  // running app, so we must not leave it mutated.
  const existing = await db.select().from(profiles);
  if (existing.length > 0) {
    savedProfileRole = existing[0]!.role;
  }

  await db.insert(items).values([
    {
      id: ITEM_OK,
      name: "Test Item OK",
      unitOfIssue: "ea",
      unitPriceUsd: 12.5,
    },
    {
      id: ITEM_NO_PRICE,
      name: "Test Item Unpriced",
      unitOfIssue: "ea",
      unitPriceUsd: 0,
    },
  ]);
});

after(async () => {
  await db
    .delete(activityEntries)
    .where(inArray(activityEntries.refId, [ITEM_OK, ITEM_NO_PRICE]));
  await db.delete(items).where(inArray(items.id, [ITEM_OK, ITEM_NO_PRICE]));
  if (createdProfile) {
    await db.delete(profiles);
  } else if (savedProfileRole != null) {
    const rows = await db.select().from(profiles);
    if (rows.length > 0) {
      await db
        .update(profiles)
        .set({ role: savedProfileRole })
        .where(eq(profiles.id, rows[0]!.id));
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

test("PATCH /api/items/:itemId rejects non-admin roles with 403", async () => {
  await setActiveRole("analyst");
  const { status, body } = await patchItem(ITEM_OK, { unitPriceUsd: 99.99 });
  assert.equal(status, 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.error, "forbidden");

  // The price must NOT have changed.
  const row = await db.select().from(items).where(eq(items.id, ITEM_OK));
  assert.equal(Number(row[0]!.unitPriceUsd), 12.5);
});

test("PATCH /api/items/:itemId rejects medical_planner with 403", async () => {
  await setActiveRole("medical_planner");
  const { status } = await patchItem(ITEM_OK, { unitPriceUsd: 50 });
  assert.equal(status, 403);
  const row = await db.select().from(items).where(eq(items.id, ITEM_OK));
  assert.equal(Number(row[0]!.unitPriceUsd), 12.5, "price must be unchanged");
});

test("PATCH /api/items/:itemId allows logistician and persists the new price", async () => {
  await setActiveRole("logistician");
  const { status, body } = await patchItem(ITEM_OK, { unitPriceUsd: 17.42 });
  assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.id, ITEM_OK);
  const row = await db.select().from(items).where(eq(items.id, ITEM_OK));
  assert.equal(Number(row[0]!.unitPriceUsd), 17.42);
});

test("PATCH /api/items/:itemId allows commander and writes a CATALOG_PRICE_CHANGED activity entry", async () => {
  await setActiveRole("commander");
  const { status } = await patchItem(ITEM_NO_PRICE, { unitPriceUsd: 8.0 });
  assert.equal(status, 200);

  const row = await db
    .select()
    .from(items)
    .where(eq(items.id, ITEM_NO_PRICE));
  assert.equal(Number(row[0]!.unitPriceUsd), 8.0);

  const acts = await db
    .select()
    .from(activityEntries)
    .where(eq(activityEntries.refId, ITEM_NO_PRICE));
  const priceActs = acts.filter((a) => a.kind === "CATALOG_PRICE_CHANGED");
  assert.ok(
    priceActs.length >= 1,
    `expected at least one CATALOG_PRICE_CHANGED activity, got: ${JSON.stringify(acts)}`,
  );
});

test("PATCH /api/items/:itemId rejects negative prices with 400 even for admins", async () => {
  await setActiveRole("logistician");
  const { status } = await patchItem(ITEM_OK, { unitPriceUsd: -1 });
  assert.equal(status, 400);
});

test("PATCH /api/items/:itemId returns 404 for unknown id (admin)", async () => {
  await setActiveRole("logistician");
  const res = await fetch(`${baseUrl}/api/items/${RUN_ID}-does-not-exist`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ unitPriceUsd: 5 }),
  });
  assert.equal(res.status, 404);
});
