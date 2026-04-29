import { db } from "@workspace/db";
import {
  nodes as nodesTable,
  routes as routesTable,
  items as itemsTable,
  inventoryBalances as balancesTable,
  suppliers as suppliersTable,
  demandProfiles as profilesTable,
  operationalStates as statesTable,
  itemSkewFactors as skewTable,
  appSettings as settingsTable,
  bloodLots as bloodLotsTable,
  coldChainAssets as coldChainAssetsTable,
  donorPools as donorPoolsTable,
} from "@workspace/db";
import type {
  ScenarioContext,
  SimBloodLot,
  SimColdChainAsset,
  SimDemandProfile,
  SimDonorPool,
  SimInventoryBalance,
  SimItem,
  SimNode,
  SimOperationalState,
  SimRoute,
  SimSupplier,
} from "@workspace/sim";

export type RouteWithCast = SimRoute;

let cache:
  | {
      builtAt: number;
      ctx: ScenarioContext;
      suppliers: SimSupplier[];
      paddingDays: number;
    }
  | undefined;

export async function loadSimContext(force = false): Promise<{
  ctx: ScenarioContext;
  suppliers: SimSupplier[];
  paddingDays: number;
}> {
  if (cache && !force && Date.now() - cache.builtAt < 5000) {
    return cache;
  }
  const [
    nodesRows,
    routesRows,
    itemsRows,
    balancesRows,
    suppliersRows,
    profilesRows,
    statesRows,
    skewRows,
    settingsRows,
    bloodLotsRows,
    coldChainAssetsRows,
    donorPoolsRows,
  ] = await Promise.all([
    db.select().from(nodesTable),
    db.select().from(routesTable),
    db.select().from(itemsTable),
    db.select().from(balancesTable),
    db.select().from(suppliersTable),
    db.select().from(profilesTable),
    db.select().from(statesTable),
    db.select().from(skewTable),
    db.select().from(settingsTable),
    db.select().from(bloodLotsTable),
    db.select().from(coldChainAssetsTable),
    db.select().from(donorPoolsTable),
  ]);

  const settings = settingsRows[0];

  const nodes: SimNode[] = nodesRows.map((n) => ({ ...n }));
  const routes: SimRoute[] = routesRows.map((r) => ({
    id: r.id,
    fromNode: r.fromNode,
    toNode: r.toNode,
    priority: (r.priority as SimRoute["priority"]) ?? "secondary",
    days: r.days,
    reliability: r.reliability,
    modality: r.modality,
  }));
  const items: SimItem[] = itemsRows.map((i) => ({
    id: i.id,
    name: i.name,
    unitOfIssue: i.unitOfIssue,
    baseDemandPerEvent: i.baseDemandPerEvent,
    wasteAdjustedDemand: i.wasteAdjustedDemand,
    trigger: i.trigger,
    criticality: i.criticality,
    leadTimeDays: i.leadTimeDays,
    category: i.category,
    classOfSupply: i.classOfSupply,
    commodityType: i.commodityType,
    unspscCommodity: i.unspscCommodity,
    size: i.size,
    productNoun: i.productNoun,
    staffingTag: i.staffingTag,
  }));
  const profiles = new Map<string, SimDemandProfile>(
    profilesRows.map((p) => [p.nodeId, { ...p }]),
  );
  const states = new Map<string, SimOperationalState>(
    statesRows.map((s) => [
      s.id,
      {
        id: s.id,
        encounterMultiplier: s.encounterMultiplier,
        populationMultiplier: s.populationMultiplier,
      },
    ]),
  );
  const balances: SimInventoryBalance[] = balancesRows.map((b) => ({
    nodeId: b.nodeId,
    itemId: b.itemId,
    onHand: b.onHand,
    dueIn: b.dueIn,
  }));
  const itemSkew: Record<string, number> = {};
  for (const s of skewRows) itemSkew[s.itemId] = s.factor;

  const suppliers: SimSupplier[] = suppliersRows.map((s) => ({
    id: s.id,
    name: s.name,
    channel: s.channel,
    country: s.country,
    leadTimeDaysMean: s.leadTimeDaysMean,
    reliabilityScore: s.reliabilityScore,
    itemsCovered: Array.isArray(s.itemsCoveredIds) ? s.itemsCoveredIds : [],
  }));

  const bloodLots: SimBloodLot[] = bloodLotsRows.map((l) => ({
    id: l.id,
    nodeId: l.nodeId,
    itemId: l.itemId,
    component: l.component,
    aboGroup: l.aboGroup ?? null,
    rhFactor: l.rhFactor ?? null,
    units: l.units,
    expiresAt: l.expiresAt instanceof Date ? l.expiresAt.toISOString() : String(l.expiresAt),
    status: l.status,
    coldChainAssetId: l.coldChainAssetId ?? null,
  }));
  const coldChainAssets: SimColdChainAsset[] = coldChainAssetsRows.map((a) => ({
    id: a.id,
    nodeId: a.nodeId,
    assetType: a.assetType,
    name: a.name,
    status: a.status,
    capacityUnits: a.capacityUnits,
    hasGenerator: a.hasGenerator,
    fuelDaysRemaining: a.fuelDaysRemaining,
  }));
  const donorPools: SimDonorPool[] = donorPoolsRows.map((d) => ({
    nodeId: d.nodeId,
    eligibleDonors: d.eligibleDonors,
    weeklyCollectionCapacity: d.weeklyCollectionCapacity,
  }));

  const ctx: ScenarioContext = {
    nodes,
    routes,
    items,
    profiles,
    states,
    balances,
    itemSkew,
    watchDays: settings?.alertWatchThresholdDays ?? 14,
    criticalDays: settings?.alertCriticalThresholdDays ?? 5,
    bloodLots,
    coldChainAssets,
    donorPools,
  };

  cache = {
    builtAt: Date.now(),
    ctx,
    suppliers,
    paddingDays: settings?.demandPaddingDays ?? 7,
  };
  return cache;
}

export function invalidateSimCache(): void {
  cache = undefined;
}
