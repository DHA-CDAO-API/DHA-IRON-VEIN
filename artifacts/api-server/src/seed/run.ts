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
} from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
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

const SUPPLIER_DEFS: Array<Omit<SimSupplier, "id"> & { id: string; country: string; notes: string }> = [
  { id: "dla-prime", name: "DLA Prime Vendor (Class VIII)", channel: "DLA", country: "US", leadTimeDaysMean: 5, reliabilityScore: 0.94, notes: "Defense Logistics Agency primary medical supply channel" },
  { id: "ecat", name: "ECAT (Electronic Catalog)", channel: "ECAT", country: "US", leadTimeDaysMean: 7, reliabilityScore: 0.91, notes: "DLA peacetime/readiness portal" },
  { id: "gsa", name: "GSA Schedule 65", channel: "GSA", country: "US", leadTimeDaysMean: 12, reliabilityScore: 0.88, notes: "GSA medical schedule" },
  { id: "fedmall", name: "FedMall", channel: "FedMall", country: "US", leadTimeDaysMean: 10, reliabilityScore: 0.86, notes: "DoD e-commerce ordering" },
  { id: "mckesson", name: "McKesson Distribution", channel: "McKesson", country: "US", leadTimeDaysMean: 4, reliabilityScore: 0.93, notes: "Commercial backstop — pharmaceuticals & supplies" },
  { id: "cardinal", name: "Cardinal Health", channel: "Cardinal", country: "US", leadTimeDaysMean: 5, reliabilityScore: 0.92, notes: "Commercial backstop — exam/surgical gloves" },
  { id: "henryschein", name: "Henry Schein", channel: "HenrySchein", country: "US", leadTimeDaysMean: 6, reliabilityScore: 0.9, notes: "Commercial backstop — phlebotomy & lab" },
  { id: "owensminor", name: "Owens & Minor", channel: "OwensMinor", country: "US", leadTimeDaysMean: 6, reliabilityScore: 0.89, notes: "Commercial backstop — surgical kits" },
  { id: "hostnation-au", name: "Host Nation — Australia (DSTG)", channel: "HostNation", country: "AU", leadTimeDaysMean: 3, reliabilityScore: 0.87, notes: "Allied basing support — Darwin / Tindal" },
  { id: "hostnation-jp", name: "Host Nation — Japan (JSDF Med)", channel: "HostNation", country: "JP", leadTimeDaysMean: 2, reliabilityScore: 0.92, notes: "Allied basing support — Okinawa / Iwakuni / Yokota" },
  { id: "hostnation-ph", name: "Host Nation — Philippines (AFP Med)", channel: "HostNation", country: "PH", leadTimeDaysMean: 4, reliabilityScore: 0.81, notes: "Allied basing support — EDCA sites" },
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

function operationalStressScale(nodeType: string, optempo: string): number {
  const t = nodeType.toLowerCase();
  if (t.includes("supplier") || t.includes("prime")) return 1;
  if (t.includes("theater") || t.includes("hub")) {
    return optempo === "active_operations" ? 0.32 : 0.45;
  }
  if (t.includes("large mtf")) {
    return optempo === "active_operations" ? 0.18 : 0.28;
  }
  if (t.includes("standard mtf") || t.includes("clinic")) {
    return optempo === "active_operations" ? 0.13 : 0.2;
  }
  if (t.includes("bas")) {
    return optempo === "active_operations" ? 0.05 : 0.09;
  }
  return 0.25;
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
      item_skew_factors, preset_events, operational_states, suppliers, items,
      routes, nodes, catalog_entries, app_settings, profiles,
      blood_lots, cold_chain_assets, donor_pools, temperature_events
      RESTART IDENTITY`);
  }

  // ---- Items (hand-curated, blood-products-first) ----
  // category: blood_products | supplies | ppe | other
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
  }> = [
    // ---- Blood products (USMC Walking Blood Bank + frozen/liquid components) ----
    { id: "ltow_pos",   name: "Whole Blood Low-Titer O Pos",        unit: "units", category: "blood_products", criticality: "critical", baseDemand: 1.0, waste: 1.10, trigger: "transfusion_event", leadTimeDays: 2, shelfLifeDays: 21,  classOfSupply: "VIII" },
    { id: "ltow_neg",   name: "Whole Blood Low-Titer O Neg",        unit: "units", category: "blood_products", criticality: "critical", baseDemand: 0.5, waste: 1.10, trigger: "transfusion_event", leadTimeDays: 2, shelfLifeDays: 21,  classOfSupply: "VIII" },
    { id: "prbc_o",     name: "Packed Red Blood Cells (PRBC) O",    unit: "units", category: "blood_products", criticality: "critical", baseDemand: 1.5, waste: 1.08, trigger: "transfusion_event", leadTimeDays: 3, shelfLifeDays: 42,  classOfSupply: "VIII" },
    { id: "ffp_ab",     name: "Fresh Frozen Plasma AB (Universal)", unit: "units", category: "blood_products", criticality: "critical", baseDemand: 1.0, waste: 1.05, trigger: "transfusion_event", leadTimeDays: 4, shelfLifeDays: 365, classOfSupply: "VIII" },
    { id: "plasma_a",   name: "Liquid Plasma Group A",              unit: "units", category: "blood_products", criticality: "high",     baseDemand: 0.6, waste: 1.05, trigger: "transfusion_event", leadTimeDays: 3, shelfLifeDays: 26,  classOfSupply: "VIII" },
    { id: "platelets",  name: "Apheresis Platelets",                unit: "units", category: "blood_products", criticality: "critical", baseDemand: 0.4, waste: 1.20, trigger: "transfusion_event", leadTimeDays: 2, shelfLifeDays: 5,   classOfSupply: "VIII" },
    { id: "cryo",       name: "Cryoprecipitate",                    unit: "units", category: "blood_products", criticality: "high",     baseDemand: 0.3, waste: 1.10, trigger: "transfusion_event", leadTimeDays: 4, shelfLifeDays: 365, classOfSupply: "VIII" },
    { id: "fdp",        name: "Freeze-Dried Plasma (FDP)",          unit: "units", category: "blood_products", criticality: "critical", baseDemand: 0.8, waste: 1.02, trigger: "transfusion_event", leadTimeDays: 5, shelfLifeDays: 730, classOfSupply: "VIII" },

    // ---- Collection / phlebotomy supplies (existing IDs preserved) ----
    { id: "tubes",      name: "Blood Collection Tubes",             unit: "tubes",  category: "supplies", criticality: "high",   baseDemand: 4.0, waste: 1.15, trigger: "phlebotomy_event", leadTimeDays: 7, shelfLifeDays: 730, classOfSupply: "VIII" },
    { id: "butterfly",  name: "Butterfly Needle Sets",              unit: "sets",   category: "supplies", criticality: "high",   baseDemand: 1.0, waste: 1.10, trigger: "phlebotomy_event", leadTimeDays: 7, shelfLifeDays: 1825, classOfSupply: "VIII" },
    { id: "alcohol",    name: "Alcohol Prep Pads",                  unit: "pads",   category: "supplies", criticality: "medium", baseDemand: 2.0, waste: 1.20, trigger: "phlebotomy_event", leadTimeDays: 7, shelfLifeDays: 1095, classOfSupply: "VIII" },
    { id: "gauze",      name: "Gauze Pads",                         unit: "pads",   category: "supplies", criticality: "medium", baseDemand: 2.0, waste: 1.15, trigger: "phlebotomy_event", leadTimeDays: 7, shelfLifeDays: 1825, classOfSupply: "VIII" },
    { id: "tourniquet", name: "Tourniquets",                        unit: "each",   category: "supplies", criticality: "medium", baseDemand: 0.2, waste: 1.05, trigger: "phlebotomy_event", leadTimeDays: 7, shelfLifeDays: 1825, classOfSupply: "VIII" },
    { id: "bags",       name: "Specimen Transport Bags",            unit: "bags",   category: "supplies", criticality: "medium", baseDemand: 1.0, waste: 1.10, trigger: "phlebotomy_event", leadTimeDays: 7, shelfLifeDays: 1825, classOfSupply: "VIII" },
    { id: "labels",     name: "Donor Barcode Labels",               unit: "labels", category: "supplies", criticality: "low",    baseDemand: 4.0, waste: 1.05, trigger: "phlebotomy_event", leadTimeDays: 5, shelfLifeDays: 1825, classOfSupply: "VIII" },
    { id: "collection_bag", name: "Blood Collection Bag CPD-A1 450mL", unit: "bags", category: "supplies", criticality: "critical", baseDemand: 1.0, waste: 1.05, trigger: "phlebotomy_event", leadTimeDays: 10, shelfLifeDays: 730, classOfSupply: "VIII" },
    { id: "antiseptic", name: "Skin Antiseptic Chlorhexidine",      unit: "ea",    category: "supplies", criticality: "medium", baseDemand: 1.5, waste: 1.10, trigger: "phlebotomy_event", leadTimeDays: 7, shelfLifeDays: 1095, classOfSupply: "VIII" },

    // ---- Storage / cold-chain transport ----
    { id: "cooler",      name: "Insulated Blood Transport Cooler 24h", unit: "ea", category: "supplies", criticality: "high", baseDemand: 0.05, waste: 1.02, trigger: "shipment_event", leadTimeDays: 21, shelfLifeDays: 3650, classOfSupply: "VIII" },
    { id: "coolant",     name: "Refrigerator Coolant Pack",            unit: "ea", category: "supplies", criticality: "medium", baseDemand: 0.5, waste: 1.05, trigger: "shipment_event", leadTimeDays: 14, shelfLifeDays: 3650, classOfSupply: "VIII" },
    { id: "chain_log",   name: "Cold-Chain Temperature Logger",        unit: "ea", category: "supplies", criticality: "high",   baseDemand: 0.1, waste: 1.02, trigger: "shipment_event", leadTimeDays: 21, shelfLifeDays: 1825, classOfSupply: "VIII" },

    // ---- Testing / typing ----
    { id: "abo_kit",     name: "ABO/Rh Typing Kit",                    unit: "kit", category: "supplies", criticality: "critical", baseDemand: 0.3, waste: 1.05, trigger: "transfusion_event", leadTimeDays: 14, shelfLifeDays: 540, classOfSupply: "VIII" },
    { id: "crossmatch",  name: "Crossmatch Test Kit",                  unit: "kit", category: "supplies", criticality: "critical", baseDemand: 0.4, waste: 1.05, trigger: "transfusion_event", leadTimeDays: 14, shelfLifeDays: 540, classOfSupply: "VIII" },
    { id: "id_screen",   name: "Infectious Disease Screen (HIV/HBV/HCV)", unit: "kit", category: "supplies", criticality: "high", baseDemand: 0.2, waste: 1.05, trigger: "phlebotomy_event", leadTimeDays: 14, shelfLifeDays: 540, classOfSupply: "VIII" },

    // ---- Transfusion administration ----
    { id: "iv_set",         name: "IV Tubing Set w/ 170μm Blood Filter", unit: "ea", category: "supplies", criticality: "critical", baseDemand: 1.0, waste: 1.10, trigger: "transfusion_event", leadTimeDays: 10, shelfLifeDays: 1825, classOfSupply: "VIII" },
    { id: "pressure_inf",   name: "Pressure Infusor Bag 500mL",          unit: "ea", category: "supplies", criticality: "high",     baseDemand: 0.4, waste: 1.05, trigger: "transfusion_event", leadTimeDays: 14, shelfLifeDays: 1825, classOfSupply: "VIII" },
    { id: "warmer",         name: "Single-Use Blood Warmer (Buddy Lite)", unit: "ea", category: "supplies", criticality: "high",    baseDemand: 0.5, waste: 1.10, trigger: "transfusion_event", leadTimeDays: 21, shelfLifeDays: 730,  classOfSupply: "VIII" },
    { id: "transfusion_band", name: "Transfusion Recipient Wristband",   unit: "ea", category: "supplies", criticality: "medium",   baseDemand: 1.0, waste: 1.05, trigger: "transfusion_event", leadTimeDays: 7, shelfLifeDays: 1825, classOfSupply: "VIII" },

    // ---- PPE ----
    { id: "gloves",  name: "Nitrile Exam Gloves",    unit: "pairs", category: "ppe", criticality: "high",   baseDemand: 4.0, waste: 1.15, trigger: "phlebotomy_event", leadTimeDays: 7, shelfLifeDays: 1095, classOfSupply: "VIII" },
    { id: "mask",    name: "Surgical Mask",          unit: "ea",    category: "ppe", criticality: "medium", baseDemand: 1.5, waste: 1.10, trigger: "phlebotomy_event", leadTimeDays: 7, shelfLifeDays: 1825, classOfSupply: "VIII" },
    { id: "shield",  name: "Disposable Face Shield", unit: "ea",    category: "ppe", criticality: "medium", baseDemand: 0.5, waste: 1.05, trigger: "phlebotomy_event", leadTimeDays: 14, shelfLifeDays: 1825, classOfSupply: "VIII" },
    { id: "gown",    name: "Isolation Gown",         unit: "ea",    category: "ppe", criticality: "medium", baseDemand: 0.8, waste: 1.05, trigger: "phlebotomy_event", leadTimeDays: 10, shelfLifeDays: 1825, classOfSupply: "VIII" },
    { id: "n95",     name: "N95 Respirator",         unit: "ea",    category: "ppe", criticality: "high",   baseDemand: 1.0, waste: 1.10, trigger: "phlebotomy_event", leadTimeDays: 14, shelfLifeDays: 1825, classOfSupply: "VIII" },

    // ---- Other lab consumables / admin ----
    { id: "sharps",          name: "Sharps Container 2L",         unit: "ea", category: "other", criticality: "medium", baseDemand: 0.1, waste: 1.05, trigger: "phlebotomy_event", leadTimeDays: 14, shelfLifeDays: 3650, classOfSupply: "VIII" },
    { id: "centrifuge_tube", name: "Lab Centrifuge Tubes 15mL",   unit: "ea", category: "other", criticality: "low",    baseDemand: 1.0, waste: 1.05, trigger: "phlebotomy_event", leadTimeDays: 14, shelfLifeDays: 1825, classOfSupply: "VIII" },
    { id: "biohazard_bag",   name: "Biohazard Disposal Bags",     unit: "ea", category: "other", criticality: "low",    baseDemand: 0.6, waste: 1.05, trigger: "phlebotomy_event", leadTimeDays: 14, shelfLifeDays: 1825, classOfSupply: "VIII" },
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
      baseDemandPerEvent: r.baseDemand,
      wasteAdjustedDemand: r.baseDemand * r.waste,
      trigger: r.trigger,
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
      return {
        id,
        name: asString(r.name),
        type: asString(r.type, "Site"),
        latitude: asNumber(r.latitude),
        longitude: asNumber(r.longitude),
        population: asNumber(r.population, 0),
        optempo: asString(r.optempo, "garrison"),
        stockDays: Math.round(asNumber(r.stock_days, 30)),
        regionalHub: hubByAppNode.get(id) ?? null,
        upstreamNode: upstreamByAppNode.get(id) ?? null,
        countryCode: inferCountry(id, asString(r.name)),
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
    profileRows.map((r) => ({
      nodeId: asString(r.node_id),
      activeSupportedPopulation: Math.round(asNumber(r.active_supported_population)),
      dailyEncounterRate: asNumber(r.daily_encounter_rate),
      phlebotomyProbability: asNumber(r.phlebotomy_probability),
      specimensPerPhlebotomy: asNumber(r.specimens_per_phlebotomy, 1),
      operationalState: asString(r.operational_state, "garrison"),
      wasteFactor: asNumber(r.waste_factor, 1.1),
    })),
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
    const scale = operationalStressScale(meta.type, meta.optempo);
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
    const optempo = asString(node.optempo, "garrison");
    const depth = depthByType[type] ?? 1;
    const stress = operationalStressScale(type, optempo);
    for (const [itemId, base] of Object.entries(stockTargetByItem)) {
      if (sheetItemIds.has(itemId)) continue; // already covered by sheet
      const jitter = deterministicJitter(`${nodeId}:${itemId}`);
      const onHand = Math.max(0, Math.round(base * depth * stress * jitter));
      newBalances.push({ nodeId, itemId, onHand, dueIn: 0, dueOut: 0, allocated: 0 });
    }
  }
  await db.insert(inventoryBalances).values([...sheetBalances, ...newBalances]);

  // ---- Suppliers ----
  await db.insert(suppliers).values(
    SUPPLIER_DEFS.map((s) => ({
      id: s.id,
      name: s.name,
      channel: s.channel,
      country: s.country,
      leadTimeDaysMean: s.leadTimeDaysMean,
      reliabilityScore: s.reliabilityScore,
      notes: s.notes,
      itemsCovered: 8,
    })),
  );

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

  // ---- Settings + profile ----
  await db.insert(appSettings).values({});
  await db.insert(profiles).values({});

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

  // ---- Touch unused imports for typecheck ----
  void conversations;
  void conversationMessages;
  void scenarios;
  void recommendations;

  logger.info("seed complete");
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
  const now = Date.now();
  for (let i = 0; i < sample.length; i++) {
    const rec = sample[i]!;
    const orderId = `o-seed-${i}`;
    const orderNo = `PO-2026-${10000 + i}`;
    const supplierId = rec.sourceSupplierId ?? "dla-prime";
    const status = i < 2 ? "ACKNOWLEDGED" : i < 4 ? "IN_TRANSIT" : "SUBMITTED";
    const createdAt = new Date(now - (i + 1) * 4 * 3600_000);
    const requested = new Date(now + (rec.etaDays + 1) * 86400_000);
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
      notes: rec.reason,
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
    activityToInsert.push({
      ts: createdAt,
      kind: "ORDER_CREATED",
      actor: "operator",
      message: `Order ${orderNo} created for ${rec.nodeId}`,
      refType: "order",
      refId: orderId,
      meta: { totalUsd: rec.suggestedQty * 1.5, lines: 1 },
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
