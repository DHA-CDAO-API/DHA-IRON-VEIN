import {
  db,
  procedures as proceduresTable,
  procedureSupplies,
  items as itemsTable,
} from "@workspace/db";
import type { CompanionItemEntry } from "./mappers";

export type CompanionItemsByItemId = Map<string, CompanionItemEntry[]>;

const TIER_WEIGHT: Record<string, number> = {
  primary: 0,
  secondary: 1,
  tertiary: 2,
};

/**
 * Build the "items used together" index used both by the predictive
 * recommendation list (so each rec carries the +N companion supplies it would
 * be bundled with on Promote) and the per-site recommendations panel.
 *
 * For a given itemId, returns every other item that shares at least one
 * procedure with it, tagged with the highest-priority tier the companion is
 * used at and a representative procedure name.
 */
export async function buildCompanionItemsByItemId(): Promise<CompanionItemsByItemId> {
  const [itemRows, procRows, supplyRows] = await Promise.all([
    db.select().from(itemsTable),
    db.select().from(proceduresTable),
    db.select().from(procedureSupplies),
  ]);

  const itemNamesById = new Map(itemRows.map((i) => [i.id, i.name]));
  const procedureNamesById = new Map(procRows.map((p) => [p.id, p.name]));

  const suppliesByProcedure = new Map<string, typeof supplyRows>();
  for (const s of supplyRows) {
    const list = suppliesByProcedure.get(s.procedureId) ?? [];
    list.push(s);
    suppliesByProcedure.set(s.procedureId, list);
  }

  const proceduresByItemId = new Map<string, string[]>();
  for (const s of supplyRows) {
    const list = proceduresByItemId.get(s.itemId) ?? [];
    list.push(s.procedureId);
    proceduresByItemId.set(s.itemId, list);
  }

  const out: CompanionItemsByItemId = new Map();
  for (const [itemId, procIds] of proceduresByItemId) {
    const seen = new Map<string, CompanionItemEntry>();
    for (const procId of procIds) {
      for (const sib of suppliesByProcedure.get(procId) ?? []) {
        if (sib.itemId === itemId) continue;
        const prev = seen.get(sib.itemId);
        const cand: CompanionItemEntry = {
          itemId: sib.itemId,
          itemName: itemNamesById.get(sib.itemId) ?? sib.itemId,
          tier: sib.tier as "primary" | "secondary" | "tertiary",
          procedureId: procId,
          procedureName: procedureNamesById.get(procId) ?? procId,
          quantityPerEvent: sib.quantityPerEvent,
        };
        if (
          !prev ||
          (TIER_WEIGHT[cand.tier] ?? 9) < (TIER_WEIGHT[prev.tier] ?? 9)
        ) {
          seen.set(sib.itemId, cand);
        }
      }
    }
    const sorted = Array.from(seen.values()).sort((a, b) => {
      const ta = TIER_WEIGHT[a.tier] ?? 9;
      const tb = TIER_WEIGHT[b.tier] ?? 9;
      if (ta !== tb) return ta - tb;
      return a.itemName.localeCompare(b.itemName);
    });
    if (sorted.length > 0) out.set(itemId, sorted);
  }
  return out;
}
