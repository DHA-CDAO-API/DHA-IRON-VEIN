import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifySupplierChannel,
  rankSuppliersForShortfall,
  generateRecommendations,
} from "../recommendations";
import type {
  SimDemandProfile,
  SimInventoryBalance,
  SimItem,
  SimNode,
  SimOperationalState,
  SimRoute,
  SimSupplier,
} from "../types";

const supplier = (overrides: Partial<SimSupplier> & { id: string }): SimSupplier => ({
  name: overrides.id,
  channel: "DLA",
  leadTimeDaysMean: 7,
  reliabilityScore: 0.9,
  ...overrides,
});

test("classifySupplierChannel maps channel strings to channel families", () => {
  assert.equal(classifySupplierChannel(supplier({ id: "dla", channel: "DLA" })), "DOD");
  assert.equal(classifySupplierChannel(supplier({ id: "ecat", channel: "ECAT" })), "DOD");
  assert.equal(classifySupplierChannel(supplier({ id: "asbp", channel: "DOD" })), "DOD");
  assert.equal(classifySupplierChannel(supplier({ id: "mck", channel: "Commercial" })), "COMMERCIAL");
  assert.equal(classifySupplierChannel(supplier({ id: "mck", channel: "McKesson" })), "COMMERCIAL");
  assert.equal(classifySupplierChannel(supplier({ id: "jp", channel: "HostNation" })), "HOST_NATION");
  assert.equal(classifySupplierChannel(supplier({ id: "tw", channel: "Allied" })), "ALLIED");
});

test("rankSuppliersForShortfall: prefers fastest in-window supplier when shortfall is urgent", () => {
  const suppliers: SimSupplier[] = [
    supplier({ id: "dla-prime", channel: "DLA", leadTimeDaysMean: 10, reliabilityScore: 0.95, itemsCovered: ["prbc_o"] }),
    supplier({ id: "mckesson", channel: "Commercial", leadTimeDaysMean: 3, reliabilityScore: 0.9, itemsCovered: ["prbc_o"] }),
    supplier({ id: "jp", channel: "HostNation", country: "JP", leadTimeDaysMean: 2, reliabilityScore: 0.92, itemsCovered: ["prbc_o"] }),
  ];
  const ranked = rankSuppliersForShortfall({
    itemId: "prbc_o",
    suggestedQty: 50,
    shortfallHorizonDays: 3,
    upstreamRouteDays: 1,
    suppliers,
  });
  assert.equal(ranked.length, 3);
  assert.equal(ranked[0].supplierId, "jp", "host-nation JP wins on viability + ETA");
  // DLA prime would arrive at 11 days, missing the 3-day horizon → bottom
  assert.equal(ranked[ranked.length - 1].supplierId, "dla-prime");
  // Channel attribution and cost present on every alternative
  for (const r of ranked) {
    assert.ok(r.estimatedTotalCostUsd > 0, "cost is annotated");
    assert.ok(["DOD", "COMMERCIAL", "HOST_NATION", "ALLIED"].includes(r.channel));
  }
});

test("rankSuppliersForShortfall: filters out suppliers that don't carry the item", () => {
  const suppliers: SimSupplier[] = [
    supplier({ id: "ppe-only", channel: "Commercial", itemsCovered: ["gloves", "mask"] }),
    supplier({ id: "blood-house", channel: "DLA", itemsCovered: ["prbc_o", "ffp_ab"] }),
  ];
  const ranked = rankSuppliersForShortfall({
    itemId: "prbc_o",
    suggestedQty: 10,
    shortfallHorizonDays: 7,
    upstreamRouteDays: 1,
    suppliers,
  });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].supplierId, "blood-house");
});

test("rankSuppliersForShortfall: cost premium reflects channel family", () => {
  const suppliers: SimSupplier[] = [
    supplier({ id: "dla", channel: "DLA", leadTimeDaysMean: 5, reliabilityScore: 0.94, itemsCovered: ["prbc_o"] }),
    supplier({ id: "mckesson", channel: "Commercial", leadTimeDaysMean: 5, reliabilityScore: 0.94, itemsCovered: ["prbc_o"] }),
    supplier({ id: "jp", channel: "HostNation", leadTimeDaysMean: 5, reliabilityScore: 0.94, itemsCovered: ["prbc_o"] }),
    supplier({ id: "tw", channel: "Allied", leadTimeDaysMean: 5, reliabilityScore: 0.94, itemsCovered: ["prbc_o"] }),
  ];
  const ranked = rankSuppliersForShortfall({
    itemId: "prbc_o",
    suggestedQty: 1,
    shortfallHorizonDays: 7,
    upstreamRouteDays: 1,
    suppliers,
  });
  const byId = new Map(ranked.map((r) => [r.supplierId, r]));
  const dla = byId.get("dla")!.estimatedUnitCostUsd;
  const mck = byId.get("mckesson")!.estimatedUnitCostUsd;
  const jp = byId.get("jp")!.estimatedUnitCostUsd;
  const tw = byId.get("tw")!.estimatedUnitCostUsd;
  assert.ok(mck > dla, "commercial > DLA prime");
  assert.ok(tw > jp, "allied > host-nation premium");
  assert.ok(jp > dla, "host-nation > DLA prime");
});

test("generateRecommendations: emits sourceChannel + cost on each rec", () => {
  const nodes: SimNode[] = [
    {
      id: "fwd",
      name: "Forward MTF",
      type: "Large MTF",
      latitude: 0,
      longitude: 0,
      population: 1000,
      optempo: "active_operations",
      stockDays: 14,
      regionalHub: "hub",
      upstreamNode: "hub",
      countryCode: "JP",
    },
  ];
  const routes: SimRoute[] = [
    { id: "r1", fromNode: "hub", toNode: "fwd", priority: "primary", days: 2, reliability: 0.9, modality: "air" },
  ];
  const items: SimItem[] = [
    {
      id: "prbc_o",
      name: "PRBC O+",
      unitOfIssue: "unit",
      baseDemandPerEvent: 5,
      wasteAdjustedDemand: 6,
      trigger: "encounter",
      criticality: "critical",
      leadTimeDays: 5,
    },
  ];
  const profiles = new Map<string, SimDemandProfile>([
    [
      "fwd",
      {
        nodeId: "fwd",
        operationalState: "active_operations",
        wasteFactor: 1.1,
        activeSupportedPopulation: 1000,
        dailyEncounterRate: 0.05,
        phlebotomyProbability: 0.2,
        specimensPerPhlebotomy: 2,
      },
    ],
  ]);
  const states = new Map<string, SimOperationalState>([
    ["active_operations", { id: "active_operations", encounterMultiplier: 1, populationMultiplier: 1 }],
  ]);
  const balances: SimInventoryBalance[] = [
    { nodeId: "fwd", itemId: "prbc_o", onHand: 10, dueIn: 0 },
  ];
  const suppliers: SimSupplier[] = [
    supplier({ id: "dla", channel: "DLA", leadTimeDaysMean: 8, reliabilityScore: 0.95, itemsCovered: ["prbc_o"] }),
    supplier({ id: "jp", channel: "HostNation", country: "JP", leadTimeDaysMean: 2, reliabilityScore: 0.92, itemsCovered: ["prbc_o"] }),
  ];

  const recs = generateRecommendations({
    nodes,
    routes,
    items,
    balances,
    profiles,
    states,
    suppliers,
    itemSkew: {},
    watchDays: 14,
    criticalDays: 5,
    paddingDays: 7,
  });
  assert.ok(recs.length >= 1, "at least one recommendation");
  const r = recs[0];
  assert.equal(r.nodeId, "fwd");
  assert.equal(r.itemId, "prbc_o");
  assert.equal(r.sourceChannel, "HOST_NATION", "host-nation JP wins on ETA + viability");
  assert.equal(r.sourceSupplierId, "jp");
  assert.ok(r.estimatedTotalCostUsd! > 0, "total cost annotated");
  assert.ok(r.alternatives && r.alternatives.length >= 2, "alternatives list populated");
  assert.match(r.reason, /Host-nation source|host-nation/);
  // Cost in the rationale string must always render with two decimals
  // and thousands separators (no `$1234.5` or `$1,234`).
  assert.match(
    r.reason,
    /Est\. cost \$[0-9]{1,3}(,[0-9]{3})*\.[0-9]{2}\./,
    "Est. cost renders with two decimal places",
  );
});
