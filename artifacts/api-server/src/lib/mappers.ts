import type { Supplier as DbSupplier } from "@workspace/db";

type RawRecommendation = {
  id: string;
  nodeId: string;
  itemId: string;
  kind: string;
  suggestedQty: number;
  reason: string;
  expectedRiskReduction: number;
  sourceSupplierId?: string | null;
  sourceChannel?: string | null;
  estimatedUnitCostUsd?: number | null;
  estimatedTotalCostUsd?: number | null;
  etaDays: number;
  alternatives?: unknown;
};

export type CompanionItemEntry = {
  itemId: string;
  itemName: string;
  tier: "primary" | "secondary" | "tertiary";
  procedureId: string;
  procedureName: string;
  quantityPerEvent: number;
};

export type RecommendationLookups = {
  itemNamesById?: Map<string, string>;
  nodeNamesById?: Map<string, string>;
  supplierNamesById?: Map<string, string>;
  supplierFromNodeById?: Map<string, string>;
  /**
   * Companion-item lookup keyed by primary itemId. When present, the mapper
   * attaches the array (de-duplicated by item) onto the recommendation as
   * `companionItems` so the UI can render the bundled-promotion toggle.
   */
  companionItemsByItemId?: Map<string, CompanionItemEntry[]>;
};

/**
 * Map a raw `generateRecommendations()` output to the OpenAPI Recommendation
 * envelope. The sim emits internal field names (`suggestedQty`, `reason`) but
 * the OpenAPI contract requires `quantity`, `priority`, `rationale`,
 * `suggestedSupplierId`, `generatedAt`, etc. Returning the raw shape leaves the
 * UI rendering blank rows.
 */
export function mapRecommendationToApi(
  rec: RawRecommendation,
  opts: {
    status?: string;
    promotedOrderId?: string | null;
    generatedAt?: string;
    lookups?: RecommendationLookups;
  } = {},
) {
  const lookups = opts.lookups ?? {};
  const priority =
    rec.kind === "ESCALATE"
      ? "FLASH"
      : rec.kind === "REROUTE"
        ? "URGENT"
        : "ROUTINE";
  const supplierId = rec.sourceSupplierId ?? null;
  return {
    id: rec.id,
    kind: rec.kind,
    nodeId: rec.nodeId,
    nodeName: lookups.nodeNamesById?.get(rec.nodeId) ?? rec.nodeId,
    itemId: rec.itemId,
    itemName: lookups.itemNamesById?.get(rec.itemId) ?? rec.itemId,
    quantity: rec.suggestedQty,
    priority,
    rationale: rec.reason,
    suggestedSupplierId: supplierId,
    suggestedSupplierName: supplierId
      ? lookups.supplierNamesById?.get(supplierId) ?? null
      : null,
    suggestedFromNodeId: supplierId
      ? lookups.supplierFromNodeById?.get(supplierId) ?? supplierId
      : null,
    sourceChannel: rec.sourceChannel ?? null,
    etaDays: rec.etaDays,
    estimatedCost: rec.estimatedTotalCostUsd ?? 0,
    estimatedUnitCostUsd: rec.estimatedUnitCostUsd ?? 0,
    estimatedTotalCostUsd: rec.estimatedTotalCostUsd ?? 0,
    alternatives: Array.isArray(rec.alternatives) ? rec.alternatives : [],
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    confidenceScore: Math.max(
      0,
      Math.min(1, rec.expectedRiskReduction ?? 0),
    ),
    scenarioId: null,
    promotedOrderId: opts.promotedOrderId ?? null,
    status: opts.status ?? "OPEN",
    companionItems: lookups.companionItemsByItemId?.get(rec.itemId) ?? [],
  };
}

/**
 * Map a raw DB supplier row to the OpenAPI Supplier envelope shape.
 *
 * OpenAPI `Supplier` requires: id, name, region, leadTimeDays,
 * reliability, costIndex, channel. Returns ONLY API-defined fields
 * to prevent DB-internal columns (leadTimeDaysMean, reliabilityScore,
 * itemsCovered, etc.) from leaking into responses and causing future
 * contract drift.
 *
 * Pass `coveredItemIds` (sourced from the `supplier_items` join table)
 * to populate the optional `items` array.
 */
export function mapSupplierToApi(
  row: DbSupplier,
  coveredItemIds?: ReadonlyArray<string>,
) {
  return {
    id: row.id,
    name: row.name,
    region: row.country,
    countryCode: row.country,
    leadTimeDays: row.leadTimeDaysMean,
    reliability: row.reliabilityScore,
    costIndex: 1,
    channel: row.channel,
    items: coveredItemIds ? [...coveredItemIds] : undefined,
    notes: row.notes ?? null,
  };
}
