import { Router, type IRouter } from "express";
import {
  db,
  orders,
  orderLines,
  shipments,
  activityEntries,
  nodes,
  suppliers,
  items,
  recommendations as recsTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { invalidateSimCache } from "../lib/ctx";
import { logger } from "../lib/logger";
import { mapSupplierToApi } from "../lib/mappers";

const router: IRouter = Router();

type RawOrder = typeof orders.$inferSelect;
type RawLine = typeof orderLines.$inferSelect;

interface EnvelopeContext {
  itemNamesById?: Map<string, string>;
  itemUnitsById?: Map<string, string>;
  nodeNamesById?: Map<string, string>;
  supplierNamesById?: Map<string, string>;
}

function buildOrderEnvelope(
  o: RawOrder,
  lines: RawLine[],
  ctx: EnvelopeContext = {},
) {
  const firstLine = lines[0];
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
  const etaMs = o.requestedDeliveryAt.getTime() - o.createdAt.getTime();
  const etaDays = Math.max(1, Math.round(etaMs / 86_400_000));

  const itemId = firstLine?.itemId ?? "";
  const itemName = firstLine
    ? ctx.itemNamesById?.get(firstLine.itemId) ?? firstLine.itemId
    : "";
  const unit = firstLine ? ctx.itemUnitsById?.get(firstLine.itemId) ?? null : null;
  const toNodeName = ctx.nodeNamesById?.get(o.nodeId) ?? null;
  const fromNodeName = o.supplierId ? ctx.nodeNamesById?.get(o.supplierId) ?? null : null;
  const supplierName = o.supplierId
    ? ctx.supplierNamesById?.get(o.supplierId) ?? null
    : null;

  const fromAi = !!o.promotedFromRecommendationId;
  const triggerSource = fromAi ? "ai" : "manual";
  const triggerNote = o.notes ?? null;

  return {
    id: o.id,
    // OpenAPI contract fields
    orderNumber: o.orderNo,
    status: o.status,
    fromNodeId: o.supplierId ?? "",
    fromNodeName,
    toNodeId: o.nodeId,
    toNodeName,
    supplierId: o.supplierId ?? null,
    supplierName,
    itemId,
    itemName,
    unit,
    quantity: totalQty,
    priority: o.priority,
    etaDays,
    requestedDeliveryAt: o.requestedDeliveryAt.toISOString(),
    totalCost: Number(o.totalUsd ?? 0),
    rationale: o.notes ?? null,
    triggerNote,
    triggerSource,
    createdAt: o.createdAt.toISOString(),
    createdByRole: null,
    sourceRecommendationId: o.promotedFromRecommendationId ?? null,
    // Legacy fields kept for PurchaseOrder/ItemDetail callers
    orderNo: o.orderNo,
    nodeId: o.nodeId,
    nodeName: toNodeName,
    totalUsd: Number(o.totalUsd ?? 0),
    notes: o.notes,
    lineCount: lines.length,
  };
}

async function loadEnvelopeContext(): Promise<EnvelopeContext> {
  const [itemRows, nodeRows, supplierRows] = await Promise.all([
    db.select({ id: items.id, name: items.name, unit: items.unitOfIssue }).from(items),
    db.select({ id: nodes.id, name: nodes.name }).from(nodes),
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers),
  ]);
  return {
    itemNamesById: new Map(itemRows.map((i) => [i.id, i.name])),
    itemUnitsById: new Map(itemRows.map((i) => [i.id, i.unit])),
    nodeNamesById: new Map(nodeRows.map((n) => [n.id, n.name])),
    supplierNamesById: new Map(supplierRows.map((s) => [s.id, s.name])),
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

    const ctx = await loadEnvelopeContext();
    res.json(rows.map((o) => buildOrderEnvelope(o, linesByOrder.get(o.id) ?? [], ctx)));
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

    // Validate that every referenced itemId exists in the catalog up-front so
    // we don't silently create orders with dangling item references that later
    // break OrderDetail.
    const requestedItemIds = Array.from(new Set(lineInputs.map((l) => l.itemId)));
    if (requestedItemIds.length > 0) {
      const existing = await db
        .select({ id: items.id })
        .from(items)
        .where(inArray(items.id, requestedItemIds));
      const knownIds = new Set(existing.map((r) => r.id));
      const unknown = requestedItemIds.filter((id) => !knownIds.has(id));
      if (unknown.length > 0) {
        return res.status(400).json({
          error: "unknown itemId",
          message: `No catalog entry exists for itemId(s): ${unknown.join(", ")}`,
          unknownItemIds: unknown,
        });
      }
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
    const ctx = await loadEnvelopeContext();
    res.status(201).json(buildOrderEnvelope(created!, createdLines, ctx));
  } catch (err) {
    logger.error({ err }, "create order failed");
    next(err);
  }
});

router.get("/orders/:orderId", async (req, res, next) => {
  try {
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

    // The first line's item may not exist in the catalog (e.g. an ad-hoc order
    // was created against an unknown itemId). Rather than 500-ing the whole
    // page, synthesize a placeholder Item envelope and signal `itemMissing`
    // so the UI can degrade gracefully (show the itemId, hide item-specific
    // blocks).
    const placeholderItemId = firstLine?.itemId ?? "";
    const itemMissing = !itemRow;
    const itemEnvelope = itemRow
      ? {
          ...itemRow,
          unit: itemRow.unitOfIssue,
          usagePerDraw: itemRow.baseDemandPerEvent,
          usageRate: itemRow.wasteAdjustedDemand,
          demandBasis: itemRow.trigger,
        }
      : {
          id: placeholderItemId,
          name: placeholderItemId || "Unknown item",
          unit: "",
          unitOfIssue: "",
          category: "other",
          classOfSupply: "",
          criticality: "unknown",
          usagePerDraw: 0,
          usageRate: 0,
          demandBasis: "unknown",
          skewFactor: 0,
          leadTimeDays: 0,
          shelfLifeDays: 0,
          baseDemandPerEvent: 0,
          wasteAdjustedDemand: 0,
          trigger: "unknown",
          niinOrSku: "",
        };

    // Resolve item names for line table
    const itemRows = await db.select({ id: items.id, name: items.name, unit: items.unitOfIssue }).from(items);
    const itemNamesById = new Map(itemRows.map((i) => [i.id, i.name]));
    const itemUnitsById = new Map(itemRows.map((i) => [i.id, i.unit]));

    const ctx: EnvelopeContext = {
      itemNamesById,
      itemUnitsById,
      nodeNamesById: new Map<string, string>([
        [toNode.id, toNode.name],
        ...(fromNodeRow ? [[fromNodeRow.id, fromNodeRow.name] as [string, string]] : []),
      ]),
      supplierNamesById: supplierRow
        ? new Map<string, string>([[supplierRow.id, supplierRow.name]])
        : new Map<string, string>(),
    };

    // Activity history for this order
    const activityRows = await db
      .select()
      .from(activityEntries)
      .where(and(eq(activityEntries.refType, "order"), eq(activityEntries.refId, id)))
      .orderBy(desc(activityEntries.ts))
      .limit(50);

    const activity = activityRows.map((r) => ({
      id: r.id,
      kind: r.kind,
      summary: r.message,
      nodeId: null,
      itemId: null,
      orderId: id,
      scenarioId: null,
      actorRole: r.actor,
      createdAt: r.ts.toISOString(),
    }));

    // If promoted from a recommendation, fetch the persisted rec for context
    let recommendation: Record<string, unknown> | undefined;
    if (order.promotedFromRecommendationId) {
      const [rec] = await db
        .select()
        .from(recsTable)
        .where(eq(recsTable.id, order.promotedFromRecommendationId));
      if (rec) {
        recommendation = {
          id: rec.id,
          kind: rec.kind,
          nodeId: rec.nodeId,
          nodeName: ctx.nodeNamesById?.get(rec.nodeId) ?? rec.nodeId,
          itemId: rec.itemId,
          itemName: itemNamesById.get(rec.itemId) ?? rec.itemId,
          quantity: rec.suggestedQty,
          priority: order.priority,
          rationale: rec.reason,
          suggestedSupplierId: rec.sourceSupplierId ?? null,
          suggestedSupplierName: rec.sourceSupplierId
            ? ctx.supplierNamesById?.get(rec.sourceSupplierId) ?? null
            : null,
          suggestedFromNodeId: rec.sourceSupplierId ?? null,
          etaDays: rec.etaDays,
          estimatedCost: 0,
          generatedAt: rec.createdAt.toISOString(),
          confidenceScore: 0,
          scenarioId: null,
          promotedOrderId: rec.promotedOrderId ?? null,
        };
      }
    }

    const linesEnvelope = lines.map((ln) => ({
      id: ln.id,
      itemId: ln.itemId,
      itemName: itemNamesById.get(ln.itemId) ?? ln.itemId,
      unit: itemUnitsById.get(ln.itemId) ?? null,
      quantity: ln.quantity,
      unitPriceUsd: Number(ln.unitPriceUsd ?? 0),
      lineTotalUsd: Number(ln.lineTotalUsd ?? 0),
    }));

    const body: Record<string, unknown> = {
      order: buildOrderEnvelope(order, lines, ctx),
      fromNode: fromNodeRow ?? toNode,
      toNode,
      item: itemEnvelope,
      itemMissing,
      lines: linesEnvelope,
      activity,
    };

    if (supplierRow) {
      body.supplier = mapSupplierToApi(supplierRow);
    }
    if (recommendation) {
      body.recommendation = recommendation;
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
    const ctx = await loadEnvelopeContext();
    res.json(buildOrderEnvelope(order, lines, ctx));
  } catch (err) {
    next(err);
  }
});

export { router as default };
