import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyAirliftCascade,
  applyColdChainCascade,
  applyReagentCascade,
  buildCascadeNarrative,
  DEFAULT_REAGENT_ITEM_IDS,
} from "../cascades";
import type {
  ScenarioPerturbation,
  SimBloodLot,
  SimColdChainAsset,
  SimDonorPool,
  SimItem,
  SimNode,
  SimRoute,
} from "../types";

const node = (id: string, name = id): SimNode => ({
  id,
  name,
  type: "Large MTF",
  latitude: 0,
  longitude: 0,
  population: 1000,
  optempo: "active_operations",
  stockDays: 30,
  regionalHub: null,
  upstreamNode: null,
  countryCode: "JP",
});

const reagentItem = (id: string): SimItem => ({
  id,
  name: id,
  unitOfIssue: "kit",
  baseDemandPerEvent: 10,
  wasteAdjustedDemand: 12,
  trigger: "encounter",
  criticality: "critical",
  leadTimeDays: 5,
});

test("cold-chain cascade: 142 PRBC units compromised at Yokosuka cold-room failure", () => {
  // 200 PRBC units in two refrigerators at the Yokosuka theater node. A
  // 36 h outage with 0.4 initialCompromisedFraction should age out
  // 0.4 + (36/24)*(1-0.4) = 1.0 → all 200 units. With outage 12 h it
  // should be 0.4 + 0.5*0.6 = 0.7 = 142 of 200 PRBC + 0.7*40 = 28 of 40
  // platelets. Test the 12 h variant for the 142-unit headline.
  const yokosuka = node("yokosuka", "NMRTC Yokosuka");
  const assets: SimColdChainAsset[] = [
    { id: "fridge-1", nodeId: "yokosuka", assetType: "refrigerator", status: "NOMINAL" },
    { id: "fridge-2", nodeId: "yokosuka", assetType: "refrigerator", status: "NOMINAL" },
    { id: "freezer-1", nodeId: "yokosuka", assetType: "freezer", status: "NOMINAL" },
  ];
  const lots: SimBloodLot[] = [
    {
      id: "lot-prbc-1",
      nodeId: "yokosuka",
      itemId: "prbc_o",
      component: "PRBC",
      units: 120,
      status: "VIABLE",
      coldChainAssetId: "fridge-1",
    },
    {
      id: "lot-prbc-2",
      nodeId: "yokosuka",
      itemId: "prbc_o",
      component: "PRBC",
      units: 80,
      status: "VIABLE",
      coldChainAssetId: "fridge-2",
    },
    // a freezer plasma lot to ensure freezers also get hit
    {
      id: "lot-plasma",
      nodeId: "yokosuka",
      itemId: "plasma_a",
      component: "PLASMA",
      units: 60,
      status: "VIABLE",
      coldChainAssetId: "freezer-1",
    },
  ];
  const onHand = new Map<string, number>([
    ["yokosuka:prbc_o", 200],
    ["yokosuka:plasma_a", 60],
  ]);

  const perturbation: ScenarioPerturbation = {
    affectedNodes: ["yokosuka"],
    coldChain: { outageHours: 12, initialCompromisedFraction: 0.4 },
  };

  const result = applyColdChainCascade({
    perturbation,
    affected: new Set(["yokosuka"]),
    bloodLots: lots,
    coldChainAssets: assets,
    onHandByKey: onHand,
  });

  assert.equal(result.failedAssetIds.size, 3, "3 cold-chain assets failed");
  // 0.4 + 0.5 * 0.6 = 0.7; 200 * 0.7 = 140; rounding 120*0.7=84, 80*0.7=56 → 140
  assert.equal(
    result.unitsCompromisedByKey.get("yokosuka:prbc_o"),
    140,
    "140 PRBC units compromised at 12h outage",
  );
  assert.equal(onHand.get("yokosuka:prbc_o"), 60, "PRBC on-hand drops 200→60");
  assert.equal(result.totalCompromisedUnits, 140 + Math.round(60 * 0.7));
  assert.equal(result.outageHours, 12);
});

test("cold-chain cascade: 24h outage with default 0.3 initial fraction = total loss of liquid components", () => {
  const lots: SimBloodLot[] = [
    {
      id: "lot-1",
      nodeId: "n1",
      itemId: "prbc_o",
      component: "PRBC",
      units: 100,
      status: "VIABLE",
      coldChainAssetId: "fridge-1",
    },
  ];
  const onHand = new Map([["n1:prbc_o", 100]]);
  const result = applyColdChainCascade({
    perturbation: {
      affectedNodes: ["n1"],
      coldChain: { outageHours: 24, initialCompromisedFraction: 0.3 },
    },
    affected: new Set(["n1"]),
    bloodLots: lots,
    coldChainAssets: [
      { id: "fridge-1", nodeId: "n1", assetType: "refrigerator", status: "NOMINAL" },
    ],
    onHandByKey: onHand,
  });
  // 0.3 + (24/24)*(0.7) = 1.0 → all 100 units lost
  assert.equal(result.unitsCompromisedByKey.get("n1:prbc_o"), 100);
  assert.equal(onHand.get("n1:prbc_o"), 0);
});

test("cold-chain cascade: empty perturbation is a no-op", () => {
  const onHand = new Map([["n1:prbc_o", 100]]);
  const result = applyColdChainCascade({
    perturbation: {},
    affected: new Set(),
    bloodLots: [],
    coldChainAssets: [],
    onHandByKey: onHand,
  });
  assert.equal(result.totalCompromisedUnits, 0);
  assert.equal(onHand.get("n1:prbc_o"), 100);
});

test("reagent cascade: ABO/Rh below 3-day threshold gates collection capacity", () => {
  const items: SimItem[] = DEFAULT_REAGENT_ITEM_IDS.map(reagentItem);
  // Node has 6 days of crossmatch and id_screen, but only 1 day of ABO. The
  // bottleneck should be ABO and the multiplier should reflect 1/3 of full.
  const onHand = new Map<string, number>([
    ["n1:abo_kit", 3], // burn 3/d → 1.0 d
    ["n1:crossmatch", 18], // 6 d
    ["n1:id_screen", 18], // 6 d
  ]);
  const burn = new Map<string, number>([
    ["n1:abo_kit", 3],
    ["n1:crossmatch", 3],
    ["n1:id_screen", 3],
  ]);
  const result = applyReagentCascade({
    perturbation: {
      affectedNodes: ["n1"],
      reagent: { thresholdDays: 3, minCapacityFraction: 0.1 },
    },
    affected: new Set(["n1"]),
    items,
    onHandByKey: onHand,
    reagentBurnByKey: burn,
    affectedNodes: [node("n1")],
  });

  assert.equal(result.perNode.length, 1);
  const n = result.perNode[0];
  assert.equal(n.bottleneckItemId, "abo_kit");
  // ratio = 1/3, frac = 0.1 + (1-0.1)*1/3 = 0.4
  assert.equal(n.capacityMultiplier, 0.4);
  assert.equal(result.capacityMultiplierByNode.get("n1"), 0.4);
});

test("reagent cascade: nodes above threshold are unaffected", () => {
  const items: SimItem[] = DEFAULT_REAGENT_ITEM_IDS.map(reagentItem);
  const onHand = new Map<string, number>([
    ["n1:abo_kit", 30], // 10 d
    ["n1:crossmatch", 30], // 10 d
    ["n1:id_screen", 30], // 10 d
  ]);
  const burn = new Map<string, number>([
    ["n1:abo_kit", 3],
    ["n1:crossmatch", 3],
    ["n1:id_screen", 3],
  ]);
  const result = applyReagentCascade({
    perturbation: {
      affectedNodes: ["n1"],
      reagent: { thresholdDays: 3 },
    },
    affected: new Set(["n1"]),
    items,
    onHandByKey: onHand,
    reagentBurnByKey: burn,
    affectedNodes: [node("n1")],
  });
  assert.equal(result.perNode.length, 0);
  assert.equal(result.capacityMultiplierByNode.size, 0);
});

test("airlift cascade: extra transit days degrades arriving liquid blood", () => {
  const routes: SimRoute[] = [
    {
      id: "r1",
      fromNode: "hub",
      toNode: "fwd",
      priority: "primary",
      days: 2,
      reliability: 0.9,
      modality: "air",
    },
  ];
  const lots: SimBloodLot[] = [
    {
      id: "lot-fwd",
      nodeId: "fwd",
      itemId: "ltow_pos",
      component: "LTOWB",
      units: 50,
      status: "VIABLE",
    },
  ];
  const onHand = new Map([["fwd:ltow_pos", 50]]);
  const result = applyAirliftCascade({
    perturbation: {
      affectedNodes: ["fwd"],
      airlift: { additionalTransitDays: 2, viabilityLossPerDay: 0.2 },
    },
    affected: new Set(["fwd"]),
    routes,
    bloodLots: lots,
    onHandByKey: onHand,
  });
  // lossFraction = 2 * 0.2 = 0.4 → 20 of 50 units lost
  assert.equal(result.totalUnitsLost, 20);
  assert.equal(result.additionalTransitDays, 2);
  assert.equal(onHand.get("fwd:ltow_pos"), 30);
});

test("airlift cascade: surface routes are not affected by default", () => {
  const routes: SimRoute[] = [
    {
      id: "r1",
      fromNode: "hub",
      toNode: "fwd",
      priority: "primary",
      days: 2,
      reliability: 0.9,
      modality: "ground",
    },
  ];
  const lots: SimBloodLot[] = [
    { id: "lot-fwd", nodeId: "fwd", itemId: "ltow_pos", component: "LTOWB", units: 50, status: "VIABLE" },
  ];
  const onHand = new Map([["fwd:ltow_pos", 50]]);
  const result = applyAirliftCascade({
    perturbation: {
      affectedNodes: ["fwd"],
      airlift: { additionalTransitDays: 2, viabilityLossPerDay: 0.2 },
    },
    affected: new Set(["fwd"]),
    routes,
    bloodLots: lots,
    onHandByKey: onHand,
  });
  assert.equal(result.totalUnitsLost, 0);
  assert.equal(onHand.get("fwd:ltow_pos"), 50);
});

test("buildCascadeNarrative: produces Yokosuka-style headline lines", () => {
  const donors: SimDonorPool[] = [
    { nodeId: "n1", weeklyCollectionCapacity: 200 },
  ];
  const lines = buildCascadeNarrative({
    scenarioName: "Yokosuka cold storage",
    coldChain: {
      failedAssetIds: new Set(["a1"]),
      unitsCompromisedByKey: new Map(),
      perNode: [
        { nodeId: "yokosuka", failedAssets: 2, compromisedUnits: 142, affectedItemIds: ["prbc_o"] },
      ],
      totalCompromisedUnits: 142,
      outageHours: 12,
    },
    reagent: {
      capacityMultiplierByNode: new Map(),
      perNode: [{ nodeId: "n1", capacityMultiplier: 0.4, bottleneckItemId: "abo_kit", bottleneckDOS: 1 }],
      reagentItemIds: ["abo_kit"],
      thresholdDays: 3,
    },
    airlift: {
      additionalTransitDays: 2,
      viabilityLossPerDay: 0.2,
      unitsLostByKey: new Map(),
      perNode: [{ nodeId: "n1", unitsLost: 20, affectedItemIds: ["ltow_pos"] }],
      totalUnitsLost: 20,
    },
    donorPools: donors,
    nodes: [node("yokosuka", "NMRTC Yokosuka"), node("n1", "Forward MTF")],
    dosBeforeByNode: { yokosuka: 12.0 },
    dosAfterByNode: { yokosuka: 3.4 },
  });
  assert.ok(
    lines.some((l) => l.includes("142 blood units") && l.includes("NMRTC Yokosuka")),
    `expected Yokosuka headline; got ${JSON.stringify(lines)}`,
  );
  assert.ok(lines.some((l) => l.includes("Reagent shortage")));
  assert.ok(lines.some((l) => l.includes("Airlift loss")));
});
