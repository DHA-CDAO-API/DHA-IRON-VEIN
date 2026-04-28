import { computeDailyDemand, computeRiskScore, projectDaysOfSupply } from "@workspace/sim";
import { loadSimContext } from "./ctx";
import {
  db,
  alerts as alertsTable,
  shipments as shipmentsTable,
  orders as ordersTable,
  orderLines as orderLinesTable,
  items as itemsTable,
  routes as routesTable,
} from "@workspace/db";
import { and, desc, eq, gte } from "drizzle-orm";

export type ThreatTier = "nominal" | "heightened" | "critical";

export type RiskNodeSummary = {
  nodeId: string;
  riskScore: number;
  daysOfSupply: number;
  openAlerts: number;
  criticalShortItems: number;
  tier: ThreatTier;
  dosByCategory: Record<string, number>;
  topCriticalItems: Array<{
    itemId: string;
    itemName: string;
    category: string;
    daysOfSupply: number;
    onHand: number;
  }>;
  lastShipmentInAt: string | null;
  lastShipmentOutAt: string | null;
};

export function deriveTier(args: {
  riskScore: number;
  openAlertsCritical: number;
  openAlertsWarning: number;
}): ThreatTier {
  if (args.riskScore >= 70 || args.openAlertsCritical > 0) return "critical";
  if (args.riskScore >= 35 || args.openAlertsWarning > 0) return "heightened";
  return "nominal";
}

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

  // Last shipment in / out per node
  const recentShipments = await db
    .select()
    .from(shipmentsTable)
    .orderBy(desc(shipmentsTable.departedAt))
    .limit(800);
  const lastInByNode = new Map<string, Date>();
  const lastOutByNode = new Map<string, Date>();
  for (const s of recentShipments) {
    if (!lastInByNode.has(s.toNode)) lastInByNode.set(s.toNode, s.departedAt);
    if (!lastOutByNode.has(s.fromNode)) lastOutByNode.set(s.fromNode, s.departedAt);
  }

  const onHandByKey = new Map<string, number>();
  for (const b of ctx.balances) onHandByKey.set(`${b.nodeId}:${b.itemId}`, b.onHand);

  // Look up category & full item record by id (the SimItem in ctx may not carry category)
  const itemRows = await db.select().from(itemsTable);
  const itemRowById = new Map(itemRows.map((i) => [i.id, i]));

  const riskByNode: RiskNodeSummary[] = ctx.nodes.map((node) => {
    const profile = ctx.profiles.get(node.id);
    if (!profile) {
      return {
        nodeId: node.id,
        riskScore: 0,
        daysOfSupply: 999,
        openAlerts: openAlertsByNode.get(node.id)?.total ?? 0,
        criticalShortItems: 0,
        tier: "nominal" as ThreatTier,
        dosByCategory: {},
        topCriticalItems: [],
        lastShipmentInAt: lastInByNode.get(node.id)?.toISOString() ?? null,
        lastShipmentOutAt: lastOutByNode.get(node.id)?.toISOString() ?? null,
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
    const dosByCategory: Record<string, number> = {};
    const perItem: Array<{
      itemId: string;
      itemName: string;
      category: string;
      daysOfSupply: number;
      onHand: number;
    }> = [];
    for (const dem of demands) {
      const onHand = onHandByKey.get(`${node.id}:${dem.itemId}`) ?? 0;
      const dos = projectDaysOfSupply(onHand, dem.quantity);
      if (dos < minDos) minDos = dos;
      if (dos <= ctx.criticalDays) critShort++;
      const row = itemRowById.get(dem.itemId);
      const category = row?.category ?? "other";
      const itemName = row?.name ?? dem.itemId;
      const safeDos = Number.isFinite(dos) ? dos : 999;
      const prev = dosByCategory[category];
      if (prev === undefined || safeDos < prev) dosByCategory[category] = safeDos;
      perItem.push({
        itemId: dem.itemId,
        itemName,
        category,
        daysOfSupply: Number(safeDos.toFixed(1)),
        onHand,
      });
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
    const tier = deriveTier({
      riskScore: score,
      openAlertsCritical: alertsForNode.critical,
      openAlertsWarning: alertsForNode.warning,
    });
    const topCriticalItems = perItem
      .sort((a, b) => a.daysOfSupply - b.daysOfSupply)
      .slice(0, 3);
    // Round dosByCategory for display
    for (const k of Object.keys(dosByCategory)) {
      dosByCategory[k] = Number(dosByCategory[k].toFixed(1));
    }
    return {
      nodeId: node.id,
      riskScore: score,
      daysOfSupply: Number.isFinite(minDos) ? Number(minDos.toFixed(1)) : 999,
      openAlerts: alertsForNode.total,
      criticalShortItems: critShort,
      tier,
      dosByCategory,
      topCriticalItems,
      lastShipmentInAt: lastInByNode.get(node.id)?.toISOString() ?? null,
      lastShipmentOutAt: lastOutByNode.get(node.id)?.toISOString() ?? null,
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
  const [recent, allItems] = await Promise.all([
    db.select().from(shipmentsTable).where(and(gte(shipmentsTable.etaAt, now))),
    db.select().from(itemsTable),
  ]);
  const itemById = new Map(allItems.map((i) => [i.id, i]));
  return recent.map((s) => {
    const totalMs = s.etaAt.getTime() - s.departedAt.getTime();
    const elapsedMs = now.getTime() - s.departedAt.getTime();
    const progress = totalMs > 0 ? Math.max(0, Math.min(1, elapsedMs / totalMs)) : 0;
    const etaDays =
      Math.max(0, (s.etaAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const item = itemById.get(s.itemId);
    return {
      id: s.id,
      orderId: s.orderId ?? null,
      fromNode: s.fromNode,
      toNode: s.toNode,
      itemId: s.itemId,
      itemName: item?.name ?? s.itemId,
      quantity: s.quantity,
      etaDays: Number(etaDays.toFixed(2)),
      progress: Number(progress.toFixed(3)),
      priority: s.priority,
      category: (item?.category as string | undefined) ?? "other",
    };
  });
}

// Compute, for each route, the categories of supply currently flowing on it
// based on (a) in-flight shipments and (b) recent (last 30 days) order
// shipments. Falls back to the three primary categories so that established
// routes with no recent telemetry still appear in any layer filter.
const DEFAULT_ROUTE_CATEGORIES = new Set<string>([
  "blood_products",
  "supplies",
  "ppe",
]);

export async function computeRouteCategories(): Promise<
  Map<string, Set<string>>
> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [recentShipments, items, recentOrders, recentLines, allRoutes] =
    await Promise.all([
      db.select().from(shipmentsTable).where(gte(shipmentsTable.departedAt, since)),
      db.select().from(itemsTable),
      db.select().from(ordersTable).where(gte(ordersTable.createdAt, since)),
      db.select().from(orderLinesTable),
      db.select().from(routesTable),
    ]);
  const itemCategoryById = new Map(items.map((i) => [i.id, i.category]));
  const linesByOrderId = new Map<string, typeof recentLines>();
  for (const l of recentLines) {
    const arr = linesByOrderId.get(l.orderId) ?? [];
    arr.push(l);
    linesByOrderId.set(l.orderId, arr);
  }
  const out = new Map<string, Set<string>>();
  const keyFor = (from: string, to: string) => `${from}::${to}`;
  for (const s of recentShipments) {
    const cat = itemCategoryById.get(s.itemId) ?? "other";
    const key = keyFor(s.fromNode, s.toNode);
    const set = out.get(key) ?? new Set<string>();
    set.add(cat);
    out.set(key, set);
  }
  for (const o of recentOrders) {
    if (!o.supplierId) continue;
    const lines = linesByOrderId.get(o.id) ?? [];
    for (const l of lines) {
      const cat = itemCategoryById.get(l.itemId) ?? "other";
      const key = keyFor(o.supplierId, o.nodeId);
      const set = out.get(key) ?? new Set<string>();
      set.add(cat);
      out.set(key, set);
    }
  }
  // Fill in defaults for known routes that have no telemetry — established
  // medical-logistics corridors carry all three primary supply classes.
  for (const r of allRoutes) {
    const key = keyFor(r.fromNode, r.toNode);
    if (!out.has(key)) out.set(key, new Set(DEFAULT_ROUTE_CATEGORIES));
  }
  return out;
}

// USINDOPACOM Area of Responsibility outline (approximate, per
// https://www.pacom.mil/About-USINDOPACOM/Area-of-Responsibility-map/).
// Coordinates are [longitude, latitude] pairs that span ~60°E → ~110°W
// (crossing the antimeridian) and from the Arctic boundary down to Antarctica.
// Drawn as an open polyline that the client renders as a faint outline.
export const AOR_BOUNDARY: number[][] = [
  // West edge: 60°E from Arctic down through Indian Ocean to Antarctica boundary
  [60, 80],
  [60, 60],
  [60, 30],
  [60, 0],
  [60, -30],
  [60, -60],
  // South edge across Indian/Southern Ocean
  [90, -60],
  [120, -60],
  [150, -60],
  [180, -60],
  [-150, -60],
  [-120, -60],
  // East edge: 110°W up from Antarctica to Arctic
  [-110, -60],
  [-110, -30],
  [-110, 0],
  [-110, 30],
  [-110, 60],
  [-110, 80],
  // North edge across the Arctic back to 60°E
  [-150, 80],
  [180, 80],
  [150, 80],
  [120, 80],
  [90, 80],
  [60, 80],
];

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
  {
    id: "th-andaman",
    label: "Andaman Sea — heightened maritime patrol activity",
    severity: "WATCH",
    polygon: [
      [90.0, 6.0],
      [98.0, 6.0],
      [98.0, 14.0],
      [90.0, 14.0],
      [90.0, 6.0],
    ] as number[][],
  },
  {
    id: "th-korea-dmz",
    label: "Korean Peninsula — DMZ readiness uplift",
    severity: "WATCH",
    polygon: [
      [124.5, 37.5],
      [131.0, 37.5],
      [131.0, 39.5],
      [124.5, 39.5],
      [124.5, 37.5],
    ] as number[][],
  },
];
