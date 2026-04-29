import { Router, type IRouter } from "express";
import { db, alerts, activityEntries, items, inventoryBalances, nodes, orders } from "@workspace/db";
import { desc, eq, ne, and } from "drizzle-orm";
import { computeRiskByNode, computeInFlightShipments } from "../lib/snapshot";
import { loadSimContext } from "../lib/ctx";
import { computeTheaterBloodReadiness } from "../lib/blood-readiness";
import {
  computeDailyDemand,
  generateRecommendations,
  projectDaysOfSupply,
  statusFromDOS,
} from "@workspace/sim";

const router: IRouter = Router();

router.get("/dashboard/overview", async (_req, res, next) => {
  try {
    const [risk, shipments, ctx, openAlerts, recentActivity, nodeRows, openOrders, bloodReadiness] =
      await Promise.all([
        computeRiskByNode(),
        computeInFlightShipments(),
        loadSimContext(),
        db.select().from(alerts).where(eq(alerts.status, "OPEN")),
        db.select().from(activityEntries).orderBy(desc(activityEntries.ts)).limit(10),
        // Hide supply-demo placeholder nodes from the dashboard map widget;
        // they have no real geography and are kept invisible by design.
        db.select().from(nodes).where(eq(nodes.hiddenFromMap, false)),
        db
          .select()
          .from(orders)
          .where(and(ne(orders.status, "DELIVERED"), ne(orders.status, "CANCELLED"))),
        computeTheaterBloodReadiness(),
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
    const warnAlerts = openAlerts.filter((a) => a.severity === "WARN" || a.severity === "WARNING").length;

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

    // Synthetic 14-day DOS trend (deterministic, gentle slope down then recovery).
    const dosTrend = Array.from({ length: 14 }, (_, i) => {
      const day = i + 1;
      const factor = 1 - Math.sin((day / 14) * Math.PI) * 0.08;
      return {
        day,
        value: Number(Math.max(1, theaterDOS * factor).toFixed(2)),
        label: day === 1 ? "today" : day === 14 ? "+14d" : null,
      };
    });

    // Alert counts by severity in the OpenAPI shape.
    const sevCounts = new Map<string, number>();
    for (const a of openAlerts) {
      const sev = a.severity ?? "UNKNOWN";
      sevCounts.set(sev, (sevCounts.get(sev) ?? 0) + 1);
    }
    const alertCountsBySeverity = Array.from(sevCounts.entries()).map(([severity, count]) => ({
      severity,
      count,
    }));

    res.json({
      // OpenAPI top-level required fields
      networkDaysOfSupply: Number(theaterDOS.toFixed(1)),
      openCriticalAlerts: critAlerts,
      openWarnAlerts: warnAlerts,
      totalNodes: nodeRows.length,
      inFlightShipments: shipments.length,
      openOrders: openOrders.length,
      pendingRecommendations: recs.length,
      kpis: {
        openCriticalAlerts: critAlerts,
        openAlertsTotal: openAlerts.length,
        theaterDaysOfSupply: Number(theaterDOS.toFixed(1)),
        shipmentsInFlight: shipments.length,
        recommendationsAwaitingPromotion: recs.length,
        nodesAtCritical: risk.riskByNode.filter((r) => r.riskScore >= 70).length,
      },
      dosTrend,
      alertCountsBySeverity,
      // Legacy fields kept for the existing dashboard UI
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
      bloodReadiness,
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

    const nodeMap = new Map(ctx.ctx.nodes.map((n) => [n.id, n]));
    const itemMap = new Map(ctx.ctx.items.map((i) => [i.id, i]));

    // Restrict to items that actually appear in inventory_balances —
    // anything else has no on-hand here and would just emit DOS sentinels.
    // Critical for perf with the activated supply demo catalog (~60k items).
    const itemsWithBalance = new Set<string>();
    for (const b of balanceRows) itemsWithBalance.add(b.itemId);
    const filteredItems = ctx.ctx.items.filter((i) => itemsWithBalance.has(i.id));
    const burnByNodeItem = new Map<string, number>();
    for (const node of ctx.ctx.nodes) {
      const profile = ctx.ctx.profiles.get(node.id);
      if (!profile) continue;
      const demands = computeDailyDemand({
        profile,
        items: filteredItems,
        operationalState: ctx.ctx.states.get(profile.operationalState),
        itemSkew: ctx.ctx.itemSkew,
        historicalBurnByItem: ctx.historicalBurn.get(node.id),
      });
      for (const d of demands) burnByNodeItem.set(`${node.id}:${d.itemId}`, d.quantity);
    }

    const itemAgg = new Map<
      string,
      { criticalNodes: number; minDOS: number; totalOnHand: number; totalBurn: number }
    >();
    for (const b of balanceRows) {
      const burn = burnByNodeItem.get(`${b.nodeId}:${b.itemId}`) ?? 0;
      const dos = projectDaysOfSupply(b.onHand, burn);
      const cur = itemAgg.get(b.itemId) ?? {
        criticalNodes: 0,
        minDOS: 999,
        totalOnHand: 0,
        totalBurn: 0,
      };
      if (dos <= ctx.ctx.criticalDays) cur.criticalNodes++;
      if (dos < cur.minDOS) cur.minDOS = dos;
      cur.totalOnHand += b.onHand;
      cur.totalBurn += burn;
      itemAgg.set(b.itemId, cur);
    }

    const byCategory = new Map<string, number>();
    for (const a of openAlerts) {
      byCategory.set(a.category, (byCategory.get(a.category) ?? 0) + 1);
    }

    // OpenAPI shapes
    const topRiskNodes = [...risk.riskByNode]
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 10)
      .map((r) => {
        const n = nodeMap.get(r.nodeId);
        return {
          nodeId: r.nodeId,
          name: n?.name ?? r.nodeId,
          type: n?.type ?? "unknown",
          regionalHub: n?.regionalHub ?? null,
          daysOfSupply: r.daysOfSupply,
          openAlerts: r.openAlerts,
          riskScore: r.riskScore,
        };
      });

    const topRiskItems = Array.from(itemAgg.entries())
      .map(([id, v]) => {
        const it = itemMap.get(id);
        const networkDOS =
          v.totalBurn > 0.0001 ? Number((v.totalOnHand / v.totalBurn).toFixed(1)) : 999;
        return {
          itemId: id,
          itemName: it?.name ?? id,
          networkDaysOfSupply: networkDOS,
          criticality: it?.criticality ?? "medium",
          atRiskNodeCount: v.criticalNodes,
        };
      })
      .sort((a, b) => a.networkDaysOfSupply - b.networkDaysOfSupply)
      .slice(0, 15);

    const predictedShortagesNext7d = Array.from(itemAgg.values()).filter(
      (v) => v.minDOS <= 7,
    ).length;

    // Hub aggregation: group nodes by regionalHub (or by node id if it is itself a hub)
    const hubAgg = new Map<
      string,
      { siteCount: number; dosSum: number; dosCount: number; name: string }
    >();
    for (const n of ctx.ctx.nodes) {
      const hubId = n.regionalHub ?? n.id;
      const cur = hubAgg.get(hubId) ?? {
        siteCount: 0,
        dosSum: 0,
        dosCount: 0,
        name: nodeMap.get(hubId)?.name ?? hubId,
      };
      cur.siteCount++;
      const r = risk.riskByNode.find((x) => x.nodeId === n.id);
      if (r && r.daysOfSupply < 999) {
        cur.dosSum += r.daysOfSupply;
        cur.dosCount++;
      }
      hubAgg.set(hubId, cur);
    }
    const byHub = Array.from(hubAgg.entries()).map(([hubId, v]) => ({
      hubId,
      hubName: v.name,
      daysOfSupply: v.dosCount > 0 ? Number((v.dosSum / v.dosCount).toFixed(1)) : 0,
      siteCount: v.siteCount,
    }));

    res.json({
      // OpenAPI required
      topRiskNodes,
      topRiskItems,
      predictedShortagesNext7d,
      byHub,
      // Legacy fields kept additively
      byNode: topRiskNodes.map((r) => ({
        nodeId: r.nodeId,
        name: r.name,
        riskScore: r.riskScore,
        daysOfSupply: r.daysOfSupply,
        openAlerts: r.openAlerts,
        criticalShortItems: 0,
      })),
      byItem: Array.from(itemAgg.entries())
        .map(([id, v]) => ({
          itemId: id,
          itemName: itemMap.get(id)?.name ?? id,
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
