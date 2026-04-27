import { Router, type IRouter } from "express";
import { db, items, inventoryBalances, suppliers, orders, orderLines } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { loadSimContext } from "../lib/ctx";
import { computeDailyDemand, projectDaysOfSupply, statusFromDOS } from "@workspace/sim";

const router: IRouter = Router();

router.get("/items", async (_req, res, next) => {
  try {
    const rows = await db.select().from(items);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/items/:itemId", async (req, res, next) => {
  try {
    const itemId = req.params.itemId;
    const [item] = await db.select().from(items).where(eq(items.id, itemId));
    if (!item) return res.status(404).json({ error: "item not found" });
    const ctx = await loadSimContext();
    const balanceRows = await db
      .select()
      .from(inventoryBalances)
      .where(eq(inventoryBalances.itemId, itemId));
    const balanceByNode = new Map(balanceRows.map((b) => [b.nodeId, b.onHand]));

    const dosByNode = ctx.ctx.nodes.map((node) => {
      const profile = ctx.ctx.profiles.get(node.id);
      const demand = profile
        ? computeDailyDemand({
            profile,
            items: ctx.ctx.items,
            operationalState: ctx.ctx.states.get(profile.operationalState),
            itemSkew: ctx.ctx.itemSkew,
          }).find((d) => d.itemId === itemId)?.quantity ?? 0
        : 0;
      const onHand = balanceByNode.get(node.id) ?? 0;
      const dos = projectDaysOfSupply(onHand, demand);
      return {
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        latitude: node.latitude,
        longitude: node.longitude,
        onHand,
        dailyBurn: Number(demand.toFixed(2)),
        daysOfSupply: Number(dos.toFixed(1)),
        status: statusFromDOS(dos, ctx.ctx.watchDays, ctx.ctx.criticalDays),
      };
    });

    const supplierRows = await db.select().from(suppliers);

    const recentOrderRows = await db
      .select({
        orderId: orders.id,
        orderNo: orders.orderNo,
        nodeId: orders.nodeId,
        supplierId: orders.supplierId,
        status: orders.status,
        priority: orders.priority,
        createdAt: orders.createdAt,
        quantity: orderLines.quantity,
      })
      .from(orderLines)
      .innerJoin(orders, eq(orderLines.orderId, orders.id))
      .where(eq(orderLines.itemId, itemId))
      .orderBy(sql`${orders.createdAt} DESC`)
      .limit(20);

    res.json({
      item,
      dosByNode,
      suppliers: supplierRows,
      recentOrders: recentOrderRows.map((o) => ({
        ...o,
        createdAt: o.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
