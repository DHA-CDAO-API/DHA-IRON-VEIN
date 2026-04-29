import {
  pgTable,
  text,
  doublePrecision,
  integer,
  primaryKey,
} from "drizzle-orm/pg-core";

// A patient archetype consumed by the casualty-driven readiness model. Each
// patient type has a per-patient bill-of-materials in
// `patient_item_requirements` and is the primary "consumer" for medical
// supplies. The same pattern (consumer type + per-consumer requirements)
// is meant to be reused later for vehicle types, troop types, etc.
export const patientTypes = pgTable("patient_types", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // critical | severe | moderate | minor | routine
  severity: text("severity").notNull().default("moderate"),
  // surgical | medical | mixed
  careCategory: text("care_category").notNull().default("mixed"),
  // Average minutes of clinician time required per patient. Drives the
  // staffing model (which in turn drives PPE demand).
  avgClinicianMinutes: integer("avg_clinician_minutes").notNull().default(60),
  description: text("description").notNull().default(""),
});

// Per-patient bill-of-materials. A row says: "one patient of patientTypeId
// requires `quantityPerPatient` of `itemId` over the course of their care".
export const patientItemRequirements = pgTable(
  "patient_item_requirements",
  {
    patientTypeId: text("patient_type_id").notNull(),
    itemId: text("item_id").notNull(),
    quantityPerPatient: doublePrecision("quantity_per_patient")
      .notNull()
      .default(0),
    notes: text("notes").notNull().default(""),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.patientTypeId, t.itemId] }),
  }),
);

// Event archetypes (Earthquake, Typhoon, Major Combat, ...). Each event
// has a default mix of patient types in `event_patient_mix`.
export const eventTypes = pgTable("event_types", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // natural-disaster | conflict | other
  category: text("category").notNull().default("other"),
  description: text("description").notNull().default(""),
  // Default arrival window in hours used when an operator hasn't entered
  // a patient curve manually. The casualty planner treats this as the
  // "by when do we need this materiel on hand" horizon.
  defaultArrivalWindowHours: integer("default_arrival_window_hours")
    .notNull()
    .default(48),
});

// Default patient-type mix per event. `defaultShare` is a 0..1 weight; the
// shares for an event don't need to sum to exactly 1 — the UI normalizes.
export const eventPatientMix = pgTable(
  "event_patient_mix",
  {
    eventTypeId: text("event_type_id").notNull(),
    patientTypeId: text("patient_type_id").notNull(),
    defaultShare: doublePrecision("default_share").notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.eventTypeId, t.patientTypeId] }),
  }),
);

export type PatientType = typeof patientTypes.$inferSelect;
export type PatientItemRequirement =
  typeof patientItemRequirements.$inferSelect;
export type EventType = typeof eventTypes.$inferSelect;
export type EventPatientMixRow = typeof eventPatientMix.$inferSelect;
