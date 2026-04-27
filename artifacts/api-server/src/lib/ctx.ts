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
} from "@workspace/db";
import type {
  ScenarioContext,
  SimDemandProfile,
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
    leadTimeDaysMean: s.leadTimeDaysMean,
    reliabilityScore: s.reliabilityScore,
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
