import type {
  AirliftLoss,
  ColdChainFailure,
  ReagentShortage,
  ScenarioPerturbation,
  SimBloodLot,
  SimColdChainAsset,
  SimDonorPool,
  SimItem,
  SimNode,
  SimRoute,
} from "./types";

export const DEFAULT_REAGENT_ITEM_IDS = [
  "abo_kit",
  "crossmatch",
  "id_screen",
];

export const BLOOD_PRODUCT_ITEM_IDS = new Set([
  "ltow_pos",
  "ltow_neg",
  "prbc_o",
  "ffp_ab",
  "plasma_a",
  "platelets",
  "cryo",
  "fdp",
]);

export const LIQUID_BLOOD_COMPONENTS = new Set([
  "LTOWB",
  "PRBC",
  "PLASMA",
  "PLATELETS",
]);

export type ColdChainCascadeResult = {
  failedAssetIds: Set<string>;
  // nodeId:itemId -> units removed from on-hand
  unitsCompromisedByKey: Map<string, number>;
  // per-affected-node summary
  perNode: Array<{
    nodeId: string;
    failedAssets: number;
    compromisedUnits: number;
    affectedItemIds: string[];
  }>;
  totalCompromisedUnits: number;
  outageHours: number;
};

export function applyColdChainCascade(args: {
  perturbation: ScenarioPerturbation;
  affected: Set<string>;
  bloodLots: SimBloodLot[];
  coldChainAssets: SimColdChainAsset[];
  onHandByKey: Map<string, number>;
}): ColdChainCascadeResult {
  const cc = args.perturbation.coldChain;
  const failedAssetIds = new Set<string>();
  const unitsCompromisedByKey = new Map<string, number>();
  const perNodeMap = new Map<
    string,
    { failedAssets: Set<string>; compromisedUnits: number; affectedItemIds: Set<string> }
  >();
  if (!cc) {
    return {
      failedAssetIds,
      unitsCompromisedByKey,
      perNode: [],
      totalCompromisedUnits: 0,
      outageHours: 0,
    };
  }

  const outageHours = Math.max(1, cc.outageHours ?? 24);
  const initialFraction = clamp01(cc.initialCompromisedFraction ?? 0.3);
  // Beyond ~24 h of warmup, liquid components are essentially condemned.
  // Linear ramp from initialFraction at 0 h to 1.0 at 24 h.
  const ageingFraction = clamp01(initialFraction + (outageHours / 24) * (1 - initialFraction));

  // Asset selection: explicit IDs win; otherwise fail any asset at the
  // affected nodes whose type is in cc.assetTypes (defaults to all
  // refrigerators + freezers + platelet incubators).
  const explicitAssetIds = new Set(cc.assetIds ?? []);
  const matchTypes =
    cc.assetTypes && cc.assetTypes.length > 0
      ? new Set(cc.assetTypes.map((t) => t.toLowerCase()))
      : new Set(["refrigerator", "freezer", "platelet_incubator"]);
  for (const a of args.coldChainAssets) {
    const nodeAffected = args.affected.size === 0 || args.affected.has(a.nodeId);
    if (explicitAssetIds.has(a.id)) {
      failedAssetIds.add(a.id);
      continue;
    }
    if (nodeAffected && matchTypes.has(a.assetType.toLowerCase())) {
      failedAssetIds.add(a.id);
    }
  }

  for (const lot of args.bloodLots) {
    if (!lot.coldChainAssetId || !failedAssetIds.has(lot.coldChainAssetId)) continue;
    if (!LIQUID_BLOOD_COMPONENTS.has(lot.component.toUpperCase())) continue;
    if (lot.status === "EXPIRED" || lot.status === "COMPROMISED") continue;
    const lostUnits = Math.round(lot.units * ageingFraction);
    if (lostUnits <= 0) continue;
    const key = `${lot.nodeId}:${lot.itemId}`;
    unitsCompromisedByKey.set(key, (unitsCompromisedByKey.get(key) ?? 0) + lostUnits);
    args.onHandByKey.set(key, Math.max(0, (args.onHandByKey.get(key) ?? 0) - lostUnits));
    let pn = perNodeMap.get(lot.nodeId);
    if (!pn) {
      pn = { failedAssets: new Set(), compromisedUnits: 0, affectedItemIds: new Set() };
      perNodeMap.set(lot.nodeId, pn);
    }
    pn.compromisedUnits += lostUnits;
    pn.affectedItemIds.add(lot.itemId);
    if (lot.coldChainAssetId) pn.failedAssets.add(lot.coldChainAssetId);
  }

  // Make sure nodes whose only result was a failed asset (no exposed lots)
  // still appear in the cascade output.
  for (const a of args.coldChainAssets) {
    if (!failedAssetIds.has(a.id)) continue;
    if (perNodeMap.has(a.nodeId)) {
      perNodeMap.get(a.nodeId)!.failedAssets.add(a.id);
      continue;
    }
    perNodeMap.set(a.nodeId, {
      failedAssets: new Set([a.id]),
      compromisedUnits: 0,
      affectedItemIds: new Set(),
    });
  }

  let total = 0;
  const perNode = Array.from(perNodeMap.entries()).map(([nodeId, v]) => {
    total += v.compromisedUnits;
    return {
      nodeId,
      failedAssets: v.failedAssets.size,
      compromisedUnits: v.compromisedUnits,
      affectedItemIds: Array.from(v.affectedItemIds),
    };
  });
  perNode.sort((a, b) => b.compromisedUnits - a.compromisedUnits);

  return {
    failedAssetIds,
    unitsCompromisedByKey,
    perNode,
    totalCompromisedUnits: total,
    outageHours,
  };
}

export type ReagentCascadeResult = {
  // nodeId -> [0..1] effective collection capacity multiplier
  capacityMultiplierByNode: Map<string, number>;
  perNode: Array<{
    nodeId: string;
    capacityMultiplier: number;
    bottleneckItemId: string | null;
    bottleneckDOS: number;
  }>;
  reagentItemIds: string[];
  thresholdDays: number;
};

export function applyReagentCascade(args: {
  perturbation: ScenarioPerturbation;
  affected: Set<string>;
  items: SimItem[];
  // Pre-cascade (post cold-chain) on-hand map. The reagent cascade does NOT
  // mutate it; it only reads to compute the gating capacity.
  onHandByKey: Map<string, number>;
  // Per-node burn rate for each reagent item. Used to convert on-hand into
  // days-of-supply.
  reagentBurnByKey: Map<string, number>;
  affectedNodes: SimNode[];
}): ReagentCascadeResult {
  const r = args.perturbation.reagent;
  const out = new Map<string, number>();
  const perNode: ReagentCascadeResult["perNode"] = [];
  if (!r) {
    return {
      capacityMultiplierByNode: out,
      perNode: [],
      reagentItemIds: [],
      thresholdDays: 0,
    };
  }
  const ids =
    r.reagentItemIds && r.reagentItemIds.length > 0
      ? r.reagentItemIds
      : DEFAULT_REAGENT_ITEM_IDS;
  const knownIds = new Set(args.items.map((i) => i.id));
  const reagentIds = ids.filter((id) => knownIds.has(id));
  const threshold = Math.max(0.1, r.thresholdDays ?? 3);
  const minFrac = clamp01(r.minCapacityFraction ?? 0);

  for (const node of args.affectedNodes) {
    if (args.affected.size > 0 && !args.affected.has(node.id)) continue;
    let worstFrac = 1;
    let bottleneckItem: string | null = null;
    let bottleneckDOS = 999;
    for (const itemId of reagentIds) {
      const onHand = args.onHandByKey.get(`${node.id}:${itemId}`) ?? 0;
      const burn = args.reagentBurnByKey.get(`${node.id}:${itemId}`) ?? 0;
      if (burn <= 0.0001) continue;
      const dos = onHand / burn;
      // Linear ramp from threshold (full capacity) to 0 (minFrac capacity)
      const ratio = Math.max(0, Math.min(1, dos / threshold));
      const frac = minFrac + (1 - minFrac) * ratio;
      if (frac < worstFrac) {
        worstFrac = frac;
        bottleneckItem = itemId;
        bottleneckDOS = dos;
      }
    }
    if (worstFrac < 1) {
      out.set(node.id, worstFrac);
      perNode.push({
        nodeId: node.id,
        capacityMultiplier: Number(worstFrac.toFixed(3)),
        bottleneckItemId: bottleneckItem,
        bottleneckDOS: Number(bottleneckDOS.toFixed(2)),
      });
    }
  }
  perNode.sort((a, b) => a.capacityMultiplier - b.capacityMultiplier);
  return {
    capacityMultiplierByNode: out,
    perNode,
    reagentItemIds: reagentIds,
    thresholdDays: threshold,
  };
}

export type AirliftCascadeResult = {
  additionalTransitDays: number;
  viabilityLossPerDay: number;
  // nodeId:itemId -> units lost
  unitsLostByKey: Map<string, number>;
  perNode: Array<{
    nodeId: string;
    unitsLost: number;
    affectedItemIds: string[];
  }>;
  totalUnitsLost: number;
};

export function applyAirliftCascade(args: {
  perturbation: ScenarioPerturbation;
  affected: Set<string>;
  routes: SimRoute[];
  bloodLots: SimBloodLot[];
  onHandByKey: Map<string, number>;
}): AirliftCascadeResult {
  const al = args.perturbation.airlift;
  const result: AirliftCascadeResult = {
    additionalTransitDays: 0,
    viabilityLossPerDay: 0,
    unitsLostByKey: new Map(),
    perNode: [],
    totalUnitsLost: 0,
  };
  if (!al) return result;
  const extraDays = Math.max(0, al.additionalTransitDays ?? 2);
  const lossPerDay = clamp01(al.viabilityLossPerDay ?? 0.1);
  const modalities = new Set(
    (al.affectedModalities ?? ["air", "airlift"]).map((m) => m.toLowerCase()),
  );
  result.additionalTransitDays = extraDays;
  result.viabilityLossPerDay = lossPerDay;
  if (extraDays === 0 || lossPerDay === 0) return result;

  // Receiving nodes are the destinations of any airlift route into an
  // affected node. If no nodes are affected, the cascade hits every airlift
  // destination.
  const receivingNodes = new Set<string>();
  for (const r of args.routes) {
    if (!modalities.has(r.modality.toLowerCase())) continue;
    if (args.affected.size === 0 || args.affected.has(r.toNode)) {
      receivingNodes.add(r.toNode);
    }
  }

  const lossFraction = clamp01(extraDays * lossPerDay);
  const perNodeAgg = new Map<
    string,
    { unitsLost: number; affectedItemIds: Set<string> }
  >();
  for (const lot of args.bloodLots) {
    if (!receivingNodes.has(lot.nodeId)) continue;
    if (!LIQUID_BLOOD_COMPONENTS.has(lot.component.toUpperCase())) continue;
    if (lot.status === "EXPIRED" || lot.status === "COMPROMISED") continue;
    const lost = Math.round(lot.units * lossFraction);
    if (lost <= 0) continue;
    const key = `${lot.nodeId}:${lot.itemId}`;
    result.unitsLostByKey.set(key, (result.unitsLostByKey.get(key) ?? 0) + lost);
    args.onHandByKey.set(key, Math.max(0, (args.onHandByKey.get(key) ?? 0) - lost));
    let pn = perNodeAgg.get(lot.nodeId);
    if (!pn) {
      pn = { unitsLost: 0, affectedItemIds: new Set() };
      perNodeAgg.set(lot.nodeId, pn);
    }
    pn.unitsLost += lost;
    pn.affectedItemIds.add(lot.itemId);
  }
  for (const [nodeId, v] of perNodeAgg.entries()) {
    result.perNode.push({
      nodeId,
      unitsLost: v.unitsLost,
      affectedItemIds: Array.from(v.affectedItemIds),
    });
    result.totalUnitsLost += v.unitsLost;
  }
  result.perNode.sort((a, b) => b.unitsLost - a.unitsLost);
  return result;
}

export function buildCascadeNarrative(args: {
  scenarioName: string;
  coldChain: ColdChainCascadeResult;
  reagent: ReagentCascadeResult;
  airlift: AirliftCascadeResult;
  donorPools: SimDonorPool[];
  nodes: SimNode[];
  // Baseline DOS map (post-baseline, pre-cascade) — used to phrase "drops X
  // from N to M" lines.
  dosBeforeByNode: Record<string, number>;
  dosAfterByNode: Record<string, number>;
}): string[] {
  const lines: string[] = [];
  const nodeNameById = new Map(args.nodes.map((n) => [n.id, n.name]));
  for (const c of args.coldChain.perNode.slice(0, 4)) {
    if (c.compromisedUnits === 0) continue;
    const name = nodeNameById.get(c.nodeId) ?? c.nodeId;
    const dosBefore = args.dosBeforeByNode[c.nodeId];
    const dosAfter = args.dosAfterByNode[c.nodeId];
    const dosClause =
      dosBefore !== undefined && dosAfter !== undefined && dosBefore < 999
        ? ` and drops ${name} blood DOS from ${dosBefore.toFixed(1)} d to ${dosAfter.toFixed(1)} d within ${args.coldChain.outageHours} h`
        : "";
    const prefix = args.scenarioName ? `${args.scenarioName}: ` : "";
    lines.push(
      `${prefix}cold storage failure compromises ${c.compromisedUnits} blood unit${c.compromisedUnits === 1 ? "" : "s"} at ${name}${dosClause}.`,
    );
  }
  if (args.coldChain.perNode.length > 4) {
    lines.push(
      `Additional cold-chain impact at ${args.coldChain.perNode.length - 4} more node(s).`,
    );
  }
  for (const r of args.reagent.perNode.slice(0, 4)) {
    const name = nodeNameById.get(r.nodeId) ?? r.nodeId;
    const dropPct = Math.round((1 - r.capacityMultiplier) * 100);
    const donor = args.donorPools.find((d) => d.nodeId === r.nodeId);
    const baselineCap = donor?.weeklyCollectionCapacity ?? 0;
    const newCap = Math.round(baselineCap * r.capacityMultiplier);
    lines.push(
      `Reagent shortage cuts donor screening at ${name} by ${dropPct}% (${baselineCap} → ${newCap} units/week)${r.bottleneckItemId ? ` — gated by ${r.bottleneckItemId} at ${r.bottleneckDOS.toFixed(1)} d on hand` : ""}.`,
    );
  }
  for (const a of args.airlift.perNode.slice(0, 4)) {
    const name = nodeNameById.get(a.nodeId) ?? a.nodeId;
    lines.push(
      `Airlift loss adds ${args.airlift.additionalTransitDays.toFixed(1)} d to in-transit time and degrades ${a.unitsLost} arriving blood unit${a.unitsLost === 1 ? "" : "s"} at ${name}.`,
    );
  }
  return lines;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
