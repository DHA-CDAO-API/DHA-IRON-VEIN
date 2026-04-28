import type { Supplier as DbSupplier } from "@workspace/db";

/**
 * Map a raw DB supplier row to the OpenAPI Supplier envelope shape.
 *
 * OpenAPI required: id, name, region, leadTimeDays, reliability,
 * costIndex, channel.
 */
export function mapSupplierToApi(row: DbSupplier) {
  return {
    ...row,
    region: row.country,
    countryCode: row.country,
    leadTimeDays: row.leadTimeDaysMean,
    reliability: row.reliabilityScore,
    costIndex: 1,
  };
}
