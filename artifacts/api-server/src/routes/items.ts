import { Router, type IRouter } from "express";
import { db, items, inventoryBalances, suppliers, supplierItems, orders, orderLines, alerts } from "@workspace/db";
import { eq, sql, and, or, ilike } from "drizzle-orm";
import { loadSimContext } from "../lib/ctx";
import { computeDailyDemand, projectDaysOfSupply, statusFromDOS } from "@workspace/sim";
import { mapSupplierToApi } from "../lib/mappers";

const router: IRouter = Router();

router.get("/items", async (req, res, next) => {
  try {
    // Optional filters keep the dropdown payload manageable now that the
    // promoted catalog can balloon the items table to ~62k rows.
    //
    //   ?source=seed|supply_demo_v2   filter by provenance
    //   ?search=...                   ILIKE on name / mfr_cat_no / ndc
    //   ?limit=N                      cap result size (default 500, max 5000)
    //   ?offset=N                     paginate
    const sourceParam = typeof req.query.source === "string" ? req.query.source : undefined;
    const searchParam = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const limitRaw = Number.parseInt(String(req.query.limit ?? "500"), 10);
    const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 500, 5000));
    const offsetRaw = Number.parseInt(String(req.query.offset ?? "0"), 10);
    const offset = Math.max(0, Number.isFinite(offsetRaw) ? offsetRaw : 0);

    const conditions = [] as Parameters<typeof and>[number][];
    if (sourceParam) conditions.push(eq(items.source, sourceParam));
    if (searchParam) {
      const like = `%${searchParam}%`;
      conditions.push(
        or(
          ilike(items.name, like),
          ilike(items.mfrCatNo, like),
          ilike(items.ndc, like),
        ) as Parameters<typeof and>[number],
      );
    }

    const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;
    const baseQuery = db.select().from(items);
    const rows = await (whereExpr ? baseQuery.where(whereExpr) : baseQuery)
      .limit(limit)
      .offset(offset);
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
      const historicalBurnByItem = ctx.historicalBurn.get(node.id);
      const demand = profile
        ? computeDailyDemand({
            profile,
            items: ctx.ctx.items,
            operationalState: ctx.ctx.states.get(profile.operationalState),
            itemSkew: ctx.ctx.itemSkew,
            historicalBurnByItem,
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
    const coverageRows = await db
      .select({ supplierId: supplierItems.supplierId })
      .from(supplierItems)
      .where(eq(supplierItems.itemId, itemId));
    const carryingSupplierIds = new Set(coverageRows.map((r) => r.supplierId));

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

    // Aggregates (match OpenAPI ItemDetail contract)
    const totalOnHand = dosByNode.reduce((s, n) => s + n.onHand, 0);
    const totalDailyBurn = dosByNode.reduce((s, n) => s + n.dailyBurn, 0);
    const networkDaysOfSupply = totalDailyBurn > 0.0001
      ? Number((totalOnHand / totalDailyBurn).toFixed(1))
      : 999;
    const perNode = dosByNode.map((n) => ({
      nodeId: n.nodeId,
      nodeName: n.nodeName,
      itemId,
      itemName: item.name,
      unit: item.unitOfIssue,
      criticality: item.criticality,
      quantityOnHand: n.onHand,
      dailyBurn: n.dailyBurn,
      daysOfSupply: n.daysOfSupply,
      status: n.status,
    }));
    const itemAlerts = await db
      .select()
      .from(alerts)
      .where(and(eq(alerts.itemId, itemId), eq(alerts.status, "OPEN")))
      .limit(50);

    // Synthesize a flat usage rate for the OpenAPI Item shape consumers
    const itemEnvelope = {
      ...item,
      unit: item.unitOfIssue,
      usagePerDraw: item.baseDemandPerEvent,
      usageRate: Number(totalDailyBurn.toFixed(2)),
      demandBasis: item.trigger,
    };

    res.json({
      item: itemEnvelope,
      totalOnHand,
      networkDaysOfSupply,
      perNode,
      dosByNode,
      suppliers: supplierRows.map((s) =>
        mapSupplierToApi(s, carryingSupplierIds.has(s.id) ? [item.id] : []),
      ),
      alerts: itemAlerts,
      recommendations: [],
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
