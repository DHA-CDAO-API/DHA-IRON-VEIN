import type {
  SimSupplier,
  SupplierImpact,
} from "./types";

// Blend a per-supplier degradation across a scenario horizon. If the
// outage covers the full horizon the knobs apply at full strength; a
// shorter outage applies a proportional fraction of each delta. We do
// this so a 24h supplier blip on a 21-day scenario doesn't masquerade
// as catastrophic, while a 30-day shutdown on a 14-day horizon still
// reads as a complete outage.
export type AppliedSupplierImpact = {
  supplierId: string;
  supplierName: string;
  capacityMultiplierApplied: number; // 1 = unchanged, 0 = offline
  leadTimeDeltaApplied: number; // days added to mean lead time
  reliabilityDeltaApplied: number; // delta on reliability score
  outageDays: number;
  horizonDays: number;
  fraction: number; // outageDays / horizonDays, capped at 1
  cause?: string;
  autoFlagged?: boolean;
  baseline: {
    leadTimeDaysMean: number;
    reliabilityScore: number;
  };
};

export type SupplierDegradationResult = {
  // Mutated copy of the supplier list with degraded fields written in
  // place. Suppliers not in the impacted list are returned as-is so the
  // caller can pass this straight to `rankSuppliersForShortfall`.
  suppliers: SimSupplier[];
  // Per-supplier breakdown of what was applied. Useful for the response
  // envelope and the AI brief.
  applied: AppliedSupplierImpact[];
};

export function applySupplierDegradation(args: {
  suppliers: SimSupplier[];
  impacted: SupplierImpact[] | undefined;
  horizonDays: number;
}): SupplierDegradationResult {
  const horizon = Math.max(1, args.horizonDays);
  // Excluded entries are tombstones used to remember an operator-suppressed
  // auto-flag — they never produce degradation themselves.
  const impacted = (args.impacted ?? []).filter((i) => !i.excluded);
  if (impacted.length === 0) {
    return { suppliers: args.suppliers.map((s) => ({ ...s })), applied: [] };
  }
  const byId = new Map(impacted.map((i) => [i.supplierId, i]));
  const applied: AppliedSupplierImpact[] = [];
  const next: SimSupplier[] = args.suppliers.map((s) => {
    const imp = byId.get(s.id);
    if (!imp) return { ...s };
    const baselineLT = s.leadTimeDaysMean;
    const baselineRel = s.reliabilityScore;
    const outage =
      typeof imp.outageDays === "number" && imp.outageDays > 0
        ? imp.outageDays
        : horizon;
    const fraction = Math.min(1, outage / horizon);
    // Capacity blends 1.0 toward the floor (capacityMultiplier).
    const capFloor =
      typeof imp.capacityMultiplier === "number"
        ? Math.max(0, Math.min(1, imp.capacityMultiplier))
        : 1;
    const capApplied = 1 - (1 - capFloor) * fraction;
    const ltDelta = (imp.leadTimeDeltaDays ?? 0) * fraction;
    const relDelta = (imp.reliabilityDelta ?? 0) * fraction;
    const newSupplier: SimSupplier = {
      ...s,
      leadTimeDaysMean: Math.max(0, baselineLT + ltDelta),
      reliabilityScore: Math.max(0, Math.min(1, baselineRel + relDelta)),
      availabilityFraction: capApplied,
    };
    applied.push({
      supplierId: s.id,
      supplierName: s.name,
      capacityMultiplierApplied: Number(capApplied.toFixed(3)),
      leadTimeDeltaApplied: Number(ltDelta.toFixed(2)),
      reliabilityDeltaApplied: Number(relDelta.toFixed(3)),
      outageDays: outage,
      horizonDays: horizon,
      fraction: Number(fraction.toFixed(3)),
      cause: imp.cause,
      autoFlagged: imp.autoFlagged,
      baseline: {
        leadTimeDaysMean: baselineLT,
        reliabilityScore: baselineRel,
      },
    });
    return newSupplier;
  });
  return { suppliers: next, applied };
}

// Map an impacted supplier's `itemsCovered` to the items it normally
// fulfills, intersected with the scenario's actual shortfall items.
// Useful for the COA brief & UI ("Globex offline → cuts off
// `prbc_o, abo_kit` to forward sites").
export function summarizeSupplierImpact(args: {
  applied: AppliedSupplierImpact[];
  baselineSuppliers: SimSupplier[];
  shortfallItemIds: Set<string>;
  // Map of (newly-chosen primary supplier id) -> (item id) so the UI can
  // call out "rerouted to <X>" for the affected items.
  reroutedTo?: Map<string, { supplierId: string; supplierName: string }>;
}) {
  const { applied, baselineSuppliers, shortfallItemIds, reroutedTo } = args;
  const baselineById = new Map(baselineSuppliers.map((s) => [s.id, s]));
  return applied.map((a) => {
    const base = baselineById.get(a.supplierId);
    const covered = base?.itemsCovered ?? [];
    const affectedItemIds = covered.filter((id) => shortfallItemIds.has(id));
    const reroutes = affectedItemIds
      .map((itemId) => {
        const r = reroutedTo?.get(`${a.supplierId}:${itemId}`);
        if (!r) return null;
        return { itemId, supplierId: r.supplierId, supplierName: r.supplierName };
      })
      .filter(
        (x): x is { itemId: string; supplierId: string; supplierName: string } =>
          x !== null,
      );
    return {
      supplierId: a.supplierId,
      supplierName: a.supplierName,
      country: base?.country,
      channel: base?.channel,
      capacityMultiplierApplied: a.capacityMultiplierApplied,
      leadTimeDeltaApplied: a.leadTimeDeltaApplied,
      reliabilityDeltaApplied: a.reliabilityDeltaApplied,
      outageDays: a.outageDays,
      horizonDays: a.horizonDays,
      cause: a.cause,
      autoFlagged: a.autoFlagged ?? false,
      baseline: a.baseline,
      itemsCovered: covered,
      affectedItemIds,
      reroutes,
    };
  });
}

export type ScenarioSupplierImpactRow = ReturnType<
  typeof summarizeSupplierImpact
>[number];
