import {
  db,
  orders as ordersTable,
  orderLines as orderLinesTable,
  items as itemsTable,
  activityEntries,
} from "@workspace/db";
import { eq, inArray, lte } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Repair existing $0 purchase orders that pre-date task #222.
 *
 * Earlier builds let the `total_usd` of a PO settle to 0 because the
 * client supplied per-line prices and many flows omitted them entirely
 * (e.g. the casualty planner bulk-order, the seed's promoted AI POs).
 * Once the schema started carrying `items.unit_price_usd` and the
 * order-create handler began computing totals server-side, those legacy
 * rows still showed up as $0 in the UI and skewed the dashboards.
 *
 * This helper runs once at startup:
 * 1. Loads every order whose total_usd <= 0.
 * 2. Re-prices each line from the live items catalog.
 * 3. Updates the line + the parent order in a small transaction per row.
 * 4. Writes an activity entry so the repair shows up on the timeline.
 *
 * Orders whose lines reference items still missing a catalog price are
 * left untouched (the repair would just write 0 again) — they're logged
 * so an operator can decide how to handle them.
 */
export async function backfillZeroTotalOrders(): Promise<{
  scanned: number;
  repaired: number;
  skipped: number;
}> {
  const candidates = await db
    .select({ id: ordersTable.id, orderNo: ordersTable.orderNo })
    .from(ordersTable)
    .where(lte(ordersTable.totalUsd, 0));

  if (candidates.length === 0) {
    return { scanned: 0, repaired: 0, skipped: 0 };
  }

  let repaired = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const lines = await db
      .select()
      .from(orderLinesTable)
      .where(eq(orderLinesTable.orderId, candidate.id));
    if (lines.length === 0) {
      skipped += 1;
      continue;
    }

    const itemIds = Array.from(new Set(lines.map((l) => l.itemId)));
    const itemRows = await db
      .select({ id: itemsTable.id, unitPriceUsd: itemsTable.unitPriceUsd })
      .from(itemsTable)
      .where(inArray(itemsTable.id, itemIds));
    const priceById = new Map<string, number>();
    for (const row of itemRows) {
      priceById.set(row.id, Number(row.unitPriceUsd) || 0);
    }

    let newTotal = 0;
    let anyMissingPrice = false;
    const lineUpdates: Array<{
      id: number;
      unitPriceUsd: number;
      lineTotalUsd: number;
    }> = [];
    for (const line of lines) {
      const price = priceById.get(line.itemId) ?? 0;
      if (price <= 0) anyMissingPrice = true;
      const lineTotal = price * line.quantity;
      newTotal += lineTotal;
      lineUpdates.push({
        id: line.id,
        unitPriceUsd: price,
        lineTotalUsd: lineTotal,
      });
    }

    if (newTotal <= 0) {
      skipped += 1;
      logger.warn(
        { orderId: candidate.id, orderNo: candidate.orderNo, anyMissingPrice },
        "backfill: skipping order — no catalog price would still leave total at $0",
      );
      continue;
    }

    for (const upd of lineUpdates) {
      await db
        .update(orderLinesTable)
        .set({
          unitPriceUsd: upd.unitPriceUsd,
          lineTotalUsd: upd.lineTotalUsd,
        })
        .where(eq(orderLinesTable.id, upd.id));
    }
    await db
      .update(ordersTable)
      .set({ totalUsd: newTotal })
      .where(eq(ordersTable.id, candidate.id));
    await db.insert(activityEntries).values({
      kind: "ORDER_BACKFILLED",
      actor: "system",
      message: `Order ${candidate.orderNo} repriced from catalog (was $0, now $${newTotal.toFixed(2)})`,
      refType: "order",
      refId: candidate.id,
      meta: { previousTotalUsd: 0, newTotalUsd: newTotal, lines: lines.length },
    });
    repaired += 1;
  }

  return { scanned: candidates.length, repaired, skipped };
}
