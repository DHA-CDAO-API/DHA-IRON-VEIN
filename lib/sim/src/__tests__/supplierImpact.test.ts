import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applySupplierDegradation,
  summarizeSupplierImpact,
} from "../supplierImpact";
import { rankSuppliersForShortfall } from "../recommendations";
import type { SimSupplier, SupplierImpact } from "../types";

const supplier = (overrides: Partial<SimSupplier> & { id: string }): SimSupplier => ({
  name: overrides.id,
  channel: "DLA",
  leadTimeDaysMean: 7,
  reliabilityScore: 0.9,
  ...overrides,
});

test("applySupplierDegradation: full-horizon outage drives capacity to zero and the ranker skips the supplier", () => {
  const suppliers: SimSupplier[] = [
    supplier({
      id: "globex-jp",
      country: "JP",
      leadTimeDaysMean: 2,
      reliabilityScore: 0.95,
      itemsCovered: ["prbc_o"],
    }),
    supplier({
      id: "mckesson",
      country: "US",
      leadTimeDaysMean: 5,
      reliabilityScore: 0.9,
      itemsCovered: ["prbc_o"],
    }),
  ];
  const impact: SupplierImpact[] = [
    { supplierId: "globex-jp", capacityMultiplier: 0, autoFlagged: true, cause: "JP outage" },
  ];
  const { suppliers: degraded, applied } = applySupplierDegradation({
    suppliers,
    impacted: impact,
    horizonDays: 21,
  });
  assert.equal(applied.length, 1);
  assert.equal(applied[0].capacityMultiplierApplied, 0);
  assert.equal(applied[0].fraction, 1);
  // The degraded copy should leave globex-jp with availability 0.
  const globex = degraded.find((s) => s.id === "globex-jp");
  assert.equal(globex?.availabilityFraction, 0);

  const ranked = rankSuppliersForShortfall({
    itemId: "prbc_o",
    suggestedQty: 50,
    shortfallHorizonDays: 4,
    upstreamRouteDays: 1,
    suppliers: degraded,
  });
  assert.equal(ranked.length, 1, "offline supplier is filtered out of the ranking");
  assert.equal(ranked[0].supplierId, "mckesson");
});

test("applySupplierDegradation: short outage on long horizon partially blends knobs", () => {
  const baseline = supplier({
    id: "tw-host",
    leadTimeDaysMean: 4,
    reliabilityScore: 0.9,
    itemsCovered: ["abo_kit"],
  });
  const { applied } = applySupplierDegradation({
    suppliers: [baseline],
    impacted: [
      {
        supplierId: "tw-host",
        capacityMultiplier: 0.2,
        leadTimeDeltaDays: 10,
        reliabilityDelta: -0.4,
        outageDays: 7,
      },
    ],
    horizonDays: 21,
  });
  // 7/21 = 1/3. cap = 1 - (1-0.2)*1/3 = 1 - 0.267 ≈ 0.733
  // ltDelta = 10/3 ≈ 3.33; relDelta = -0.4/3 ≈ -0.133
  assert.ok(Math.abs(applied[0].capacityMultiplierApplied - 0.733) < 0.005);
  assert.ok(Math.abs(applied[0].leadTimeDeltaApplied - 3.33) < 0.05);
  assert.ok(Math.abs(applied[0].reliabilityDeltaApplied - -0.133) < 0.005);
});

test("rankSuppliersForShortfall: lead-time delta past the horizon penalizes a supplier vs intact alternates", () => {
  const suppliers: SimSupplier[] = [
    supplier({
      id: "primary-jp",
      leadTimeDaysMean: 2,
      reliabilityScore: 0.95,
      itemsCovered: ["prbc_o"],
    }),
    supplier({
      id: "backup-us",
      leadTimeDaysMean: 6,
      reliabilityScore: 0.9,
      itemsCovered: ["prbc_o"],
    }),
  ];
  // Without degradation, primary-jp wins.
  const baseline = rankSuppliersForShortfall({
    itemId: "prbc_o",
    suggestedQty: 25,
    shortfallHorizonDays: 5,
    upstreamRouteDays: 1,
    suppliers,
  });
  assert.equal(baseline[0].supplierId, "primary-jp");

  // Add +20 days of lead time to primary-jp → it drops behind.
  const { suppliers: degraded } = applySupplierDegradation({
    suppliers,
    impacted: [{ supplierId: "primary-jp", leadTimeDeltaDays: 20 }],
    horizonDays: 21,
  });
  const ranked = rankSuppliersForShortfall({
    itemId: "prbc_o",
    suggestedQty: 25,
    shortfallHorizonDays: 5,
    upstreamRouteDays: 1,
    suppliers: degraded,
  });
  assert.equal(ranked[0].supplierId, "backup-us", "intact backup wins after lead-time hit");
});

test("rankSuppliersForShortfall: reliability delta penalizes the impacted supplier", () => {
  const suppliers: SimSupplier[] = [
    supplier({
      id: "stable",
      leadTimeDaysMean: 5,
      reliabilityScore: 0.85,
      itemsCovered: ["prbc_o"],
    }),
    supplier({
      id: "degraded",
      leadTimeDaysMean: 5,
      reliabilityScore: 0.95,
      itemsCovered: ["prbc_o"],
    }),
  ];
  // Without degradation, the more reliable one wins (tied lead time).
  const baseline = rankSuppliersForShortfall({
    itemId: "prbc_o",
    suggestedQty: 10,
    shortfallHorizonDays: 10,
    upstreamRouteDays: 1,
    suppliers,
  });
  assert.equal(baseline[0].supplierId, "degraded");

  // Crater "degraded"'s reliability — "stable" should win.
  const { suppliers: next } = applySupplierDegradation({
    suppliers,
    impacted: [{ supplierId: "degraded", reliabilityDelta: -0.5 }],
    horizonDays: 21,
  });
  const ranked = rankSuppliersForShortfall({
    itemId: "prbc_o",
    suggestedQty: 10,
    shortfallHorizonDays: 10,
    upstreamRouteDays: 1,
    suppliers: next,
  });
  assert.equal(ranked[0].supplierId, "stable");
});

test("rankSuppliersForShortfall: capacity-degraded supplier still appears but is penalized", () => {
  const suppliers: SimSupplier[] = [
    supplier({
      id: "wounded",
      leadTimeDaysMean: 2,
      reliabilityScore: 0.95,
      itemsCovered: ["prbc_o"],
    }),
    supplier({
      id: "alt",
      leadTimeDaysMean: 4,
      reliabilityScore: 0.9,
      itemsCovered: ["prbc_o"],
    }),
  ];
  // 30% capacity → +21 capacity penalty. Lead-time gap is only ~3 score points,
  // so the capacity penalty must be enough to flip the ranking.
  const { suppliers: degraded } = applySupplierDegradation({
    suppliers,
    impacted: [{ supplierId: "wounded", capacityMultiplier: 0.3 }],
    horizonDays: 21,
  });
  const ranked = rankSuppliersForShortfall({
    itemId: "prbc_o",
    suggestedQty: 10,
    shortfallHorizonDays: 10,
    upstreamRouteDays: 1,
    suppliers: degraded,
  });
  assert.equal(ranked.length, 2, "capacity-degraded supplier is still listed");
  assert.equal(ranked[0].supplierId, "alt", "intact alt wins despite slower lead time");
  assert.equal(ranked[1].supplierId, "wounded");
});

test("summarizeSupplierImpact: maps covered items to shortfall items and surfaces reroutes", () => {
  const suppliers: SimSupplier[] = [
    supplier({
      id: "globex-jp",
      country: "JP",
      itemsCovered: ["prbc_o", "abo_kit", "saline"],
    }),
  ];
  const { applied } = applySupplierDegradation({
    suppliers,
    impacted: [
      { supplierId: "globex-jp", capacityMultiplier: 0, autoFlagged: true, cause: "JP" },
    ],
    horizonDays: 14,
  });
  const reroutedTo = new Map<string, { supplierId: string; supplierName: string }>([
    ["globex-jp:prbc_o", { supplierId: "mckesson", supplierName: "McKesson" }],
  ]);
  const summary = summarizeSupplierImpact({
    applied,
    baselineSuppliers: suppliers,
    shortfallItemIds: new Set(["prbc_o", "abo_kit"]),
    reroutedTo,
  });
  assert.equal(summary.length, 1);
  assert.deepEqual(summary[0].affectedItemIds.sort(), ["abo_kit", "prbc_o"]);
  assert.equal(summary[0].reroutes.length, 1);
  assert.equal(summary[0].reroutes[0].supplierName, "McKesson");
  assert.equal(summary[0].reroutes[0].itemId, "prbc_o");
  assert.equal(summary[0].autoFlagged, true);
});

test("applySupplierDegradation: entries marked excluded are tombstones — no degradation applied", () => {
  const suppliers: SimSupplier[] = [
    supplier({
      id: "globex-jp",
      country: "JP",
      leadTimeDaysMean: 2,
      reliabilityScore: 0.95,
      itemsCovered: ["prbc_o"],
    }),
  ];
  const impact: SupplierImpact[] = [
    {
      supplierId: "globex-jp",
      capacityMultiplier: 0,
      autoFlagged: true,
      excluded: true,
      cause: "operator override",
    },
  ];
  const { suppliers: degraded, applied } = applySupplierDegradation({
    suppliers,
    impacted: impact,
    horizonDays: 21,
  });
  assert.equal(applied.length, 0, "excluded entries do not produce an applied row");
  const globex = degraded.find((s) => s.id === "globex-jp");
  assert.equal(
    globex?.availabilityFraction,
    undefined,
    "supplier availability is left at baseline when excluded",
  );
  assert.equal(globex?.leadTimeDaysMean, 2, "lead time is unchanged when excluded");
});
