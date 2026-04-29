import {
  db,
  bloodLots,
  coldChainAssets,
  donorPools,
  temperatureEvents,
  inventoryBalances,
  items as itemsTable,
  nodes as nodesTable,
  type BloodLot,
  type ColdChainAsset,
  type DonorPool,
  type TemperatureEvent,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { loadSimContext } from "./ctx";
import { computeDailyDemand, projectDaysOfSupply } from "@workspace/sim";

// Items considered critical reagents/kits whose availability gates either
// donor qualification (ID screen) or transfusion (typing/crossmatch).
export const TESTING_SUPPLY_ITEMS: Array<{
  itemId: string;
  label: string;
  constrains: "collection" | "transfusion" | "both";
}> = [
  { itemId: "abo_kit", label: "ABO/Rh Typing Kit", constrains: "both" },
  { itemId: "crossmatch", label: "Crossmatch Test Kit", constrains: "transfusion" },
  { itemId: "id_screen", label: "Infectious Disease Screen", constrains: "collection" },
  { itemId: "collection_bag", label: "Blood Collection Bag", constrains: "collection" },
];

export type ViabilityRow = {
  component: string;
  aboGroup: string | null;
  rhFactor: string | null;
  viableUnits: number;
  nearExpiryUnits: number;
  expiredUnits: number;
  compromisedUnits: number;
};

export type ColdChainAssetView = {
  id: string;
  assetType: string;
  name: string;
  status: string;
  currentTempC: number;
  targetTempMinC: number;
  targetTempMaxC: number;
  hasGenerator: boolean;
  fuelDaysRemaining: number;
  capacityUnits: number;
  lastCheckedAt: string;
};

export type TestingSupplyView = {
  itemId: string;
  itemName: string;
  onHand: number;
  dailyBurn: number;
  daysOfSupply: number;
  constrains: "collection" | "transfusion" | "both";
  isConstraint: boolean;
};

export type WbbReadyByType = {
  oPos: number;
  oNeg: number;
  aPos: number;
  aNeg: number;
  bPos: number;
  bNeg: number;
  abPos: number;
  abNeg: number;
  total: number;
};

export type NodeBloodReadiness = {
  nodeId: string;
  totalViableUnits: number;
  unitsExpiringWithin24h: number;
  unitsExpiringWithin72h: number;
  unitsExpiringWithin7d: number;
  // Days of supply against current demand using only viable units (i.e. not
  // counting lots that will expire in the lead-time window).
  viableDaysOfSupply: number;
  viability: ViabilityRow[];
  coldChain: {
    assets: ColdChainAssetView[];
    healthPercent: number;
    activeExcursions: number;
    failedAssets: number;
    minFuelDaysRemaining: number;
  };
  donors: {
    eligibleDonors: number;
    weeklyCollectionCapacity: number;
    effectiveCollectionCapacity: number;
    wbbReady: WbbReadyByType;
    lastDriveAt: string | null;
  };
  testingSupplies: {
    items: TestingSupplyView[];
    minDaysOfSupply: number;
    constraintsCollection: boolean;
    constraintsTransfusion: boolean;
  };
};

export type NodeBloodReadinessRollup = {
  nodeId: string;
  viableDaysOfSupply: number;
  totalViableUnits: number;
  unitsExpiringWithin72h: number;
  tier: "nominal" | "heightened" | "critical";
};

export type TheaterBloodReadiness = {
  totalViableUnits: number;
  unitsExpiringWithin24h: number;
  unitsExpiringWithin72h: number;
  unitsExpiringWithin7d: number;
  coldChainHealthPercent: number;
  coldChainAssetsTotal: number;
  coldChainAssetsExcursion: number;
  coldChainAssetsFailed: number;
  walkingBloodBankReadyDonors: number;
  reagentDaysRemaining: number;
  nodesWithBlood: number;
  nodesWithCriticalShortage: number;
};

const DAY_MS = 86_400_000;

function daysUntil(d: Date, nowMs: number): number {
  return (d.getTime() - nowMs) / DAY_MS;
}

function bucketLot(lot: BloodLot, nowMs: number) {
  const dDays = daysUntil(lot.expiresAt, nowMs);
  const expired = dDays < 0;
  const nearExpiry = !expired && dDays <= 3;
  const w24 = !expired && dDays <= 1;
  const w72 = !expired && dDays <= 3;
  const w7 = !expired && dDays <= 7;
  return { expired, nearExpiry, w24, w72, w7 };
}

function buildViability(lots: BloodLot[], nowMs: number): ViabilityRow[] {
  const map = new Map<string, ViabilityRow>();
  for (const lot of lots) {
    const key = `${lot.component}|${lot.aboGroup ?? ""}|${lot.rhFactor ?? ""}`;
    let row = map.get(key);
    if (!row) {
      row = {
        component: lot.component,
        aboGroup: lot.aboGroup,
        rhFactor: lot.rhFactor,
        viableUnits: 0,
        nearExpiryUnits: 0,
        expiredUnits: 0,
        compromisedUnits: 0,
      };
      map.set(key, row);
    }
    if (lot.status === "COMPROMISED") {
      row.compromisedUnits += lot.units;
      continue;
    }
    const b = bucketLot(lot, nowMs);
    if (b.expired || lot.status === "EXPIRED") {
      row.expiredUnits += lot.units;
    } else if (b.nearExpiry || lot.status === "NEAR_EXPIRY") {
      row.nearExpiryUnits += lot.units;
      row.viableUnits += lot.units;
    } else {
      row.viableUnits += lot.units;
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.component !== b.component) return a.component.localeCompare(b.component);
    return (a.aboGroup ?? "").localeCompare(b.aboGroup ?? "");
  });
}

function summarizeColdChain(assets: ColdChainAsset[]) {
  const generators = assets.filter((a) => a.assetType === "generator");
  const storage = assets.filter((a) => a.assetType !== "generator");
  let healthScore = 0;
  for (const a of storage) {
    if (a.status === "NOMINAL") healthScore += 1;
    else if (a.status === "EXCURSION") healthScore += 0.4;
  }
  const healthPercent = storage.length > 0 ? (healthScore / storage.length) * 100 : 100;
  const minFuel = generators.length > 0
    ? Math.min(...generators.map((g) => g.fuelDaysRemaining))
    : 0;
  return {
    healthPercent: Number(healthPercent.toFixed(1)),
    activeExcursions: storage.filter((a) => a.status === "EXCURSION").length,
    failedAssets: storage.filter((a) => a.status === "FAILED").length,
    minFuelDaysRemaining: Number(minFuel.toFixed(1)),
  };
}

function donorTotals(p: DonorPool): WbbReadyByType {
  const total =
    p.wbbReadyOPos +
    p.wbbReadyONeg +
    p.wbbReadyAPos +
    p.wbbReadyANeg +
    p.wbbReadyBPos +
    p.wbbReadyBNeg +
    p.wbbReadyAbPos +
    p.wbbReadyAbNeg;
  return {
    oPos: p.wbbReadyOPos,
    oNeg: p.wbbReadyONeg,
    aPos: p.wbbReadyAPos,
    aNeg: p.wbbReadyANeg,
    bPos: p.wbbReadyBPos,
    bNeg: p.wbbReadyBNeg,
    abPos: p.wbbReadyAbPos,
    abNeg: p.wbbReadyAbNeg,
    total,
  };
}

export async function computeNodeBloodReadiness(
  nodeId: string,
): Promise<NodeBloodReadiness | null> {
  const [node] = await db.select().from(nodesTable).where(eq(nodesTable.id, nodeId));
  if (!node) return null;

  const [lots, assets, donorRow, balanceRows, ctx, allItems] = await Promise.all([
    db.select().from(bloodLots).where(eq(bloodLots.nodeId, nodeId)),
    db.select().from(coldChainAssets).where(eq(coldChainAssets.nodeId, nodeId)),
    db.select().from(donorPools).where(eq(donorPools.nodeId, nodeId)),
    db.select().from(inventoryBalances).where(eq(inventoryBalances.nodeId, nodeId)),
    loadSimContext(),
    db.select().from(itemsTable),
  ]);

  // Nodes that hold no blood and have no cold-chain assets and no donor pool
  // (e.g. suppliers / prime vendors) are not blood-storing — return null so
  // downstream UIs can skip the section entirely.
  if (lots.length === 0 && assets.length === 0 && !donorRow[0]) {
    return null;
  }

  const itemMap = new Map(allItems.map((i) => [i.id, i]));
  const nowMs = Date.now();

  // ---- Viability ----
  const viability = buildViability(lots, nowMs);
  let totalViableUnits = 0;
  let w24 = 0;
  let w72 = 0;
  let w7 = 0;
  for (const lot of lots) {
    if (lot.status === "COMPROMISED" || lot.status === "EXPIRED") continue;
    const b = bucketLot(lot, nowMs);
    if (b.expired) continue;
    totalViableUnits += lot.units;
    if (b.w24) w24 += lot.units;
    if (b.w72) w72 += lot.units;
    if (b.w7) w7 += lot.units;
  }

  // Per-node demand for blood-product items only (used to back out viable DOS)
  const profile = ctx.ctx.profiles.get(nodeId);
  const historicalBurnByItem = ctx.historicalBurn.get(nodeId);
  let bloodDemandPerDay = 0;
  if (profile) {
    const demands = computeDailyDemand({
      profile,
      items: ctx.ctx.items,
      operationalState: ctx.ctx.states.get(profile.operationalState),
      itemSkew: ctx.ctx.itemSkew,
      historicalBurnByItem,
    });
    for (const d of demands) {
      const item = itemMap.get(d.itemId);
      if (item?.category === "blood_products") bloodDemandPerDay += d.quantity;
    }
  }
  // Subtract the units that will expire in the lead-time window so the DOS
  // metric reflects what is actually transfusable.
  const usableUnits = Math.max(0, totalViableUnits - w7);
  const viableDaysOfSupply = projectDaysOfSupply(usableUnits, bloodDemandPerDay);

  // ---- Cold-chain ----
  const ccSummary = summarizeColdChain(assets);
  const ccAssets: ColdChainAssetView[] = assets.map((a) => ({
    id: a.id,
    assetType: a.assetType,
    name: a.name,
    status: a.status,
    currentTempC: a.currentTempC,
    targetTempMinC: a.targetTempMinC,
    targetTempMaxC: a.targetTempMaxC,
    hasGenerator: a.hasGenerator,
    fuelDaysRemaining: a.fuelDaysRemaining,
    capacityUnits: a.capacityUnits,
    lastCheckedAt: a.lastCheckedAt.toISOString(),
  }));

  // ---- Testing supplies ----
  const balanceMap = new Map(balanceRows.map((b) => [b.itemId, b.onHand]));
  const burnByItem = new Map<string, number>();
  if (profile) {
    const demands = computeDailyDemand({
      profile,
      items: ctx.ctx.items,
      operationalState: ctx.ctx.states.get(profile.operationalState),
      itemSkew: ctx.ctx.itemSkew,
      historicalBurnByItem,
    });
    for (const d of demands) burnByItem.set(d.itemId, d.quantity);
  }
  const testingItems: TestingSupplyView[] = TESTING_SUPPLY_ITEMS.map((spec) => {
    const onHand = balanceMap.get(spec.itemId) ?? 0;
    const burn = burnByItem.get(spec.itemId) ?? 0;
    const dos = projectDaysOfSupply(onHand, burn);
    const isConstraint = dos <= ctx.ctx.criticalDays;
    return {
      itemId: spec.itemId,
      itemName: itemMap.get(spec.itemId)?.name ?? spec.itemId,
      onHand,
      dailyBurn: Number(burn.toFixed(2)),
      daysOfSupply: Number(Number.isFinite(dos) ? dos.toFixed(1) : "999"),
      constrains: spec.constrains,
      isConstraint,
    };
  });
  const minTestingDOS = testingItems.reduce(
    (m, t) => Math.min(m, t.daysOfSupply),
    999,
  );
  const constraintsCollection = testingItems.some(
    (t) => t.isConstraint && (t.constrains === "collection" || t.constrains === "both"),
  );
  const constraintsTransfusion = testingItems.some(
    (t) => t.isConstraint && (t.constrains === "transfusion" || t.constrains === "both"),
  );

  // ---- Donors ----
  const donor = donorRow[0];
  const wbbReady = donor
    ? donorTotals(donor)
    : {
        oPos: 0, oNeg: 0, aPos: 0, aNeg: 0, bPos: 0, bNeg: 0, abPos: 0, abNeg: 0, total: 0,
      };
  const baseCapacity = donor?.weeklyCollectionCapacity ?? 0;
  // If reagents are short, effective collection drops — use the worst of the
  // collection-side testing supplies as a haircut from 0 to 1.
  const collectionConstraint = testingItems
    .filter((t) => t.constrains === "collection" || t.constrains === "both")
    .reduce((min, t) => Math.min(min, t.daysOfSupply), 999);
  const haircut = collectionConstraint <= 0 ? 0
    : collectionConstraint <= 3 ? 0.25
    : collectionConstraint <= 7 ? 0.6
    : collectionConstraint <= 14 ? 0.85
    : 1;
  const effectiveCollectionCapacity = Math.round(baseCapacity * haircut);

  return {
    nodeId,
    totalViableUnits,
    unitsExpiringWithin24h: w24,
    unitsExpiringWithin72h: w72,
    unitsExpiringWithin7d: w7,
    viableDaysOfSupply: Number.isFinite(viableDaysOfSupply)
      ? Number(viableDaysOfSupply.toFixed(1))
      : 999,
    viability,
    coldChain: {
      assets: ccAssets,
      ...ccSummary,
    },
    donors: {
      eligibleDonors: donor?.eligibleDonors ?? 0,
      weeklyCollectionCapacity: baseCapacity,
      effectiveCollectionCapacity,
      wbbReady,
      lastDriveAt: donor?.lastDriveAt ? donor.lastDriveAt.toISOString() : null,
    },
    testingSupplies: {
      items: testingItems,
      minDaysOfSupply: Number(minTestingDOS.toFixed(1)),
      constraintsCollection,
      constraintsTransfusion,
    },
  };
}

// Tier thresholds for viable blood DOS — blood is more perishable than other
// supply classes, so the cutoffs are tighter than the global risk tiering.
const BLOOD_CRITICAL_DAYS = 3;
const BLOOD_HEIGHTENED_DAYS = 7;

function tierForBloodDos(dos: number): "nominal" | "heightened" | "critical" {
  if (!Number.isFinite(dos)) return "nominal";
  if (dos <= BLOOD_CRITICAL_DAYS) return "critical";
  if (dos <= BLOOD_HEIGHTENED_DAYS) return "heightened";
  return "nominal";
}

// Lightweight per-node viable blood-DOS roll-up. Used by the network map
// sidebar widget; intentionally avoids the heavy cold-chain / donor /
// reagent computation that the per-site readiness payload performs.
export async function computeBloodReadinessByNode(): Promise<NodeBloodReadinessRollup[]> {
  const [allLots, allDonors, ctx, allItems] = await Promise.all([
    db.select().from(bloodLots),
    db.select().from(donorPools),
    loadSimContext(),
    db.select().from(itemsTable),
  ]);

  const itemMap = new Map(allItems.map((i) => [i.id, i]));
  const nowMs = Date.now();

  // Bucket all lots by node, accumulating viable / near-expiry counts.
  const lotsByNode = new Map<string, { viable: number; w72: number; w7: number }>();
  for (const lot of allLots) {
    if (lot.status === "COMPROMISED" || lot.status === "EXPIRED") continue;
    const b = bucketLot(lot, nowMs);
    if (b.expired) continue;
    const cur = lotsByNode.get(lot.nodeId) ?? { viable: 0, w72: 0, w7: 0 };
    cur.viable += lot.units;
    if (b.w72) cur.w72 += lot.units;
    if (b.w7) cur.w7 += lot.units;
    lotsByNode.set(lot.nodeId, cur);
  }

  const donorByNode = new Set(allDonors.map((d) => d.nodeId));

  const out: NodeBloodReadinessRollup[] = [];
  for (const node of ctx.ctx.nodes) {
    const lots = lotsByNode.get(node.id);
    const hasDonor = donorByNode.has(node.id);
    if (!lots && !hasDonor) continue;
    const viable = lots?.viable ?? 0;
    const w7 = lots?.w7 ?? 0;
    const w72 = lots?.w72 ?? 0;

    // Per-node blood-product daily demand
    const profile = ctx.ctx.profiles.get(node.id);
    let bloodDemandPerDay = 0;
    if (profile) {
      const demands = computeDailyDemand({
        profile,
        items: ctx.ctx.items,
        operationalState: ctx.ctx.states.get(profile.operationalState),
        itemSkew: ctx.ctx.itemSkew,
        historicalBurnByItem: ctx.historicalBurn.get(node.id),
      });
      for (const d of demands) {
        const item = itemMap.get(d.itemId);
        if (item?.category === "blood_products") bloodDemandPerDay += d.quantity;
      }
    }
    const usable = Math.max(0, viable - w7);
    const dosRaw = projectDaysOfSupply(usable, bloodDemandPerDay);
    const viableDaysOfSupply = Number.isFinite(dosRaw)
      ? Number(dosRaw.toFixed(1))
      : 999;

    out.push({
      nodeId: node.id,
      viableDaysOfSupply,
      totalViableUnits: viable,
      unitsExpiringWithin72h: w72,
      tier: tierForBloodDos(viableDaysOfSupply),
    });
  }
  return out;
}

export async function computeTheaterBloodReadiness(): Promise<TheaterBloodReadiness> {
  const [allLots, allAssets, allDonors, ctx, allItems, allBalances] = await Promise.all([
    db.select().from(bloodLots),
    db.select().from(coldChainAssets),
    db.select().from(donorPools),
    loadSimContext(),
    db.select().from(itemsTable),
    db.select().from(inventoryBalances),
  ]);
  const nowMs = Date.now();

  let totalViableUnits = 0;
  let w24 = 0;
  let w72 = 0;
  let w7 = 0;
  const lotsByNode = new Map<string, BloodLot[]>();
  for (const lot of allLots) {
    const arr = lotsByNode.get(lot.nodeId) ?? [];
    arr.push(lot);
    lotsByNode.set(lot.nodeId, arr);
    if (lot.status === "COMPROMISED" || lot.status === "EXPIRED") continue;
    const b = bucketLot(lot, nowMs);
    if (b.expired) continue;
    totalViableUnits += lot.units;
    if (b.w24) w24 += lot.units;
    if (b.w72) w72 += lot.units;
    if (b.w7) w7 += lot.units;
  }

  // Cold-chain — aggregate health score across all storage assets in theater
  const storage = allAssets.filter((a) => a.assetType !== "generator");
  let totalScore = 0;
  for (const a of storage) {
    if (a.status === "NOMINAL") totalScore += 1;
    else if (a.status === "EXCURSION") totalScore += 0.4;
  }
  const healthPercent = storage.length > 0 ? (totalScore / storage.length) * 100 : 100;
  const excursion = storage.filter((a) => a.status === "EXCURSION").length;
  const failed = storage.filter((a) => a.status === "FAILED").length;

  let totalWbbReady = 0;
  for (const d of allDonors) totalWbbReady += donorTotals(d).total;

  // Reagent days remaining — minimum DOS across critical reagents/kits
  // network-wide.
  const itemMap = new Map(allItems.map((i) => [i.id, i]));
  const balanceByKey = new Map<string, number>();
  for (const b of allBalances) balanceByKey.set(`${b.nodeId}:${b.itemId}`, b.onHand);
  let minReagentDOS = 999;
  let nodesWithCriticalShortage = 0;
  for (const node of ctx.ctx.nodes) {
    const profile = ctx.ctx.profiles.get(node.id);
    if (!profile) continue;
    const lots = lotsByNode.get(node.id);
    if (!lots || lots.length === 0) continue;
    const demands = computeDailyDemand({
      profile,
      items: ctx.ctx.items,
      operationalState: ctx.ctx.states.get(profile.operationalState),
      itemSkew: ctx.ctx.itemSkew,
      historicalBurnByItem: ctx.historicalBurn.get(node.id),
    });
    let nodeMinDOS = 999;
    for (const reagent of TESTING_SUPPLY_ITEMS) {
      const onHand = balanceByKey.get(`${node.id}:${reagent.itemId}`) ?? 0;
      const burn = demands.find((d) => d.itemId === reagent.itemId)?.quantity ?? 0;
      const dos = projectDaysOfSupply(onHand, burn);
      if (dos < nodeMinDOS) nodeMinDOS = dos;
    }
    if (nodeMinDOS < minReagentDOS) minReagentDOS = nodeMinDOS;
    if (nodeMinDOS <= ctx.ctx.criticalDays) nodesWithCriticalShortage++;
  }
  void itemMap; // suppress unused warn — itemMap reserved for future per-item rollup

  return {
    totalViableUnits,
    unitsExpiringWithin24h: w24,
    unitsExpiringWithin72h: w72,
    unitsExpiringWithin7d: w7,
    coldChainHealthPercent: Number(healthPercent.toFixed(1)),
    coldChainAssetsTotal: storage.length,
    coldChainAssetsExcursion: excursion,
    coldChainAssetsFailed: failed,
    walkingBloodBankReadyDonors: totalWbbReady,
    reagentDaysRemaining: Number(minReagentDOS.toFixed(1)),
    nodesWithBlood: lotsByNode.size,
    nodesWithCriticalShortage,
  };
}

// Convenience for routes that need the most recent excursion events for a node.
export async function listRecentTemperatureEvents(
  nodeId: string,
  limit = 10,
): Promise<TemperatureEvent[]> {
  const rows = await db
    .select()
    .from(temperatureEvents)
    .where(eq(temperatureEvents.nodeId, nodeId));
  return rows
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, limit);
}
