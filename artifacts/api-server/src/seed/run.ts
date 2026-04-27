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

const PRESET_EVENTS = [
  {
    id: "ev-typhoon-southhub",
    name: "Typhoon Yagi-class — Southern Spoke",
    kind: "natural_disaster",
    summary: "Cat-4 typhoon saturates the southern spoke; civilian-assist demand and waste both rise sharply for 14 days.",
    durationDays: 14,
    parameters: {
      affectedNodes: ["southHub", "mtfRomeo", "mtfUniform", "basCopper"],
      encounterMultiplier: 1.6,
      populationMultiplier: 1.1,
      wasteMultiplier: 1.3,
      routeReliabilityDelta: -0.25,
      routeDelayDays: 3,
    },
  },
  {
    id: "ev-port-closure-central",
    name: "Port Closure — Central Hub",
    kind: "infra_disruption",
    summary: "Naha-class port closure blocks the primary surface route into the central regional hub for 5 days.",
    durationDays: 5,
    parameters: {
      affectedNodes: ["centralHub", "mtfEcho", "mtfHotel", "mtfKilo"],
      routeReliabilityDelta: -0.4,
      routeDelayDays: 4,
      encounterMultiplier: 1.05,
    },
  },
  {
    id: "ev-mascal-theater",
    name: "MASCAL — Theater Medical Hub",
    kind: "mass_casualty",
    summary: "Multi-vehicle incident drives a 72-hour MASCAL surge at the theater hub; phlebotomy and trauma kits spike.",
    durationDays: 4,
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
    summary: "Adversary maritime activity in the SCS corridor forces reroutes; 7-day reliability hit across forward sites.",
    durationDays: 7,
    parameters: {
      affectedNodes: ["southHub", "centralHub", "basCopper", "basIron", "basZinc", "basSteel"],
      routeReliabilityDelta: -0.35,
      routeDelayDays: 5,
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
      routes, nodes, catalog_entries, app_settings, profiles
      RESTART IDENTITY`);
  }

  // ---- Items ----
  const itemRows = readSheetAsObjects(wb, "Items", [
    "id",
    "name",
    "unit",
    "base_demand_per_event",
    "waste_adjusted_demand",
    "trigger",
    "criticality",
  ]);
  await db.insert(items).values(
    itemRows.map((r) => ({
      id: asString(r.id),
      name: asString(r.name),
      niinOrSku: "",
      unitOfIssue: asString(r.unit, "ea"),
      classOfSupply: "VIII",
      mandatory: true,
      criticality: asString(r.criticality, "medium"),
      leadTimeDays: 7,
      shelfLifeDays: 365,
      baseDemandPerEvent: asNumber(r.base_demand_per_event, 1),
      wasteAdjustedDemand: asNumber(r.waste_adjusted_demand, 1),
      trigger: asString(r.trigger, "phlebotomy_event"),
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
  await db.insert(inventoryBalances).values(
    balanceRows.map((r) => {
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
    }),
  );

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

  // ---- Generate alerts from current DOS ----
  await generateBootstrapAlerts();

  // ---- Generate sample orders ----
  await generateSampleOrders();

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
  const now = Date.now();
  for (let i = 0; i < sample.length; i++) {
    const rec = sample[i]!;
    const orderId = `o-seed-${i}`;
    const orderNo = `PO-2026-${10000 + i}`;
    const supplierId = rec.sourceSupplierId ?? "dla-prime";
    const status = i < 2 ? "ACKNOWLEDGED" : i < 4 ? "IN_TRANSIT" : "SUBMITTED";
    const requested = new Date(now + (rec.etaDays + 1) * 86400_000);
    ordersToInsert.push({
      id: orderId,
      orderNo,
      nodeId: rec.nodeId,
      supplierId,
      status,
      priority: rec.kind === "ESCALATE" ? "FLASH" : rec.kind === "REROUTE" ? "URGENT" : "ROUTINE",
      createdAt: new Date(now - (i + 1) * 4 * 3600_000),
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
      shipmentsToInsert.push({
        id: `sh-seed-${i}`,
        orderId,
        fromNode: supplierId,
        toNode: rec.nodeId,
        itemId: rec.itemId,
        quantity: rec.suggestedQty,
        departedAt: new Date(now - 2 * 86400_000),
        etaAt: new Date(now + (rec.etaDays - 2) * 86400_000),
        priority: rec.kind === "ESCALATE" ? "FLASH" : rec.kind === "REROUTE" ? "URGENT" : "ROUTINE",
      });
    }
  }
  if (ordersToInsert.length > 0) await db.insert(orders).values(ordersToInsert);
  if (linesToInsert.length > 0) await db.insert(orderLines).values(linesToInsert);
  if (shipmentsToInsert.length > 0) await db.insert(shipments).values(shipmentsToInsert);
}
