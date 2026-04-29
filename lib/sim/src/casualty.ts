// Casualty-driven demand engine.
//
// Where `forecast.computeDailyDemand` is built around abstract encounters
// and phlebotomy events (a blood-only worldview), this module is built
// around concrete *patients* and their per-patient bill-of-materials.
//
// The engine is consumer-type agnostic: today the only consumer type is
// "patient", but the same shape works for vehicles, troops, etc. See
// `README-consumer-types.md` for the extension recipe.

import type { SimInventoryBalance, SimItem, SimSupplier, SimRoute, SimNode } from "./types";
import {
  computeStaffingDemand,
  ppeDemandToItemQuantities,
  type StaffingPatientInput,
  type StaffingResult,
} from "./staffing";
import { rankSuppliersForShortfall, type RecommendationAlternative } from "./recommendations";
import { findUpstreamRoute } from "./network";

export type PatientRequirementRow = {
  patientTypeId: string;
  itemId: string;
  quantityPerPatient: number;
};

export type PatientTypeMeta = {
  id: string;
  name: string;
  severity: string;
  avgClinicianMinutes: number;
};

export type CasualtyDemandInput = {
  // Patient counts keyed by patient_type id.
  patientCounts: Record<string, number>;
  // Hours over which the casualty load arrives (defaults to 48h).
  arrivalWindowHours: number;
  // Optional operator-entered ETA for the next major resupply, in hours
  // from "now". Used by the sufficiency check.
  resupplyEtaHours?: number;
};

export type CasualtyRequirementRow = {
  itemId: string;
  itemName: string;
  category: string;
  classOfSupply: string;
  unitOfIssue: string;
  commodityType: string;
  unspscCommodity: string;
  size: string;
  productNoun: string;
  // Sum of per-patient × patient-count, plus PPE attribution if applicable.
  requiredQty: number;
  // Whether this item came from the per-patient bill-of-materials, the
  // PPE staffing model, or both.
  source: "patient_bom" | "ppe_staffing" | "both";
};

export function computeCasualtyDemand(args: {
  input: CasualtyDemandInput;
  items: SimItem[];
  patientTypes: PatientTypeMeta[];
  patientRequirements: PatientRequirementRow[];
}): CasualtyRequirementRow[] {
  const itemById = new Map(args.items.map((i) => [i.id, i]));
  const patientById = new Map(args.patientTypes.map((p) => [p.id, p]));
  const requiredByItem = new Map<
    string,
    { qty: number; source: CasualtyRequirementRow["source"] }
  >();

  // 1) Per-patient bill-of-materials
  for (const req of args.patientRequirements) {
    const count = args.input.patientCounts[req.patientTypeId];
    if (!count || count <= 0) continue;
    const qty = count * req.quantityPerPatient;
    if (qty <= 0) continue;
    const cur = requiredByItem.get(req.itemId);
    if (cur) {
      requiredByItem.set(req.itemId, {
        qty: cur.qty + qty,
        source: cur.source === "ppe_staffing" ? "both" : cur.source,
      });
    } else {
      requiredByItem.set(req.itemId, { qty, source: "patient_bom" });
    }
  }

  // 2) PPE from the staffing model
  const staffingInputs: StaffingPatientInput[] = [];
  for (const [pid, count] of Object.entries(args.input.patientCounts)) {
    if (!count || count <= 0) continue;
    const meta = patientById.get(pid);
    if (!meta) continue;
    staffingInputs.push({
      patientTypeId: pid,
      count,
      avgClinicianMinutes: meta.avgClinicianMinutes,
    });
  }
  // Use the operator's arrival window as the "shift" so PPE scales with
  // event tempo rather than a baked-in number.
  const shiftHours = Math.max(4, Math.min(72, args.input.arrivalWindowHours));
  const staffing = computeStaffingDemand({
    patients: staffingInputs,
    shiftHours,
  });
  const ppeQuantities = ppeDemandToItemQuantities({
    ppeDemandByTag: staffing.ppeDemandByTag,
    items: args.items.map((i) => ({
      id: i.id,
      staffingTag: (i as { staffingTag?: string }).staffingTag,
    })),
  });
  for (const p of ppeQuantities) {
    const cur = requiredByItem.get(p.itemId);
    if (cur) {
      requiredByItem.set(p.itemId, {
        qty: cur.qty + p.quantity,
        source: cur.source === "patient_bom" ? "both" : cur.source,
      });
    } else {
      requiredByItem.set(p.itemId, {
        qty: p.quantity,
        source: "ppe_staffing",
      });
    }
  }

  const out: CasualtyRequirementRow[] = [];
  for (const [itemId, agg] of requiredByItem) {
    const it = itemById.get(itemId);
    if (!it) continue;
    out.push({
      itemId,
      itemName: it.name,
      category: (it as unknown as { category?: string }).category ?? "other",
      classOfSupply:
        (it as unknown as { classOfSupply?: string }).classOfSupply ?? "VIII",
      unitOfIssue: it.unitOfIssue,
      commodityType:
        (it as unknown as { commodityType?: string }).commodityType ?? "",
      unspscCommodity:
        (it as unknown as { unspscCommodity?: string }).unspscCommodity ?? "",
      size: (it as unknown as { size?: string }).size ?? "",
      productNoun:
        (it as unknown as { productNoun?: string }).productNoun ?? "",
      requiredQty: Math.ceil(agg.qty),
      source: agg.source,
    });
  }
  // Stable order: blood products first, then by item name.
  out.sort((a, b) => {
    const aBlood = a.category === "blood_products" ? 0 : 1;
    const bBlood = b.category === "blood_products" ? 0 : 1;
    if (aBlood !== bBlood) return aBlood - bBlood;
    return a.itemName.localeCompare(b.itemName);
  });
  return out;
}

// Sufficiency verdict per item.
export type SufficiencyVerdict = "green" | "amber" | "red";

export type SufficiencyRow = CasualtyRequirementRow & {
  onHand: number;
  inboundBeforeWindow: number;
  shortfallQty: number;
  verdict: SufficiencyVerdict;
  // For shortfalls: ranked supplier alternatives that *can* fill this item
  // ahead of the patient arrival window (best first).
  supplierAlternatives?: RecommendationAlternative[];
};

export type SiteSufficiencySummary = {
  totalRequiredItems: number;
  greenCount: number;
  amberCount: number;
  redCount: number;
  // Plain-English headline used by the UI ("Site can support" / "Site is
  // short on N items").
  verdict: string;
};

export type ShipmentArrival = {
  itemId: string;
  quantity: number;
  // Hours from "now" until the shipment lands. Inbound shipments arriving
  // after the patient window don't count toward sufficiency.
  hoursToArrival: number;
};

export function evaluateSiteSufficiency(args: {
  required: CasualtyRequirementRow[];
  onHandByItem: Record<string, number>;
  inbound: ShipmentArrival[];
  arrivalWindowHours: number;
  resupplyEtaHours?: number;
  // Optional supplier ranking inputs. When provided, each red row will be
  // augmented with `supplierAlternatives`.
  supplierContext?: {
    suppliers: SimSupplier[];
    upstreamRouteDays: number;
  };
}): { rows: SufficiencyRow[]; summary: SiteSufficiencySummary } {
  const horizonHours = args.resupplyEtaHours
    ? Math.min(args.arrivalWindowHours, args.resupplyEtaHours)
    : args.arrivalWindowHours;
  const inboundByItem = new Map<string, number>();
  for (const s of args.inbound) {
    if (s.hoursToArrival <= horizonHours) {
      inboundByItem.set(
        s.itemId,
        (inboundByItem.get(s.itemId) ?? 0) + s.quantity,
      );
    }
  }
  const rows: SufficiencyRow[] = args.required.map((r) => {
    const onHand = args.onHandByItem[r.itemId] ?? 0;
    const inbound = inboundByItem.get(r.itemId) ?? 0;
    const total = onHand + inbound;
    let verdict: SufficiencyVerdict;
    let shortfall = 0;
    if (total >= r.requiredQty) {
      verdict = onHand >= r.requiredQty ? "green" : "amber";
    } else {
      verdict = "red";
      shortfall = r.requiredQty - total;
    }
    const row: SufficiencyRow = {
      ...r,
      onHand,
      inboundBeforeWindow: inbound,
      shortfallQty: Math.ceil(shortfall),
      verdict,
    };
    if (verdict === "red" && args.supplierContext) {
      const horizonDays = Math.max(0.5, args.arrivalWindowHours / 24);
      row.supplierAlternatives = rankSuppliersForShortfall({
        itemId: r.itemId,
        suggestedQty: row.shortfallQty,
        shortfallHorizonDays: horizonDays,
        upstreamRouteDays: args.supplierContext.upstreamRouteDays,
        suppliers: args.supplierContext.suppliers,
      }).slice(0, 5);
    }
    return row;
  });
  const greenCount = rows.filter((r) => r.verdict === "green").length;
  const amberCount = rows.filter((r) => r.verdict === "amber").length;
  const redCount = rows.filter((r) => r.verdict === "red").length;
  const verdict =
    redCount === 0
      ? amberCount === 0
        ? "Site can support the casualty load"
        : `Site can support — ${amberCount} item${amberCount === 1 ? "" : "s"} reliant on inbound shipments`
      : `Site is short on ${redCount} item${redCount === 1 ? "" : "s"}`;
  return {
    rows,
    summary: {
      totalRequiredItems: rows.length,
      greenCount,
      amberCount,
      redCount,
      verdict,
    },
  };
}

// Patient rerouting suggestions.
//
// Score candidate sites by:
//   (a) supply sufficiency for the unmet patient subset,
//   (b) distance / route lead time from the original site,
//   (c) the candidate site's residual capacity after absorbing the patients.
//
// We don't model real MEDEVAC physics here — distance and the existing
// route lead-time table are stand-ins, and a candidate's "capacity" is
// proxied by its `population` field (a coarse but uniform metric).

export type PatientReroutePosture = "viable" | "stretched" | "unsuitable";

export type PatientRerouteCandidate = {
  nodeId: string;
  nodeName: string;
  countryCode?: string | null;
  distanceKm: number;
  estimatedTransitDays: number;
  posture: PatientReroutePosture;
  // 0..1 coverage score for the unmet patient subset's required materiel.
  supplyCoverage: number;
  // Residual surge capacity (patients) after absorbing the unmet load.
  residualCapacity: number;
  rationale: string;
};

function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function suggestPatientReroutes(args: {
  originSiteId: string;
  unmetPatientCounts: Record<string, number>;
  arrivalWindowHours: number;
  candidateSites: SimNode[];
  routes: SimRoute[];
  // Per-(site,item) on-hand snapshot for every candidate site.
  onHandBySiteItem: Record<string, Record<string, number>>;
  patientTypes: PatientTypeMeta[];
  patientRequirements: PatientRequirementRow[];
  items: SimItem[];
  // Per-patient capacity proxy: how many casualties a site can surge before
  // overrunning. Default = 5% of population.
  surgeCapacityFractionOfPopulation?: number;
  maxResults?: number;
}): PatientRerouteCandidate[] {
  const origin = args.candidateSites.find((n) => n.id === args.originSiteId);
  if (!origin) return [];
  const unmetCount = Object.values(args.unmetPatientCounts).reduce(
    (a, b) => a + b,
    0,
  );
  if (unmetCount <= 0) return [];

  const required = computeCasualtyDemand({
    input: {
      patientCounts: args.unmetPatientCounts,
      arrivalWindowHours: args.arrivalWindowHours,
    },
    items: args.items,
    patientTypes: args.patientTypes,
    patientRequirements: args.patientRequirements,
  });

  const surgeFraction = args.surgeCapacityFractionOfPopulation ?? 0.05;
  const candidates: PatientRerouteCandidate[] = [];
  for (const node of args.candidateSites) {
    if (node.id === args.originSiteId) continue;
    if ((node as unknown as { hiddenFromMap?: boolean }).hiddenFromMap)
      continue;
    // Filter to nodes that look like they could receive patients (has
    // population — i.e. a treatment node, not a depot/anchor).
    if (!node.population || node.population <= 0) continue;

    const onHand = args.onHandBySiteItem[node.id] ?? {};
    let coverableQty = 0;
    let totalRequiredQty = 0;
    for (const r of required) {
      totalRequiredQty += r.requiredQty;
      coverableQty += Math.min(r.requiredQty, onHand[r.itemId] ?? 0);
    }
    const supplyCoverage =
      totalRequiredQty > 0 ? coverableQty / totalRequiredQty : 1;

    const surgeCapacity = Math.floor(node.population * surgeFraction);
    const residualCapacity = surgeCapacity - unmetCount;

    // Try to find a known route between origin and candidate first; fall
    // back to straight-line distance + a 4 hr/100 km transit estimate.
    const route = args.routes.find(
      (r) =>
        (r.fromNode === origin.id && r.toNode === node.id) ||
        (r.fromNode === node.id && r.toNode === origin.id),
    );
    const distanceKm = Number(haversineKm(origin, node).toFixed(0));
    const estimatedTransitDays = route
      ? route.days
      : Number((distanceKm / 600).toFixed(2)); // rough air-MEDEVAC pace

    let posture: PatientReroutePosture = "viable";
    if (residualCapacity < 0 || supplyCoverage < 0.5) posture = "unsuitable";
    else if (residualCapacity < unmetCount * 0.25 || supplyCoverage < 0.85)
      posture = "stretched";

    const distanceClause =
      distanceKm < 1000
        ? `${distanceKm} km away`
        : `${(distanceKm / 1000).toFixed(1)} k km away`;
    const transitClause = `${estimatedTransitDays.toFixed(1)} d transit`;
    const coverageClause = `${Math.round(supplyCoverage * 100)}% supply coverage`;
    const capacityClause =
      residualCapacity >= 0
        ? `${residualCapacity} surge slots remain after absorbing ${unmetCount} patients`
        : `Over capacity by ${Math.abs(residualCapacity)} patients`;
    const rationale = `${distanceClause} · ${transitClause} · ${coverageClause} · ${capacityClause}`;

    candidates.push({
      nodeId: node.id,
      nodeName: node.name,
      countryCode: node.countryCode ?? null,
      distanceKm,
      estimatedTransitDays,
      posture,
      supplyCoverage: Number(supplyCoverage.toFixed(2)),
      residualCapacity,
      rationale,
    });
  }

  // Score: prefer viable > stretched > unsuitable, then high coverage,
  // short transit, ample residual capacity.
  const postureRank = (p: PatientReroutePosture) =>
    p === "viable" ? 0 : p === "stretched" ? 1 : 2;
  candidates.sort((a, b) => {
    const pr = postureRank(a.posture) - postureRank(b.posture);
    if (pr !== 0) return pr;
    const cov = b.supplyCoverage - a.supplyCoverage;
    if (Math.abs(cov) > 0.05) return cov;
    const tr = a.estimatedTransitDays - b.estimatedTransitDays;
    if (Math.abs(tr) > 0.2) return tr;
    return b.residualCapacity - a.residualCapacity;
  });
  return candidates.slice(0, args.maxResults ?? 5);
}

// Convenience helper: convert the existing inventoryBalances flat list
// into the per-(site,item) on-hand map expected by `suggestPatientReroutes`.
export function buildOnHandIndex(
  balances: SimInventoryBalance[],
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const b of balances) {
    if (!out[b.nodeId]) out[b.nodeId] = {};
    out[b.nodeId][b.itemId] = (out[b.nodeId][b.itemId] ?? 0) + b.onHand;
  }
  return out;
}
