/**
 * Generates `src/data/coverage.json` from the live API server, which is itself
 * driven by the canonical seed dataset (`lib/db/seed-data/dataset.xlsx`).
 *
 * The slides in `src/pages/slides/Stakes.tsx` and `src/pages/slides/Deliver.tsx`
 * import the resulting JSON so the leadership opener never displays stale
 * hardcoded counts.
 *
 * Prerequisite:
 *   The api-server workflow (`artifacts/api-server: API Server`) must be
 *   running and reachable. By default this script targets
 *   `http://localhost:8080`; override with the `IRON_VEIN_API` env var if the
 *   api-server is bound elsewhere (e.g. in a remote workspace).
 *
 * Regenerate whenever the seed dataset, network, or supplier mix changes:
 *   pnpm --filter @workspace/marines-opener run build-coverage
 *
 * After regenerating, re-run the manifest validator to confirm the deck still
 * renders cleanly:
 *   pnpm --filter @workspace/marines-opener run validate-slides
 *
 * The committed `coverage.json` carries a `generatedAt` ISO timestamp so
 * staleness can be eyeballed at a glance.
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API = process.env.IRON_VEIN_API ?? "http://localhost:8080";

type Site = {
  nodeId: string;
  name: string;
  type: string;
  hiddenFromMap?: boolean;
};

type Item = {
  id: string;
  name: string;
  category: string;
  classOfSupply: string;
};

type Supplier = {
  id: string;
  name: string;
  channel: string;
  countryCode: string;
};

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) {
    throw new Error(`GET ${path} → ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

function bucketize<T, K extends string>(
  rows: T[],
  key: (row: T) => K | null,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const k = key(row);
    if (!k) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

async function main() {
  const [sites, items, suppliers] = await Promise.all([
    fetchJson<Site[]>("/api/sites"),
    fetchJson<Item[]>("/api/items"),
    fetchJson<Supplier[]>("/api/suppliers"),
  ]);

  // Sustainment network = mappable, non-vendor nodes. Excludes the two
  // upstream pins (`Supplier`, `Prime vendor`) and the lowercase `mtf`
  // import-derived nodes that are hidden from the operational map.
  const operationalTypes = new Set([
    "Theater hub",
    "Regional hub",
    "Large MTF",
    "Standard MTF",
    "BAS",
    "Clinic",
    "Forward node",
  ]);

  const operationalNodes = sites.filter(
    (s) => operationalTypes.has(s.type) && !s.hiddenFromMap,
  );

  const nodesByType = bucketize(operationalNodes, (s) => s.type);

  const network = {
    operationalNodeCount: operationalNodes.length,
    theaterHubs: nodesByType["Theater hub"] ?? 0,
    regionalHubs: nodesByType["Regional hub"] ?? 0,
    largeMTFs: nodesByType["Large MTF"] ?? 0,
    standardMTFs: nodesByType["Standard MTF"] ?? 0,
    mtfTotal:
      (nodesByType["Large MTF"] ?? 0) + (nodesByType["Standard MTF"] ?? 0),
    bas: nodesByType["BAS"] ?? 0,
    clinics: nodesByType["Clinic"] ?? 0,
    forwardNodes: nodesByType["Forward node"] ?? 0,
    basNames: operationalNodes
      .filter((s) => s.type === "BAS")
      .map((s) => s.name.replace(/^BAS\s+/, ""))
      .sort(),
  };

  const itemsByCategory = bucketize(items, (i) =>
    i.classOfSupply === "VIII" ? i.category : null,
  );

  const itemsTotal = Object.values(itemsByCategory).reduce(
    (a, b) => a + b,
    0,
  );

  const suppliersByChannel = bucketize(suppliers, (s) => s.channel);
  const suppliersByCountry = bucketize(suppliers, (s) =>
    s.countryCode === "US" ? null : s.countryCode,
  );

  const supplierMix = {
    total: suppliers.length,
    dla: suppliersByChannel["DLA"] ?? 0,
    ecat: suppliersByChannel["ECAT"] ?? 0,
    gsa: suppliersByChannel["GSA"] ?? 0,
    fedmall: suppliersByChannel["FedMall"] ?? 0,
    asbp: suppliersByChannel["DOD"] ?? 0,
    commercial: suppliersByChannel["Commercial"] ?? 0,
    hostNation: suppliersByChannel["HostNation"] ?? 0,
    allied: suppliersByChannel["Allied"] ?? 0,
    hostNationCountries: Object.entries(suppliersByCountry)
      .filter(([cc]) => ["JP", "KR", "AU", "PH"].includes(cc))
      .map(([cc]) => cc)
      .sort(),
    alliedCountries: Object.entries(suppliersByCountry)
      .filter(([cc]) => ["TW", "SG", "NZ"].includes(cc))
      .map(([cc]) => cc)
      .sort(),
  };

  const coverage = {
    generatedAt: new Date().toISOString(),
    source: API,
    classVIII: {
      itemsTotal,
      blood: itemsByCategory["blood_products"] ?? 0,
      supplies: itemsByCategory["supplies"] ?? 0,
      ppe: itemsByCategory["ppe"] ?? 0,
      other: itemsByCategory["other"] ?? 0,
    },
    network,
    supplierMix,
  };

  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(here, "..", "src", "data", "coverage.json");
  writeFileSync(outPath, `${JSON.stringify(coverage, null, 2)}\n`);
  console.log(`✓ Wrote ${outPath}`);
  console.log(JSON.stringify(coverage, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
