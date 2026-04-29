// Clinician + PPE staffing model.
//
// Given a vector of patients-by-type, estimate how many clinicians are
// needed by role (surgeon, nurse, tech) and what PPE that implies over a
// shift. PPE demand is derived from clinician_count × shift_duration ×
// procedure_intensity × per-clinician-per-shift PPE rate, NOT hard-coded
// per item id.
//
// PPE items are looked up via the `staffingTag` column on the items table
// (e.g. "ppe:gloves", "ppe:mask", "ppe:gown", "ppe:eye"), so a future
// contributor can swap in different PPE skus without touching this file.

import type { SimItem } from "./types";

export type ClinicianRole = "surgeon" | "nurse" | "tech";

export type StaffingPatientWeight = {
  // 0..1 weight describing how much of this patient's care is performed
  // by each role. Weights don't need to sum to 1 — they're applied as
  // ratios to convert avgClinicianMinutes into role-specific minutes.
  surgeon: number;
  nurse: number;
  tech: number;
  // Procedure intensity multiplier. Higher = more PPE changes per
  // clinician hour (e.g. major trauma surgery vs. routine triage).
  intensity: number;
};

export const DEFAULT_PATIENT_WEIGHTS: Record<string, StaffingPatientWeight> = {
  trauma_critical: { surgeon: 0.6, nurse: 0.3, tech: 0.1, intensity: 1.8 },
  trauma_severe: { surgeon: 0.55, nurse: 0.35, tech: 0.1, intensity: 1.6 },
  trauma_moderate: { surgeon: 0.25, nurse: 0.5, tech: 0.25, intensity: 1.2 },
  trauma_minor: { surgeon: 0.05, nurse: 0.55, tech: 0.4, intensity: 0.8 },
  burn_severe: { surgeon: 0.4, nurse: 0.45, tech: 0.15, intensity: 1.5 },
  burn: { surgeon: 0.4, nurse: 0.45, tech: 0.15, intensity: 1.5 },
  pediatric_trauma: { surgeon: 0.3, nurse: 0.55, tech: 0.15, intensity: 1.4 },
  pediatric: { surgeon: 0.2, nurse: 0.6, tech: 0.2, intensity: 1.0 },
  medical_acute: { surgeon: 0.1, nurse: 0.6, tech: 0.3, intensity: 0.9 },
  medical_chronic: { surgeon: 0.05, nurse: 0.55, tech: 0.4, intensity: 0.6 },
  medical_disease: { surgeon: 0.05, nurse: 0.6, tech: 0.35, intensity: 0.7 },
  obstetric: { surgeon: 0.3, nurse: 0.55, tech: 0.15, intensity: 1.0 },
  ob: { surgeon: 0.3, nurse: 0.55, tech: 0.15, intensity: 1.0 },
  minor_outpatient: { surgeon: 0.0, nurse: 0.5, tech: 0.5, intensity: 0.4 },
  routine: { surgeon: 0.0, nurse: 0.5, tech: 0.5, intensity: 0.4 },
};

export type StaffingPatientInput = {
  patientTypeId: string;
  count: number;
  // Average minutes of clinician time per patient (from patient_types).
  avgClinicianMinutes: number;
};

export type StaffingResult = {
  clinicians: Record<ClinicianRole, number>;
  // Total clinician-hours across all roles. Used to drive PPE demand.
  totalClinicianHours: number;
  // Per-PPE-tag demand. Keys are tag names like "ppe:gloves"; values are
  // estimated unit counts needed across the shift.
  ppeDemandByTag: Record<string, number>;
};

// Per-clinician-hour PPE consumption rate (units/hour), scaled by
// procedure intensity. These are deliberately conservative.
const PPE_RATE_PER_CLINICIAN_HOUR: Record<string, number> = {
  "ppe:gloves": 4, // pairs (gloves go on/off frequently)
  "ppe:mask": 1.0,
  "ppe:gown": 0.6,
  "ppe:eye": 0.25, // face shields / goggles
};

export function computeStaffingDemand(args: {
  patients: StaffingPatientInput[];
  shiftHours?: number;
  // Optional override of per-patient role weights. Falls back to the
  // baked-in DEFAULT_PATIENT_WEIGHTS keyed by patient_type id, then to a
  // generic mixed-care weight if the id is unknown.
  weightsByPatientType?: Record<string, StaffingPatientWeight>;
}): StaffingResult {
  const shift = args.shiftHours ?? 12;
  const weights = args.weightsByPatientType ?? DEFAULT_PATIENT_WEIGHTS;
  const fallback: StaffingPatientWeight = {
    surgeon: 0.2,
    nurse: 0.5,
    tech: 0.3,
    intensity: 1,
  };

  const clinicianMinutes: Record<ClinicianRole, number> = {
    surgeon: 0,
    nurse: 0,
    tech: 0,
  };
  let totalIntensityHours = 0;

  for (const p of args.patients) {
    if (p.count <= 0 || p.avgClinicianMinutes <= 0) continue;
    const w = weights[p.patientTypeId] ?? fallback;
    const totalMinutes = p.count * p.avgClinicianMinutes;
    clinicianMinutes.surgeon += totalMinutes * w.surgeon;
    clinicianMinutes.nurse += totalMinutes * w.nurse;
    clinicianMinutes.tech += totalMinutes * w.tech;
    // intensity-weighted hours for PPE
    totalIntensityHours += (totalMinutes / 60) * w.intensity;
  }

  // Convert minutes-of-care into headcount: (minutes / 60) hours of
  // clinician time, divided by shift hours, rounded up.
  const clinicians: Record<ClinicianRole, number> = {
    surgeon: Math.ceil(clinicianMinutes.surgeon / 60 / shift),
    nurse: Math.ceil(clinicianMinutes.nurse / 60 / shift),
    tech: Math.ceil(clinicianMinutes.tech / 60 / shift),
  };

  const totalClinicianHours = Number(
    (
      clinicianMinutes.surgeon / 60 +
      clinicianMinutes.nurse / 60 +
      clinicianMinutes.tech / 60
    ).toFixed(1),
  );

  const ppeDemandByTag: Record<string, number> = {};
  for (const [tag, rate] of Object.entries(PPE_RATE_PER_CLINICIAN_HOUR)) {
    // Use intensity-weighted hours so hot cases (severe trauma, burn) drive
    // more PPE turn-over than the same number of routine encounters.
    ppeDemandByTag[tag] = Math.ceil(totalIntensityHours * rate);
  }

  return { clinicians, totalClinicianHours, ppeDemandByTag };
}

// Resolve PPE demand keyed by tag into per-item quantities. An item is
// assigned a tag's demand if its `staffingTag` equals the tag exactly. If
// multiple items share a tag, demand is split evenly across them.
export function ppeDemandToItemQuantities(args: {
  ppeDemandByTag: Record<string, number>;
  items: Array<{ id: string; staffingTag?: string | null }>;
}): Array<{ itemId: string; quantity: number }> {
  const itemsByTag = new Map<string, string[]>();
  const list = Array.isArray(args.items) ? args.items : [];
  for (const it of list) {
    const tag = (it.staffingTag ?? "").trim();
    if (!tag) continue;
    if (!itemsByTag.has(tag)) itemsByTag.set(tag, []);
    itemsByTag.get(tag)!.push(it.id);
  }
  const out: Array<{ itemId: string; quantity: number }> = [];
  for (const [tag, qty] of Object.entries(args.ppeDemandByTag)) {
    const ids = itemsByTag.get(tag) ?? [];
    if (ids.length === 0 || qty <= 0) continue;
    const share = qty / ids.length;
    for (const id of ids) {
      out.push({ itemId: id, quantity: Math.ceil(share) });
    }
  }
  return out;
}
