import { computeDailyDemand, projectDaysOfSupply } from "./forecast";
import type {
  SimDemandProfile,
  SimInventoryBalance,
  SimItem,
  SimNode,
  SimOperationalState,
  SimRoute,
  SimSupplier,
} from "./types";
import { findUpstreamRoute } from "./network";

export type RecommendationKind = "REORDER" | "REROUTE" | "SUBSTITUTE" | "ESCALATE";

export type Recommendation = {
  id: string;
  nodeId: string;
  itemId: string;
  kind: RecommendationKind;
  suggestedQty: number;
  reason: string;
  expectedRiskReduction: number;
  sourceSupplierId?: string;
  etaDays: number;
};

export function generateRecommendations(args: {
  nodes: SimNode[];
  routes: SimRoute[];
  items: SimItem[];
  balances: SimInventoryBalance[];
  profiles: Map<string, SimDemandProfile>;
  states: Map<string, SimOperationalState>;
  suppliers: SimSupplier[];
  itemSkew: Record<string, number>;
  watchDays: number;
  criticalDays: number;
  paddingDays: number;
}): Recommendation[] {
  const recs: Recommendation[] = [];
  const balanceMap = new Map<string, number>();
  for (const b of args.balances) {
    balanceMap.set(`${b.nodeId}:${b.itemId}`, b.onHand);
  }

  for (const node of args.nodes) {
    const profile = args.profiles.get(node.id);
    if (!profile || profile.activeSupportedPopulation === 0) continue;
    const state = args.states.get(profile.operationalState);
    const demands = computeDailyDemand({
      profile,
      items: args.items,
      operationalState: state,
      itemSkew: args.itemSkew,
    });
    const upstreamRoute = findUpstreamRoute(node.id, args.routes);
    for (const dem of demands) {
      const item = args.items.find((i) => i.id === dem.itemId);
      if (!item) continue;
      const onHand = balanceMap.get(`${node.id}:${dem.itemId}`) ?? 0;
      const dos = projectDaysOfSupply(onHand, dem.quantity);
      if (dos > args.watchDays) continue;
      const targetDays = Math.max(
        node.stockDays,
        item.leadTimeDays + args.paddingDays,
      );
      const suggestedQty = Math.ceil(dem.quantity * (targetDays - dos));
      if (suggestedQty <= 0) continue;
      const supplier =
        args.suppliers.find((s) =>
          upstreamRoute ? s.id === upstreamRoute.fromNode : false,
        ) ?? args.suppliers[0];
      const kind: RecommendationKind =
        dos <= args.criticalDays
          ? upstreamRoute && upstreamRoute.priority !== "primary"
            ? "REROUTE"
            : "ESCALATE"
          : "REORDER";
      const expected =
        Math.min(50, Math.round(((args.watchDays - dos) / args.watchDays) * 60)) +
        (kind === "ESCALATE" ? 15 : 0);
      const eta =
        (supplier?.leadTimeDaysMean ?? 7) + (upstreamRoute?.days ?? 3);
      recs.push({
        id: `rec-${node.id}-${item.id}`,
        nodeId: node.id,
        itemId: item.id,
        kind,
        suggestedQty,
        reason: `${item.name} at ${node.name}: projected DOS ${dos.toFixed(1)} d (target ${targetDays} d). Daily burn ${dem.quantity.toFixed(1)} ${item.unitOfIssue}.`,
        expectedRiskReduction: expected,
        sourceSupplierId: supplier?.id,
        etaDays: Math.round(eta * 10) / 10,
      });
    }
  }
  return recs.sort((a, b) => b.expectedRiskReduction - a.expectedRiskReduction);
}
