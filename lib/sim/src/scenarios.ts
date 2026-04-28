import { computeDailyDemand, projectDaysOfSupply } from "./forecast";
import { computeRiskScore } from "./risk";
import type {
  SimDemandProfile,
  SimInventoryBalance,
  SimItem,
  SimNode,
  SimOperationalState,
  SimRoute,
  ScenarioRunInput,
} from "./types";

export type ScenarioStep = {
  day: number;
  riskByNode: Record<string, number>;
  dosByNode: Record<string, number>;
  criticalShortByNode: Record<string, number>;
};

export type ScenarioItemShortfall = {
  nodeId: string;
  itemId: string;
  peakDemandPerDay: number;
  finalOnHand: number;
  projectedDOS: number;
  daysCritical: number;
  suggestedQty: number;
};

export type ScenarioOutcome = {
  steps: ScenarioStep[];
  impactedNodes: Array<{
    nodeId: string;
    baselineRisk: number;
    peakRisk: number;
    minDOS: number;
    daysCritical: number;
  }>;
  baselineRisk: Record<string, number>;
  peakDay: number;
  perItemShortfall: ScenarioItemShortfall[];
};

export type ScenarioContext = {
  nodes: SimNode[];
  routes: SimRoute[];
  items: SimItem[];
  profiles: Map<string, SimDemandProfile>;
  states: Map<string, SimOperationalState>;
  balances: SimInventoryBalance[];
  itemSkew: Record<string, number>;
  watchDays: number;
  criticalDays: number;
};

export function runScenario(
  ctx: ScenarioContext,
  input: ScenarioRunInput,
): ScenarioOutcome {
  const horizon = Math.max(1, Math.min(60, input.horizonDays));
  const affected = new Set(input.perturbation.affectedNodes ?? []);

  const onHandByKey = new Map<string, number>();
  for (const b of ctx.balances) {
    onHandByKey.set(`${b.nodeId}:${b.itemId}`, b.onHand);
  }

  const baselineRisk: Record<string, number> = {};
  for (const node of ctx.nodes) {
    baselineRisk[node.id] = computeNodeRisk(ctx, node, onHandByKey, {});
  }

  const steps: ScenarioStep[] = [];
  const peakRiskByNode: Record<string, number> = { ...baselineRisk };
  const minDOSByNode: Record<string, number> = {};
  const daysCriticalByNode: Record<string, number> = {};
  const peakBurnByKey = new Map<string, number>();
  const daysCriticalByKey = new Map<string, number>();

  let peakDay = 0;
  let peakSum = -Infinity;

  for (let d = 1; d <= horizon; d++) {
    const riskByNode: Record<string, number> = {};
    const dosByNode: Record<string, number> = {};
    const criticalShortByNode: Record<string, number> = {};
    let sum = 0;
    for (const node of ctx.nodes) {
      const isAffected = affected.size === 0 || affected.has(node.id);
      const profile = ctx.profiles.get(node.id);
      if (!profile) {
        riskByNode[node.id] = baselineRisk[node.id] ?? 0;
        continue;
      }
      const state = ctx.states.get(profile.operationalState);
      const demands = computeDailyDemand({
        profile,
        items: ctx.items,
        operationalState: state,
        itemSkew: { ...ctx.itemSkew, ...(input.perturbation.itemSkew ?? {}) },
        wasteOverride: isAffected
          ? profile.wasteFactor * (input.perturbation.wasteMultiplier ?? 1)
          : profile.wasteFactor,
        encounterMultiplierOverride: isAffected
          ? input.perturbation.encounterMultiplier ?? 1
          : 1,
        populationMultiplierOverride: isAffected
          ? input.perturbation.populationMultiplier ?? 1
          : 1,
        specimensMultiplier: isAffected
          ? input.perturbation.specimensMultiplier ?? 1
          : 1,
      });

      let critShort = 0;
      let minDosForNode = 999;
      for (const dem of demands) {
        const key = `${node.id}:${dem.itemId}`;
        const onHand = (onHandByKey.get(key) ?? 0) - dem.quantity;
        onHandByKey.set(key, Math.max(0, onHand));
        const dos = projectDaysOfSupply(Math.max(0, onHand), dem.quantity);
        if (dos < minDosForNode) minDosForNode = dos;
        if (dos <= ctx.criticalDays) critShort++;
        if ((peakBurnByKey.get(key) ?? 0) < dem.quantity) {
          peakBurnByKey.set(key, dem.quantity);
        }
        if (dos <= ctx.criticalDays) {
          daysCriticalByKey.set(key, (daysCriticalByKey.get(key) ?? 0) + 1);
        }
      }
      const upstreamDelay = isAffected
        ? input.perturbation.routeDelayDays ?? 0
        : 0;
      const reliabilityDelta = isAffected
        ? input.perturbation.routeReliabilityDelta ?? 0
        : 0;
      const risk = computeRiskScore({
        daysOfSupply: minDosForNode,
        criticalShortItems: critShort,
        openAlertsCritical: 0,
        openAlertsWarning: 0,
        upstreamRouteDelayDays: upstreamDelay,
        routeReliability: Math.max(0, 0.9 + reliabilityDelta),
      });
      riskByNode[node.id] = risk;
      dosByNode[node.id] = minDosForNode;
      criticalShortByNode[node.id] = critShort;
      sum += risk;
      if (risk > (peakRiskByNode[node.id] ?? 0)) peakRiskByNode[node.id] = risk;
      if ((minDOSByNode[node.id] ?? 999) > minDosForNode)
        minDOSByNode[node.id] = minDosForNode;
      if (minDosForNode <= ctx.criticalDays) {
        daysCriticalByNode[node.id] = (daysCriticalByNode[node.id] ?? 0) + 1;
      }
    }
    if (sum > peakSum) {
      peakSum = sum;
      peakDay = d;
    }
    steps.push({ day: d, riskByNode, dosByNode, criticalShortByNode });
  }

  const impactedNodes = ctx.nodes
    .map((n) => ({
      nodeId: n.id,
      baselineRisk: baselineRisk[n.id] ?? 0,
      peakRisk: peakRiskByNode[n.id] ?? 0,
      minDOS: minDOSByNode[n.id] ?? 999,
      daysCritical: daysCriticalByNode[n.id] ?? 0,
    }))
    .filter((x) => x.peakRisk - x.baselineRisk >= 1)
    .sort((a, b) => b.peakRisk - b.baselineRisk - (a.peakRisk - a.baselineRisk))
    .slice(0, 12);

  const nodeById = new Map(ctx.nodes.map((n) => [n.id, n]));
  const itemById = new Map(ctx.items.map((i) => [i.id, i]));
  const perItemShortfall: ScenarioItemShortfall[] = [];
  for (const [key, peakBurn] of peakBurnByKey.entries()) {
    if (peakBurn <= 0) continue;
    const [nodeId, itemId] = key.split(":");
    const node = nodeById.get(nodeId);
    const item = itemById.get(itemId);
    if (!node || !item) continue;
    const finalOnHand = onHandByKey.get(key) ?? 0;
    const projectedDOS = projectDaysOfSupply(finalOnHand, peakBurn);
    if (projectedDOS > ctx.watchDays) continue;
    const targetDays = Math.max(node.stockDays, item.leadTimeDays + ctx.criticalDays);
    const suggestedQty = Math.ceil(Math.max(0, peakBurn * targetDays - finalOnHand));
    if (suggestedQty <= 0) continue;
    perItemShortfall.push({
      nodeId,
      itemId,
      peakDemandPerDay: Number(peakBurn.toFixed(2)),
      finalOnHand: Number(finalOnHand.toFixed(1)),
      projectedDOS: Number(projectedDOS.toFixed(1)),
      daysCritical: daysCriticalByKey.get(key) ?? 0,
      suggestedQty,
    });
  }
  perItemShortfall.sort((a, b) => {
    const aCrit = (itemById.get(a.itemId)?.criticality === "critical" ? 0 : 1);
    const bCrit = (itemById.get(b.itemId)?.criticality === "critical" ? 0 : 1);
    if (aCrit !== bCrit) return aCrit - bCrit;
    return a.projectedDOS - b.projectedDOS;
  });

  return { steps, impactedNodes, baselineRisk, peakDay, perItemShortfall };
}

function computeNodeRisk(
  ctx: ScenarioContext,
  node: SimNode,
  onHandByKey: Map<string, number>,
  _opts: Record<string, never>,
): number {
  const profile = ctx.profiles.get(node.id);
  if (!profile) return 0;
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
  return computeRiskScore({
    daysOfSupply: minDos,
    criticalShortItems: critShort,
    openAlertsCritical: 0,
    openAlertsWarning: 0,
    upstreamRouteDelayDays: 0,
    routeReliability: 0.9,
  });
}
