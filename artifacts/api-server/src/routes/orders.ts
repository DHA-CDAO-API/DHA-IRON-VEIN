import { Router, type IRouter } from "express";
import {
  db,
  orders,
  orderLines,
  shipments,
  activityEntries,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { invalidateSimCache } from "../lib/ctx";
import { logger } from "../lib/logger";

const router: IRouter = Router();

type RawOrder = typeof orders.$inferSelect;
type RawLine = typeof orderLines.$inferSelect;

function buildOrderEnvelope(o: RawOrder, lines: RawLine[], itemNamesById?: Map<string, string>) {
  const firstLine = lines[0];
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
  const etaMs = o.requestedDeliveryAt.getTime() - o.createdAt.getTime();
  const etaDays = Math.max(1, Math.round(etaMs / 86_400_000));
  return {
    id: o.id,
    // OpenAPI contract fields
    orderNumber: o.orderNo,
    status: o.status,
    fromNodeId: o.supplierId ?? null,
    toNodeId: o.nodeId,
    supplierId: o.supplierId ?? null,
    itemId: firstLine?.itemId ?? "",
    itemName: firstLine ? itemNamesById?.get(firstLine.itemId) ?? firstLine.itemId : "",
    quantity: totalQty,
    priority: o.priority,
    etaDays,
    totalCost: Number(o.totalUsd ?? 0),
    rationale: o.notes ?? null,
    createdAt: o.createdAt.toISOString(),
    createdByRole: null,
    sourceRecommendationId: null,
    // Legacy fields kept for PurchaseOrder/ItemDetail callers
    orderNo: o.orderNo,
    nodeId: o.nodeId,
    requestedDeliveryAt: o.requestedDeliveryAt.toISOString(),
    totalUsd: Number(o.totalUsd ?? 0),
    notes: o.notes,
    lineCount: lines.length,
  };
}

router.get("/orders", async (req, res, next) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const nodeId = typeof req.query.nodeId === "string" ? req.query.nodeId : undefined;
    const limit = Math.min(500, Number(req.query.limit ?? 100) || 100);
    const conds: import("drizzle-orm").SQL[] = [];
    if (status) conds.push(eq(orders.status, status));
    if (nodeId) conds.push(eq(orders.nodeId, nodeId));
    const rows = conds.length
      ? await db.select().from(orders).where(and(...conds)).orderBy(desc(orders.createdAt)).limit(limit)
      : await db.select().from(orders).orderBy(desc(orders.createdAt)).limit(limit);

    const allLines = await db.select().from(orderLines);
    const linesByOrder = new Map<string, RawLine[]>();
    for (const l of allLines) {
      const arr = linesByOrder.get(l.orderId) ?? [];
      arr.push(l);
      linesByOrder.set(l.orderId, arr);
    }

    // Resolve item names for the first-line denormalization
    const { items } = await import("@workspace/db");
    const itemRows = await db.select({ id: items.id, name: items.name }).from(items);
    const itemNamesById = new Map(itemRows.map((i) => [i.id, i.name]));

    res.json(rows.map((o) => buildOrderEnvelope(o, linesByOrder.get(o.id) ?? [], itemNamesById)));
  } catch (err) {
    next(err);
  }
});

// Accept both the legacy multi-line shape and the OpenAPI single-line shape.
const CreateOrderInput = z.union([
  z.object({
    nodeId: z.string(),
    supplierId: z.string(),
    priority: z.string().optional(),
    requestedDeliveryAt: z.string().optional(),
    notes: z.string().optional(),
    lines: z.array(
      z.object({
        itemId: z.string(),
        quantity: z.number().positive(),
        unitPriceUsd: z.number().nonnegative().optional(),
      }),
    ).min(1),
  }),
  z.object({
    toNodeId: z.string(),
    fromNodeId: z.string().nullish(),
    supplierId: z.string().nullish(),
    itemId: z.string(),
    quantity: z.number().positive(),
    priority: z.string(),
    rationale: z.string().nullish(),
    sourceRecommendationId: z.string().nullish(),
  }),
]);

router.post("/orders", async (req, res, next) => {
  try {
    const parsed = CreateOrderInput.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid order body", details: parsed.error.flatten() });
    }
    const body = parsed.data;

    const orderId = `o-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const orderNo = `PO-${new Date().getFullYear()}-${Math.floor(Math.random() * 90000 + 10000)}`;

    const isLegacy = "lines" in body;
    const nodeId = isLegacy ? body.nodeId : body.toNodeId;
    const supplierId = isLegacy ? body.supplierId : (body.supplierId ?? body.fromNodeId ?? "");
    const priority = body.priority ?? "ROUTINE";
    const notes = isLegacy ? body.notes : (body.rationale ?? undefined);
    const requested = isLegacy && body.requestedDeliveryAt
      ? new Date(body.requestedDeliveryAt)
      : new Date(Date.now() + 7 * 86400_000);
    const lineInputs = isLegacy
      ? body.lines
      : [{ itemId: body.itemId, quantity: body.quantity, unitPriceUsd: 0 }];
    const totalUsd = lineInputs.reduce((sum, l) => sum + (l.unitPriceUsd ?? 0) * l.quantity, 0);

    if (!supplierId) {
      return res.status(400).json({ error: "supplierId or fromNodeId required" });
    }

    await db.insert(orders).values({
      id: orderId,
      orderNo,
      nodeId,
      supplierId,
      status: "SUBMITTED",
      priority,
      requestedDeliveryAt: requested,
      totalUsd,
      notes,
    });
    if (lineInputs.length > 0) {
      await db.insert(orderLines).values(
        lineInputs.map((l) => ({
          orderId,
          itemId: l.itemId,
          quantity: l.quantity,
          unitPriceUsd: l.unitPriceUsd ?? 0,
          lineTotalUsd: (l.unitPriceUsd ?? 0) * l.quantity,
        })),
      );
    }
    await db.insert(activityEntries).values({
      kind: "ORDER_CREATED",
      actor: "operator",
      message: `Order ${orderNo} created for ${nodeId}`,
      refType: "order",
      refId: orderId,
      meta: { totalUsd, lines: lineInputs.length },
    });
    invalidateSimCache();

    const [created] = await db.select().from(orders).where(eq(orders.id, orderId));
    const createdLines = await db.select().from(orderLines).where(eq(orderLines.orderId, orderId));
    res.status(201).json(buildOrderEnvelope(created!, createdLines));
  } catch (err) {
    logger.error({ err }, "create order failed");
    next(err);
  }
});

router.get("/orders/:orderId", async (req, res, next) => {
  try {
    const { items, nodes, suppliers } = await import("@workspace/db");
    const id = req.params.orderId;
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    if (!order) return res.status(404).json({ error: "order not found" });
    const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, id));

    // Hydrate fromNode / toNode / item / supplier for the OpenAPI OrderDetail shape.
    const [toNode] = await db.select().from(nodes).where(eq(nodes.id, order.nodeId));
    const [fromNodeRow] = order.supplierId
      ? await db.select().from(nodes).where(eq(nodes.id, order.supplierId))
      : [undefined];
    const firstLine = lines[0];
    const [itemRow] = firstLine
      ? await db.select().from(items).where(eq(items.id, firstLine.itemId))
      : [undefined];
    const [supplierRow] = order.supplierId
      ? await db.select().from(suppliers).where(eq(suppliers.id, order.supplierId))
      : [undefined];

    if (!toNode) return res.status(500).json({ error: "destination node missing for order" });
    if (!itemRow)
      return res.status(500).json({ error: "no line items resolved for order" });

    // Map raw DB rows to OpenAPI envelope shapes.
    const itemEnvelope = {
      ...itemRow,
      unit: itemRow.unitOfIssue,
      usagePerDraw: itemRow.baseDemandPerEvent,
      usageRate: itemRow.wasteAdjustedDemand,
      demandBasis: itemRow.trigger,
    };

    const body: Record<string, unknown> = {
      order: buildOrderEnvelope(order, lines),
      fromNode: fromNodeRow ?? toNode,
      toNode,
      item: itemEnvelope,
      lines,
    };

    if (supplierRow) {
      body.supplier = {
        ...supplierRow,
        region: supplierRow.country,
        countryCode: supplierRow.country,
        leadTimeDays: supplierRow.leadTimeDaysMean,
        reliability: supplierRow.reliabilityScore,
        costIndex: 1,
      };
    }

    res.json(body);
  } catch (err) {
    next(err);
  }
});

const UpdateOrderInput = z.object({ status: z.string().min(1) });

router.patch("/orders/:orderId", async (req, res, next) => {
  try {
    const parsed = UpdateOrderInput.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid status payload", details: parsed.error.flatten() });
    }
    const id = req.params.orderId;
    const status = parsed.data.status;
    await db.update(orders).set({ status }).where(eq(orders.id, id));
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    if (!order) return res.status(404).json({ error: "order not found" });

    if (status === "IN_TRANSIT") {
      const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, id));
      for (const ln of lines) {
        const eta = new Date(Date.now() + 5 * 86400_000);
        await db.insert(shipments).values({
          id: `sh-${id}-${ln.itemId}`,
          orderId: id,
          fromNode: order.supplierId,
          toNode: order.nodeId,
          itemId: ln.itemId,
          quantity: ln.quantity,
          etaAt: eta,
          priority: order.priority,
        });
      }
    }

    await db.insert(activityEntries).values({
      kind: "ORDER_STATUS_CHANGE",
      actor: "operator",
      message: `Order ${order.orderNo} -> ${status}`,
      refType: "order",
      refId: id,
      meta: { status },
    });

    invalidateSimCache();
    const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, id));
    res.json(buildOrderEnvelope(order, lines));
  } catch (err) {
    next(err);
  }
});

export { router as default };
