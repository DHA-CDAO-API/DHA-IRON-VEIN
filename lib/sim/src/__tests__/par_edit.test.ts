import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDailyDemand } from "../forecast";
import { runScenario } from "../scenarios";
import type {
  ScenarioContext,
  ScenarioRunInput,
  SimDemandProfile,
  SimInventoryBalance,
  SimItem,
  SimNode,
  SimOperationalState,
  SimRoute,
} from "../types";

const item: SimItem = {
  id: "iv_set",
  name: "IV Set",
  unitOfIssue: "ea",
  baseDemandPerEvent: 1,
  wasteAdjustedDemand: 1,
  trigger: "population",
  criticality: "high",
  leadTimeDays: 5,
};

const baseProfile = (par: number): SimDemandProfile => ({
  nodeId: "fwd",
  operationalState: "garrison",
  wasteFactor: 1,
  activeSupportedPopulation: par,
  dailyEncounterRate: 0.05,
  phlebotomyProbability: 0.2,
  specimensPerPhlebotomy: 1,
});

const garrison: SimOperationalState = {
  id: "garrison",
  encounterMultiplier: 1,
  populationMultiplier: 1,
};

test("scenario populationMultiplier compounds on top of an edited PAR, not the seeded one", () => {
  const editedPar = 35_000;
  const editedDemand = computeDailyDemand({
    profile: baseProfile(editedPar),
    items: [item],
    operationalState: garrison,
    itemSkew: {},
    populationMultiplierOverride: 1.5,
  });
  assert.equal(editedDemand.length, 1);
  // effectivePop = 35,000 * 1.0 (state) * 1.5 (perturbation) = 52,500
  assert.equal(editedDemand[0].quantity, 52_500);

  const noScenarioDemand = computeDailyDemand({
    profile: baseProfile(editedPar),
    items: [item],
    operationalState: garrison,
    itemSkew: {},
  });
  assert.equal(noScenarioDemand[0].quantity, 35_000);
});

test("runScenario layers populationMultiplier on the persisted PAR (post-edit)", () => {
  const node: SimNode = {
    id: "fwd",
    name: "Forward MTF",
    type: "Large MTF",
    latitude: 0,
    longitude: 0,
    population: 35_000,
    optempo: "garrison",
    stockDays: 14,
    regionalHub: "hub",
    upstreamNode: "hub",
    countryCode: "JP",
  };
  const route: SimRoute = {
    id: "r1",
    fromNode: "hub",
    toNode: "fwd",
    priority: "primary",
    days: 2,
    reliability: 0.95,
    modality: "air",
  };
  const balances: SimInventoryBalance[] = [
    { nodeId: "fwd", itemId: "iv_set", onHand: 200_000, dueIn: 0 },
  ];
  const profiles = new Map<string, SimDemandProfile>([
    ["fwd", baseProfile(35_000)],
  ]);
  const states = new Map<string, SimOperationalState>([
    ["garrison", garrison],
  ]);

  const ctx: ScenarioContext = {
    nodes: [node],
    routes: [route],
    items: [item],
    balances,
    profiles,
    states,
    itemSkew: {},
    watchDays: 14,
    criticalDays: 5,
    bloodLots: [],
    coldChainAssets: [],
    donorPools: [],
  };

  const input: ScenarioRunInput = {
    horizonDays: 7,
    perturbation: {
      affectedNodes: ["fwd"],
      populationMultiplier: 2,
    },
  };

  const outcome = runScenario(ctx, input);
  const shortfall = outcome.perItemShortfall.find(
    (s) => s.nodeId === "fwd" && s.itemId === "iv_set",
  );
  assert.ok(shortfall, "iv_set shortfall is reported for the affected node");
  // effectivePop = 35,000 * 1 (state) * 2 (perturbation) = 70,000
  assert.equal(
    shortfall.peakDemandPerDay,
    70_000,
    "scenario layers on the edited 35,000 PAR, not a seeded baseline",
  );
});
