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
};

export type ScenarioRunInput = {
  horizonDays: number;
  perturbation: ScenarioPerturbation;
};
