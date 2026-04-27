import { computeDailyDemand, computeRiskScore, projectDaysOfSupply } from "@workspace/sim";
import { loadSimContext } from "./ctx";
import { db, alerts as alertsTable, shipments as shipmentsTable } from "@workspace/db";
import { and, eq, gte } from "drizzle-orm";

export type RiskNodeSummary = {
  nodeId: string;
  riskScore: number;
  daysOfSupply: number;
  openAlerts: number;
  criticalShortItems: number;
};

export async function computeRiskByNode(): Promise<{
  riskByNode: RiskNodeSummary[];
  operationalState: string;
  focusedHubId: string | null;
}> {
  const { ctx } = await loadSimContext();
  const openAlerts = await db
    .select()
    .from(alertsTable)
    .where(eq(alertsTable.status, "OPEN"));
  const openAlertsByNode = new Map<string, { critical: number; warning: number; total: number }>();
  for (const a of openAlerts) {
    const cur = openAlertsByNode.get(a.nodeId) ?? { critical: 0, warning: 0, total: 0 };
    cur.total += 1;
    if (a.severity === "CRITICAL") cur.critical += 1;
    if (a.severity === "WARNING") cur.warning += 1;
    openAlertsByNode.set(a.nodeId, cur);
  }

  const onHandByKey = new Map<string, number>();
  for (const b of ctx.balances) onHandByKey.set(`${b.nodeId}:${b.itemId}`, b.onHand);

  const riskByNode: RiskNodeSummary[] = ctx.nodes.map((node) => {
    const profile = ctx.profiles.get(node.id);
    if (!profile) {
      return {
        nodeId: node.id,
        riskScore: 0,
        daysOfSupply: 999,
        openAlerts: openAlertsByNode.get(node.id)?.total ?? 0,
        criticalShortItems: 0,
      };
    }
    const state = ctx.states.get(profile.operationalState);
    const demands = computeDailyDemand({
      profile,
      items: ctx.items,
      operationalState: state,
      itemSkew: ctx.itemSkew,
    });
    let critShort = 0;
    let minDos = 999;
    for (const dem of demands) {
      const onHand = onHandByKey.get(`${node.id}:${dem.itemId}`) ?? 0;
      const dos = projectDaysOfSupply(onHand, dem.quantity);
      if (dos < minDos) minDos = dos;
      if (dos <= ctx.criticalDays) critShort++;
    }
    const alertsForNode = openAlertsByNode.get(node.id) ?? { critical: 0, warning: 0, total: 0 };
    const score = computeRiskScore({
      daysOfSupply: minDos,
      criticalShortItems: critShort,
      openAlertsCritical: alertsForNode.critical,
      openAlertsWarning: alertsForNode.warning,
      upstreamRouteDelayDays: 0,
      routeReliability: 0.9,
    });
    return {
      nodeId: node.id,
      riskScore: score,
      daysOfSupply: Number.isFinite(minDos) ? Number(minDos.toFixed(1)) : 999,
      openAlerts: alertsForNode.total,
      criticalShortItems: critShort,
    };
  });

  const sorted = [...riskByNode].sort((a, b) => b.riskScore - a.riskScore);
  const focusedHubId = sorted[0]?.nodeId ?? null;

  return {
    riskByNode,
    operationalState: "HEIGHTENED",
    focusedHubId,
  };
}

export async function computeInFlightShipments() {
  const now = new Date();
  const recent = await db
    .select()
    .from(shipmentsTable)
    .where(and(gte(shipmentsTable.etaAt, now)));
  return recent.map((s) => {
    const totalMs = s.etaAt.getTime() - s.departedAt.getTime();
    const elapsedMs = now.getTime() - s.departedAt.getTime();
    const progress = totalMs > 0 ? Math.max(0, Math.min(1, elapsedMs / totalMs)) : 0;
    const etaDays =
      Math.max(0, (s.etaAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return {
      id: s.id,
      fromNode: s.fromNode,
      toNode: s.toNode,
      itemId: s.itemId,
      itemName: s.itemId,
      quantity: s.quantity,
      etaDays: Number(etaDays.toFixed(2)),
      progress: Number(progress.toFixed(3)),
      priority: s.priority,
    };
  });
}

export const THREATS = [
  {
    id: "th-typhoon-luzon",
    label: "Typhoon Yagi-class system tracking NW of Luzon",
    severity: "WATCH",
    polygon: [
      [118.5, 18.0],
      [122.0, 18.0],
      [122.0, 21.5],
      [118.5, 21.5],
      [118.5, 18.0],
    ] as number[][],
  },
  {
    id: "th-scs-contested",
    label: "Contested logistics corridor — South China Sea",
    severity: "WARNING",
    polygon: [
      [113.0, 9.0],
      [120.0, 9.0],
      [120.0, 16.0],
      [113.0, 16.0],
      [113.0, 9.0],
    ] as number[][],
  },
  {
    id: "th-strait-tw",
    label: "Taiwan Strait freedom-of-navigation activity",
    severity: "WARNING",
    polygon: [
      [118.5, 22.5],
      [122.5, 22.5],
      [122.5, 26.0],
      [118.5, 26.0],
      [118.5, 22.5],
    ] as number[][],
  },
];
