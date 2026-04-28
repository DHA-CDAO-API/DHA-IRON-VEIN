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

// Channel families used by the market-aware ranker. Lowercase for cheap
// matching against `SimSupplier.channel`.
const CHANNEL_FAMILY: Record<string, "DOD" | "COMMERCIAL" | "HOST_NATION" | "ALLIED"> = {
  dla: "DOD",
  ecat: "DOD",
  gsa: "DOD",
  fedmall: "DOD",
  dod: "DOD",
  mckesson: "COMMERCIAL",
  cardinal: "COMMERCIAL",
  henryschein: "COMMERCIAL",
  owensminor: "COMMERCIAL",
  commercial: "COMMERCIAL",
  hostnation: "HOST_NATION",
  host_nation: "HOST_NATION",
  allied: "ALLIED",
};

export function classifySupplierChannel(
  supplier: SimSupplier,
): "DOD" | "COMMERCIAL" | "HOST_NATION" | "ALLIED" {
  const c = supplier.channel.toLowerCase().replace(/\s+/g, "");
  return CHANNEL_FAMILY[c] ?? "DOD";
}

const DEFAULT_UNIT_COSTS_USD: Record<string, number> = {
  ltow_pos: 220, ltow_neg: 260, prbc_o: 180, ffp_ab: 110, plasma_a: 95,
  platelets: 540, cryo: 95, fdp: 320,
  abo_kit: 28, crossmatch: 32, id_screen: 75,
  iv_set: 6, pressure_inf: 22, warmer: 38, transfusion_band: 0.5,
  collection_bag: 4, antiseptic: 1.2, cooler: 220, coolant: 5, chain_log: 95,
  tubes: 0.4, butterfly: 1.1, alcohol: 0.05, gauze: 0.1, tourniquet: 1.2,
  bags: 0.3, labels: 0.05,
  gloves: 0.25, mask: 0.2, shield: 1.5, gown: 1.8, n95: 2.4,
  sharps: 8, centrifuge_tube: 0.4, biohazard_bag: 0.4,
};

export function estimateUnitCostUsd(
  supplier: SimSupplier,
  itemId: string,
): number {
  if (typeof supplier.unitCostUsd === "number" && supplier.unitCostUsd > 0) {
    // Treat the supplier-level price as a multiplier hint for cost-tier
    // suppliers; otherwise use it directly when items aren't catalogued.
    const cataloged = DEFAULT_UNIT_COSTS_USD[itemId];
    if (cataloged) {
      // Channel premium: commercial/host-nation/allied procurement is
      // typically 15-40% above DLA prime-vendor cost.
      const channel = classifySupplierChannel(supplier);
      const premium =
        channel === "DOD"
          ? 1
          : channel === "HOST_NATION"
            ? 1.18
            : channel === "ALLIED"
              ? 1.25
              : 1.35;
      return Number((cataloged * premium).toFixed(2));
    }
    return supplier.unitCostUsd;
  }
  const cataloged = DEFAULT_UNIT_COSTS_USD[itemId] ?? 1.5;
  const channel = classifySupplierChannel(supplier);
  const premium =
    channel === "DOD"
      ? 1
      : channel === "HOST_NATION"
        ? 1.18
        : channel === "ALLIED"
          ? 1.25
          : 1.35;
  return Number((cataloged * premium).toFixed(2));
}

export type Recommendation = {
  id: string;
  nodeId: string;
  itemId: string;
  kind: RecommendationKind;
  suggestedQty: number;
  reason: string;
  expectedRiskReduction: number;
  sourceSupplierId?: string;
  sourceChannel?: "DOD" | "COMMERCIAL" | "HOST_NATION" | "ALLIED";
  estimatedUnitCostUsd?: number;
  estimatedTotalCostUsd?: number;
  etaDays: number;
  alternatives?: RecommendationAlternative[];
};

export type RecommendationAlternative = {
  supplierId: string;
  supplierName: string;
  channel: "DOD" | "COMMERCIAL" | "HOST_NATION" | "ALLIED";
  etaDays: number;
  reliabilityScore: number;
  estimatedUnitCostUsd: number;
  estimatedTotalCostUsd: number;
  rankScore: number;
};

// Rank suppliers by (viability fit, ETA, reliability, cost). The ranker
// returns a sorted list of all suppliers that *could* fill the shortfall,
// best first. A lower `rankScore` is better.
//
// `shortfallHorizonDays` is the deadline we need stock by; suppliers whose
// `etaDays` exceed it are penalized aggressively because they violate
// "viability fit" (won't arrive in time to keep the node viable).
export function rankSuppliersForShortfall(args: {
  itemId: string;
  suggestedQty: number;
  shortfallHorizonDays: number;
  upstreamRouteDays: number;
  suppliers: SimSupplier[];
}): RecommendationAlternative[] {
  const ranked: RecommendationAlternative[] = [];
  for (const s of args.suppliers) {
    if (
      s.itemsCovered &&
      s.itemsCovered.length > 0 &&
      !s.itemsCovered.includes(args.itemId)
    ) {
      continue;
    }
    const eta = Number(
      ((s.leadTimeDaysMean ?? 7) + (args.upstreamRouteDays ?? 2)).toFixed(1),
    );
    const channel = classifySupplierChannel(s);
    const unitCost = estimateUnitCostUsd(s, args.itemId);
    const totalCost = Number((unitCost * args.suggestedQty).toFixed(2));
    // Score: weight viability fit heavily, then ETA, reliability, cost.
    // viability penalty: how badly we miss the shortfall horizon.
    const viabilityPenalty =
      args.shortfallHorizonDays > 0
        ? Math.max(0, eta - args.shortfallHorizonDays) * 25
        : 0;
    const etaScore = eta * 1.5;
    const reliabilityScore = (1 - (s.reliabilityScore ?? 0.85)) * 30;
    const costScore = Math.log10(Math.max(1, totalCost)) * 2;
    const rankScore =
      viabilityPenalty + etaScore + reliabilityScore + costScore;
    ranked.push({
      supplierId: s.id,
      supplierName: s.name,
      channel,
      etaDays: eta,
      reliabilityScore: s.reliabilityScore ?? 0.85,
      estimatedUnitCostUsd: unitCost,
      estimatedTotalCostUsd: totalCost,
      rankScore: Number(rankScore.toFixed(2)),
    });
  }
  ranked.sort((a, b) => a.rankScore - b.rankScore);
  return ranked;
}

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
      const ranked = rankSuppliersForShortfall({
        itemId: item.id,
        suggestedQty,
        shortfallHorizonDays: Math.max(args.criticalDays, dos),
        upstreamRouteDays: upstreamRoute?.days ?? 2,
        suppliers: args.suppliers,
      });
      const top = ranked[0];
      const kind: RecommendationKind =
        dos <= args.criticalDays
          ? upstreamRoute && upstreamRoute.priority !== "primary"
            ? "REROUTE"
            : "ESCALATE"
          : "REORDER";
      const expected =
        Math.min(50, Math.round(((args.watchDays - dos) / args.watchDays) * 60)) +
        (kind === "ESCALATE" ? 15 : 0);
      const channelClause = top
        ? top.channel === "COMMERCIAL"
          ? " — Buy on market"
          : top.channel === "HOST_NATION"
            ? " — Host-nation source"
            : top.channel === "ALLIED"
              ? " — Allied partner source"
              : ""
        : "";
      const costClause = top
        ? ` Est. cost $${top.estimatedTotalCostUsd.toLocaleString()}.`
        : "";
      recs.push({
        id: `rec-${node.id}-${item.id}`,
        nodeId: node.id,
        itemId: item.id,
        kind,
        suggestedQty,
        reason: `${item.name} at ${node.name}: projected DOS ${dos.toFixed(1)} d (target ${targetDays} d). Daily burn ${dem.quantity.toFixed(1)} ${item.unitOfIssue}.${channelClause}${costClause}`,
        expectedRiskReduction: expected,
        sourceSupplierId: top?.supplierId,
        sourceChannel: top?.channel,
        estimatedUnitCostUsd: top?.estimatedUnitCostUsd,
        estimatedTotalCostUsd: top?.estimatedTotalCostUsd,
        etaDays: top ? top.etaDays : 7,
        alternatives: ranked.slice(0, 4),
      });
    }
  }
  return recs.sort((a, b) => b.expectedRiskReduction - a.expectedRiskReduction);
}
