import { pgTable, text, integer, doublePrecision, primaryKey } from "drizzle-orm/pg-core";

/**
 * Clinician-curated medical procedures (read-only library in this task).
 * Each procedure is a clinical activity (transfusion, phlebotomy, IV access,
 * etc.) that consumes a known set of supplies grouped into Primary,
 * Secondary, and Tertiary tiers.
 */
export const procedures = pgTable("procedures", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  clinicalCategory: text("clinical_category").notNull().default("general"),
});

/**
 * The supply kit for a procedure. One row per (procedure, item) pair.
 *
 * tier: "primary"   — must-have; mission stops without it.
 *       "secondary" — strongly recommended; accepted standard of care.
 *       "tertiary"  — nice-to-have; improves safety/comfort.
 *
 * quantityPerEvent is the typical number of units consumed per single
 * execution of the procedure. Used as a scaling hint when bundling
 * Primary-tier dependents into a recommendation order.
 */
export const procedureSupplies = pgTable(
  "procedure_supplies",
  {
    procedureId: text("procedure_id").notNull(),
    itemId: text("item_id").notNull(),
    tier: text("tier").notNull(),
    quantityPerEvent: doublePrecision("quantity_per_event").notNull().default(1),
    notes: text("notes").notNull().default(""),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.procedureId, t.itemId] }),
  }),
);

/**
 * Echelon of care tags. role values: "role_1" (aid station),
 * "role_2" (forward surgical), "role_3" (combat support hospital).
 * A procedure can be performed at multiple Roles.
 */
export const procedureRoles = pgTable(
  "procedure_roles",
  {
    procedureId: text("procedure_id").notNull(),
    role: text("role").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.procedureId, t.role] }),
  }),
);

export type Procedure = typeof procedures.$inferSelect;
export type ProcedureSupply = typeof procedureSupplies.$inferSelect;
export type ProcedureRole = typeof procedureRoles.$inferSelect;
