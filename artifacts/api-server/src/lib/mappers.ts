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
  /**
   * Catalog unit price (USD) per item. When provided, the mapper overrides
   * the sim's supplier-derived `estimatedUnitCostUsd` with this value (and
   * recomputes the total). This keeps the cost shown on a recommendation
   * card in lock-step with what the order-create handler will charge when
   * the operator promotes the rec — the same column (`items.unit_price_usd`)
   * is the source of truth on both sides, so the rec card's "$X" matches
   * the resulting PO's totalUsd to the cent.
   */
  itemUnitPriceUsdById?: Map<string, number>;
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
  // Prefer the catalog unit price (the same column the order-create handler
  // bills from) over the sim's supplier-derived cost so the dollar number on
  // a rec card matches the PO total to the cent. Fall back to the sim cost
  // only when no catalog price is available for this itemId.
  const catalogUnitPrice = lookups.itemUnitPriceUsdById?.get(rec.itemId);
  const unitCost =
    typeof catalogUnitPrice === "number" && catalogUnitPrice > 0
      ? catalogUnitPrice
      : rec.estimatedUnitCostUsd ?? 0;
  const totalCost = Number((unitCost * rec.suggestedQty).toFixed(2));
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
    estimatedCost: totalCost,
    estimatedUnitCostUsd: unitCost,
    estimatedTotalCostUsd: totalCost,
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
