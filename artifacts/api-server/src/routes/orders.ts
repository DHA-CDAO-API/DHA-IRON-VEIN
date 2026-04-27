import { Router, type IRouter } from "express";
import {
  db,
  orders,
  orderLines,
  shipments,
  recommendations,
  activityEntries,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { invalidateSimCache } from "../lib/ctx";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/orders", async (req, res, next) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const nodeId = typeof req.query.nodeId === "string" ? req.query.nodeId : undefined;
    const limit = Math.min(500, Number(req.query.limit ?? 100) || 100);
    const conds = [];
    if (status) conds.push(eq(orders.status, status));
    if (nodeId) conds.push(eq(orders.nodeId, nodeId));
    const rows = conds.length
      ? await db.select().from(orders).where(and(...conds)).orderBy(desc(orders.createdAt)).limit(limit)
      : await db.select().from(orders).orderBy(desc(orders.createdAt)).limit(limit);

    const lineCounts = await db
      .select({ orderId: orderLines.orderId })
      .from(orderLines);
    const counts = new Map<string, number>();
    for (const l of lineCounts) counts.set(l.orderId, (counts.get(l.orderId) ?? 0) + 1);

    res.json(
      rows.map((o) => ({
        ...o,
        createdAt: o.createdAt.toISOString(),
        requestedDeliveryAt: o.requestedDeliveryAt.toISOString(),
        lineCount: counts.get(o.id) ?? 0,
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.post("/orders", async (req, res, next) => {
  try {
    const body = req.body as {
      nodeId: string;
      supplierId: string;
      priority?: string;
      requestedDeliveryAt?: string;
      notes?: string;
      lines: Array<{ itemId: string; quantity: number; unitPriceUsd?: number }>;
    };
    const orderId = `o-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const orderNo = `PO-${new Date().getFullYear()}-${Math.floor(Math.random() * 90000 + 10000)}`;
    const requested = body.requestedDeliveryAt ? new Date(body.requestedDeliveryAt) : new Date(Date.now() + 7 * 86400_000);
    const totalUsd = body.lines.reduce((sum, l) => sum + (l.unitPriceUsd ?? 0) * l.quantity, 0);

    await db.insert(orders).values({
      id: orderId,
      orderNo,
      nodeId: body.nodeId,
      supplierId: body.supplierId,
      status: "SUBMITTED",
      priority: body.priority ?? "ROUTINE",
      requestedDeliveryAt: requested,
      totalUsd,
      notes: body.notes,
    });
    if (body.lines.length > 0) {
      await db.insert(orderLines).values(
        body.lines.map((l) => ({
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
      message: `Order ${orderNo} created for ${body.nodeId}`,
      refType: "order",
      refId: orderId,
      meta: { totalUsd, lines: body.lines.length },
    });
    invalidateSimCache();
    res.status(201).json({
      id: orderId,
      orderNo,
      nodeId: body.nodeId,
      supplierId: body.supplierId,
      status: "SUBMITTED",
      priority: body.priority ?? "ROUTINE",
      createdAt: new Date().toISOString(),
      requestedDeliveryAt: requested.toISOString(),
      totalUsd,
      lineCount: body.lines.length,
    });
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
    res.json({
      order: {
        ...order,
        createdAt: order.createdAt.toISOString(),
        requestedDeliveryAt: order.requestedDeliveryAt.toISOString(),
        lineCount: lines.length,
      },
      lines,
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/orders/:orderId", async (req, res, next) => {
  try {
    const id = req.params.orderId;
    const status = (req.body as { status: string }).status;
    const update: Record<string, unknown> = { status };
    await db.update(orders).set(update).where(eq(orders.id, id));
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
    res.json({
      ...order,
      status,
      createdAt: order.createdAt.toISOString(),
      requestedDeliveryAt: order.requestedDeliveryAt.toISOString(),
      lineCount: 0,
    });
  } catch (err) {
    next(err);
  }
});

export { router as default };
