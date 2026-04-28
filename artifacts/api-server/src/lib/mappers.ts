import type { Supplier as DbSupplier } from "@workspace/db";

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
