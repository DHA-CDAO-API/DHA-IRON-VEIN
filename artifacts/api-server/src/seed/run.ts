import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import * as XLSX from "xlsx";
import { db } from "@workspace/db";
import {
  catalogEntries,
  nodes,
  routes,
  items,
  inventoryBalances,
  suppliers,
  supplierItems,
  alerts,
  orders,
  orderLines,
  shipments,
  appSettings,
  profiles,
  demandProfiles,
  operationalStates,
  itemSkewFactors,
  presetEvents,
  conversations,
  conversationMessages,
  scenarios,
  recommendations,
  activityEntries,
  bloodLots,
  coldChainAssets,
  donorPools,
  temperatureEvents,
  patientTypes,
  patientItemRequirements,
  eventTypes,
  eventPatientMix,
  procedures as proceduresTable,
  procedureSupplies,
  procedureRoles,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { encryptText } from "../lib/crypto";
import {
  computeDailyDemand,
  generateRecommendations,
  projectDaysOfSupply,
  type SimDemandProfile,
  type SimItem,
  type SimNode,
  type SimRoute,
  type SimSupplier,
} from "@workspace/sim";

const __filename = fileURLToPath(import.meta.url);
const __dirnameLocal = path.dirname(__filename);
const candidates = [
  path.resolve(__dirnameLocal, "../../../../lib/db/seed-data"),
  path.resolve(process.cwd(), "lib/db/seed-data"),
  path.resolve(process.cwd(), "../../lib/db/seed-data"),
];
const SEED_DIR = candidates.find((c) => existsSync(c)) ?? candidates[0]!;

type Row = Record<string, unknown>;

function readSheet(wb: XLSX.WorkBook, name: string): Row[] {
  const ws = wb.Sheets[name];
  if (!ws) {
    logger.warn({ name }, "sheet missing in dataset");
    return [];
  }
  return XLSX.utils.sheet_to_json<Row>(ws, { range: 1, defval: null });
}

function asNumber(v: unknown, def = 0): number {
  if (v === null || v === undefined || v === "") return def;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : def;
}

function asString(v: unknown, def = ""): string {
  if (v === null || v === undefined) return def;
  return String(v);
}

// Item ID groups used by SUPPLIER_DEFS' itemsCovered arrays. Keep in sync
// with ITEM_CATALOG below — the recommendation engine uses itemsCovered to
// decide which suppliers can fill a particular shortfall, and the seeded
// `supplier_items` join table is derived from the same arrays so coverage
// can be queried from the DB directly.
// General medical supplies used by the patient bill-of-materials.
const ITEMS_GENERAL_MED: string[] = [
  "iv_fluid_ns","iv_fluid_lr","airway_kit","tq_cat","chest_seal","hemo_dressing",
  "pressure_dressing","burn_dressing","suture_kit","antibiotic_iv","antibiotic_po",
  "analgesic_morphine","analgesic_ketamine","trauma_dressing","splint_sam","ob_kit",
  "peds_airway_kit","antiemetic","oral_rehydration",
];

const ITEMS_FULL_CATALOG: string[] = [
  // blood
  "ltow_pos","ltow_neg","prbc_o","ffp_ab","plasma_a","platelets","cryo","fdp",
  // collection
  "tubes","butterfly","alcohol","gauze","tourniquet","bags","labels","collection_bag","antiseptic",
  // cold-chain
  "cooler","coolant","chain_log",
  // testing
  "abo_kit","crossmatch","id_screen",
  // transfusion
  "iv_set","pressure_inf","warmer","transfusion_band",
  // general medical (casualty bill-of-materials)
  ...ITEMS_GENERAL_MED,
  // PPE
  "gloves","mask","shield","gown","n95",
  // other
  "sharps","centrifuge_tube","biohazard_bag",
];
const ITEMS_BLOOD: string[] = ["ltow_pos","ltow_neg","prbc_o","ffp_ab","plasma_a","platelets","cryo","fdp"];
const ITEMS_TESTING: string[] = ["abo_kit","crossmatch","id_screen"];
const ITEMS_COLDCHAIN: string[] = ["cooler","coolant","chain_log"];
const ITEMS_TRANSFUSION: string[] = ["iv_set","pressure_inf","warmer","transfusion_band","collection_bag"];
const ITEMS_PPE: string[] = ["gloves","mask","shield","gown","n95"];
const ITEMS_COLLECTION: string[] = ["tubes","butterfly","alcohol","gauze","tourniquet","bags","labels","collection_bag","antiseptic"];

const SUPPLIER_DEFS: Array<{
  id: string;
  name: string;
  channel: string;
  country: string;
  leadTimeDaysMean: number;
  reliabilityScore: number;
  unitCostUsd?: number;
  itemsCovered: string[];
  notes: string;
}> = [
  // ---- DOD channels (slow but trusted) ----
  { id: "dla-prime", name: "DLA Prime Vendor (Class VIII)", channel: "DLA", country: "US", leadTimeDaysMean: 5, reliabilityScore: 0.94, itemsCovered: ITEMS_FULL_CATALOG, notes: "Defense Logistics Agency primary medical supply channel" },
  { id: "ecat", name: "ECAT (Electronic Catalog)", channel: "ECAT", country: "US", leadTimeDaysMean: 7, reliabilityScore: 0.91, itemsCovered: ITEMS_FULL_CATALOG, notes: "DLA peacetime/readiness portal" },
  { id: "gsa", name: "GSA Schedule 65", channel: "GSA", country: "US", leadTimeDaysMean: 12, reliabilityScore: 0.88, itemsCovered: [...ITEMS_PPE, ...ITEMS_COLLECTION, ...ITEMS_TRANSFUSION, "sharps","centrifuge_tube","biohazard_bag"], notes: "GSA medical schedule" },
  { id: "fedmall", name: "FedMall", channel: "FedMall", country: "US", leadTimeDaysMean: 10, reliabilityScore: 0.86, itemsCovered: [...ITEMS_PPE, ...ITEMS_COLLECTION, "iv_set","transfusion_band","sharps","centrifuge_tube","biohazard_bag"], notes: "DoD e-commerce ordering" },
  { id: "armed-services-blood", name: "Armed Services Blood Program", channel: "DOD", country: "US", leadTimeDaysMean: 6, reliabilityScore: 0.93, itemsCovered: ITEMS_BLOOD, notes: "ASBP collection / distribution — primary DOD blood channel" },

  // ---- Commercial USA backstops (fast, expensive) ----
  { id: "mckesson", name: "McKesson Distribution", channel: "Commercial", country: "US", leadTimeDaysMean: 4, reliabilityScore: 0.93, itemsCovered: [...ITEMS_PPE, ...ITEMS_COLLECTION, ...ITEMS_TRANSFUSION, ...ITEMS_TESTING, ...ITEMS_COLDCHAIN, ...ITEMS_GENERAL_MED, "sharps","centrifuge_tube","biohazard_bag"], notes: "Commercial backstop — pharmaceuticals & supplies" },
  { id: "cardinal", name: "Cardinal Health", channel: "Commercial", country: "US", leadTimeDaysMean: 5, reliabilityScore: 0.92, itemsCovered: [...ITEMS_PPE, ...ITEMS_COLLECTION, ...ITEMS_TRANSFUSION, ...ITEMS_GENERAL_MED, "sharps"], notes: "Commercial backstop — exam/surgical gloves & trauma supplies" },
  { id: "henryschein", name: "Henry Schein", channel: "Commercial", country: "US", leadTimeDaysMean: 6, reliabilityScore: 0.9, itemsCovered: [...ITEMS_PPE, ...ITEMS_COLLECTION, ...ITEMS_TESTING, "iv_set","transfusion_band","cooler","coolant","iv_fluid_ns","iv_fluid_lr","suture_kit","airway_kit","peds_airway_kit","ob_kit","splint_sam","antiemetic","oral_rehydration"], notes: "Commercial backstop — phlebotomy, lab & ambulatory" },
  { id: "owensminor", name: "Owens & Minor", channel: "Commercial", country: "US", leadTimeDaysMean: 6, reliabilityScore: 0.89, itemsCovered: [...ITEMS_PPE, ...ITEMS_TRANSFUSION, ...ITEMS_COLLECTION, "sharps","centrifuge_tube","biohazard_bag","trauma_dressing","burn_dressing","pressure_dressing","hemo_dressing","tq_cat","chest_seal"], notes: "Commercial backstop — surgical kits & trauma dressings" },
  { id: "vitalant-pacific", name: "Vitalant — Pacific Region", channel: "Commercial", country: "US", leadTimeDaysMean: 3, reliabilityScore: 0.9, itemsCovered: ["prbc_o","ffp_ab","plasma_a","platelets","cryo"], notes: "Commercial blood center — Pacific NW & HI distribution" },
  { id: "abbott-coldchain", name: "Abbott Cold-Chain Solutions", channel: "Commercial", country: "US", leadTimeDaysMean: 5, reliabilityScore: 0.91, itemsCovered: [...ITEMS_COLDCHAIN, "warmer"], notes: "Commercial cold-chain hardware (Helmer/Helmer-equivalent)" },
  { id: "ortho-diag", name: "Ortho Clinical Diagnostics", channel: "Commercial", country: "US", leadTimeDaysMean: 6, reliabilityScore: 0.92, itemsCovered: ITEMS_TESTING, notes: "Commercial reagent supplier (ABO/Rh, ID screen)" },

  // ---- Host nation — Japan / Korea / Australia / Philippines ----
  { id: "hostnation-jp", name: "Host Nation — Japan (JSDF Med + JRCS)", channel: "HostNation", country: "JP", leadTimeDaysMean: 2, reliabilityScore: 0.92, itemsCovered: [...ITEMS_BLOOD, ...ITEMS_TESTING, ...ITEMS_COLDCHAIN, ...ITEMS_TRANSFUSION, ...ITEMS_PPE], notes: "Allied basing support — Okinawa / Iwakuni / Yokota; JRCS blood + JSDF medical logistics" },
  { id: "hostnation-kr", name: "Host Nation — Korea (ROK MND Med + KRCBI)", channel: "HostNation", country: "KR", leadTimeDaysMean: 2, reliabilityScore: 0.9, itemsCovered: [...ITEMS_BLOOD, ...ITEMS_TESTING, ...ITEMS_TRANSFUSION, ...ITEMS_PPE, ...ITEMS_COLLECTION], notes: "Allied basing support — Camp Humphreys / Daegu; ROK Blood Centers + MND medical" },
  { id: "hostnation-au", name: "Host Nation — Australia (DSTG + Lifeblood)", channel: "HostNation", country: "AU", leadTimeDaysMean: 3, reliabilityScore: 0.89, itemsCovered: [...ITEMS_BLOOD, ...ITEMS_TESTING, ...ITEMS_COLDCHAIN, ...ITEMS_TRANSFUSION, ...ITEMS_PPE], notes: "Allied basing support — Darwin / Tindal / Townsville; AU Lifeblood + DSTG" },
  { id: "hostnation-ph", name: "Host Nation — Philippines (AFP Med)", channel: "HostNation", country: "PH", leadTimeDaysMean: 4, reliabilityScore: 0.81, itemsCovered: [...ITEMS_PPE, ...ITEMS_COLLECTION, ...ITEMS_TRANSFUSION], notes: "Allied basing support — EDCA sites" },

  // ---- Allied (PRC-adjacent partners) ----
  { id: "allied-tw", name: "Allied — Taiwan (TaiwanBC + MND)", channel: "Allied", country: "TW", leadTimeDaysMean: 3, reliabilityScore: 0.84, itemsCovered: [...ITEMS_BLOOD, ...ITEMS_TESTING, ...ITEMS_TRANSFUSION], notes: "PRC-adjacent partner — Taiwan Blood Services Foundation + MND medical" },
  { id: "allied-sg", name: "Allied — Singapore (SAF Med + HSA)", channel: "Allied", country: "SG", leadTimeDaysMean: 4, reliabilityScore: 0.9, itemsCovered: [...ITEMS_BLOOD, ...ITEMS_TESTING, ...ITEMS_COLDCHAIN, ...ITEMS_TRANSFUSION, ...ITEMS_PPE], notes: "PRC-adjacent partner — SAF medical logistics + Health Sciences Authority blood services" },
  { id: "allied-nz", name: "Allied — New Zealand (NZBS + NZDF)", channel: "Allied", country: "NZ", leadTimeDaysMean: 5, reliabilityScore: 0.87, itemsCovered: [...ITEMS_BLOOD, ...ITEMS_PPE, ...ITEMS_COLLECTION, ...ITEMS_TRANSFUSION], notes: "Five Eyes partner — NZ Blood Service + NZDF" },
];

// Preset events ordered with kinetic / contested scenarios first (lowest displayOrder),
// degraded comms / cyber / blockade in the middle, logistics disruptions next,
// and weather / natural disasters last.
const PRESET_EVENTS = [
  // ---- Tier 1: Kinetic / war / contested-fires (displayOrder 10-49) ----
  {
    id: "ev-prc-taiwan-blockade",
    name: "PRC Taiwan Blockade — Joint Sword Surge",
    kind: "war_conflict",
    summary:
      "PLA-led joint blockade of Taiwan closes the Taiwan Strait, suspends commercial air, and forces all theater resupply onto Luzon Strait and Bashi Channel reroutes for 21 days.",
    durationDays: 21,
    displayOrder: 10,
    parameters: {
      affectedNodes: ["theater", "centralHub", "southHub", "mtfDelta", "mtfGolf", "mtfHotel", "mtfKilo", "basCopper", "basIron"],
      encounterMultiplier: 2.4,
      populationMultiplier: 1.2,
      wasteMultiplier: 1.35,
      routeReliabilityDelta: -0.55,
      routeDelayDays: 9,
      specimensMultiplier: 1.6,
      itemSkew: { ltow_pos: 2.2, ltow_neg: 2.0, prbc_o: 2.0, ffp_ab: 1.8, fdp: 2.4, iv_set: 1.6, crossmatch: 1.7 },
    },
  },
  {
    id: "ev-senkaku-kinetic",
    name: "Senkaku / Diaoyu Kinetic Incident",
    kind: "war_conflict",
    summary:
      "Limited PLA-N kinetic exchange in the East China Sea drives a MASCAL spike at Okinawa-aligned MTFs and a 14-day air-corridor degradation north of 25°N.",
    durationDays: 14,
    displayOrder: 15,
    parameters: {
      affectedNodes: ["theater", "centralHub", "mtfEcho", "mtfHotel", "mtfKilo"],
      encounterMultiplier: 2.8,
      populationMultiplier: 1.05,
      wasteMultiplier: 1.4,
      routeReliabilityDelta: -0.4,
      routeDelayDays: 5,
      specimensMultiplier: 1.9,
      itemSkew: { ltow_pos: 2.5, prbc_o: 2.2, ffp_ab: 2.0, platelets: 1.6, tubes: 1.5, gloves: 1.4 },
    },
  },
  {
    id: "ev-a2ad-conus",
    name: "A2/AD Denial — CONUS Strategic Lift",
    kind: "contested_logistics",
    summary:
      "Anti-access / area-denial posture in the Western Pacific halts CONUS-origin strategic airlift for 10 days; theater must subsist on host-nation and intra-theater stocks.",
    durationDays: 10,
    displayOrder: 20,
    parameters: {
      affectedNodes: ["theater", "centralHub", "southHub", "mtfDelta", "mtfEcho", "mtfGolf", "mtfHotel", "mtfKilo", "mtfRomeo", "mtfUniform", "basCopper", "basIron", "basZinc", "basSteel"],
      encounterMultiplier: 1.15,
      wasteMultiplier: 1.1,
      routeReliabilityDelta: -0.5,
      routeDelayDays: 8,
    },
  },
  {
    id: "ev-luzon-strait",
    name: "Luzon Strait Sea-Lane Interdiction",
    kind: "contested_logistics",
    summary:
      "PLA-N submarine and missile activity interdicts the Luzon Strait sea-lane for 7 days; surface lift between Subic and Okinawa drops to 35% reliability.",
    durationDays: 7,
    displayOrder: 25,
    parameters: {
      affectedNodes: ["southHub", "centralHub", "basCopper", "basIron", "basZinc", "basSteel", "mtfDelta"],
      routeReliabilityDelta: -0.45,
      routeDelayDays: 6,
      encounterMultiplier: 1.2,
    },
  },
  {
    id: "ev-yokosuka-strike",
    name: "Yokosuka Strike Package — Forward Strike Risk",
    kind: "war_conflict",
    summary:
      "Coordinated long-range fires threaten Yokosuka-area infrastructure; northern theater MTFs absorb a 96-hour MASCAL surge and a 12-day medical-waste spike.",
    durationDays: 12,
    displayOrder: 30,
    parameters: {
      affectedNodes: ["theater", "mtfDelta", "mtfGolf"],
      encounterMultiplier: 3.0,
      populationMultiplier: 1.15,
      wasteMultiplier: 1.5,
      specimensMultiplier: 2.0,
      routeReliabilityDelta: -0.25,
      routeDelayDays: 3,
      itemSkew: { ltow_pos: 2.8, prbc_o: 2.4, ffp_ab: 2.2, fdp: 2.5, iv_set: 1.8, warmer: 1.6, abo_kit: 1.7 },
    },
  },
  {
    id: "ev-mascal-theater",
    name: "MASCAL — Theater Medical Hub",
    kind: "mass_casualty",
    summary:
      "Multi-vehicle incident drives a 72-hour MASCAL surge at the theater hub; phlebotomy and trauma kits spike.",
    durationDays: 4,
    displayOrder: 35,
    parameters: {
      affectedNodes: ["theater", "mtfDelta", "mtfGolf"],
      encounterMultiplier: 2.5,
      specimensMultiplier: 1.8,
      wasteMultiplier: 1.4,
      itemSkew: { tubes: 1.6, gloves: 1.5 },
    },
  },
  {
    id: "ev-contested-scs",
    name: "Contested Logistics — South China Sea",
    kind: "contested_logistics",
    summary:
      "Adversary maritime activity in the SCS corridor forces reroutes; 7-day reliability hit across forward sites.",
    durationDays: 7,
    displayOrder: 40,
    parameters: {
      affectedNodes: ["southHub", "centralHub", "basCopper", "basIron", "basZinc", "basSteel"],
      routeReliabilityDelta: -0.35,
      routeDelayDays: 5,
    },
  },

  // ---- Tier 2: Degraded comms / cyber / undersea blockade (50-79) ----
  {
    id: "ev-cable-cut-comms",
    name: "Undersea Cable Cut + Comms Denial",
    kind: "cyber_comms",
    summary:
      "Pacific submarine cable is severed and coincident SATCOM jamming degrades inventory visibility and ordering for 9 days; manual workarounds drive waste up.",
    durationDays: 9,
    displayOrder: 50,
    parameters: {
      affectedNodes: ["theater", "centralHub", "southHub", "mtfDelta", "mtfEcho", "mtfGolf", "mtfHotel", "mtfKilo", "mtfRomeo", "mtfUniform"],
      wasteMultiplier: 1.25,
      routeReliabilityDelta: -0.3,
      routeDelayDays: 4,
      encounterMultiplier: 1.05,
    },
  },
  {
    id: "ev-cyber-mhs",
    name: "Cyber Disruption — MHS Genesis",
    kind: "cyber_comms",
    summary:
      "Ransomware-class incident degrades the medical health system of record; ordering and EHR access drop for 6 days, forcing higher waste and over-ordering.",
    durationDays: 6,
    displayOrder: 55,
    parameters: {
      affectedNodes: ["theater", "centralHub", "southHub", "mtfDelta", "mtfEcho", "mtfGolf", "mtfHotel", "mtfKilo"],
      wasteMultiplier: 1.3,
      routeReliabilityDelta: -0.2,
      routeDelayDays: 2,
    },
  },

  // ---- Tier 3: Logistics / infrastructure disruptions (80-99) ----
  {
    id: "ev-port-closure-central",
    name: "Port Closure — Central Hub",
    kind: "infra_disruption",
    summary:
      "Naha-class port closure blocks the primary surface route into the central regional hub for 5 days.",
    durationDays: 5,
    displayOrder: 80,
    parameters: {
      affectedNodes: ["centralHub", "mtfEcho", "mtfHotel", "mtfKilo"],
      routeReliabilityDelta: -0.4,
      routeDelayDays: 4,
      encounterMultiplier: 1.05,
    },
  },
  {
    id: "ev-coldchain-failure",
    name: "Cold-Chain Failure — Forward Hub",
    kind: "infra_disruption",
    summary:
      "Forward-hub refrigeration outage condemns 30% of liquid blood components; depleted stock must be replaced via airlift before the next transfusion event.",
    durationDays: 3,
    displayOrder: 85,
    parameters: {
      affectedNodes: ["southHub", "mtfRomeo", "mtfUniform"],
      wasteMultiplier: 2.2,
      routeReliabilityDelta: -0.1,
      routeDelayDays: 1,
      itemSkew: { ltow_pos: 1.8, ltow_neg: 1.8, prbc_o: 1.6, plasma_a: 1.6, platelets: 2.0 },
    },
  },
  {
    id: "ev-yokosuka-coldstorage",
    name: "Yokosuka Cold-Storage Strike",
    kind: "infra_disruption",
    summary:
      "Precision strike on Yokosuka medical refrigeration plant takes the northern theater cold rooms and Helmer banks offline for 36 h — liquid PRBC, plasma, and platelet inventory is condemned and must be re-sourced.",
    durationDays: 4,
    displayOrder: 32,
    parameters: {
      affectedNodes: ["theater", "mtfDelta", "mtfGolf", "mtfHotel"],
      wasteMultiplier: 1.4,
      routeReliabilityDelta: -0.15,
      routeDelayDays: 2,
      itemSkew: { prbc_o: 1.6, plasma_a: 1.4, platelets: 2.2, ltow_pos: 1.5 },
      coldChain: {
        outageHours: 36,
        initialCompromisedFraction: 0.4,
        assetTypes: ["refrigerator", "freezer", "platelet_incubator"],
      },
    },
  },
  {
    id: "ev-pacific-reagent-shortage",
    name: "Pacific Reagent Shortage",
    kind: "supply_disruption",
    summary:
      "Sole-source ABO/Rh and ID-screen reagent backorder strands forward labs at < 3 days of supply — donor screening throughput at northern and central hubs is gated by reagent availability for two weeks.",
    durationDays: 14,
    displayOrder: 90,
    parameters: {
      affectedNodes: ["theater", "centralHub", "mtfDelta", "mtfGolf", "mtfEcho"],
      wasteMultiplier: 1.05,
      routeReliabilityDelta: -0.05,
      routeDelayDays: 1,
      itemSkew: { abo_kit: 2.4, crossmatch: 2.0, id_screen: 2.6 },
      reagent: {
        reagentItemIds: ["abo_kit", "crossmatch", "id_screen"],
        thresholdDays: 3,
        minCapacityFraction: 0.15,
      },
    },
  },
  {
    id: "ev-airlift-denial-pacific",
    name: "Airlift Denial — Pacific",
    kind: "infra_disruption",
    summary:
      "PRC long-range fires push C-17 / commercial-charter routes outside threat envelope; airlift transit times rise by 2-3 days and a fraction of arriving liquid blood degrades en route.",
    durationDays: 10,
    displayOrder: 45,
    parameters: {
      affectedNodes: ["theater", "centralHub", "mtfDelta", "mtfGolf", "mtfEcho", "mtfHotel"],
      wasteMultiplier: 1.2,
      routeReliabilityDelta: -0.3,
      routeDelayDays: 3,
      itemSkew: { ltow_pos: 1.5, prbc_o: 1.5, plasma_a: 1.4, platelets: 1.7 },
      airlift: {
        additionalTransitDays: 2.5,
        viabilityLossPerDay: 0.12,
        affectedModalities: ["air", "airlift"],
      },
    },
  },

  // ---- Tier 4: Weather / natural disasters (100+) ----
  {
    id: "ev-typhoon-southhub",
    name: "Typhoon Yagi-class — Southern Spoke",
    kind: "natural_disaster",
    summary:
      "Cat-4 typhoon saturates the southern spoke; civilian-assist demand and waste both rise sharply for 14 days.",
    durationDays: 14,
    displayOrder: 110,
    parameters: {
      affectedNodes: ["southHub", "mtfRomeo", "mtfUniform", "basCopper"],
      encounterMultiplier: 1.6,
      populationMultiplier: 1.1,
      wasteMultiplier: 1.3,
      routeReliabilityDelta: -0.25,
      routeDelayDays: 3,
    },
  },
];

/**
 * Map free-text node `type` strings (e.g. "Theater hub", "Large MTF",
 * "Forward node", "BAS") into a canonical role_1/role_2/role_3 tag for
 * demand nodes. Returns null for non-demand sites (suppliers, hubs,
 * prime vendors) so the role badge stays empty there.
 */
function roleForNodeType(nodeType: string): string | null {
  const t = (nodeType ?? "").toLowerCase();
  if (!t) return null;
  // Role 3: combat support hospital / large MTF / theater hub field hospitals
  if (
    t.includes("field hospital") ||
    t.includes("large mtf") ||
    t.includes("theater hub") ||
    t.includes("combat support hospital") ||
    t === "csh"
  ) {
    return "role_3";
  }
  // Role 2: forward surgical / standard MTF / forward node / hospital ship
  if (
    t.includes("forward surgical") ||
    t.includes("forward resuscitative") ||
    t.includes("standard mtf") ||
    t.includes("forward node") ||
    t.includes("hospital ship") ||
    t === "ship" ||
    t === "hospital"
  ) {
    return "role_2";
  }
  // Role 1: BAS / aid station / forward clinic / clinic
  if (
    t.includes("bas") ||
    t.includes("aid station") ||
    t.includes("forward clinic") ||
    t.includes("battalion aid") ||
    t === "clinic" ||
    t.includes("treatment node")
  ) {
    return "role_1";
  }
  // Non-demand sites (supplier, prime vendor, regional hub, port, depot)
  return null;
}

// =============================================================================
// Curated steady-state stress profile
// =============================================================================
// The default seed needs to read like a real network: most sites quietly
// nominal, a clear handful of "interesting" problem sites that drive the
// demo story (alerts, recommendations, scenarios). The previous behavior
// scaled *every* site's inventory down to active-operations levels, which
// painted the entire map red and erased any useful signal.
//
// Two knobs replace the old broad stress scale:
//
//   1. `BASELINE_STOCK_SCALE_BY_TYPE` — a per-node-type multiplier applied
//      to the seeded sheet quantity at every non-curated node. Sized so
//      every category of supply lands comfortably above the 14-day WATCH
//      threshold for that site type, regardless of optempo. Tuning these
//      up makes the map quieter; tuning down makes more sites slide into
//      the watch band naturally.
//
//   2. `CURATED_PROBLEM_SITES` — a small, deterministic set of nodes that
//      are *intentionally* stressed in specific ways so the operator has
//      real problems to solve. Each entry documents the demo story and
//      lists per-item shortage scales (multiplied against the baseline
//      sheet quantity). Anything not listed inherits the healthy
//      baseline. Order is not significant; reseeds are deterministic.
//
// To tune the steady state, edit either constant — the seeder, the alert
// generator, and the snapshot all derive their behavior from these.
const BASELINE_STOCK_SCALE_BY_TYPE: Record<string, number> = {
  // Supplier / prime vendor stocks aren't pulled into demand math, so
  // these multipliers mostly affect "how many units are visible at the
  // origin of a route" rather than DOS. Kept generous.
  Supplier: 2.0,
  "Prime vendor": 2.0,
  // Hubs (theater + regional) hold deep wholesale stock — keep them well
  // above the 14-day band so the rollup doesn't flag the spine of the
  // network on noise.
  "Theater hub": 2.4,
  "Regional hub": 2.4,
  // MTFs sit a tier shallower than hubs but still need a comfortable
  // buffer so a single optempo-driven swing doesn't make them blink.
  "Large MTF": 2.6,
  "Standard MTF": 2.6,
  Clinic: 2.4,
  // BAS / forward nodes have small absolute stocks; we scale up more so
  // their handful of items still clear the 14-day floor.
  BAS: 3.0,
  "Forward node": 3.0,
};
const DEFAULT_BASELINE_STOCK_SCALE = 2.4;

type CuratedProblemSite = {
  /** Free-text description of the demo arc this site drives. */
  description: string;
  /**
   * Per-item shortage scale. Anything in this map replaces the healthy
   * baseline for the listed item; everything else stays nominal. Values
   * are multipliers against the seeded sheet quantity (or, for items
   * synthesized via `stockTargetByItem`, against the stockTarget * depth
   * baseline) — small numbers (~0.05) push the site to <3 DOS, mid
   * numbers (~0.3) drag it into the watch band.
   */
  shortageScaleByItem: Record<string, number>;
};
const CURATED_PROBLEM_SITES: Record<string, CuratedProblemSite> = {
  // Forward BAS short on whole blood — drives the "blood at the FLOT"
  // demo arc. The Walking Blood Bank gap surfaces as critical alerts on
  // LTOWB / FDP / liquid plasma and feeds the recommendations rail with
  // resupply suggestions from ASBP and Vitalant.
  basIron: {
    description:
      "Forward BAS Iron short on whole blood — Walking Blood Bank gap drives the FLOT-blood demo arc.",
    shortageScaleByItem: {
      ltow_pos: 0.04,
      ltow_neg: 0.04,
      fdp: 0.05,
      ffp_ab: 0.06,
      plasma_a: 0.08,
      prbc_o: 0.08,
    },
  },
  // Large MTF caught by a cold-chain failure — liquid components are
  // condemned and the cold-chain consumables fall to <3 DOS. This is the
  // anchor for the cold-chain story (Yokosuka Cold-Storage Strike preset
  // event uses the same node ids).
  mtfHotel: {
    description:
      "MTF Hotel cold-chain failure — liquid blood condemned, cold-chain consumables short.",
    shortageScaleByItem: {
      prbc_o: 0.06,
      plasma_a: 0.06,
      platelets: 0.04,
      cooler: 0.08,
      coolant: 0.08,
      chain_log: 0.07,
    },
  },
  // Regional hub running into a sole-source reagent backorder — the
  // typing/screen pipeline feeding everything downstream is at risk.
  // This is a "cascading" problem site so heightened ripples to the
  // MTFs in its corridor in the alerts and recommendations.
  centralHub: {
    description:
      "Regional Hub Central reagent backorder — cascading typing/screen risk for downstream MTFs.",
    shortageScaleByItem: {
      abo_kit: 0.07,
      crossmatch: 0.05,
      id_screen: 0.05,
    },
  },
};

/**
 * Returns the inventory multiplier to apply to (`nodeId`, `itemId`) when
 * computing on-hand from the baseline target. Curated problem sites
 * override on a per-item basis; everything else falls through to the
 * type-based healthy baseline.
 */
function inventoryScale(
  nodeId: string,
  itemId: string,
  nodeType: string,
): number {
  const curated = CURATED_PROBLEM_SITES[nodeId];
  if (curated) {
    const override = curated.shortageScaleByItem[itemId];
    if (override !== undefined) return override;
  }
  return (
    BASELINE_STOCK_SCALE_BY_TYPE[nodeType] ?? DEFAULT_BASELINE_STOCK_SCALE
  );
}

function deterministicJitter(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const v = (Math.abs(h) % 1000) / 1000;
  return 0.85 + v * 0.3;
}

const OPERATIONAL_STATE_DESCRIPTIONS: Record<string, string> = {
  garrison: "Garrison / Steady State — baseline home-station medical demand.",
  standby: "Reduced Manning / Standby — minimal staffing and low routine patient flow.",
  exercise: "Exercise / Workup — moderate uptick from training operations.",
  forward_deployed: "Forward Deployed — sustained operational tempo at distance.",
  combat_ops: "Combat Operations — high tempo, elevated trauma demand.",
  contested: "Contested Logistics — degraded SLOCs and elevated risk.",
  mascal: "MASCAL Surge — short-duration mass casualty surge.",
};

export type SeedOptions = { truncate?: boolean };

export async function runSeed(opts: SeedOptions = {}): Promise<void> {
  const wbPath = path.join(SEED_DIR, "dataset.xlsx");
  const csvPath = path.join(SEED_DIR, "medical_supply_inventory.csv");
  if (!existsSync(wbPath)) throw new Error(`dataset.xlsx not found at ${wbPath}`);
  const wbBuf = readFileSync(wbPath);
  const wb = XLSX.read(wbBuf, { type: "buffer" });

  if (opts.truncate) {
    await db.execute(sql`TRUNCATE TABLE
      activity_entries, conversation_messages, conversations, scenarios, recommendations,
      shipments, order_lines, orders, alerts, inventory_balances, demand_profiles,
      item_skew_factors, preset_events, operational_states, supplier_items,
      event_patient_mix, event_types, patient_item_requirements, patient_types,
      suppliers, items,
      routes, nodes, catalog_entries, app_settings, profiles,
      blood_lots, cold_chain_assets, donor_pools, temperature_events,
      tag_assignments, tags,
      procedure_supplies, procedure_roles, procedures
      RESTART IDENTITY`);
  }

  // ---- Items (hand-curated, blood-products-first) ----
  // category: blood_products | supplies | ppe | other
  // commodityType / unspscCommodity / size / productNoun support the
  // casualty planner's commodity-grouped required-materiel view.
  // staffingTag links PPE items to the clinician staffing model so PPE
  // demand isn't bound to hard-coded ids.
  // unitPriceUsd is the catalog price every order-create handler uses to
  // compute total_usd server-side. Numbers below are realistic
  // DoD-reimbursement / GSA-bulk-rate references for INDOPACOM. Every item
  // MUST have a non-zero price — the order handler refuses to write a PO
  // whose computed total is $0 (task #222).
  const ITEM_CATALOG: Array<{
    id: string;
    name: string;
    unit: string;
    category: "blood_products" | "supplies" | "ppe" | "other";
    criticality: "critical" | "high" | "medium" | "low";
    baseDemand: number;
    waste: number;
    trigger: string;
    leadTimeDays: number;
    shelfLifeDays: number;
    classOfSupply: string;
    commodityType: string;
    unspscCommodity: string;
    size: string;
    productNoun: string;
    staffingTag?: string;
    unitPriceUsd: number;
  }> = [
    // ---- Blood products (USMC Walking Blood Bank + frozen/liquid components) ----
    { id: "ltow_pos",   name: "Whole Blood Low-Titer O Pos",        unit: "units", category: "blood_products", criticality: "critical", baseDemand: 1.0, waste: 1.10, trigger: "transfusion_event", leadTimeDays: 2, shelfLifeDays: 21,  classOfSupply: "VIII", commodityType: "Blood — Whole",   unspscCommodity: "51171800", size: "450 mL", productNoun: "Whole Blood",          unitPriceUsd: 425.00 },
    { id: "ltow_neg",   name: "Whole Blood Low-Titer O Neg",        unit: "units", category: "blood_products", criticality: "critical", baseDemand: 0.5, waste: 1.10, trigger: "transfusion_event", leadTimeDays: 2, shelfLifeDays: 21,  classOfSupply: "VIII", commodityType: "Blood — Whole",   unspscCommodity: "51171800", size: "450 mL", productNoun: "Whole Blood",          unitPriceUsd: 475.00 },
    { id: "prbc_o",     name: "Packed Red Blood Cells (PRBC) O",    unit: "units", category: "blood_products", criticality: "critical", baseDemand: 1.5, waste: 1.08, trigger: "transfusion_event", leadTimeDays: 3, shelfLifeDays: 42,  classOfSupply: "VIII", commodityType: "Blood — Component", unspscCommodity: "51171802", size: "300 mL", productNoun: "Red Cells",            unitPriceUsd: 525.00 },
    { id: "ffp_ab",     name: "Fresh Frozen Plasma AB (Universal)", unit: "units", category: "blood_products", criticality: "critical", baseDemand: 1.0, waste: 1.05, trigger: "transfusion_event", leadTimeDays: 4, shelfLifeDays: 365, classOfSupply: "VIII", commodityType: "Blood — Component", unspscCommodity: "51171803", size: "250 mL", productNoun: "Plasma",               unitPriceUsd: 65.00 },
    { id: "plasma_a",   name: "Liquid Plasma Group A",              unit: "units", category: "blood_products", criticality: "high",     baseDemand: 0.6, waste: 1.05, trigger: "transfusion_event", leadTimeDays: 3, shelfLifeDays: 26,  classOfSupply: "VIII", commodityType: "Blood — Component", unspscCommodity: "51171803", size: "250 mL", productNoun: "Plasma",               unitPriceUsd: 60.00 },
    { id: "platelets",  name: "Apheresis Platelets",                unit: "units", category: "blood_products", criticality: "critical", baseDemand: 0.4, waste: 1.20, trigger: "transfusion_event", leadTimeDays: 2, shelfLifeDays: 5,   classOfSupply: "VIII", commodityType: "Blood — Component", unspscCommodity: "51171804", size: "200 mL", productNoun: "Platelets",            unitPriceUsd: 625.00 },
    { id: "cryo",       name: "Cryoprecipitate",                    unit: "units", category: "blood_products", criticality: "high",     baseDemand: 0.3, waste: 1.10, trigger: "transfusion_event", leadTimeDays: 4, shelfLifeDays: 365, classOfSupply: "VIII", commodityType: "Blood — Component", unspscCommodity: "51171805", size: "20 mL",  productNoun: "Cryoprecipitate",      unitPriceUsd: 85.00 },
    { id: "fdp",        name: "Freeze-Dried Plasma (FDP)",          unit: "units", category: "blood_products", criticality: "critical", baseDemand: 0.8, waste: 1.02, trigger: "transfusion_event", leadTimeDays: 5, shelfLifeDays: 730, classOfSupply: "VIII", commodityType: "Blood — Component", unspscCommodity: "51171806", size: "200 mL", productNoun: "Plasma (Freeze-Dried)", unitPriceUsd: 1200.00 },

    // ---- Collection / phlebotomy supplies (existing IDs preserved) ----
    { id: "tubes",      name: "Blood Collection Tubes",             unit: "tubes",  category: "supplies", criticality: "high",   baseDemand: 4.0, waste: 1.15, trigger: "phlebotomy_event", leadTimeDays: 7, shelfLifeDays: 730, classOfSupply: "VIII", commodityType: "Phlebotomy",  unspscCommodity: "41104100", size: "10 mL",   productNoun: "Collection Tube",       unitPriceUsd: 0.45 },
    { id: "butterfly",  name: "Butterfly Needle Sets",              unit: "sets",   category: "supplies", criticality: "high",   baseDemand: 1.0, waste: 1.10, trigger: "phlebotomy_event", leadTimeDays: 7, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "Phlebotomy",  unspscCommodity: "41104105", size: "21 G",   productNoun: "Butterfly Needle Set",   unitPriceUsd: 1.85 },
    { id: "alcohol",    name: "Alcohol Prep Pads",                  unit: "pads",   category: "supplies", criticality: "medium", baseDemand: 2.0, waste: 1.20, trigger: "phlebotomy_event", leadTimeDays: 7, shelfLifeDays: 1095, classOfSupply: "VIII", commodityType: "Antiseptic",  unspscCommodity: "42182203", size: "Single", productNoun: "Alcohol Prep Pad",       unitPriceUsd: 0.05 },
    { id: "gauze",      name: "Gauze Pads",                         unit: "pads",   category: "supplies", criticality: "medium", baseDemand: 2.0, waste: 1.15, trigger: "phlebotomy_event", leadTimeDays: 7, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "Wound Care",  unspscCommodity: "42311500", size: "4x4 in", productNoun: "Gauze Pad",              unitPriceUsd: 0.18 },
    { id: "tourniquet", name: "Tourniquets",                        unit: "each",   category: "supplies", criticality: "medium", baseDemand: 0.2, waste: 1.05, trigger: "phlebotomy_event", leadTimeDays: 7, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "Hemorrhage Control", unspscCommodity: "42312305", size: "1 in",  productNoun: "Tourniquet",          unitPriceUsd: 1.20 },
    { id: "bags",       name: "Specimen Transport Bags",            unit: "bags",   category: "supplies", criticality: "medium", baseDemand: 1.0, waste: 1.10, trigger: "phlebotomy_event", leadTimeDays: 7, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "Specimen Transport", unspscCommodity: "41104111", size: "Small", productNoun: "Specimen Bag",        unitPriceUsd: 0.32 },
    { id: "labels",     name: "Donor Barcode Labels",               unit: "labels", category: "supplies", criticality: "low",    baseDemand: 4.0, waste: 1.05, trigger: "phlebotomy_event", leadTimeDays: 5, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "Lab Admin",   unspscCommodity: "44121804", size: "Roll",   productNoun: "Barcode Label",          unitPriceUsd: 0.04 },
    { id: "collection_bag", name: "Blood Collection Bag CPD-A1 450mL", unit: "bags", category: "supplies", criticality: "critical", baseDemand: 1.0, waste: 1.05, trigger: "phlebotomy_event", leadTimeDays: 10, shelfLifeDays: 730, classOfSupply: "VIII", commodityType: "Phlebotomy", unspscCommodity: "41104102", size: "450 mL", productNoun: "Collection Bag",   unitPriceUsd: 8.75 },
    { id: "antiseptic", name: "Skin Antiseptic Chlorhexidine",      unit: "ea",    category: "supplies", criticality: "medium", baseDemand: 1.5, waste: 1.10, trigger: "phlebotomy_event", leadTimeDays: 7, shelfLifeDays: 1095, classOfSupply: "VIII", commodityType: "Antiseptic",  unspscCommodity: "42182203", size: "26 mL", productNoun: "Antiseptic Swab",         unitPriceUsd: 1.10 },

    // ---- Storage / cold-chain transport ----
    { id: "cooler",      name: "Insulated Blood Transport Cooler 24h", unit: "ea", category: "supplies", criticality: "high", baseDemand: 0.05, waste: 1.02, trigger: "shipment_event", leadTimeDays: 21, shelfLifeDays: 3650, classOfSupply: "VIII", commodityType: "Cold Chain", unspscCommodity: "24112106", size: "30 L", productNoun: "Transport Cooler",        unitPriceUsd: 285.00 },
    { id: "coolant",     name: "Refrigerator Coolant Pack",            unit: "ea", category: "supplies", criticality: "medium", baseDemand: 0.5, waste: 1.05, trigger: "shipment_event", leadTimeDays: 14, shelfLifeDays: 3650, classOfSupply: "VIII", commodityType: "Cold Chain", unspscCommodity: "24112107", size: "1 L",  productNoun: "Coolant Pack",            unitPriceUsd: 6.50 },
    { id: "chain_log",   name: "Cold-Chain Temperature Logger",        unit: "ea", category: "supplies", criticality: "high",   baseDemand: 0.1, waste: 1.02, trigger: "shipment_event", leadTimeDays: 21, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "Cold Chain", unspscCommodity: "41112209", size: "Single", productNoun: "Temperature Logger",   unitPriceUsd: 42.00 },

    // ---- Testing / typing ----
    { id: "abo_kit",     name: "ABO/Rh Typing Kit",                    unit: "kit", category: "supplies", criticality: "critical", baseDemand: 0.3, waste: 1.05, trigger: "transfusion_event", leadTimeDays: 14, shelfLifeDays: 540, classOfSupply: "VIII", commodityType: "Blood Bank Reagent", unspscCommodity: "41116132", size: "10 tests", productNoun: "Typing Kit",       unitPriceUsd: 38.50 },
    { id: "crossmatch",  name: "Crossmatch Test Kit",                  unit: "kit", category: "supplies", criticality: "critical", baseDemand: 0.4, waste: 1.05, trigger: "transfusion_event", leadTimeDays: 14, shelfLifeDays: 540, classOfSupply: "VIII", commodityType: "Blood Bank Reagent", unspscCommodity: "41116133", size: "10 tests", productNoun: "Crossmatch Kit",   unitPriceUsd: 44.00 },
    { id: "id_screen",   name: "Infectious Disease Screen (HIV/HBV/HCV)", unit: "kit", category: "supplies", criticality: "high", baseDemand: 0.2, waste: 1.05, trigger: "phlebotomy_event", leadTimeDays: 14, shelfLifeDays: 540, classOfSupply: "VIII", commodityType: "Diagnostic Reagent", unspscCommodity: "41116135", size: "20 tests", productNoun: "ID Screen Kit",       unitPriceUsd: 72.00 },

    // ---- Transfusion administration ----
    { id: "iv_set",         name: "IV Tubing Set w/ 170μm Blood Filter", unit: "ea", category: "supplies", criticality: "critical", baseDemand: 1.0, waste: 1.10, trigger: "transfusion_event", leadTimeDays: 10, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "IV Administration", unspscCommodity: "42221501", size: "170 μm", productNoun: "Blood IV Set",       unitPriceUsd: 12.50 },
    { id: "pressure_inf",   name: "Pressure Infusor Bag 500mL",          unit: "ea", category: "supplies", criticality: "high",     baseDemand: 0.4, waste: 1.05, trigger: "transfusion_event", leadTimeDays: 14, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "IV Administration", unspscCommodity: "42221504", size: "500 mL", productNoun: "Pressure Infusor",   unitPriceUsd: 38.00 },
    { id: "warmer",         name: "Single-Use Blood Warmer (Buddy Lite)", unit: "ea", category: "supplies", criticality: "high",    baseDemand: 0.5, waste: 1.10, trigger: "transfusion_event", leadTimeDays: 21, shelfLifeDays: 730,  classOfSupply: "VIII", commodityType: "IV Administration", unspscCommodity: "42221506", size: "Single", productNoun: "Blood Warmer",       unitPriceUsd: 95.00 },
    { id: "transfusion_band", name: "Transfusion Recipient Wristband",   unit: "ea", category: "supplies", criticality: "medium",   baseDemand: 1.0, waste: 1.05, trigger: "transfusion_event", leadTimeDays: 7, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "Patient ID",      unspscCommodity: "42182013", size: "Adult",  productNoun: "Wristband",              unitPriceUsd: 0.65 },

    // ---- General medical supplies (used by the casualty bill-of-materials) ----
    { id: "iv_fluid_ns",    name: "IV Fluid — Normal Saline 1L",          unit: "bag", category: "supplies", criticality: "critical", baseDemand: 0.0, waste: 1.05, trigger: "encounter", leadTimeDays: 7,  shelfLifeDays: 730,  classOfSupply: "VIII", commodityType: "IV Fluid",          unspscCommodity: "51241600", size: "1 L",   productNoun: "Saline Solution",         unitPriceUsd: 4.20 },
    { id: "iv_fluid_lr",    name: "IV Fluid — Lactated Ringer's 1L",      unit: "bag", category: "supplies", criticality: "critical", baseDemand: 0.0, waste: 1.05, trigger: "encounter", leadTimeDays: 7,  shelfLifeDays: 730,  classOfSupply: "VIII", commodityType: "IV Fluid",          unspscCommodity: "51241601", size: "1 L",   productNoun: "Lactated Ringer's",       unitPriceUsd: 4.85 },
    { id: "airway_kit",     name: "Advanced Airway Kit (Cric/ET)",        unit: "kit", category: "supplies", criticality: "critical", baseDemand: 0.0, waste: 1.02, trigger: "encounter", leadTimeDays: 14, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "Airway",            unspscCommodity: "42271700", size: "Adult", productNoun: "Airway Kit",              unitPriceUsd: 145.00 },
    { id: "tq_cat",         name: "Combat Application Tourniquet (CAT-7)", unit: "ea", category: "supplies", criticality: "critical", baseDemand: 0.0, waste: 1.02, trigger: "encounter", leadTimeDays: 7,  shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "Hemorrhage Control", unspscCommodity: "42312305", size: "Single", productNoun: "Combat Tourniquet",   unitPriceUsd: 32.00 },
    { id: "chest_seal",     name: "Vented Chest Seal",                    unit: "ea", category: "supplies", criticality: "critical", baseDemand: 0.0, waste: 1.02, trigger: "encounter", leadTimeDays: 14, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "Hemorrhage Control", unspscCommodity: "42311900", size: "6 in",  productNoun: "Chest Seal",          unitPriceUsd: 28.00 },
    { id: "hemo_dressing",  name: "Hemostatic Dressing (Combat Gauze)",   unit: "ea", category: "supplies", criticality: "critical", baseDemand: 0.0, waste: 1.05, trigger: "encounter", leadTimeDays: 14, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "Wound Care",        unspscCommodity: "42311501", size: "3 in",  productNoun: "Hemostatic Gauze",        unitPriceUsd: 42.00 },
    { id: "pressure_dressing", name: "Pressure Dressing (Israeli Bandage)", unit: "ea", category: "supplies", criticality: "high", baseDemand: 0.0, waste: 1.05, trigger: "encounter", leadTimeDays: 14, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "Wound Care",        unspscCommodity: "42311502", size: "6 in",  productNoun: "Pressure Dressing",         unitPriceUsd: 6.75 },
    { id: "burn_dressing",  name: "Burn Dressing (Sterile, 4x4 in)",      unit: "ea", category: "supplies", criticality: "high",     baseDemand: 0.0, waste: 1.05, trigger: "encounter", leadTimeDays: 14, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "Wound Care",        unspscCommodity: "42311550", size: "4x4 in", productNoun: "Burn Dressing",          unitPriceUsd: 5.50 },
    { id: "suture_kit",     name: "Suture Kit (3-0 Nylon, Curved)",       unit: "kit", category: "supplies", criticality: "high",   baseDemand: 0.0, waste: 1.05, trigger: "encounter", leadTimeDays: 14, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "Surgical Suture",   unspscCommodity: "42291611", size: "3-0",   productNoun: "Suture Kit",              unitPriceUsd: 8.40 },
    { id: "antibiotic_iv",  name: "Antibiotic — Ceftriaxone 1g IV",       unit: "vial", category: "supplies", criticality: "critical", baseDemand: 0.0, waste: 1.05, trigger: "encounter", leadTimeDays: 21, shelfLifeDays: 730, classOfSupply: "VIII", commodityType: "Pharmaceutical — Antibiotic", unspscCommodity: "51101707", size: "1 g", productNoun: "Ceftriaxone",  unitPriceUsd: 12.00 },
    { id: "antibiotic_po",  name: "Antibiotic — Doxycycline 100mg PO",    unit: "tab", category: "supplies", criticality: "high",   baseDemand: 0.0, waste: 1.05, trigger: "encounter", leadTimeDays: 21, shelfLifeDays: 1095, classOfSupply: "VIII", commodityType: "Pharmaceutical — Antibiotic", unspscCommodity: "51101708", size: "100 mg", productNoun: "Doxycycline", unitPriceUsd: 0.55 },
    { id: "analgesic_morphine", name: "Analgesic — Morphine 10mg/mL IV",  unit: "vial", category: "supplies", criticality: "critical", baseDemand: 0.0, waste: 1.05, trigger: "encounter", leadTimeDays: 21, shelfLifeDays: 730, classOfSupply: "VIII", commodityType: "Pharmaceutical — Analgesic", unspscCommodity: "51141604", size: "10 mg", productNoun: "Morphine",   unitPriceUsd: 9.50 },
    { id: "analgesic_ketamine", name: "Analgesic — Ketamine 50mg/mL IV",  unit: "vial", category: "supplies", criticality: "high",     baseDemand: 0.0, waste: 1.05, trigger: "encounter", leadTimeDays: 21, shelfLifeDays: 730, classOfSupply: "VIII", commodityType: "Pharmaceutical — Analgesic", unspscCommodity: "51141605", size: "50 mg", productNoun: "Ketamine",     unitPriceUsd: 14.00 },
    { id: "trauma_dressing", name: "Trauma Dressing (Abdominal Pad)",     unit: "ea", category: "supplies", criticality: "high",     baseDemand: 0.0, waste: 1.05, trigger: "encounter", leadTimeDays: 14, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "Wound Care",        unspscCommodity: "42311503", size: "5x9 in", productNoun: "Trauma Dressing",       unitPriceUsd: 3.85 },
    { id: "splint_sam",     name: "SAM Splint (Universal)",               unit: "ea", category: "supplies", criticality: "medium",   baseDemand: 0.0, waste: 1.02, trigger: "encounter", leadTimeDays: 21, shelfLifeDays: 3650, classOfSupply: "VIII", commodityType: "Orthopedic",        unspscCommodity: "42241801", size: "36 in", productNoun: "Splint",                  unitPriceUsd: 18.00 },
    { id: "ob_kit",         name: "Emergency OB Delivery Kit",            unit: "kit", category: "supplies", criticality: "high",    baseDemand: 0.0, waste: 1.02, trigger: "encounter", leadTimeDays: 21, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "OB/GYN",            unspscCommodity: "42141701", size: "Single", productNoun: "OB Kit",                  unitPriceUsd: 62.00 },
    { id: "peds_airway_kit", name: "Pediatric Airway Kit",                unit: "kit", category: "supplies", criticality: "critical", baseDemand: 0.0, waste: 1.02, trigger: "encounter", leadTimeDays: 14, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "Airway",            unspscCommodity: "42271710", size: "Pediatric", productNoun: "Pediatric Airway",      unitPriceUsd: 165.00 },
    { id: "antiemetic",     name: "Antiemetic — Ondansetron 4mg IV",      unit: "vial", category: "supplies", criticality: "medium",  baseDemand: 0.0, waste: 1.05, trigger: "encounter", leadTimeDays: 21, shelfLifeDays: 1095, classOfSupply: "VIII", commodityType: "Pharmaceutical — Antiemetic", unspscCommodity: "51141900", size: "4 mg", productNoun: "Ondansetron", unitPriceUsd: 1.85 },
    { id: "oral_rehydration", name: "Oral Rehydration Salts",             unit: "packet", category: "supplies", criticality: "medium", baseDemand: 0.0, waste: 1.02, trigger: "encounter", leadTimeDays: 21, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "Pharmaceutical — Hydration", unspscCommodity: "51241700", size: "1 L mix", productNoun: "ORS Packet", unitPriceUsd: 0.40 },

    // ---- PPE (staffing tags wire these into the clinician PPE model) ----
    { id: "gloves",  name: "Nitrile Exam Gloves",    unit: "pairs", category: "ppe", criticality: "high",   baseDemand: 4.0, waste: 1.15, trigger: "phlebotomy_event", leadTimeDays: 7, shelfLifeDays: 1095, classOfSupply: "VIII", commodityType: "PPE — Hand",  unspscCommodity: "42132205", size: "M",     productNoun: "Exam Gloves",   staffingTag: "ppe:gloves", unitPriceUsd: 0.12 },
    { id: "mask",    name: "Surgical Mask",          unit: "ea",    category: "ppe", criticality: "medium", baseDemand: 1.5, waste: 1.10, trigger: "phlebotomy_event", leadTimeDays: 7, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "PPE — Face",  unspscCommodity: "42131601", size: "Single", productNoun: "Surgical Mask",  staffingTag: "ppe:mask",   unitPriceUsd: 0.15 },
    { id: "shield",  name: "Disposable Face Shield", unit: "ea",    category: "ppe", criticality: "medium", baseDemand: 0.5, waste: 1.05, trigger: "phlebotomy_event", leadTimeDays: 14, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "PPE — Eye",   unspscCommodity: "42131602", size: "Single", productNoun: "Face Shield",   staffingTag: "ppe:eye",   unitPriceUsd: 1.40 },
    { id: "gown",    name: "Isolation Gown",         unit: "ea",    category: "ppe", criticality: "medium", baseDemand: 0.8, waste: 1.05, trigger: "phlebotomy_event", leadTimeDays: 10, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "PPE — Body",  unspscCommodity: "42131603", size: "L",     productNoun: "Isolation Gown",  staffingTag: "ppe:gown",  unitPriceUsd: 1.10 },
    { id: "n95",     name: "N95 Respirator",         unit: "ea",    category: "ppe", criticality: "high",   baseDemand: 1.0, waste: 1.10, trigger: "phlebotomy_event", leadTimeDays: 14, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "PPE — Face",  unspscCommodity: "42131604", size: "Single", productNoun: "N95 Respirator", staffingTag: "ppe:mask",  unitPriceUsd: 0.95 },

    // ---- Other lab consumables / admin ----
    { id: "sharps",          name: "Sharps Container 2L",         unit: "ea", category: "other", criticality: "medium", baseDemand: 0.1, waste: 1.05, trigger: "phlebotomy_event", leadTimeDays: 14, shelfLifeDays: 3650, classOfSupply: "VIII", commodityType: "Waste Disposal", unspscCommodity: "47131830", size: "2 L", productNoun: "Sharps Container",     unitPriceUsd: 4.25 },
    { id: "centrifuge_tube", name: "Lab Centrifuge Tubes 15mL",   unit: "ea", category: "other", criticality: "low",    baseDemand: 1.0, waste: 1.05, trigger: "phlebotomy_event", leadTimeDays: 14, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "Lab Consumable", unspscCommodity: "41121706", size: "15 mL", productNoun: "Centrifuge Tube",     unitPriceUsd: 0.22 },
    { id: "biohazard_bag",   name: "Biohazard Disposal Bags",     unit: "ea", category: "other", criticality: "low",    baseDemand: 0.6, waste: 1.05, trigger: "phlebotomy_event", leadTimeDays: 14, shelfLifeDays: 1825, classOfSupply: "VIII", commodityType: "Waste Disposal", unspscCommodity: "47131831", size: "Medium", productNoun: "Biohazard Bag",      unitPriceUsd: 0.28 },
  ];
  await db.insert(items).values(
    ITEM_CATALOG.map((r) => ({
      id: r.id,
      name: r.name,
      niinOrSku: r.id.toUpperCase(),
      unitOfIssue: r.unit,
      classOfSupply: r.classOfSupply,
      category: r.category,
      mandatory: true,
      criticality: r.criticality,
      leadTimeDays: r.leadTimeDays,
      shelfLifeDays: r.shelfLifeDays,
      unitPriceUsd: r.unitPriceUsd,
      baseDemandPerEvent: r.baseDemand,
      wasteAdjustedDemand: r.baseDemand * r.waste,
      trigger: r.trigger,
      commodityType: r.commodityType,
      unspscCommodity: r.unspscCommodity,
      size: r.size,
      productNoun: r.productNoun,
      staffingTag: r.staffingTag ?? "",
    })),
  );

  // ---- Patient types + per-patient bill-of-materials ----
  // Severities follow standard MASCAL triage (immediate/delayed/minor)
  // plus a "routine" steady-state archetype. Item quantities are
  // intentionally rounded — the casualty engine will Math.ceil totals
  // so fractional values still produce sensible whole-unit demand.
  const PATIENT_TYPES: Array<{
    id: string;
    name: string;
    severity: "critical" | "severe" | "moderate" | "minor" | "routine";
    careCategory: "surgical" | "medical" | "mixed";
    avgClinicianMinutes: number;
    description: string;
  }> = [
    { id: "trauma_critical",   name: "Critical Trauma (T1 Immediate)",  severity: "critical", careCategory: "surgical", avgClinicianMinutes: 240, description: "Polytrauma with massive transfusion protocol activation; surgical airway risk." },
    { id: "trauma_severe",     name: "Severe Trauma (T2 Delayed)",      severity: "severe",   careCategory: "surgical", avgClinicianMinutes: 150, description: "Significant hemorrhage, fractures, or penetrating injury requiring surgical intervention." },
    { id: "trauma_moderate",   name: "Moderate Trauma (T3 Minor)",      severity: "moderate", careCategory: "surgical", avgClinicianMinutes: 60,  description: "Walking wounded — lacerations, simple fractures, soft-tissue injuries." },
    { id: "burn_severe",       name: "Severe Burn (>20% TBSA)",         severity: "critical", careCategory: "mixed",    avgClinicianMinutes: 200, description: "Large body-surface burns; aggressive fluid resuscitation + airway risk." },
    { id: "medical_acute",     name: "Acute Medical (Sepsis/MI)",       severity: "severe",   careCategory: "medical",  avgClinicianMinutes: 120, description: "Sepsis, MI, stroke, severe pneumonia. Antibiotics + IV fluids." },
    { id: "medical_chronic",   name: "Chronic Medical Exacerbation",    severity: "moderate", careCategory: "medical",  avgClinicianMinutes: 45,  description: "COPD, CHF, diabetic ketoacidosis. Stabilize and admit." },
    { id: "obstetric",         name: "Obstetric Emergency",             severity: "severe",   careCategory: "mixed",    avgClinicianMinutes: 150, description: "Active labor, hemorrhage, eclampsia." },
    { id: "pediatric_trauma",  name: "Pediatric Trauma",                severity: "severe",   careCategory: "surgical", avgClinicianMinutes: 180, description: "Pediatric patient — smaller fluid volumes, pediatric airway." },
    { id: "minor_outpatient",  name: "Minor Outpatient",                severity: "minor",    careCategory: "medical",  avgClinicianMinutes: 20,  description: "Sick call, minor wound care, prescription refills." },
  ];
  await db.insert(patientTypes).values(PATIENT_TYPES);

  // Per-patient bill-of-materials. Quantities are *per patient* over
  // their initial 24-48h of care.
  const REQS: Array<[string, string, number]> = [
    // critical trauma
    ["trauma_critical","prbc_o",4],
    ["trauma_critical","ffp_ab",2],
    ["trauma_critical","ltow_pos",2],
    ["trauma_critical","platelets",1],
    ["trauma_critical","cryo",1],
    ["trauma_critical","iv_fluid_lr",4],
    ["trauma_critical","iv_fluid_ns",2],
    ["trauma_critical","iv_set",3],
    ["trauma_critical","airway_kit",1],
    ["trauma_critical","tq_cat",2],
    ["trauma_critical","chest_seal",1],
    ["trauma_critical","hemo_dressing",2],
    ["trauma_critical","trauma_dressing",4],
    ["trauma_critical","pressure_dressing",2],
    ["trauma_critical","suture_kit",2],
    ["trauma_critical","antibiotic_iv",2],
    ["trauma_critical","analgesic_morphine",4],
    ["trauma_critical","analgesic_ketamine",1],
    ["trauma_critical","antiemetic",2],
    ["trauma_critical","abo_kit",1],
    ["trauma_critical","crossmatch",1],
    ["trauma_critical","warmer",1],
    ["trauma_critical","pressure_inf",1],
    // severe trauma
    ["trauma_severe","prbc_o",2],
    ["trauma_severe","ffp_ab",1],
    ["trauma_severe","ltow_pos",1],
    ["trauma_severe","iv_fluid_lr",3],
    ["trauma_severe","iv_set",2],
    ["trauma_severe","tq_cat",1],
    ["trauma_severe","hemo_dressing",1],
    ["trauma_severe","pressure_dressing",2],
    ["trauma_severe","trauma_dressing",2],
    ["trauma_severe","suture_kit",1],
    ["trauma_severe","antibiotic_iv",2],
    ["trauma_severe","analgesic_morphine",2],
    ["trauma_severe","antiemetic",1],
    ["trauma_severe","splint_sam",1],
    ["trauma_severe","abo_kit",1],
    ["trauma_severe","crossmatch",1],
    // moderate trauma
    ["trauma_moderate","iv_fluid_ns",1],
    ["trauma_moderate","iv_set",1],
    ["trauma_moderate","gauze",6],
    ["trauma_moderate","pressure_dressing",1],
    ["trauma_moderate","suture_kit",1],
    ["trauma_moderate","antibiotic_po",6],
    ["trauma_moderate","analgesic_morphine",1],
    ["trauma_moderate","splint_sam",1],
    // severe burn
    ["burn_severe","iv_fluid_lr",8],
    ["burn_severe","iv_set",3],
    ["burn_severe","airway_kit",1],
    ["burn_severe","burn_dressing",10],
    ["burn_severe","trauma_dressing",4],
    ["burn_severe","suture_kit",1],
    ["burn_severe","antibiotic_iv",4],
    ["burn_severe","analgesic_morphine",6],
    ["burn_severe","analgesic_ketamine",2],
    ["burn_severe","antiemetic",2],
    ["burn_severe","prbc_o",1],
    ["burn_severe","ffp_ab",1],
    // acute medical
    ["medical_acute","iv_fluid_ns",3],
    ["medical_acute","iv_set",2],
    ["medical_acute","antibiotic_iv",4],
    ["medical_acute","antiemetic",2],
    ["medical_acute","analgesic_morphine",1],
    ["medical_acute","oral_rehydration",2],
    // chronic medical
    ["medical_chronic","iv_fluid_ns",1],
    ["medical_chronic","iv_set",1],
    ["medical_chronic","antibiotic_po",10],
    ["medical_chronic","oral_rehydration",2],
    ["medical_chronic","antiemetic",1],
    // obstetric
    ["obstetric","ob_kit",1],
    ["obstetric","iv_fluid_lr",3],
    ["obstetric","iv_set",2],
    ["obstetric","prbc_o",2],
    ["obstetric","ffp_ab",1],
    ["obstetric","suture_kit",2],
    ["obstetric","antibiotic_iv",2],
    ["obstetric","analgesic_morphine",2],
    ["obstetric","abo_kit",1],
    ["obstetric","crossmatch",1],
    // pediatric trauma
    ["pediatric_trauma","prbc_o",1],
    ["pediatric_trauma","ffp_ab",1],
    ["pediatric_trauma","iv_fluid_lr",2],
    ["pediatric_trauma","iv_set",2],
    ["pediatric_trauma","peds_airway_kit",1],
    ["pediatric_trauma","hemo_dressing",1],
    ["pediatric_trauma","pressure_dressing",2],
    ["pediatric_trauma","trauma_dressing",2],
    ["pediatric_trauma","suture_kit",1],
    ["pediatric_trauma","antibiotic_iv",2],
    ["pediatric_trauma","analgesic_ketamine",1],
    ["pediatric_trauma","antiemetic",1],
    ["pediatric_trauma","abo_kit",1],
    ["pediatric_trauma","crossmatch",1],
    // minor outpatient
    ["minor_outpatient","gauze",2],
    ["minor_outpatient","alcohol",2],
    ["minor_outpatient","antibiotic_po",6],
    ["minor_outpatient","oral_rehydration",1],
  ];
  await db.insert(patientItemRequirements).values(
    REQS.map(([patientTypeId, itemId, qty]) => ({
      patientTypeId,
      itemId,
      quantityPerPatient: qty,
      notes: "",
    })),
  );

  // ---- Event types + default patient mixes ----
  const EVENT_TYPES: Array<{
    id: string;
    name: string;
    category: "natural-disaster" | "conflict" | "other";
    description: string;
    defaultArrivalWindowHours: number;
  }> = [
    { id: "earthquake_m7",        name: "Major Earthquake (M7+)",            category: "natural-disaster", defaultArrivalWindowHours: 48, description: "Crush injuries, fractures, lacerations, displaced civilian population." },
    { id: "typhoon_landfall",     name: "Typhoon Landfall",                  category: "natural-disaster", defaultArrivalWindowHours: 72, description: "Storm-surge drownings, debris injuries, secondary infections from contaminated water." },
    { id: "tsunami",              name: "Tsunami / Coastal Flooding",        category: "natural-disaster", defaultArrivalWindowHours: 36, description: "Drowning, hypothermia, blunt trauma, crush." },
    { id: "volcanic_eruption",    name: "Volcanic Eruption / Ashfall",       category: "natural-disaster", defaultArrivalWindowHours: 96, description: "Burns, respiratory injury, displaced population." },
    { id: "major_combat",         name: "Major Combat Operations",           category: "conflict",         defaultArrivalWindowHours: 24, description: "High-volume penetrating trauma, blast injury, burns." },
    { id: "missile_strike_base",  name: "Missile Strike on Base",            category: "conflict",         defaultArrivalWindowHours: 12, description: "Concentrated mass-casualty event with blast and burn injuries." },
    { id: "humanitarian_response", name: "Humanitarian Assistance / DR",     category: "other",            defaultArrivalWindowHours: 96, description: "Mixed civilian medical load, infectious disease, OB, peds." },
    { id: "small_unit_engagement", name: "Small Unit Engagement",            category: "conflict",         defaultArrivalWindowHours: 24, description: "Squad/platoon engagement — limited casualties, mostly trauma." },
  ];
  await db.insert(eventTypes).values(EVENT_TYPES);

  const MIX: Array<[string, string, number]> = [
    // earthquake — civilian-heavy crush/fracture
    ["earthquake_m7","trauma_critical",0.10],
    ["earthquake_m7","trauma_severe",0.20],
    ["earthquake_m7","trauma_moderate",0.40],
    ["earthquake_m7","pediatric_trauma",0.10],
    ["earthquake_m7","obstetric",0.05],
    ["earthquake_m7","medical_chronic",0.15],
    // typhoon
    ["typhoon_landfall","trauma_severe",0.15],
    ["typhoon_landfall","trauma_moderate",0.35],
    ["typhoon_landfall","medical_acute",0.15],
    ["typhoon_landfall","medical_chronic",0.20],
    ["typhoon_landfall","pediatric_trauma",0.05],
    ["typhoon_landfall","minor_outpatient",0.10],
    // tsunami
    ["tsunami","trauma_critical",0.10],
    ["tsunami","trauma_severe",0.25],
    ["tsunami","trauma_moderate",0.30],
    ["tsunami","medical_acute",0.20],
    ["tsunami","pediatric_trauma",0.10],
    ["tsunami","obstetric",0.05],
    // volcanic
    ["volcanic_eruption","burn_severe",0.20],
    ["volcanic_eruption","trauma_moderate",0.20],
    ["volcanic_eruption","medical_acute",0.30],
    ["volcanic_eruption","medical_chronic",0.20],
    ["volcanic_eruption","minor_outpatient",0.10],
    // major combat
    ["major_combat","trauma_critical",0.30],
    ["major_combat","trauma_severe",0.40],
    ["major_combat","trauma_moderate",0.20],
    ["major_combat","burn_severe",0.10],
    // missile strike
    ["missile_strike_base","trauma_critical",0.40],
    ["missile_strike_base","trauma_severe",0.30],
    ["missile_strike_base","burn_severe",0.20],
    ["missile_strike_base","trauma_moderate",0.10],
    // humanitarian
    ["humanitarian_response","trauma_moderate",0.20],
    ["humanitarian_response","medical_acute",0.20],
    ["humanitarian_response","medical_chronic",0.25],
    ["humanitarian_response","pediatric_trauma",0.10],
    ["humanitarian_response","obstetric",0.10],
    ["humanitarian_response","minor_outpatient",0.15],
    // small unit
    ["small_unit_engagement","trauma_critical",0.20],
    ["small_unit_engagement","trauma_severe",0.40],
    ["small_unit_engagement","trauma_moderate",0.40],
  ];
  await db.insert(eventPatientMix).values(
    MIX.map(([eventTypeId, patientTypeId, defaultShare]) => ({
      eventTypeId,
      patientTypeId,
      defaultShare,
    })),
  );

  // ---- Nodes ----
  const nodeRows = readSheetAsObjects(wb, "Nodes", [
    "id",
    "name",
    "type",
    "latitude",
    "longitude",
    "population",
    "optempo",
    "stock_days",
  ]);
  const crosswalk = readSheet(wb, "Site Crosswalk");
  const upstreamByAppNode = new Map<string, string>();
  const hubByAppNode = new Map<string, string>();
  for (const c of crosswalk) {
    const id = asString(c["app_node_id"]);
    if (!id) continue;
    const hub = asString(c["app_regional_hub"]);
    const up = asString(c["app_upstream_node"]);
    if (hub) hubByAppNode.set(id, hub);
    if (up) upstreamByAppNode.set(id, up);
  }
  const countryByPrefix: Array<[RegExp, string]> = [
    [/edca|subic|mtfDelta/i, "PH"],
    [/okinawa|iwakuni|yokota|misawa|sasebo|atsugi/i, "JP"],
    [/darwin|tindal|townsville|robertson/i, "AU"],
    [/guam|andersen/i, "GU"],
    [/honolulu|tripler|hickam|pearl|kbay|hawaii/i, "US"],
    [/coronado|sandiego|pendleton|miramar|conus|supplier|dla/i, "US"],
    [/marshall|kwajalein/i, "MH"],
  ];
  function inferCountry(id: string, name: string): string {
    const test = `${id} ${name}`;
    for (const [re, code] of countryByPrefix) if (re.test(test)) return code;
    return "US";
  }
  await db.insert(nodes).values(
    nodeRows.map((r) => {
      const id = asString(r.id);
      const type = asString(r.type, "Site");
      return {
        id,
        name: asString(r.name),
        type,
        latitude: asNumber(r.latitude),
        longitude: asNumber(r.longitude),
        population: asNumber(r.population, 0),
        optempo: asString(r.optempo, "garrison"),
        stockDays: Math.round(asNumber(r.stock_days, 30)),
        regionalHub: hubByAppNode.get(id) ?? null,
        upstreamNode: upstreamByAppNode.get(id) ?? null,
        countryCode: inferCountry(id, asString(r.name)),
        role: roleForNodeType(type),
      };
    }),
  );

  // ---- AOR anchor nodes (cover sub-regions of INDOPACOM that the dataset
  // misses: Indian Ocean, Korean Peninsula, mid-Pacific, South Pacific). These
  // appear on the map as nominal anchor sites; they intentionally have no
  // demand profile so they render as low-risk reference points.
  const ANCHOR_NODES: Array<{
    id: string;
    name: string;
    type: string;
    latitude: number;
    longitude: number;
    population: number;
    countryCode: string;
    regionalHub?: string | null;
  }> = [
    { id: "diegoGarcia", name: "NSF Diego Garcia",        type: "Theater hub", latitude: -7.31,  longitude: 72.41,   population: 600,  countryCode: "IO", regionalHub: "theater" },
    { id: "campHumphreys", name: "Camp Humphreys (USAG)", type: "Large MTF",   latitude: 36.96,  longitude: 127.03,  population: 2800, countryCode: "KR", regionalHub: "northHub" },
    { id: "wakeIsland",  name: "Wake Island AAF",         type: "Forward node", latitude: 19.30, longitude: 166.64,  population: 200,  countryCode: "US", regionalHub: "theater" },
    { id: "christchurch", name: "Christchurch (Op DEEP FREEZE)", type: "Forward node", latitude: -43.49, longitude: 172.55, population: 150, countryCode: "NZ", regionalHub: "southHub" },
  ];
  await db.insert(nodes).values(
    ANCHOR_NODES.map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      latitude: n.latitude,
      longitude: n.longitude,
      population: n.population,
      optempo: "garrison",
      stockDays: 90,
      regionalHub: n.regionalHub ?? null,
      upstreamNode: n.regionalHub ?? null,
      countryCode: n.countryCode,
      role: roleForNodeType(n.type),
    })),
  );

  // ---- Routes ----
  const routeRows = readSheetAsObjects(wb, "Routes", [
    "id",
    "from",
    "to",
    "priority",
    "days",
    "reliability",
  ]);
  await db.insert(routes).values(
    routeRows.map((r) => ({
      id: asString(r.id),
      fromNode: asString(r["from"]),
      toNode: asString(r.to),
      priority: asString(r.priority, "secondary"),
      days: asNumber(r.days, 3),
      reliability: asNumber(r.reliability, 0.9),
      modality: inferModality(asString(r.priority, "secondary"), asNumber(r.days, 3)),
    })),
  );

  // Anchor routes connect the AOR anchor sites to their parent hubs so they
  // appear on the network map instead of floating alone.
  const ANCHOR_ROUTES = [
    { id: "r-anchor-dg",  from: "theater",  to: "diegoGarcia",   priority: "secondary", days: 9, reliability: 0.82 },
    { id: "r-anchor-ch",  from: "northHub", to: "campHumphreys", priority: "primary",   days: 2, reliability: 0.92 },
    { id: "r-anchor-wk",  from: "theater",  to: "wakeIsland",    priority: "tertiary",  days: 4, reliability: 0.84 },
    { id: "r-anchor-cz",  from: "southHub", to: "christchurch",  priority: "tertiary",  days: 6, reliability: 0.83 },
  ] as const;
  await db.insert(routes).values(
    ANCHOR_ROUTES.map((r) => ({
      id: r.id,
      fromNode: r.from,
      toNode: r.to,
      priority: r.priority,
      days: r.days,
      reliability: r.reliability,
      modality: inferModality(r.priority, r.days),
    })),
  );

  // ---- Demand profiles ----
  const profileRows = readSheetAsObjects(wb, "Demand Profiles", [
    "node_id",
    "active_supported_population",
    "daily_encounter_rate",
    "phlebotomy_probability",
    "specimens_per_phlebotomy",
    "operational_state",
    "waste_factor",
  ]);
  await db.insert(demandProfiles).values(
    profileRows.map((r) => {
      const par = Math.round(asNumber(r.active_supported_population));
      return {
        nodeId: asString(r.node_id),
        activeSupportedPopulation: par,
        // Snapshot the seeded PAR so the UI can offer a "reset to seeded value"
        // affordance after an operator edits PAR for a site.
        seededActiveSupportedPopulation: par,
        dailyEncounterRate: asNumber(r.daily_encounter_rate),
        phlebotomyProbability: asNumber(r.phlebotomy_probability),
        specimensPerPhlebotomy: asNumber(r.specimens_per_phlebotomy, 1),
        operationalState: asString(r.operational_state, "garrison"),
        wasteFactor: asNumber(r.waste_factor, 1.1),
      };
    }),
  );

  // ---- Operational states ----
  const stateRows = readSheetAsObjects(wb, "Operational States", [
    "id",
    "label",
    "encounter_multiplier",
    "population_multiplier",
    "description",
  ]);
  const seenStates = new Set<string>();
  const statesData: Array<{
    id: string;
    label: string;
    encounterMultiplier: number;
    populationMultiplier: number;
    description: string;
  }> = [];
  for (const r of stateRows) {
    const id = asString(r.id);
    if (!id || seenStates.has(id)) continue;
    seenStates.add(id);
    statesData.push({
      id,
      label: asString(r.label, id),
      encounterMultiplier: asNumber(r.encounter_multiplier, 1),
      populationMultiplier: asNumber(r.population_multiplier, 1),
      description: asString(r.description, OPERATIONAL_STATE_DESCRIPTIONS[id] ?? id),
    });
  }
  for (const id of Object.keys(OPERATIONAL_STATE_DESCRIPTIONS)) {
    if (seenStates.has(id)) continue;
    seenStates.add(id);
    statesData.push({
      id,
      label: id,
      encounterMultiplier: 1,
      populationMultiplier: 1,
      description: OPERATIONAL_STATE_DESCRIPTIONS[id] ?? id,
    });
  }
  if (statesData.length > 0) await db.insert(operationalStates).values(statesData);

  // ---- Item skew ----
  const skewRows = readSheetAsObjects(wb, "Item Skew Factors", ["item_id", "factor"]);
  if (skewRows.length > 0) {
    await db.insert(itemSkewFactors).values(
      skewRows.map((r) => ({ itemId: asString(r.item_id), factor: asNumber(r.factor, 1) })),
    );
  }

  // ---- Inventory balances ----
  const balanceRows = readSheetAsObjects(wb, "Inventory Balances", [
    "node_id",
    "item_id",
    "item_name",
    "unit",
    "criticality",
    "quantity_on_hand",
  ]);
  const nodeMetaForBalance = new Map<string, { type: string; optempo: string }>();
  for (const r of nodeRows) {
    nodeMetaForBalance.set(asString(r.id), {
      type: asString(r.type, "Site"),
      optempo: asString(r.optempo, "garrison"),
    });
  }
  // existing IDs covered by sheet rows
  const sheetItemIds = new Set(balanceRows.map((r) => asString(r.item_id)));
  const sheetBalances = balanceRows.map((r) => {
    const nodeId = asString(r.node_id);
    const itemId = asString(r.item_id);
    const meta = nodeMetaForBalance.get(nodeId) ?? { type: "Site", optempo: "garrison" };
    const baseQty = asNumber(r.quantity_on_hand);
    const scale = inventoryScale(nodeId, itemId, meta.type);
    const jitter = deterministicJitter(`${nodeId}:${itemId}`);
    const onHand = Math.max(0, Math.round(baseQty * scale * jitter));
    return {
      nodeId,
      itemId,
      onHand,
      dueIn: 0,
      dueOut: 0,
      allocated: 0,
    };
  });

  // synthesize balances for newly added (blood-products + transfusion) items
  // baseStockByCategory: target days-of-supply * baseDemand (rough)
  const stockTargetByItem: Record<string, number> = {
    // blood products: keep limited stock at MTFs, deeper at hubs/theater
    ltow_pos: 18, ltow_neg: 8, prbc_o: 24, ffp_ab: 16, plasma_a: 10,
    platelets: 6, cryo: 8, fdp: 14,
    // collection / cold-chain / testing / transfusion supplies
    collection_bag: 80, antiseptic: 120, cooler: 6, coolant: 24, chain_log: 8,
    abo_kit: 24, crossmatch: 30, id_screen: 20,
    iv_set: 80, pressure_inf: 24, warmer: 16, transfusion_band: 80,
    mask: 200, shield: 60, gown: 80, n95: 100,
    sharps: 8, centrifuge_tube: 80, biohazard_bag: 60,
  };
  // Hub/theater/supplier carry deeper stock (multiplier)
  const depthByType: Record<string, number> = {
    Strategic: 12, Theater: 6, Hub: 3, MTF: 1, BAS: 0.5, Clinic: 0.4,
  };
  const newBalances: typeof sheetBalances = [];
  for (const node of nodeRows) {
    const nodeId = asString(node.id);
    const type = asString(node.type, "Site");
    const depth = depthByType[type] ?? 1;
    for (const [itemId, base] of Object.entries(stockTargetByItem)) {
      if (sheetItemIds.has(itemId)) continue; // already covered by sheet
      // Inventory scale comes from the curated stress profile: most
      // sites get the type-based healthy baseline; the handful of
      // curated problem sites get per-item shortage overrides so the
      // demo arc (forward blood gap, cold-chain failure, reagent
      // backorder) shows up as real critical-DOS items.
      const scale = inventoryScale(nodeId, itemId, type);
      const jitter = deterministicJitter(`${nodeId}:${itemId}`);
      const onHand = Math.max(0, Math.round(base * depth * scale * jitter));
      newBalances.push({ nodeId, itemId, onHand, dueIn: 0, dueOut: 0, allocated: 0 });
    }
  }
  await db.insert(inventoryBalances).values([...sheetBalances, ...newBalances]);

  // ---- Supplier-item coverage rows ----
  // Stored as data so the API can populate `Supplier.items` from the
  // catalog instead of channel-based rules. Filtered against the seeded
  // item ids so an unknown id in the coverage map can't break the seed.
  // Built up first so the inserted row count drives `suppliers.itemsCovered`.
  const seededItemIds = new Set(ITEM_CATALOG.map((it) => it.id));
  const supplierItemRows: Array<{ supplierId: string; itemId: string }> = [];
  const coveredItemIdsBySupplier = new Map<string, string[]>();
  for (const s of SUPPLIER_DEFS) {
    const seen = new Set<string>();
    for (const itemId of s.itemsCovered) {
      if (!seededItemIds.has(itemId)) continue;
      if (seen.has(itemId)) continue;
      seen.add(itemId);
      supplierItemRows.push({ supplierId: s.id, itemId });
    }
    coveredItemIdsBySupplier.set(s.id, [...seen]);
  }

  // ---- Suppliers ----
  await db.insert(suppliers).values(
    SUPPLIER_DEFS.map((s) => {
      const covered = coveredItemIdsBySupplier.get(s.id) ?? [];
      return {
        id: s.id,
        name: s.name,
        channel: s.channel,
        country: s.country,
        leadTimeDaysMean: s.leadTimeDaysMean,
        reliabilityScore: s.reliabilityScore,
        notes: s.notes,
        itemsCovered: covered.length,
        itemsCoveredIds: covered,
      };
    }),
  );

  if (supplierItemRows.length > 0) {
    await db.insert(supplierItems).values(supplierItemRows);
  }

  // ---- Catalog entries ----
  const catalogRows = readSheetAsObjects(wb, "Catalog", [
    "mfr_cat_no",
    "app_item_id",
    "mapped",
    "order_lines",
    "total_qty",
    "description",
    "manufacturer",
    "product_noun",
    "product_type",
    "unspsc_commodity",
    "product_size",
    "ghx_commodity_type",
    "full_description",
  ]);
  if (catalogRows.length > 0) {
    const chunkSize = 500;
    for (let i = 0; i < catalogRows.length; i += chunkSize) {
      const slice = catalogRows.slice(i, i + chunkSize);
      await db.insert(catalogEntries).values(
        slice.map((r) => ({
          mfrCatNo: asString(r.mfr_cat_no),
          appItemId: asString(r.app_item_id) || null,
          mapped: asString(r.mapped).toLowerCase() === "yes",
          orderLines: Math.round(asNumber(r.order_lines)),
          totalQty: asNumber(r.total_qty),
          description: asString(r.description),
          manufacturer: asString(r.manufacturer, "Unknown"),
          productNoun: asString(r.product_noun, "Item"),
          productType: asString(r.product_type, "Other"),
          unspscCommodity: asString(r.unspsc_commodity) || null,
          productSize: asString(r.product_size) || null,
          ghxCommodityType: asString(r.ghx_commodity_type) || null,
          fullDescription: asString(r.full_description) || null,
        })),
      );
    }
  } else if (existsSync(csvPath)) {
    await ingestCsvCatalog(csvPath);
  }

  // ---- Settings ----
  // Per-user profiles are now created lazily on first sign-in and bound
  // to the authenticated user's id. Don't seed a placeholder row.
  await db.insert(appSettings).values({});

  // ---- Medical procedures (clinician-curated reference library) ----
  await seedMedicalProcedures();

  // ---- Preset events ----
  await db.insert(presetEvents).values(PRESET_EVENTS);

  // ---- Blood-products foundation (lots, cold-chain, donors, temperature events) ----
  await seedBloodReadiness();

  // ---- Generate alerts from current DOS ----
  await generateBootstrapAlerts();

  // ---- Generate sample orders ----
  await generateSampleOrders();

  // ---- Populate the live in-flight shipments pool so the map shows
  //      30-45 active convoys/aircraft from the moment the app boots.
  const { tickShipments } = await import("../lib/shipments-tick");
  const { added, active } = await tickShipments();
  logger.info({ added, active }, "seed: in-flight shipments populated");

  // ---- Seed activity ----
  await db.insert(activityEntries).values([
    {
      kind: "SYSTEM",
      actor: "system",
      message: "Theater snapshot ingested from MARFORPAC dataset",
      meta: { source: "dataset.xlsx" },
    },
    {
      kind: "SYSTEM",
      actor: "system",
      message: `INDOPACOM operational state set to HEIGHTENED`,
      meta: {},
    },
  ]);

  // ---- Starter tag library ----
  await seedStarterTags();

  // ---- Touch unused imports for typecheck ----
  void conversations;
  void conversationMessages;
  void scenarios;
  void recommendations;

  logger.info("seed complete");
}

async function seedStarterTags(): Promise<void> {
  const { tags: tagsTable } = await import("@workspace/db");
  const STARTER_TAGS: Array<{
    name: string;
    slug: string;
    color: string;
    description: string;
  }> = [
    { name: "Pacific Theater", slug: "pacific-theater", color: "sky", description: "Sites and shipments inside the broader Pacific AOR." },
    { name: "First Island Chain", slug: "first-island-chain", color: "cyan", description: "Forward sites along the first island chain (Japan, Taiwan, Philippines)." },
    { name: "Forward Operating", slug: "forward-operating", color: "rose", description: "Forward operating sites under heightened or higher optempo." },
    { name: "High Priority", slug: "high-priority", color: "amber", description: "Records the watch officer flagged as high priority." },
    { name: "Critical Mission", slug: "critical-mission", color: "rose", description: "Tied to a critical mission set or named operation." },
    { name: "Cold Chain", slug: "cold-chain", color: "fuchsia", description: "Cold-chain dependent items, lots, or sustainment paths." },
    { name: "Walking Blood Bank", slug: "walking-blood-bank", color: "rose", description: "Walking blood bank readiness — donor pool, lots, sites." },
    { name: "Long Lead", slug: "long-lead", color: "orange", description: "Items or suppliers with multi-week lead times." },
    { name: "Trusted Supplier", slug: "trusted-supplier", color: "emerald", description: "High-reliability supplier the planners default to." },
    { name: "Disruption Watch", slug: "disruption-watch", color: "violet", description: "Currently affected by an active disruption / scenario." },
  ];
  await db.insert(tagsTable).values(
    STARTER_TAGS.map((t) => ({
      id: `tag_${t.slug}`,
      name: t.name,
      slug: t.slug,
      color: t.color,
      description: t.description,
      source: "manual",
      createdBy: "system",
    })),
  );
  logger.info({ count: STARTER_TAGS.length }, "seed: starter tags inserted");
}

function inferModality(priority: string, days: number): string {
  if (priority === "primary" && days <= 3) return "air";
  if (priority === "primary") return "surface";
  if (days >= 7) return "sealift";
  return "surface";
}

function readSheetAsObjects(
  wb: XLSX.WorkBook,
  sheetName: string,
  expectedHeaders: string[],
): Row[] {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const arr = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, range: 1, defval: null });
  const out: Row[] = [];
  if (arr.length === 0) return out;
  const firstRow = arr[0] as unknown[];
  const headerLooksReal = firstRow.every(
    (c, idx) => typeof c === "string" && c === expectedHeaders[idx],
  );
  const startIdx = headerLooksReal ? 1 : 0;
  for (let i = startIdx; i < arr.length; i++) {
    const row = arr[i] as unknown[];
    if (!row || row.every((v) => v === null || v === "")) continue;
    const obj: Row = {};
    for (let h = 0; h < expectedHeaders.length; h++) {
      const headerName = expectedHeaders[h]!;
      obj[headerName] = row[h] ?? null;
    }
    out.push(obj);
  }
  return out;
}

async function ingestCsvCatalog(csvPath: string): Promise<void> {
  const text = readFileSync(csvPath, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return;
  const header = parseCsvLine(lines[0]!);
  const aggregated = new Map<string, {
    mfrCatNo: string;
    description: string;
    manufacturer: string;
    productNoun: string;
    productType: string;
    unspscCommodity: string | null;
    productSize: string | null;
    ghxCommodityType: string | null;
    fullDescription: string | null;
    orderLines: number;
    totalQty: number;
  }>();
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]!);
    const rec: Record<string, string> = {};
    for (let h = 0; h < header.length; h++) rec[header[h]!] = row[h] ?? "";
    const key = rec["Mfr Cat No."] || rec["Item Dsc Short"] || `row-${i}`;
    const cur = aggregated.get(key) ?? {
      mfrCatNo: rec["Mfr Cat No."] ?? key,
      description: rec["Item Dsc Short"] ?? "",
      manufacturer: rec["Manufacturer"] ?? "Unknown",
      productNoun: rec["Product Noun"] ?? "Item",
      productType: rec["Product Type"] ?? "Other",
      unspscCommodity: rec["UNSPSC Commodity"] || null,
      productSize: rec["Product Size"] || null,
      ghxCommodityType: rec["GHX Commodity Type"] || null,
      fullDescription: rec["GHX Full Product Description"] || null,
      orderLines: 0,
      totalQty: 0,
    };
    cur.orderLines += 1;
    cur.totalQty += Number(rec["Order Qty"] ?? 0) || 0;
    aggregated.set(key, cur);
  }
  const entries = Array.from(aggregated.values()).map((v) => ({
    ...v,
    appItemId: null,
    mapped: false,
  }));
  const chunkSize = 500;
  for (let i = 0; i < entries.length; i += chunkSize) {
    const slice = entries.slice(i, i + chunkSize);
    await db.insert(catalogEntries).values(slice);
  }
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else cur += ch;
    } else {
      if (ch === ",") {
        out.push(cur);
        cur = "";
      } else if (ch === '"') inQuotes = true;
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function generateBootstrapAlerts(): Promise<void> {
  const [allNodes, allItems, allBalances, allProfiles, allStates, allSkew] =
    await Promise.all([
      db.select().from(nodes),
      db.select().from(items),
      db.select().from(inventoryBalances),
      db.select().from(demandProfiles),
      db.select().from(operationalStates),
      db.select().from(itemSkewFactors),
    ]);
  const profileMap = new Map<string, SimDemandProfile>(allProfiles.map((p) => [p.nodeId, { ...p }]));
  const stateMap = new Map(
    allStates.map((s) => [
      s.id,
      {
        id: s.id,
        encounterMultiplier: s.encounterMultiplier,
        populationMultiplier: s.populationMultiplier,
      },
    ]),
  );
  const skew: Record<string, number> = {};
  for (const r of allSkew) skew[r.itemId] = r.factor;
  const balanceMap = new Map<string, number>();
  for (const b of allBalances) balanceMap.set(`${b.nodeId}:${b.itemId}`, b.onHand);

  const simItems: SimItem[] = allItems.map((i) => ({
    id: i.id,
    name: i.name,
    unitOfIssue: i.unitOfIssue,
    baseDemandPerEvent: i.baseDemandPerEvent,
    wasteAdjustedDemand: i.wasteAdjustedDemand,
    trigger: i.trigger,
    criticality: i.criticality,
    leadTimeDays: i.leadTimeDays,
  }));

  const newAlerts: Array<{
    id: string;
    nodeId: string;
    itemId: string | null;
    severity: string;
    category: string;
    message: string;
    status: string;
  }> = [];

  for (const node of allNodes) {
    const profile = profileMap.get(node.id);
    if (!profile || profile.activeSupportedPopulation === 0) continue;
    const demands = computeDailyDemand({
      profile,
      items: simItems,
      operationalState: stateMap.get(profile.operationalState),
      itemSkew: skew,
    });
    for (const dem of demands) {
      const onHand = balanceMap.get(`${node.id}:${dem.itemId}`) ?? 0;
      const dos = projectDaysOfSupply(onHand, dem.quantity);
      if (dos > 14) continue;
      const severity = dos <= 3 ? "CRITICAL" : dos <= 7 ? "WARNING" : "WATCH";
      const item = simItems.find((s) => s.id === dem.itemId);
      newAlerts.push({
        id: `al-${node.id}-${dem.itemId}`,
        nodeId: node.id,
        itemId: dem.itemId,
        severity,
        category: "DOS_SHORTFALL",
        message: `${item?.name ?? dem.itemId} at ${node.name}: projected ${dos.toFixed(1)} days of supply`,
        status: "OPEN",
      });
    }
  }
  if (newAlerts.length > 0) await db.insert(alerts).values(newAlerts);
}

async function generateSampleOrders(): Promise<void> {
  const [allNodes, allItems, allBalances, allProfiles, allStates, allSkew, allRoutes] =
    await Promise.all([
      db.select().from(nodes),
      db.select().from(items),
      db.select().from(inventoryBalances),
      db.select().from(demandProfiles),
      db.select().from(operationalStates),
      db.select().from(itemSkewFactors),
      db.select().from(routes),
    ]);
  const profileMap = new Map<string, SimDemandProfile>(allProfiles.map((p) => [p.nodeId, { ...p }]));
  const stateMap = new Map(
    allStates.map((s) => [
      s.id,
      {
        id: s.id,
        encounterMultiplier: s.encounterMultiplier,
        populationMultiplier: s.populationMultiplier,
      },
    ]),
  );
  const skew: Record<string, number> = {};
  for (const r of allSkew) skew[r.itemId] = r.factor;

  const simNodes: SimNode[] = allNodes.map((n) => ({ ...n }));
  const simItems: SimItem[] = allItems.map((i) => ({
    id: i.id,
    name: i.name,
    unitOfIssue: i.unitOfIssue,
    baseDemandPerEvent: i.baseDemandPerEvent,
    wasteAdjustedDemand: i.wasteAdjustedDemand,
    trigger: i.trigger,
    criticality: i.criticality,
    leadTimeDays: i.leadTimeDays,
  }));
  const simRoutes: SimRoute[] = allRoutes.map((r) => ({
    id: r.id,
    fromNode: r.fromNode,
    toNode: r.toNode,
    priority: r.priority as SimRoute["priority"],
    days: r.days,
    reliability: r.reliability,
    modality: r.modality,
  }));

  const recs = generateRecommendations({
    nodes: simNodes,
    routes: simRoutes,
    items: simItems,
    balances: allBalances.map((b) => ({
      nodeId: b.nodeId,
      itemId: b.itemId,
      onHand: b.onHand,
      dueIn: b.dueIn,
    })),
    profiles: profileMap,
    states: stateMap,
    suppliers: SUPPLIER_DEFS,
    itemSkew: skew,
    watchDays: 14,
    criticalDays: 5,
    paddingDays: 7,
  });

  const sample = recs.slice(0, 6);
  const ordersToInsert: Array<typeof orders.$inferInsert> = [];
  const linesToInsert: Array<typeof orderLines.$inferInsert> = [];
  const shipmentsToInsert: Array<typeof shipments.$inferInsert> = [];
  const activityToInsert: Array<typeof activityEntries.$inferInsert> = [];
  const recsToInsert: Array<typeof recommendations.$inferInsert> = [];
  const now = Date.now();
  for (let i = 0; i < sample.length; i++) {
    const rec = sample[i]!;
    const orderId = `o-seed-${i}`;
    const orderNo = `PO-2026-${10000 + i}`;
    const supplierId = rec.sourceSupplierId ?? "dla-prime";
    const status = i < 2 ? "ACKNOWLEDGED" : i < 4 ? "IN_TRANSIT" : "SUBMITTED";
    const createdAt = new Date(now - (i + 1) * 4 * 3600_000);
    const requested = new Date(now + (rec.etaDays + 1) * 86400_000);
    // Persist the AI recommendation row that this seeded order was promoted
    // from, and link both directions. The OrdersBoard / OrderDetail UI keys
    // its "Powered by AI" highlight off promotedFromRecommendationId.
    const recId = `rec-seed-${i}`;
    recsToInsert.push({
      id: recId,
      nodeId: rec.nodeId,
      itemId: rec.itemId,
      kind: rec.kind,
      suggestedQty: rec.suggestedQty,
      reason: rec.reason,
      expectedRiskReduction: rec.expectedRiskReduction,
      sourceSupplierId: supplierId,
      etaDays: rec.etaDays,
      status: "PROMOTED",
      createdAt: new Date(createdAt.getTime() - 30 * 60_000),
      promotedOrderId: orderId,
    });
    ordersToInsert.push({
      id: orderId,
      orderNo,
      nodeId: rec.nodeId,
      supplierId,
      status,
      priority: rec.kind === "ESCALATE" ? "FLASH" : rec.kind === "REROUTE" ? "URGENT" : "ROUTINE",
      createdAt,
      requestedDeliveryAt: requested,
      totalUsd: rec.suggestedQty * 1.5,
      notesEnc: encryptText(rec.reason) as unknown as Buffer | undefined,
      promotedFromRecommendationId: recId,
    });
    linesToInsert.push({
      orderId,
      itemId: rec.itemId,
      quantity: rec.suggestedQty,
      unitPriceUsd: 1.5,
      lineTotalUsd: rec.suggestedQty * 1.5,
    });
    if (status === "IN_TRANSIT") {
      const shipmentId = `sh-seed-${i}`;
      const departedAt = new Date(now - 2 * 86400_000);
      const etaAt = new Date(now + (rec.etaDays - 2) * 86400_000);
      shipmentsToInsert.push({
        id: shipmentId,
        orderId,
        fromNode: supplierId,
        toNode: rec.nodeId,
        itemId: rec.itemId,
        quantity: rec.suggestedQty,
        departedAt,
        etaAt,
        priority: rec.kind === "ESCALATE" ? "FLASH" : rec.kind === "REROUTE" ? "URGENT" : "ROUTINE",
      });
      activityToInsert.push({
        ts: departedAt,
        kind: "SHIPMENT_DEPARTED",
        actor: "system",
        message: `Shipment departed ${supplierId} → ${rec.nodeId} carrying ${rec.suggestedQty} ${rec.itemId} (ETA ${etaAt.toISOString().slice(0, 10)})`,
        refType: "order",
        refId: orderId,
        meta: {
          shipmentId,
          itemId: rec.itemId,
          quantity: rec.suggestedQty,
          fromNode: supplierId,
          toNode: rec.nodeId,
          etaAt: etaAt.toISOString(),
        },
      });
    }

    // Backfill activity history so the OrderDetail panel has a real audit trail.
    // The promotion entry comes first (chronologically), mirroring what the
    // /predictive/recommendations/:id/promote handler writes at runtime so the
    // "Triggered by AI" provenance is surfaced consistently.
    activityToInsert.push({
      ts: new Date(createdAt.getTime() - 30 * 60_000),
      kind: "RECOMMENDATION_PROMOTED",
      actor: "operator",
      message: `AI recommendation promoted to order ${orderNo}`,
      refType: "order",
      refId: orderId,
      meta: {
        recommendationId: recId,
        recommendationKind: rec.kind,
        suggestedQty: rec.suggestedQty,
        promotedQty: rec.suggestedQty,
        promotedSupplierId: supplierId,
        promotedEtaDays: rec.etaDays,
        promotedPriority:
          rec.kind === "ESCALATE"
            ? "FLASH"
            : rec.kind === "REROUTE"
              ? "URGENT"
              : "ROUTINE",
        overridden: false,
      },
    });
    activityToInsert.push({
      ts: createdAt,
      kind: "ORDER_CREATED",
      actor: "operator",
      message: `Order ${orderNo} created for ${rec.nodeId}`,
      refType: "order",
      refId: orderId,
      meta: {
        totalUsd: rec.suggestedQty * 1.5,
        lines: 1,
        promotedFromRecommendationId: recId,
      },
    });
    if (status === "ACKNOWLEDGED" || status === "IN_TRANSIT") {
      activityToInsert.push({
        ts: new Date(createdAt.getTime() + 45 * 60_000),
        kind: "ORDER_STATUS_CHANGE",
        actor: "operator",
        message: `Order ${orderNo} -> ACKNOWLEDGED`,
        refType: "order",
        refId: orderId,
        meta: { status: "ACKNOWLEDGED", supplierId },
      });
    }
    if (status === "IN_TRANSIT") {
      activityToInsert.push({
        ts: new Date(createdAt.getTime() + 6 * 3600_000),
        kind: "ORDER_STATUS_CHANGE",
        actor: "operator",
        message: `Order ${orderNo} -> IN_TRANSIT`,
        refType: "order",
        refId: orderId,
        meta: { status: "IN_TRANSIT" },
      });
    }
  }
  if (recsToInsert.length > 0) await db.insert(recommendations).values(recsToInsert);
  if (ordersToInsert.length > 0) await db.insert(orders).values(ordersToInsert);
  if (linesToInsert.length > 0) await db.insert(orderLines).values(linesToInsert);
  if (shipmentsToInsert.length > 0) await db.insert(shipments).values(shipmentsToInsert);
  if (activityToInsert.length > 0) await db.insert(activityEntries).values(activityToInsert);
}

// ===== Blood-readiness seed =====================================================
// Generates per-unit blood lots, per-site cold-chain assets, donor pools, and
// temperature-excursion events for every node that holds blood. Distributions
// are tuned so the UI has interesting near-expiry tails, a few compromised
// lots, and a handful of cold-chain excursions to surface in the dashboard.

type BloodSeedSpec = {
  // Component family enum we expose through the API.
  component: string;
  // Item id this lot maps onto.
  itemId: string;
  // Shelf life in days (used to scatter expirations).
  shelfDays: number;
  // ABO/Rh distribution (probability weights) — null = universal/N/A.
  abo: Array<{ abo: string | null; rh: string | null; weight: number }>;
};

const BLOOD_COMPONENT_SPECS: BloodSeedSpec[] = [
  {
    component: "LTOWB",
    itemId: "ltow_pos",
    shelfDays: 21,
    abo: [
      { abo: "O", rh: "POS", weight: 1 },
    ],
  },
  {
    component: "LTOWB",
    itemId: "ltow_neg",
    shelfDays: 21,
    abo: [
      { abo: "O", rh: "NEG", weight: 1 },
    ],
  },
  {
    component: "PRBC",
    itemId: "prbc_o",
    shelfDays: 42,
    abo: [
      { abo: "O", rh: "POS", weight: 0.55 },
      { abo: "O", rh: "NEG", weight: 0.15 },
      { abo: "A", rh: "POS", weight: 0.18 },
      { abo: "B", rh: "POS", weight: 0.08 },
      { abo: "AB", rh: "POS", weight: 0.04 },
    ],
  },
  {
    component: "FFP",
    itemId: "ffp_ab",
    shelfDays: 365,
    abo: [{ abo: "AB", rh: null, weight: 1 }],
  },
  {
    component: "PLASMA",
    itemId: "plasma_a",
    shelfDays: 26,
    abo: [{ abo: "A", rh: null, weight: 1 }],
  },
  {
    component: "PLATELETS",
    itemId: "platelets",
    shelfDays: 5,
    abo: [
      { abo: "A", rh: "POS", weight: 0.4 },
      { abo: "O", rh: "POS", weight: 0.4 },
      { abo: "B", rh: "POS", weight: 0.15 },
      { abo: "AB", rh: "POS", weight: 0.05 },
    ],
  },
  {
    component: "CRYO",
    itemId: "cryo",
    shelfDays: 365,
    abo: [{ abo: null, rh: null, weight: 1 }],
  },
  {
    component: "FDP",
    itemId: "fdp",
    shelfDays: 730,
    abo: [{ abo: null, rh: null, weight: 1 }],
  },
];

// Stocking depth multiplier per node type. Theater & hubs hold the deepest
// stocks; BAS/Clinic hold a shallow walking-blood-bank-driven inventory.
function bloodDepthForType(nodeType: string): number {
  const t = nodeType.toLowerCase();
  if (t.includes("theater")) return 6;
  if (t.includes("regional") || t.includes("hub")) return 4;
  if (t.includes("large mtf")) return 2;
  if (t.includes("standard mtf")) return 1.0;
  if (t.includes("bas")) return 0.4;
  if (t.includes("clinic")) return 0.7;
  if (t.includes("forward")) return 0.5;
  if (t.includes("supplier") || t.includes("prime")) return 0;
  return 0.6;
}

// Walking-blood-bank donor count proportional to population.
function wbbReadyForPopulation(population: number, seed: string): number {
  const j = deterministicJitter(seed);
  // ~1.5% of population pre-screened as WBB-ready donors at MTFs.
  return Math.max(0, Math.round(population * 0.015 * j));
}

async function seedBloodReadiness(): Promise<void> {
  const allNodes = await db.select().from(nodes);
  const lotInserts: Array<typeof bloodLots.$inferInsert> = [];
  const assetInserts: Array<typeof coldChainAssets.$inferInsert> = [];
  const donorInserts: Array<typeof donorPools.$inferInsert> = [];
  const tempEventInserts: Array<typeof temperatureEvents.$inferInsert> = [];

  const now = Date.now();
  const dayMs = 86_400_000;

  for (const node of allNodes) {
    const depth = bloodDepthForType(node.type);
    if (depth <= 0) continue; // suppliers / prime vendors don't physically hold blood

    // ---- Cold-chain assets ----
    const generatorJitter = deterministicJitter(`${node.id}:generator`);
    const fuelDays = Number((6 + generatorJitter * 8).toFixed(1)); // 6–14 days fuel
    const generatorId = `cc-${node.id}-gen`;
    assetInserts.push({
      id: generatorId,
      nodeId: node.id,
      assetType: "generator",
      name: "Backup Generator",
      status: fuelDays < 4 ? "EXCURSION" : "NOMINAL",
      currentTempC: 0,
      targetTempMinC: 0,
      targetTempMaxC: 0,
      hasGenerator: true,
      fuelDaysRemaining: fuelDays,
      capacityUnits: 0,
      lastCheckedAt: new Date(now - Math.floor(generatorJitter * 6) * 3600_000),
    });

    // Always at least one refrigerator (2–6°C target) and one freezer
    // (-25 to -18°C target). Larger sites get a second refrigerator and a
    // platelet incubator. Hubs/theater additionally get a cryopreserver.
    const fridgeJ = deterministicJitter(`${node.id}:fridge`);
    const fridgeTemp = Number((4 + (fridgeJ - 0.5) * 4).toFixed(2));
    const fridgeStatus = fridgeTemp > 6 ? "EXCURSION" : "NOMINAL";
    const fridgeId = `cc-${node.id}-fridge1`;
    assetInserts.push({
      id: fridgeId,
      nodeId: node.id,
      assetType: "refrigerator",
      name: "Blood Bank Refrigerator A",
      status: fridgeStatus,
      currentTempC: fridgeTemp,
      targetTempMinC: 2,
      targetTempMaxC: 6,
      hasGenerator: true,
      fuelDaysRemaining: fuelDays,
      capacityUnits: Math.round(120 * depth),
      lastCheckedAt: new Date(now - 30 * 60_000),
    });

    const freezerJ = deterministicJitter(`${node.id}:freezer`);
    const freezerTemp = Number((-22 + (freezerJ - 0.5) * 6).toFixed(2));
    const freezerStatus = freezerTemp > -18 ? "EXCURSION" : "NOMINAL";
    const freezerId = `cc-${node.id}-freezer1`;
    assetInserts.push({
      id: freezerId,
      nodeId: node.id,
      assetType: "freezer",
      name: "Plasma Freezer",
      status: freezerStatus,
      currentTempC: freezerTemp,
      targetTempMinC: -30,
      targetTempMaxC: -18,
      hasGenerator: true,
      fuelDaysRemaining: fuelDays,
      capacityUnits: Math.round(80 * depth),
      lastCheckedAt: new Date(now - 90 * 60_000),
    });

    if (depth >= 2) {
      const fridge2J = deterministicJitter(`${node.id}:fridge2`);
      const fridge2Temp = Number((4 + (fridge2J - 0.5) * 4).toFixed(2));
      assetInserts.push({
        id: `cc-${node.id}-fridge2`,
        nodeId: node.id,
        assetType: "refrigerator",
        name: "Blood Bank Refrigerator B",
        status: fridge2Temp > 6 ? "EXCURSION" : "NOMINAL",
        currentTempC: fridge2Temp,
        targetTempMinC: 2,
        targetTempMaxC: 6,
        hasGenerator: true,
        fuelDaysRemaining: fuelDays,
        capacityUnits: Math.round(120 * depth),
        lastCheckedAt: new Date(now - 45 * 60_000),
      });

      const incJ = deterministicJitter(`${node.id}:incubator`);
      const incTemp = Number((22 + (incJ - 0.5) * 2).toFixed(2));
      assetInserts.push({
        id: `cc-${node.id}-platelet`,
        nodeId: node.id,
        assetType: "platelet_incubator",
        name: "Platelet Agitator/Incubator",
        status: incTemp > 24 || incTemp < 20 ? "EXCURSION" : "NOMINAL",
        currentTempC: incTemp,
        targetTempMinC: 20,
        targetTempMaxC: 24,
        hasGenerator: true,
        fuelDaysRemaining: fuelDays,
        capacityUnits: Math.round(40 * depth),
        lastCheckedAt: new Date(now - 60 * 60_000),
      });
    }

    if (depth >= 4) {
      const cryoJ = deterministicJitter(`${node.id}:cryo`);
      const cryoTemp = Number((-152 + (cryoJ - 0.5) * 4).toFixed(2));
      assetInserts.push({
        id: `cc-${node.id}-cryo`,
        nodeId: node.id,
        assetType: "cryopreserver",
        name: "Cryopreservation Vault",
        status: cryoTemp > -150 ? "EXCURSION" : "NOMINAL",
        currentTempC: cryoTemp,
        targetTempMinC: -160,
        targetTempMaxC: -150,
        hasGenerator: true,
        fuelDaysRemaining: fuelDays + 4,
        capacityUnits: Math.round(60 * depth),
        lastCheckedAt: new Date(now - 120 * 60_000),
      });
    }

    // Force a few notable failures to make the UI interesting.
    if (node.id === "mtfRomeo") {
      // Failed refrigerator on the southern spoke
      const idx = assetInserts.findIndex((a) => a.id === fridgeId);
      if (idx >= 0) {
        assetInserts[idx]!.status = "FAILED";
        assetInserts[idx]!.currentTempC = 14.2;
      }
    }
    if (node.id === "mtfUniform") {
      const idx = assetInserts.findIndex((a) => a.id === freezerId);
      if (idx >= 0) {
        assetInserts[idx]!.status = "EXCURSION";
        assetInserts[idx]!.currentTempC = -14.5;
      }
    }

    // ---- Temperature-excursion events (recent history) ----
    for (const a of assetInserts.filter((x) => x.nodeId === node.id)) {
      if (a.status === "FAILED") {
        tempEventInserts.push({
          assetId: a.id,
          nodeId: node.id,
          occurredAt: new Date(now - 6 * 3600_000),
          recordedTempC: a.currentTempC ?? 0,
          severity: "CRITICAL",
          resolvedAt: null,
          notes: "Compressor offline; unit awaiting maintenance",
        });
      } else if (a.status === "EXCURSION") {
        tempEventInserts.push({
          assetId: a.id,
          nodeId: node.id,
          occurredAt: new Date(now - 90 * 60_000),
          recordedTempC: a.currentTempC ?? 0,
          severity: "WARNING",
          resolvedAt: null,
          notes: "Out-of-band temperature excursion in progress",
        });
      }
    }

    // ---- Donor pool ----
    const wbbBase = wbbReadyForPopulation(node.population, `${node.id}:wbb`);
    const eligible = Math.max(wbbBase * 4, Math.round(node.population * 0.06));
    // ABO/Rh distribution roughly mirrors US donor pool:
    //   O+ 38%  O- 7%  A+ 34%  A- 6%  B+ 9%  B- 2%  AB+ 3%  AB- 1%
    const aboMix = (frac: number) => Math.max(0, Math.round(wbbBase * frac));
    donorInserts.push({
      nodeId: node.id,
      eligibleDonors: eligible,
      weeklyCollectionCapacity: Math.max(2, Math.round(wbbBase * 0.4)),
      wbbReadyOPos: aboMix(0.38),
      wbbReadyONeg: aboMix(0.07),
      wbbReadyAPos: aboMix(0.34),
      wbbReadyANeg: aboMix(0.06),
      wbbReadyBPos: aboMix(0.09),
      wbbReadyBNeg: aboMix(0.02),
      wbbReadyAbPos: aboMix(0.03),
      wbbReadyAbNeg: aboMix(0.01),
      lastDriveAt: new Date(
        now - Math.round(deterministicJitter(`${node.id}:drive`) * 14) * dayMs,
      ),
    });

    // ---- Blood lots ----
    // Target lots per spec scaled by depth so MTFs hold a small handful and
    // hubs/theater hold many.
    let lotIdx = 0;
    for (const spec of BLOOD_COMPONENT_SPECS) {
      const baseLotCount = Math.max(1, Math.round(depth * 1.6));
      // Smaller sites only stock the universal/critical components; larger
      // sites stock the full ABO mix.
      const aboList = depth >= 2 ? spec.abo : spec.abo.slice(0, 1);
      for (const aboEntry of aboList) {
        const lotCount = Math.max(
          1,
          Math.round(baseLotCount * aboEntry.weight),
        );
        for (let i = 0; i < lotCount; i++) {
          const lotKey = `${node.id}:${spec.itemId}:${i}:${aboEntry.abo ?? "U"}:${aboEntry.rh ?? "N"}`;
          const j = deterministicJitter(lotKey);
          // Scatter expirations across [-2, shelfDays * 0.95] days from now,
          // weighted toward the back half so most lots are healthy but a tail
          // sits in the 0–7 day near-expiry window.
          const skew = (j - 0.3) * 1.4;
          const offset = Math.max(-2, Math.round(spec.shelfDays * Math.max(0, skew)));
          const expiresAt = new Date(now + offset * dayMs);
          const collectedAt = new Date(expiresAt.getTime() - spec.shelfDays * dayMs);

          // Units per lot: trauma-volume LTOWB lots tend to be smaller (1–4),
          // PRBC/FFP are larger (3–10), platelets are typically singletons.
          const unitsBase =
            spec.component === "PLATELETS"
              ? 1
              : spec.component === "LTOWB"
              ? 1 + Math.round(j * 3)
              : 2 + Math.round(j * 6);
          const units = Math.max(1, Math.round(unitsBase * (depth / 2 + 0.5)));

          let status: string;
          if (offset < 0) status = "EXPIRED";
          else if (offset <= 3) status = "NEAR_EXPIRY";
          else status = "VIABLE";
          // Mark a small deterministic fraction as compromised
          if (j > 0.97) status = "COMPROMISED";

          // Pick the appropriate cold-chain asset for this component.
          let coldChainAssetId: string | null = null;
          if (
            spec.component === "LTOWB" ||
            spec.component === "PRBC" ||
            spec.component === "PLASMA"
          ) {
            coldChainAssetId = fridgeId;
          } else if (
            spec.component === "FFP" ||
            spec.component === "FDP" ||
            spec.component === "CRYO"
          ) {
            coldChainAssetId = freezerId;
          } else if (spec.component === "PLATELETS") {
            const inc = assetInserts.find(
              (a) => a.nodeId === node.id && a.assetType === "platelet_incubator",
            );
            coldChainAssetId = inc?.id ?? fridgeId;
          }

          lotInserts.push({
            id: `bl-${node.id}-${spec.component}-${lotIdx++}`,
            nodeId: node.id,
            itemId: spec.itemId,
            component: spec.component,
            aboGroup: aboEntry.abo,
            rhFactor: aboEntry.rh,
            units,
            collectedAt,
            expiresAt,
            status,
            coldChainAssetId,
          });
        }
      }
    }
  }

  if (assetInserts.length > 0) await db.insert(coldChainAssets).values(assetInserts);
  if (donorInserts.length > 0) await db.insert(donorPools).values(donorInserts);
  if (lotInserts.length > 0) await db.insert(bloodLots).values(lotInserts);
  if (tempEventInserts.length > 0)
    await db.insert(temperatureEvents).values(tempEventInserts);

  logger.info(
    {
      assets: assetInserts.length,
      donorNodes: donorInserts.length,
      lots: lotInserts.length,
      tempEvents: tempEventInserts.length,
    },
    "seed: blood-readiness foundation populated",
  );
}

/**
 * Seed the clinician-curated medical-procedure library. Each procedure is a
 * read-only reference entry with a Primary/Secondary/Tertiary supply kit
 * and one or more echelon-of-care role tags (role_1/2/3). The catalog covers
 * the activities most relevant to the INDOPACOM blood-readiness scenario:
 * transfusion, phlebotomy, IV access, surgical prep, wound care, airway
 * management, mass-casualty triage, cold-chain handling, and routine
 * encounters.
 *
 * Item ids must already exist in the items table — we only reference IDs
 * from ITEM_CATALOG above.
 */
async function seedMedicalProcedures(): Promise<void> {
  type Tier = "primary" | "secondary" | "tertiary";
  type Role = "role_1" | "role_2" | "role_3";
  type Kit = Array<{ itemId: string; tier: Tier; quantityPerEvent: number; notes?: string }>;
  type ProcedureSeed = {
    id: string;
    slug: string;
    name: string;
    description: string;
    clinicalCategory: string;
    roles: Role[];
    supplies: Kit;
  };

  const PROCEDURES: ProcedureSeed[] = [
    {
      id: "proc-whole-blood-transfusion",
      slug: "whole-blood-transfusion",
      name: "Whole Blood Transfusion",
      description:
        "Resuscitative transfusion of low-titer O whole blood (cold-stored or fresh from a Walking Blood Bank). Used in massive hemorrhage and damage-control resuscitation.",
      clinicalCategory: "transfusion",
      roles: ["role_2", "role_3"],
      supplies: [
        { itemId: "ltow_pos", tier: "primary", quantityPerEvent: 1, notes: "Primary product when O+ recipient" },
        { itemId: "iv_set", tier: "primary", quantityPerEvent: 1, notes: "170 µm blood filter required" },
        { itemId: "abo_kit", tier: "primary", quantityPerEvent: 1 },
        { itemId: "crossmatch", tier: "primary", quantityPerEvent: 1 },
        { itemId: "gloves", tier: "primary", quantityPerEvent: 2 },
        { itemId: "warmer", tier: "secondary", quantityPerEvent: 1, notes: "Strongly recommended for >2 units" },
        { itemId: "pressure_inf", tier: "secondary", quantityPerEvent: 1 },
        { itemId: "transfusion_band", tier: "secondary", quantityPerEvent: 1 },
        { itemId: "antiseptic", tier: "secondary", quantityPerEvent: 1 },
        { itemId: "biohazard_bag", tier: "tertiary", quantityPerEvent: 1 },
        { itemId: "mask", tier: "tertiary", quantityPerEvent: 1 },
      ],
    },
    {
      id: "proc-component-transfusion",
      slug: "component-transfusion",
      name: "Component Transfusion (PRBC + FFP)",
      description:
        "Balanced 1:1 packed-red-cell and plasma transfusion at a Role 3 facility with a functional blood bank.",
      clinicalCategory: "transfusion",
      roles: ["role_3"],
      supplies: [
        { itemId: "prbc_o", tier: "primary", quantityPerEvent: 1 },
        { itemId: "ffp_ab", tier: "primary", quantityPerEvent: 1 },
        { itemId: "iv_set", tier: "primary", quantityPerEvent: 1 },
        { itemId: "abo_kit", tier: "primary", quantityPerEvent: 1 },
        { itemId: "crossmatch", tier: "primary", quantityPerEvent: 1 },
        { itemId: "gloves", tier: "primary", quantityPerEvent: 2 },
        { itemId: "warmer", tier: "secondary", quantityPerEvent: 1 },
        { itemId: "transfusion_band", tier: "secondary", quantityPerEvent: 1 },
        { itemId: "id_screen", tier: "secondary", quantityPerEvent: 1 },
        { itemId: "platelets", tier: "tertiary", quantityPerEvent: 1, notes: "Add for MTP activation" },
      ],
    },
    {
      id: "proc-phlebotomy",
      slug: "phlebotomy",
      name: "Phlebotomy / Blood Draw",
      description:
        "Diagnostic venipuncture and Walking Blood Bank donor collection. Uses standard collection kit and PPE.",
      clinicalCategory: "collection",
      roles: ["role_1", "role_2", "role_3"],
      supplies: [
        { itemId: "tubes", tier: "primary", quantityPerEvent: 4 },
        { itemId: "butterfly", tier: "primary", quantityPerEvent: 1 },
        { itemId: "gloves", tier: "primary", quantityPerEvent: 1 },
        { itemId: "antiseptic", tier: "primary", quantityPerEvent: 1 },
        { itemId: "tourniquet", tier: "primary", quantityPerEvent: 1 },
        { itemId: "gauze", tier: "secondary", quantityPerEvent: 2 },
        { itemId: "alcohol", tier: "secondary", quantityPerEvent: 2 },
        { itemId: "labels", tier: "secondary", quantityPerEvent: 4 },
        { itemId: "bags", tier: "secondary", quantityPerEvent: 1 },
        { itemId: "sharps", tier: "tertiary", quantityPerEvent: 1 },
        { itemId: "biohazard_bag", tier: "tertiary", quantityPerEvent: 1 },
      ],
    },
    {
      id: "proc-walking-blood-bank-donation",
      slug: "walking-blood-bank-donation",
      name: "Walking Blood Bank Donation",
      description:
        "Whole-blood collection from a pre-screened low-titer O donor for emergency transfusion. Uses CPD-A1 collection bag and barcode chain-of-custody.",
      clinicalCategory: "collection",
      roles: ["role_2", "role_3"],
      supplies: [
        { itemId: "collection_bag", tier: "primary", quantityPerEvent: 1 },
        { itemId: "antiseptic", tier: "primary", quantityPerEvent: 1 },
        { itemId: "gloves", tier: "primary", quantityPerEvent: 1 },
        { itemId: "tourniquet", tier: "primary", quantityPerEvent: 1 },
        { itemId: "labels", tier: "primary", quantityPerEvent: 2 },
        { itemId: "tubes", tier: "secondary", quantityPerEvent: 2, notes: "Held for ABO confirm + ID screen" },
        { itemId: "id_screen", tier: "secondary", quantityPerEvent: 1 },
        { itemId: "abo_kit", tier: "secondary", quantityPerEvent: 1 },
        { itemId: "bags", tier: "tertiary", quantityPerEvent: 1 },
        { itemId: "sharps", tier: "tertiary", quantityPerEvent: 1 },
      ],
    },
    {
      id: "proc-iv-access",
      slug: "iv-access",
      name: "IV Access & Fluid Resuscitation",
      description:
        "Peripheral IV placement and crystalloid infusion for hypovolemia, sepsis, dehydration, or burn resuscitation.",
      clinicalCategory: "vascular_access",
      roles: ["role_1", "role_2", "role_3"],
      supplies: [
        { itemId: "iv_set", tier: "primary", quantityPerEvent: 1 },
        { itemId: "iv_fluid_lr", tier: "primary", quantityPerEvent: 1 },
        { itemId: "antiseptic", tier: "primary", quantityPerEvent: 1 },
        { itemId: "gloves", tier: "primary", quantityPerEvent: 1 },
        { itemId: "iv_fluid_ns", tier: "secondary", quantityPerEvent: 1, notes: "When LR contraindicated" },
        { itemId: "tourniquet", tier: "secondary", quantityPerEvent: 1 },
        { itemId: "gauze", tier: "secondary", quantityPerEvent: 1 },
        { itemId: "alcohol", tier: "tertiary", quantityPerEvent: 2 },
        { itemId: "sharps", tier: "tertiary", quantityPerEvent: 1 },
      ],
    },
    {
      id: "proc-surgical-prep",
      slug: "surgical-prep",
      name: "Damage-Control Surgical Prep",
      description:
        "Pre-operative skin antisepsis, draping, and instrument prep for damage-control surgery at a Role 2/3 facility.",
      clinicalCategory: "surgical",
      roles: ["role_2", "role_3"],
      supplies: [
        { itemId: "antiseptic", tier: "primary", quantityPerEvent: 4 },
        { itemId: "gloves", tier: "primary", quantityPerEvent: 4, notes: "Sterile pairs per surgical team" },
        { itemId: "gown", tier: "primary", quantityPerEvent: 3 },
        { itemId: "mask", tier: "primary", quantityPerEvent: 3 },
        { itemId: "suture_kit", tier: "primary", quantityPerEvent: 2 },
        { itemId: "shield", tier: "secondary", quantityPerEvent: 3 },
        { itemId: "antibiotic_iv", tier: "secondary", quantityPerEvent: 2, notes: "Pre-incision dose" },
        { itemId: "trauma_dressing", tier: "secondary", quantityPerEvent: 4 },
        { itemId: "biohazard_bag", tier: "tertiary", quantityPerEvent: 2 },
        { itemId: "sharps", tier: "tertiary", quantityPerEvent: 1 },
      ],
    },
    {
      id: "proc-wound-care",
      slug: "wound-care",
      name: "Basic Wound Care",
      description:
        "Cleansing, hemostasis, and dressing of a non-surgical wound. The bread-and-butter of Role 1 sick call.",
      clinicalCategory: "wound_care",
      roles: ["role_1", "role_2"],
      supplies: [
        { itemId: "gauze", tier: "primary", quantityPerEvent: 4 },
        { itemId: "antiseptic", tier: "primary", quantityPerEvent: 1 },
        { itemId: "gloves", tier: "primary", quantityPerEvent: 1 },
        { itemId: "pressure_dressing", tier: "primary", quantityPerEvent: 1 },
        { itemId: "suture_kit", tier: "secondary", quantityPerEvent: 1 },
        { itemId: "antibiotic_po", tier: "secondary", quantityPerEvent: 7, notes: "5–7 day course PRN" },
        { itemId: "trauma_dressing", tier: "secondary", quantityPerEvent: 1 },
        { itemId: "alcohol", tier: "tertiary", quantityPerEvent: 2 },
        { itemId: "biohazard_bag", tier: "tertiary", quantityPerEvent: 1 },
      ],
    },
    {
      id: "proc-hemorrhage-control",
      slug: "hemorrhage-control",
      name: "Tactical Hemorrhage Control",
      description:
        "Tourniquet application, hemostatic packing, and wound pressure for life-threatening external hemorrhage (TCCC).",
      clinicalCategory: "trauma",
      roles: ["role_1", "role_2"],
      supplies: [
        { itemId: "tq_cat", tier: "primary", quantityPerEvent: 2 },
        { itemId: "hemo_dressing", tier: "primary", quantityPerEvent: 1 },
        { itemId: "pressure_dressing", tier: "primary", quantityPerEvent: 2 },
        { itemId: "gloves", tier: "primary", quantityPerEvent: 1 },
        { itemId: "trauma_dressing", tier: "secondary", quantityPerEvent: 2 },
        { itemId: "gauze", tier: "secondary", quantityPerEvent: 4 },
        { itemId: "splint_sam", tier: "secondary", quantityPerEvent: 1 },
        { itemId: "analgesic_morphine", tier: "tertiary", quantityPerEvent: 1 },
      ],
    },
    {
      id: "proc-airway-management",
      slug: "airway-management",
      name: "Advanced Airway Management",
      description:
        "Cricothyrotomy or endotracheal intubation for airway compromise, severe burn, or polytrauma.",
      clinicalCategory: "airway",
      roles: ["role_2", "role_3"],
      supplies: [
        { itemId: "airway_kit", tier: "primary", quantityPerEvent: 1 },
        { itemId: "gloves", tier: "primary", quantityPerEvent: 1 },
        { itemId: "iv_set", tier: "primary", quantityPerEvent: 1, notes: "Sedation access" },
        { itemId: "analgesic_ketamine", tier: "secondary", quantityPerEvent: 1, notes: "Dissociative induction" },
        { itemId: "antiseptic", tier: "secondary", quantityPerEvent: 1 },
        { itemId: "mask", tier: "secondary", quantityPerEvent: 1 },
        { itemId: "shield", tier: "secondary", quantityPerEvent: 1 },
        { itemId: "n95", tier: "tertiary", quantityPerEvent: 1, notes: "If aerosol-generating procedure" },
        { itemId: "suture_kit", tier: "tertiary", quantityPerEvent: 1, notes: "Cric tie-in" },
      ],
    },
    {
      id: "proc-mascal-triage",
      slug: "mascal-triage",
      name: "MASCAL Triage & Stabilization",
      description:
        "Mass-casualty triage with immediate life-saving interventions: airway, breathing, circulation, hemorrhage, hypothermia.",
      clinicalCategory: "triage",
      roles: ["role_1", "role_2", "role_3"],
      supplies: [
        { itemId: "tq_cat", tier: "primary", quantityPerEvent: 2 },
        { itemId: "iv_set", tier: "primary", quantityPerEvent: 1 },
        { itemId: "iv_fluid_lr", tier: "primary", quantityPerEvent: 1 },
        { itemId: "gloves", tier: "primary", quantityPerEvent: 2 },
        { itemId: "trauma_dressing", tier: "primary", quantityPerEvent: 2 },
        { itemId: "chest_seal", tier: "secondary", quantityPerEvent: 1 },
        { itemId: "airway_kit", tier: "secondary", quantityPerEvent: 1 },
        { itemId: "analgesic_morphine", tier: "secondary", quantityPerEvent: 1 },
        { itemId: "antiemetic", tier: "secondary", quantityPerEvent: 1 },
        { itemId: "splint_sam", tier: "tertiary", quantityPerEvent: 1 },
        { itemId: "labels", tier: "tertiary", quantityPerEvent: 2 },
      ],
    },
    {
      id: "proc-cold-chain-handling",
      slug: "cold-chain-handling",
      name: "Cold-Chain Handling & Transport",
      description:
        "Receiving and dispatching blood products in a validated cold chain (2–6 °C). Required for any inter-facility blood movement.",
      clinicalCategory: "logistics",
      roles: ["role_2", "role_3"],
      supplies: [
        { itemId: "cooler", tier: "primary", quantityPerEvent: 1 },
        { itemId: "coolant", tier: "primary", quantityPerEvent: 4 },
        { itemId: "chain_log", tier: "primary", quantityPerEvent: 1 },
        { itemId: "labels", tier: "secondary", quantityPerEvent: 4 },
        { itemId: "bags", tier: "secondary", quantityPerEvent: 1 },
        { itemId: "gloves", tier: "tertiary", quantityPerEvent: 1 },
      ],
    },
    {
      id: "proc-routine-encounter",
      slug: "routine-encounter",
      name: "Routine Sick-Call Encounter",
      description:
        "Steady-state outpatient encounter — vitals, basic assessment, prescription, and minor wound care.",
      clinicalCategory: "encounter",
      roles: ["role_1", "role_2"],
      supplies: [
        { itemId: "gloves", tier: "primary", quantityPerEvent: 1 },
        { itemId: "antiseptic", tier: "primary", quantityPerEvent: 1 },
        { itemId: "gauze", tier: "primary", quantityPerEvent: 2 },
        { itemId: "antibiotic_po", tier: "secondary", quantityPerEvent: 5 },
        { itemId: "oral_rehydration", tier: "secondary", quantityPerEvent: 2 },
        { itemId: "antiemetic", tier: "tertiary", quantityPerEvent: 1 },
        { itemId: "alcohol", tier: "tertiary", quantityPerEvent: 1 },
      ],
    },
  ];

  // Insert procedures, supplies, roles. Order matters only for FK clarity —
  // the schema does not declare hard FKs, but we still keep the dependency
  // order so the data is coherent if any are added later.
  await db.insert(proceduresTable).values(
    PROCEDURES.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      clinicalCategory: p.clinicalCategory,
    })),
  );

  const supplyRows = PROCEDURES.flatMap((p) =>
    p.supplies.map((s) => ({
      procedureId: p.id,
      itemId: s.itemId,
      tier: s.tier,
      quantityPerEvent: s.quantityPerEvent,
      notes: s.notes ?? "",
    })),
  );
  if (supplyRows.length > 0) {
    await db.insert(procedureSupplies).values(supplyRows);
  }

  const roleRows = PROCEDURES.flatMap((p) =>
    p.roles.map((role) => ({ procedureId: p.id, role })),
  );
  if (roleRows.length > 0) {
    await db.insert(procedureRoles).values(roleRows);
  }

  logger.info(
    {
      procedures: PROCEDURES.length,
      supplyLinks: supplyRows.length,
      roleLinks: roleRows.length,
    },
    "seed: medical-procedure library populated",
  );
}
