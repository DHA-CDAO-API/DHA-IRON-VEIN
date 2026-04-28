import { Router, type IRouter } from "express";
import {
  db,
  nodes,
  inventoryBalances,
  alerts,
  orders,
  items as itemsTable,
  demandProfiles,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { computeRiskByNode } from "../lib/snapshot";
import { loadSimContext } from "../lib/ctx";
import { computeNodeBloodReadiness } from "../lib/blood-readiness";
import { computeDailyDemand, projectDaysOfSupply, statusFromDOS, generateRecommendations } from "@workspace/sim";

const router: IRouter = Router();

router.get("/sites", async (_req, res, next) => {
  try {
    const [nodeRows, risk] = await Promise.all([db.select().from(nodes), computeRiskByNode()]);
    const riskMap = new Map(risk.riskByNode.map((r) => [r.nodeId, r]));
    res.json(
      nodeRows.map((n) => {
        const r = riskMap.get(n.id);
        return {
          nodeId: n.id,
          name: n.name,
          type: n.type,
          regionalHub: n.regionalHub,
          daysOfSupply: r?.daysOfSupply ?? 999,
          openAlerts: r?.openAlerts ?? 0,
          riskScore: r?.riskScore ?? 0,
          criticalShortItems: r?.criticalShortItems ?? 0,
          latitude: n.latitude,
          longitude: n.longitude,
        };
      }),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/sites/:nodeId", async (req, res, next) => {
  try {
    const nodeId = req.params.nodeId;
    const [nodeRow] = await db.select().from(nodes).where(eq(nodes.id, nodeId));
    if (!nodeRow) return res.status(404).json({ error: "node not found" });

    const [balanceRows, alertRows, orderRows, allItems, profileRow, ctx, bloodReadiness] =
      await Promise.all([
        db.select().from(inventoryBalances).where(eq(inventoryBalances.nodeId, nodeId)),
        db
          .select()
          .from(alerts)
          .where(and(eq(alerts.nodeId, nodeId), eq(alerts.status, "OPEN"))),
        db
          .select()
          .from(orders)
          .where(eq(orders.nodeId, nodeId))
          .orderBy(desc(orders.createdAt))
          .limit(20),
        db.select().from(itemsTable),
        db.select().from(demandProfiles).where(eq(demandProfiles.nodeId, nodeId)),
        loadSimContext(),
        computeNodeBloodReadiness(nodeId),
      ]);

    const profile = profileRow[0];
    const dailyDemand = profile
      ? computeDailyDemand({
          profile,
          items: ctx.ctx.items,
          operationalState: ctx.ctx.states.get(profile.operationalState),
          itemSkew: ctx.ctx.itemSkew,
        })
      : [];
    const demandByItem = new Map(dailyDemand.map((d) => [d.itemId, d.quantity]));

    const itemNameById = new Map(allItems.map((i) => [i.id, i]));
    const balances = balanceRows.map((b) => {
      const it = itemNameById.get(b.itemId);
      const burn = demandByItem.get(b.itemId) ?? 0;
      const dos = projectDaysOfSupply(b.onHand, burn);
      return {
        id: b.id,
        nodeId: b.nodeId,
        itemId: b.itemId,
        itemName: it?.name ?? b.itemId,
        unitOfIssue: it?.unitOfIssue ?? "ea",
        onHand: b.onHand,
        dueIn: b.dueIn,
        dueOut: b.dueOut,
        allocated: b.allocated,
        lastCountedAt: b.lastCountedAt.toISOString(),
        daysOfSupply: Number(dos.toFixed(1)),
        status: statusFromDOS(dos, ctx.ctx.watchDays, ctx.ctx.criticalDays),
      };
    });

    const dosByItem = balances.map((b) => ({
      itemId: b.itemId,
      itemName: b.itemName,
      unit: b.unitOfIssue,
      onHand: b.onHand,
      dailyBurn: Number((demandByItem.get(b.itemId) ?? 0).toFixed(2)),
      daysOfSupply: b.daysOfSupply,
      status: b.status,
    }));

    const recs = generateRecommendations({
      nodes: [nodeRow],
      routes: ctx.ctx.routes,
      items: ctx.ctx.items,
      balances: balanceRows.map((b) => ({
        nodeId: b.nodeId,
        itemId: b.itemId,
        onHand: b.onHand,
        dueIn: b.dueIn,
      })),
      profiles: ctx.ctx.profiles,
      states: ctx.ctx.states,
      suppliers: ctx.suppliers,
      itemSkew: ctx.ctx.itemSkew,
      watchDays: ctx.ctx.watchDays,
      criticalDays: ctx.ctx.criticalDays,
      paddingDays: ctx.paddingDays,
    });

    const history = buildSyntheticHistory(nodeId, dailyDemand);

    res.json({
      node: nodeRow,
      demandProfile: profile ?? null,
      balances,
      dosByItem,
      alerts: alertRows.map((a) => ({
        ...a,
        openedAt: a.openedAt.toISOString(),
        ackedAt: a.ackedAt ? a.ackedAt.toISOString() : null,
        resolvedAt: a.resolvedAt ? a.resolvedAt.toISOString() : null,
      })),
      recentOrders: orderRows.map((o) => ({
        ...o,
        createdAt: o.createdAt.toISOString(),
        requestedDeliveryAt: o.requestedDeliveryAt.toISOString(),
        lineCount: 0,
      })),
      recommendations: recs.map((r) => ({
        ...r,
        status: "OPEN",
        createdAt: new Date().toISOString(),
      })),
      history,
      bloodReadiness,
    });
  } catch (err) {
    next(err);
  }
});

function buildSyntheticHistory(
  nodeId: string,
  dailyDemand: { itemId: string; quantity: number }[],
) {
  const out: Array<{ date: string; demand: number; consumption: number }> = [];
  const today = new Date();
  const totalDaily = dailyDemand.reduce((s, d) => s + d.quantity, 0);
  for (let i = 30; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const noise = ((Math.sin((i + nodeId.length) * 0.7) + 1) / 2) * 0.4 + 0.8;
    out.push({
      date: d.toISOString().slice(0, 10),
      demand: Number((totalDaily * noise).toFixed(1)),
      consumption: Number((totalDaily * noise * 0.95).toFixed(1)),
    });
  }
  return out;
}

export default router;
