import { Router, type IRouter } from "express";
import { db, alerts, activityEntries, items, inventoryBalances, nodes } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { computeRiskByNode, computeInFlightShipments } from "../lib/snapshot";
import { loadSimContext } from "../lib/ctx";
import {
  computeDailyDemand,
  generateRecommendations,
  projectDaysOfSupply,
  statusFromDOS,
} from "@workspace/sim";

const router: IRouter = Router();

router.get("/dashboard/overview", async (_req, res, next) => {
  try {
    const [risk, shipments, ctx, openAlerts, recentActivity, nodeRows] =
      await Promise.all([
        computeRiskByNode(),
        computeInFlightShipments(),
        loadSimContext(),
        db.select().from(alerts).where(eq(alerts.status, "OPEN")),
        db.select().from(activityEntries).orderBy(desc(activityEntries.ts)).limit(10),
        db.select().from(nodes),
      ]);

    const nodeNameMap = new Map(nodeRows.map((n) => [n.id, n.name]));
    const recs = generateRecommendations({
      nodes: ctx.ctx.nodes,
      routes: ctx.ctx.routes,
      items: ctx.ctx.items,
      balances: ctx.ctx.balances,
      profiles: ctx.ctx.profiles,
      states: ctx.ctx.states,
      suppliers: ctx.suppliers,
      itemSkew: ctx.ctx.itemSkew,
      watchDays: ctx.ctx.watchDays,
      criticalDays: ctx.ctx.criticalDays,
      paddingDays: ctx.paddingDays,
    });
    const totalDOS = risk.riskByNode
      .filter((r) => r.daysOfSupply < 999)
      .reduce((s, r) => s + r.daysOfSupply, 0);
    const denomDOS = risk.riskByNode.filter((r) => r.daysOfSupply < 999).length;
    const theaterDOS = denomDOS > 0 ? totalDOS / denomDOS : 0;
    const critAlerts = openAlerts.filter((a) => a.severity === "CRITICAL").length;

    const top5 = [...risk.riskByNode]
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 5)
      .map((r) => ({
        nodeId: r.nodeId,
        name: nodeNameMap.get(r.nodeId) ?? r.nodeId,
        riskScore: r.riskScore,
        daysOfSupply: r.daysOfSupply,
        openAlerts: r.openAlerts,
        criticalShortItems: r.criticalShortItems,
      }));

    res.json({
      kpis: {
        openCriticalAlerts: critAlerts,
        openAlertsTotal: openAlerts.length,
        theaterDaysOfSupply: Number(theaterDOS.toFixed(1)),
        shipmentsInFlight: shipments.length,
        recommendationsAwaitingPromotion: recs.length,
        nodesAtCritical: risk.riskByNode.filter((r) => r.riskScore >= 70).length,
      },
      riskHubs: top5,
      recentActivity: recentActivity.map((a) => ({
        id: a.id,
        ts: a.ts.toISOString(),
        kind: a.kind,
        actor: a.actor,
        message: a.message,
        refType: a.refType,
        refId: a.refId,
      })),
      operationalState: risk.operationalState,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/risk", async (_req, res, next) => {
  try {
    const [risk, ctx, balanceRows, openAlerts] = await Promise.all([
      computeRiskByNode(),
      loadSimContext(),
      db.select().from(inventoryBalances),
      db.select().from(alerts).where(eq(alerts.status, "OPEN")),
    ]);

    const nodeNameMap = new Map(ctx.ctx.nodes.map((n) => [n.id, n.name]));
    const itemNameMap = new Map(ctx.ctx.items.map((i) => [i.id, i.name]));

    const burnByNodeItem = new Map<string, number>();
    for (const node of ctx.ctx.nodes) {
      const profile = ctx.ctx.profiles.get(node.id);
      if (!profile) continue;
      const demands = computeDailyDemand({
        profile,
        items: ctx.ctx.items,
        operationalState: ctx.ctx.states.get(profile.operationalState),
        itemSkew: ctx.ctx.itemSkew,
      });
      for (const d of demands) burnByNodeItem.set(`${node.id}:${d.itemId}`, d.quantity);
    }

    const itemAgg = new Map<string, { criticalNodes: number; minDOS: number; totalOnHand: number }>();
    for (const b of balanceRows) {
      const burn = burnByNodeItem.get(`${b.nodeId}:${b.itemId}`) ?? 0;
      const dos = projectDaysOfSupply(b.onHand, burn);
      const cur = itemAgg.get(b.itemId) ?? { criticalNodes: 0, minDOS: 999, totalOnHand: 0 };
      if (dos <= ctx.ctx.criticalDays) cur.criticalNodes++;
      if (dos < cur.minDOS) cur.minDOS = dos;
      cur.totalOnHand += b.onHand;
      itemAgg.set(b.itemId, cur);
    }

    const byCategory = new Map<string, number>();
    for (const a of openAlerts) {
      byCategory.set(a.category, (byCategory.get(a.category) ?? 0) + 1);
    }

    res.json({
      byNode: risk.riskByNode
        .map((r) => ({
          nodeId: r.nodeId,
          name: nodeNameMap.get(r.nodeId) ?? r.nodeId,
          riskScore: r.riskScore,
          daysOfSupply: r.daysOfSupply,
          openAlerts: r.openAlerts,
          criticalShortItems: r.criticalShortItems,
        }))
        .sort((a, b) => b.riskScore - a.riskScore),
      byItem: Array.from(itemAgg.entries())
        .map(([id, v]) => ({
          itemId: id,
          itemName: itemNameMap.get(id) ?? id,
          criticalNodes: v.criticalNodes,
          minDaysOfSupply: Number((v.minDOS === 999 ? 999 : v.minDOS).toFixed(1)),
          totalOnHand: Number(v.totalOnHand.toFixed(0)),
          status: statusFromDOS(v.minDOS, ctx.ctx.watchDays, ctx.ctx.criticalDays),
        }))
        .sort((a, b) => a.minDaysOfSupply - b.minDaysOfSupply),
      byCategory: Array.from(byCategory.entries()).map(([category, count]) => ({
        category,
        count,
      })),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
