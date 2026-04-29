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

// When a scenario degrades the primary supplier for an item, we attribute
// the COA reroute back to that supplier so the operator sees *why* the
// recommendation looks different from the steady-state pick.
export type RecommendationDisplacement = {
  supplierId: string;
  supplierName: string;
  // Horizon-blended availability of the displaced supplier (0..1). 0 means
  // "fully offline during the scenario", 1 means "unaffected".
  availabilityFraction: number;
  // Optional human-friendly cause sourced from the perturbation entry.
  cause?: string;
};

// When the chosen supplier is capacity-constrained, the COA spreads the
// fill across a primary + secondary supplier proportional to available
// capacity instead of single-sourcing a degraded vendor.
export type RecommendationSplitAllocation = {
  supplierId: string;
  supplierName: string;
  channel: "DOD" | "COMMERCIAL" | "HOST_NATION" | "ALLIED";
  qty: number;
  pctOfTotal: number; // 0..1
  etaDays: number;
};

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
  // Set when the scenario knocked out the would-be primary source.
  displacedFrom?: RecommendationDisplacement;
  // Set when capacity constraints force a multi-supplier fill.
  splitAllocation?: RecommendationSplitAllocation[];
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
    // Hard-skip a supplier whose horizon-blended capacity is effectively
    // zero. They are physically unable to deliver during the scenario, so
    // surfacing them as an alternative would be misleading and could even
    // win the rank if their baseline ETA was best.
    const availability =
      typeof s.availabilityFraction === "number" ? s.availabilityFraction : 1;
    if (availability <= 0.001) continue;
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
    // Capacity penalty grows as availability drops. A 60%-capacity supplier
    // gets +8, a 20%-capacity supplier gets +24. This nudges the ranker
    // toward intact alternates while still keeping a half-degraded supplier
    // viable when no better source exists.
    const capacityPenalty = (1 - availability) * 30;
    const rankScore =
      viabilityPenalty + etaScore + reliabilityScore + costScore + capacityPenalty;
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

// Find the single fastest in-network route between two nodes (direct edge
// only — we do not multi-hop here). Used to estimate TLAMM→MTF lead time.
function findRouteBetween(
  fromId: string,
  toId: string,
  routes: SimRoute[],
): SimRoute | undefined {
  let best: SimRoute | undefined;
  for (const r of routes) {
    if (r.fromNode === fromId && r.toNode === toId) {
      if (!best || r.days < best.days) best = r;
    }
  }
  return best;
}

const DEFAULT_TLAMM_PICK_DAYS = 1; // intra-TLAMM pick + pack handle time

// Decide whether a TLAMM can be the primary source for an MTF shortfall,
// and how much it can ship. Returns null if no TLAMM is configured or the
// TLAMM has zero on-hand. When the TLAMM has *some* stock we still prefer
// it for the available quantity (a "split" rec is created elsewhere).
function evaluateTlammSource(args: {
  mtfNode: SimNode;
  itemId: string;
  shortfallQty: number;
  tlammNode: SimNode | undefined;
  tlammOnHand: number;
  routes: SimRoute[];
}): {
  qty: number;
  etaDays: number;
  reliability: number;
  available: boolean;
} | null {
  const tlamm = args.tlammNode;
  if (!tlamm) return null;
  if (args.tlammOnHand <= 0) return { qty: 0, etaDays: 0, reliability: 0, available: false };
  const route = findRouteBetween(tlamm.id, args.mtfNode.id, args.routes);
  // If no direct route exists, the TLAMM cannot deliver this run; fall
  // back to the MTF's nearest upstream + supplier path.
  if (!route) return null;
  const eta = Number((route.days + DEFAULT_TLAMM_PICK_DAYS).toFixed(1));
  const qty = Math.min(args.shortfallQty, args.tlammOnHand);
  return { qty, etaDays: eta, reliability: route.reliability, available: true };
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
  /**
   * Optional per-node, per-item historical daily-burn override. When a
   * node has an entry, the inner map is forwarded to `computeDailyDemand`
   * so the recommendation engine reorders against real history rather
   * than synthetic rates. Items without history fall back to synthetic.
   */
  historicalBurnByNode?: Map<string, Map<string, number>>;
}): Recommendation[] {
  const recs: Recommendation[] = [];
  const balanceMap = new Map<string, number>();
  // Track which items materially matter so the per-node forecast loop
  // doesn't iterate the entire (~60k after supply-demo activation) catalog
  // when only a handful of items have on-hand or historical-burn data.
  const itemsWithBalanceByNode = new Map<string, Set<string>>();
  for (const b of args.balances) {
    balanceMap.set(`${b.nodeId}:${b.itemId}`, b.onHand);
    let s = itemsWithBalanceByNode.get(b.nodeId);
    if (!s) {
      s = new Set();
      itemsWithBalanceByNode.set(b.nodeId, s);
    }
    s.add(b.itemId);
  }
  // Item lookups inside the inner loop must be O(1) — the previous
  // `args.items.find(...)` was O(items × demands × nodes).
  const itemById = new Map(args.items.map((i) => [i.id, i]));
  // Always include seeded items (anything not from the supply-demo
  // catalog) so curated blood/supply recommendations still emit.
  const seededIds = new Set(
    args.items.filter((i) => !i.id.startsWith("cat_")).map((i) => i.id),
  );

  for (const node of args.nodes) {
    const profile = args.profiles.get(node.id);
    if (!profile || profile.activeSupportedPopulation === 0) continue;
    const state = args.states.get(profile.operationalState);
    // Build per-node item subset: seeded items + anything we have on hand
    // here + anything with a historical burn rate at this node.
    const relevant = new Set<string>(seededIds);
    const onHandHere = itemsWithBalanceByNode.get(node.id);
    if (onHandHere) for (const id of onHandHere) relevant.add(id);
    const histHere = args.historicalBurnByNode?.get(node.id);
    if (histHere) for (const id of histHere.keys()) relevant.add(id);
    const nodeItems: SimItem[] = [];
    for (const id of relevant) {
      const it = itemById.get(id);
      if (it) nodeItems.push(it);
    }
    const demands = computeDailyDemand({
      profile,
      items: nodeItems,
      operationalState: state,
      itemSkew: args.itemSkew,
      historicalBurnByItem: args.historicalBurnByNode?.get(node.id),
    });
    const upstreamRoute = findUpstreamRoute(node.id, args.routes);
    for (const dem of demands) {
      const item = itemById.get(dem.itemId);
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
        ? ` Est. cost $${top.estimatedTotalCostUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`
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

// ---------------------------------------------------------------------------
// TLAMM self-replenishment: each TLAMM should look at the aggregated
// downstream burn it serves and keep enough on-hand to satisfy that demand
// over its own stock-days target. Emits one rec per (TLAMM,item) where the
// TLAMM's projected days-of-supply is below the watch threshold.
// ---------------------------------------------------------------------------

export type TlammReplenishmentRecommendation = Recommendation & {
  // For traceability in the UI: which downstream MTFs are pulling on this
  // TLAMM and how much each contributes to the aggregate daily burn.
  downstreamContributions?: Array<{
    nodeId: string;
    nodeName: string;
    dailyBurn: number;
  }>;
};

export function generateTlammSelfReplenishment(args: {
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
}): TlammReplenishmentRecommendation[] {
  const out: TlammReplenishmentRecommendation[] = [];
  const balanceMap = new Map<string, number>();
  for (const b of args.balances) {
    balanceMap.set(`${b.nodeId}:${b.itemId}`, b.onHand);
  }
  const tlamms = args.nodes.filter((n) => n.isTlamm === true);
  if (tlamms.length === 0) return out;

  // Pre-compute per-MTF daily demand once.
  const mtfDemandByNode = new Map<string, Map<string, number>>();
  for (const node of args.nodes) {
    const p = args.profiles.get(node.id);
    if (!p || p.activeSupportedPopulation === 0) continue;
    const state = args.states.get(p.operationalState);
    const dem = computeDailyDemand({
      profile: p,
      items: args.items,
      operationalState: state,
      itemSkew: args.itemSkew,
    });
    mtfDemandByNode.set(
      node.id,
      new Map(dem.map((d) => [d.itemId, d.quantity])),
    );
  }

  for (const tlamm of tlamms) {
    // Downstream MTFs = nodes whose primaryTlammNodeId matches AND whose
    // aor matches (defensive — primaryTlammNodeId already implies it).
    const downstream = args.nodes.filter(
      (n) => n.primaryTlammNodeId === tlamm.id && n.id !== tlamm.id,
    );
    if (downstream.length === 0) continue;

    // For each item carried by any downstream MTF, sum daily burn and
    // record contributors.
    const aggBurn = new Map<string, number>();
    const contribByItem = new Map<
      string,
      Array<{ nodeId: string; nodeName: string; dailyBurn: number }>
    >();
    for (const m of downstream) {
      const burns = mtfDemandByNode.get(m.id);
      if (!burns) continue;
      for (const [itemId, q] of burns) {
        if (q <= 0) continue;
        aggBurn.set(itemId, (aggBurn.get(itemId) ?? 0) + q);
        const arr = contribByItem.get(itemId) ?? [];
        arr.push({ nodeId: m.id, nodeName: m.name, dailyBurn: Number(q.toFixed(2)) });
        contribByItem.set(itemId, arr);
      }
    }

    const upstreamRoute = findUpstreamRoute(tlamm.id, args.routes);
    for (const [itemId, totalBurn] of aggBurn) {
      const item = args.items.find((i) => i.id === itemId);
      if (!item || totalBurn <= 0) continue;
      const onHand = balanceMap.get(`${tlamm.id}:${itemId}`) ?? 0;
      const dos = projectDaysOfSupply(onHand, totalBurn);
      if (dos > args.watchDays) continue;
      const targetDays = Math.max(
        tlamm.stockDays,
        item.leadTimeDays + args.paddingDays,
      );
      const suggestedQty = Math.ceil(totalBurn * (targetDays - dos));
      if (suggestedQty <= 0) continue;

      const ranked = rankSuppliersForShortfall({
        itemId,
        suggestedQty,
        shortfallHorizonDays: Math.max(args.criticalDays, dos),
        upstreamRouteDays: upstreamRoute?.days ?? 2,
        suppliers: args.suppliers,
      });
      const top = ranked[0];
      const kind: RecommendationKind =
        dos <= args.criticalDays ? "ESCALATE" : "REORDER";
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
        ? ` Est. cost $${top.estimatedTotalCostUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`
        : "";
      out.push({
        id: `rec-tlamm-${tlamm.id}-${itemId}`,
        nodeId: tlamm.id,
        itemId,
        kind,
        suggestedQty,
        reason: `${item.name} at TLAMM ${tlamm.name}: aggregate downstream burn ${totalBurn.toFixed(1)} ${item.unitOfIssue}/d across ${downstream.length} MTFs; projected DOS ${dos.toFixed(1)} d (target ${targetDays} d).${channelClause}${costClause}`,
        expectedRiskReduction: expected,
        sourceKind: "SUPPLIER",
        sourceSupplierId: top?.supplierId,
        sourceChannel: top?.channel,
        estimatedUnitCostUsd: top?.estimatedUnitCostUsd,
        estimatedTotalCostUsd: top?.estimatedTotalCostUsd,
        etaDays: top ? top.etaDays : 7,
        alternatives: ranked.slice(0, 4),
        downstreamContributions: contribByItem.get(itemId) ?? [],
      });
    }
  }
  return out.sort((a, b) => b.expectedRiskReduction - a.expectedRiskReduction);
}
