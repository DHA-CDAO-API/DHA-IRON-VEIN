import type { Supplier as DbSupplier, Item as DbItem } from "@workspace/db";

/**
 * Coverage rules per supplier channel. We need to know which items
 * each supplier carries so the New Order picker can hide suppliers
 * that don't stock the chosen item.
 *
 * Each channel may declare:
 *  - `categories`: full item categories the channel covers, OR
 *  - `itemIds`: an explicit allow-list of item ids.
 * If both are set, the union is taken.
 *
 * Categories in the DB today are: blood_products, supplies, other.
 * "supplies" is broad (it includes phlebotomy, transfusion, cold-chain,
 * PPE-style and lab items), so most narrower commercial channels use
 * an explicit `itemIds` allow-list keyed off the item id naming
 * conventions in the seed.
 */
type ChannelCoverage = {
  categories?: ReadonlyArray<string>;
  itemIds?: ReadonlyArray<string>;
};

const PHLEBOTOMY_LAB = [
  "tubes",
  "butterfly",
  "alcohol",
  "gauze",
  "tourniquet",
  "bags",
  "labels",
  "antiseptic",
  "abo_kit",
  "crossmatch",
  "id_screen",
  "sharps",
  "centrifuge_tube",
  "biohazard_bag",
] as const;

const PPE_STYLE = ["gloves", "mask", "shield", "gown", "n95"] as const;

const TRANSFUSION_SUPPLIES = [
  "iv_set",
  "pressure_inf",
  "warmer",
  "transfusion_band",
  "collection_bag",
] as const;

const COLD_CHAIN = ["cooler", "coolant", "chain_log"] as const;

const BLOOD_PRODUCTS = [
  "ltow_pos",
  "ltow_neg",
  "prbc_o",
  "ffp_ab",
  "plasma_a",
  "platelets",
  "cryo",
  "fdp",
] as const;

const CHANNEL_COVERAGE: Record<string, ChannelCoverage> = {
  // Broad government channels — cover everything in Class VIII.
  DLA: { categories: ["blood_products", "supplies", "other"] },
  ECAT: { categories: ["blood_products", "supplies", "other"] },
  GSA: { categories: ["blood_products", "supplies", "other"] },
  FedMall: { categories: ["supplies", "other"] },

  // Commercial backstops — narrower coverage.
  McKesson: {
    itemIds: [
      ...BLOOD_PRODUCTS,
      ...TRANSFUSION_SUPPLIES,
      ...COLD_CHAIN,
    ],
  },
  Cardinal: { itemIds: [...PPE_STYLE, "gauze", "alcohol"] },
  HenrySchein: { itemIds: [...PHLEBOTOMY_LAB] },
  OwensMinor: {
    itemIds: [...TRANSFUSION_SUPPLIES, ...PPE_STYLE, "gauze"],
  },

  // Allied host-nation support — local blood programs + collection.
  HostNation: {
    itemIds: [
      ...BLOOD_PRODUCTS,
      ...TRANSFUSION_SUPPLIES,
      "tubes",
      "alcohol",
      "gauze",
    ],
  },
};

const FALLBACK_COVERAGE: ChannelCoverage = { categories: ["supplies"] };

/**
 * Compute the list of item ids a supplier carries based on its
 * channel's coverage rules. Used to populate `Supplier.items`.
 */
export function itemsCoveredBySupplier(
  supplier: DbSupplier,
  items: ReadonlyArray<Pick<DbItem, "id" | "category">>,
): string[] {
  const rule = CHANNEL_COVERAGE[supplier.channel] ?? FALLBACK_COVERAGE;
  const cats = new Set(rule.categories ?? []);
  const ids = new Set(rule.itemIds ?? []);
  return items
    .filter((it) => cats.has(it.category) || ids.has(it.id))
    .map((it) => it.id);
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
 * Pass `coveredItemIds` to populate the optional `items` array.
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
