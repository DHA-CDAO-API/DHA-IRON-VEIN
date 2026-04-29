import {
  db,
  patientTypes,
  patientItemRequirements,
  eventTypes,
  eventPatientMix,
} from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

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

export type CasualtyReferenceSeedResult = {
  inserted: boolean;
  patientTypes: number;
  patientItemRequirements: number;
  eventTypes: number;
  eventPatientMix: number;
};

// Idempotent self-heal for the four casualty reference tables. When a DB
// is partially restored (or only those tables are wiped), this re-populates
// them without touching anything else. Insertion happens inside a single
// transaction so a mid-run failure can't leave a half-populated state.
//
// Each table is checked independently — if any one of the four is empty
// we re-insert just that table's rows. The expected steady-state is "all
// four populated", so a partial wipe (e.g. just `event_types`) still heals.
export async function seedCasualtyReferenceData(): Promise<CasualtyReferenceSeedResult> {
  return await db.transaction(async (tx) => {
    // Run the four count probes sequentially. Drizzle/pg's transaction
    // client serialises queries on a single connection, so issuing them
    // via Promise.all triggers a "client.query() while already executing"
    // deprecation warning in pg@9. Sequential awaits avoid that and have
    // negligible cost (4 cheap COUNT(*)s on tiny reference tables).
    const [{ count: ptCount } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(patientTypes);
    const [{ count: prCount } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(patientItemRequirements);
    const [{ count: etCount } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(eventTypes);
    const [{ count: emCount } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(eventPatientMix);

    const result: CasualtyReferenceSeedResult = {
      inserted: false,
      patientTypes: ptCount,
      patientItemRequirements: prCount,
      eventTypes: etCount,
      eventPatientMix: emCount,
    };

    if (ptCount === 0) {
      await tx.insert(patientTypes).values(PATIENT_TYPES);
      result.patientTypes = PATIENT_TYPES.length;
      result.inserted = true;
    }

    if (prCount === 0) {
      await tx.insert(patientItemRequirements).values(
        REQS.map(([patientTypeId, itemId, qty]) => ({
          patientTypeId,
          itemId,
          quantityPerPatient: qty,
          notes: "",
        })),
      );
      result.patientItemRequirements = REQS.length;
      result.inserted = true;
    }

    if (etCount === 0) {
      await tx.insert(eventTypes).values(EVENT_TYPES);
      result.eventTypes = EVENT_TYPES.length;
      result.inserted = true;
    }

    if (emCount === 0) {
      await tx.insert(eventPatientMix).values(
        MIX.map(([eventTypeId, patientTypeId, defaultShare]) => ({
          eventTypeId,
          patientTypeId,
          defaultShare,
        })),
      );
      result.eventPatientMix = MIX.length;
      result.inserted = true;
    }

    return result;
  });
}

// Wrapper that logs the outcome at the right level. Safe to call on
// every server boot — when the four tables are already populated the
// helper is a no-op and we log nothing above debug.
export async function ensureCasualtyReferenceDataSeeded(): Promise<void> {
  try {
    const r = await seedCasualtyReferenceData();
    if (r.inserted) {
      logger.info(
        {
          patientTypes: r.patientTypes,
          patientItemRequirements: r.patientItemRequirements,
          eventTypes: r.eventTypes,
          eventPatientMix: r.eventPatientMix,
        },
        "Casualty reference data was empty — seeded patient types, requirements, event types, and mix",
      );
    } else {
      logger.debug(
        {
          patientTypes: r.patientTypes,
          patientItemRequirements: r.patientItemRequirements,
          eventTypes: r.eventTypes,
          eventPatientMix: r.eventPatientMix,
        },
        "Casualty reference data already populated — skipping self-heal",
      );
    }
  } catch (err) {
    // Never block boot on a healed-data check. Log loudly so it's
    // visible, but let the server keep coming up.
    logger.error(
      { err },
      "Casualty reference data self-heal failed — server will continue starting",
    );
  }
}
