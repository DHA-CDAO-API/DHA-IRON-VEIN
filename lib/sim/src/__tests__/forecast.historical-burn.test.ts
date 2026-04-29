import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDailyDemand } from "../forecast";
import type {
  SimDemandProfile,
  SimItem,
  SimOperationalState,
} from "../types";

const baseProfile: SimDemandProfile = {
  nodeId: "mtfDelta",
  activeSupportedPopulation: 10_000,
  dailyEncounterRate: 0.05,
  phlebotomyProbability: 0.4,
  specimensPerPhlebotomy: 2,
  operationalState: "garrison",
  wasteFactor: 1.1,
};

const itemPhleb: SimItem = {
  id: "tube_edta",
  name: "Lavender top tube",
  unit: "ea",
  criticality: "routine",
  usagePerDraw: 1,
  usageRate: 1,
  demandBasis: "per_phlebotomy",
  trigger: "phlebotomy_event",
  wasteAdjustedDemand: 1.1,
  shelfLifeDays: 365,
};

const itemHist: SimItem = {
  id: "cat_42",
  name: "Imported gauze",
  unit: "ea",
  criticality: "routine",
  usagePerDraw: 0,
  usageRate: 0,
  demandBasis: "per_population",
  trigger: "population",
  wasteAdjustedDemand: 0.0001,
  shelfLifeDays: 730,
};

test("computeDailyDemand: historical burn override drives daily quantity directly", () => {
  const histMap = new Map<string, number>([["cat_42", 12]]);

  const out = computeDailyDemand({
    profile: baseProfile,
    items: [itemHist],
    operationalState: undefined,
    itemSkew: {},
    historicalBurnByItem: histMap,
  });

  assert.equal(out.length, 1);
  assert.equal(out[0]!.itemId, "cat_42");
  // No state mult, no encounter mult, no skew → quantity equals raw burn rate.
  assert.equal(out[0]!.quantity, 12);
});

test("computeDailyDemand: historical burn flexes with operational state and encounter override", () => {
  const histMap = new Map<string, number>([["cat_42", 10]]);
  const opState: SimOperationalState = {
    id: "combat",
    label: "Major combat ops",
    encounterMultiplier: 2,
    populationMultiplier: 1,
  };

  const out = computeDailyDemand({
    profile: baseProfile,
    items: [itemHist],
    operationalState: opState,
    itemSkew: { cat_42: 1.5 },
    encounterMultiplierOverride: 1.25,
    historicalBurnByItem: histMap,
  });

  // 10 (rate) * 2 (stateMult) * 1.25 (encMult) * 1.5 (skew) = 37.5
  assert.equal(out[0]!.quantity, 37.5);
});

test("computeDailyDemand: items without a historical entry fall back to synthetic math", () => {
  const histMap = new Map<string, number>([["cat_42", 10]]);

  const out = computeDailyDemand({
    profile: baseProfile,
    items: [itemHist, itemPhleb],
    operationalState: undefined,
    itemSkew: {},
    historicalBurnByItem: histMap,
  });

  const hist = out.find((d) => d.itemId === "cat_42")!;
  const synth = out.find((d) => d.itemId === "tube_edta")!;

  // Historical-driven item uses the override.
  assert.equal(hist.quantity, 10);

  // Synthetic item uses the per-phlebotomy math:
  // pop=10000, encRate=0.05, phlebProb=0.4, waste=1.1, demand=1.1
  //   → 10000 * 0.05 * 0.4 * 1.1 * 1.1 = 242
  assert.ok(Math.abs(synth.quantity - 242) < 0.001);
});

test("computeDailyDemand: zero historical burn is treated as 'no override' and falls through", () => {
  const histMap = new Map<string, number>([["tube_edta", 0]]);

  const out = computeDailyDemand({
    profile: baseProfile,
    items: [itemPhleb],
    operationalState: undefined,
    itemSkew: {},
    historicalBurnByItem: histMap,
  });

  // Falls back to synthetic math (242, see prior test).
  assert.ok(Math.abs(out[0]!.quantity - 242) < 0.001);
});
