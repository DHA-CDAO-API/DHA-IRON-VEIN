export type SimNode = {
  id: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  population: number;
  optempo: string;
  stockDays: number;
  regionalHub?: string | null;
  upstreamNode?: string | null;
  countryCode?: string | null;
};

export type SimRoute = {
  id: string;
  fromNode: string;
  toNode: string;
  priority: "primary" | "secondary" | "tertiary";
  days: number;
  reliability: number;
  modality: string;
};

export type SimItem = {
  id: string;
  name: string;
  unitOfIssue: string;
  baseDemandPerEvent: number;
  wasteAdjustedDemand: number;
  trigger: string;
  criticality: string;
  leadTimeDays: number;
  // Optional commodity attributes used by the casualty / multi-class
  // supply model. Existing blood-only callers can ignore them.
  category?: string;
  classOfSupply?: string;
  commodityType?: string;
  unspscCommodity?: string;
  size?: string;
  productNoun?: string;
  staffingTag?: string;
};

export type SimDemandProfile = {
  nodeId: string;
  activeSupportedPopulation: number;
  dailyEncounterRate: number;
  phlebotomyProbability: number;
  specimensPerPhlebotomy: number;
  operationalState: string;
  wasteFactor: number;
};

export type SimOperationalState = {
  id: string;
  encounterMultiplier: number;
  populationMultiplier: number;
};

export type SimInventoryBalance = {
  nodeId: string;
  itemId: string;
  onHand: number;
  dueIn: number;
};

export type SimSupplier = {
  id: string;
  name: string;
  channel: string;
  leadTimeDaysMean: number;
  reliabilityScore: number;
  country?: string;
  unitCostUsd?: number;
  itemsCovered?: string[];
};

// Cold-chain failure cascade. Identifies which cold-chain assets (or asset
// types, or whole nodes) lose refrigeration. Liquid blood components held
// by those assets are aged out / compromised by the simulation.
export type ColdChainFailure = {
  // List of cold_chain_assets.id values that are knocked offline. Lots
  // referencing any of these IDs are considered exposed.
  assetIds?: string[];
  // Asset types (refrigerator | freezer | platelet_incubator | cryopreserver |
  // generator) to fail at the affected nodes. If present, all assets at the
  // affected nodes matching one of these types are marked failed.
  assetTypes?: string[];
  // Hours the cold chain has been out. Drives how aggressively lots age out.
  // Default: 24 (i.e., one full day of warmup).
  outageHours?: number;
  // 0..1 fraction of exposed liquid lots compromised at the start of the run
  // (in addition to age-out across the horizon). Default 0.3.
  initialCompromisedFraction?: number;
};

// Reagent/testing-supply shortage cascade. When testing supplies (ABO/Rh
// kits, crossmatch kits, infectious-disease screen) drop below the
// threshold at affected nodes, donor screening throughput collapses and
// the in-theater donation pipeline can't keep up.
export type ReagentShortage = {
  // Item IDs treated as gating reagents. Defaults to ABO/Rh + crossmatch +
  // infectious-disease screen.
  reagentItemIds?: string[];
  // Days-of-supply floor. Below this, collection capacity falls
  // proportionally. Default 3 days.
  thresholdDays?: number;
  // Hard cap on collection capacity multiplier when reagents are completely
  // exhausted. 0 = full pipeline halt. Default 0.
  minCapacityFraction?: number;
};

// Airlift loss cascade. Lengthens routes (already covered by routeDelayDays)
// AND degrades viability of in-transit blood lots by the extra time spent
// on cold packs.
export type AirliftLoss = {
  // Extra days added on top of routeDelayDays for affected airlift routes.
  // Default 2.
  additionalTransitDays?: number;
  // Viability haircut applied to arriving blood lots, expressed as a
  // fraction of units lost per extra transit day. Default 0.1 (10% per day).
  viabilityLossPerDay?: number;
  // Modalities considered "airlift" when scoping the cascade. Default
  // ["air", "airlift"].
  affectedModalities?: string[];
};

export type ScenarioPerturbation = {
  affectedNodes?: string[];
  encounterMultiplier?: number;
  populationMultiplier?: number;
  wasteMultiplier?: number;
  routeReliabilityDelta?: number;
  routeDelayDays?: number;
  closedRoutes?: string[];
  specimensMultiplier?: number;
  itemSkew?: Record<string, number>;
  coldChain?: ColdChainFailure;
  reagent?: ReagentShortage;
  airlift?: AirliftLoss;
};

// Per-node blood lot used by the cold-chain cascade and airlift cascade.
export type SimBloodLot = {
  id: string;
  nodeId: string;
  itemId: string;
  component: string;
  aboGroup?: string | null;
  rhFactor?: string | null;
  units: number;
  status: string;
  coldChainAssetId?: string | null;
  // ISO timestamp; allows airlift-loss to discount near-expiry lots harder.
  expiresAt?: string;
};

export type SimColdChainAsset = {
  id: string;
  nodeId: string;
  assetType: string;
  name?: string;
  status: string;
  capacityUnits?: number;
  hasGenerator?: boolean;
  fuelDaysRemaining?: number;
};

export type SimDonorPool = {
  nodeId: string;
  weeklyCollectionCapacity: number;
  eligibleDonors?: number;
};

export type ScenarioRunInput = {
  horizonDays: number;
  perturbation: ScenarioPerturbation;
};
