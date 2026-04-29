import { Router, type IRouter } from "express";
import {
  db,
  procedures as proceduresTable,
  procedureSupplies,
  procedureRoles,
  items as itemsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const router: IRouter = Router();

const VALID_ROLES = new Set(["role_1", "role_2", "role_3"]);

/**
 * GET /procedures — list the clinician-curated procedure library, optionally
 * filtered by role. Each entry includes a supply-tier roll-up so the rail
 * card can show "5 primary / 3 secondary / 1 tertiary" at a glance without
 * a follow-up fetch.
 */
router.get("/procedures", async (req, res, next) => {
  try {
    const roleFilter =
      typeof req.query.role === "string" && VALID_ROLES.has(req.query.role)
        ? req.query.role
        : undefined;

    const [procRows, supplyRows, roleRows] = await Promise.all([
      db.select().from(proceduresTable),
      db.select().from(procedureSupplies),
      db.select().from(procedureRoles),
    ]);

    const rolesByProcedure = new Map<string, string[]>();
    for (const r of roleRows) {
      const list = rolesByProcedure.get(r.procedureId) ?? [];
      list.push(r.role);
      rolesByProcedure.set(r.procedureId, list);
    }

    const tierCountsByProcedure = new Map<
      string,
      { primary: number; secondary: number; tertiary: number }
    >();
    for (const s of supplyRows) {
      const counts =
        tierCountsByProcedure.get(s.procedureId) ?? {
          primary: 0,
          secondary: 0,
          tertiary: 0,
        };
      if (s.tier === "primary") counts.primary += 1;
      else if (s.tier === "secondary") counts.secondary += 1;
      else if (s.tier === "tertiary") counts.tertiary += 1;
      tierCountsByProcedure.set(s.procedureId, counts);
    }

    const summaries = procRows
      .map((p) => {
        const roles = (rolesByProcedure.get(p.id) ?? []).sort();
        const counts = tierCountsByProcedure.get(p.id) ?? {
          primary: 0,
          secondary: 0,
          tertiary: 0,
        };
        return {
          id: p.id,
          slug: p.slug,
          name: p.name,
          description: p.description,
          clinicalCategory: p.clinicalCategory,
          roles,
          primaryCount: counts.primary,
          secondaryCount: counts.secondary,
          tertiaryCount: counts.tertiary,
        };
      })
      .filter((s) => (roleFilter ? s.roles.includes(roleFilter) : true))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json(summaries);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /procedures/:procedureId — full detail for a single procedure with
 * tiered supplies and (optional) on-hand counts at a specified node.
 */
router.get("/procedures/:procedureId", async (req, res, next) => {
  try {
    const procedureId = req.params.procedureId;

    const [procRow] = await db
      .select()
      .from(proceduresTable)
      .where(eq(proceduresTable.id, procedureId));
    if (!procRow) return res.status(404).json({ error: "procedure not found" });

    const [supplyRows, roleRows] = await Promise.all([
      db
        .select()
        .from(procedureSupplies)
        .where(eq(procedureSupplies.procedureId, procedureId)),
      db
        .select()
        .from(procedureRoles)
        .where(eq(procedureRoles.procedureId, procedureId)),
    ]);

    const itemIds = supplyRows.map((s) => s.itemId);
    const itemRows =
      itemIds.length > 0
        ? await db.select().from(itemsTable).where(inArray(itemsTable.id, itemIds))
        : [];
    const itemById = new Map(itemRows.map((it) => [it.id, it]));

    const tierOrder: Record<string, number> = {
      primary: 0,
      secondary: 1,
      tertiary: 2,
    };
    const supplies = supplyRows
      .map((s) => {
        const it = itemById.get(s.itemId);
        return {
          itemId: s.itemId,
          itemName: it?.name ?? s.itemId,
          unit: it?.unitOfIssue ?? null,
          category: it?.category ?? null,
          criticality: it?.criticality ?? null,
          tier: s.tier,
          quantityPerEvent: s.quantityPerEvent,
          notes: s.notes || null,
        };
      })
      .sort((a, b) => {
        const ta = tierOrder[a.tier] ?? 99;
        const tb = tierOrder[b.tier] ?? 99;
        if (ta !== tb) return ta - tb;
        return a.itemName.localeCompare(b.itemName);
      });

    res.json({
      id: procRow.id,
      slug: procRow.slug,
      name: procRow.name,
      description: procRow.description,
      clinicalCategory: procRow.clinicalCategory,
      roles: roleRows.map((r) => r.role).sort(),
      supplies,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /items/:itemId/procedures — reverse lookup. Which procedures use this
 * item, and at what tier? Powers the "Companion supplies" panel in the New
 * Order dialog and the "+N companion supplies" chip on the recommendation
 * card.
 */
router.get("/items/:itemId/procedures", async (req, res, next) => {
  try {
    const itemId = req.params.itemId;
    const supplyRows = await db
      .select()
      .from(procedureSupplies)
      .where(eq(procedureSupplies.itemId, itemId));
    const procIds = Array.from(new Set(supplyRows.map((s) => s.procedureId)));
    if (procIds.length === 0) return res.json([]);

    const [procRows, roleRows] = await Promise.all([
      db.select().from(proceduresTable).where(inArray(proceduresTable.id, procIds)),
      db.select().from(procedureRoles).where(inArray(procedureRoles.procedureId, procIds)),
    ]);
    const procById = new Map(procRows.map((p) => [p.id, p]));
    const rolesByProcedure = new Map<string, string[]>();
    for (const r of roleRows) {
      const list = rolesByProcedure.get(r.procedureId) ?? [];
      list.push(r.role);
      rolesByProcedure.set(r.procedureId, list);
    }
    const tierOrder: Record<string, number> = {
      primary: 0,
      secondary: 1,
      tertiary: 2,
    };
    const usages = supplyRows
      .map((s) => {
        const p = procById.get(s.procedureId);
        return {
          procedureId: s.procedureId,
          procedureName: p?.name ?? s.procedureId,
          slug: p?.slug ?? s.procedureId,
          tier: s.tier,
          quantityPerEvent: s.quantityPerEvent,
          roles: (rolesByProcedure.get(s.procedureId) ?? []).sort(),
        };
      })
      .sort((a, b) => {
        const ta = tierOrder[a.tier] ?? 99;
        const tb = tierOrder[b.tier] ?? 99;
        if (ta !== tb) return ta - tb;
        return a.procedureName.localeCompare(b.procedureName);
      });

    res.json(usages);
  } catch (err) {
    next(err);
  }
});

export default router;
