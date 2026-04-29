import { Router, type IRouter } from "express";
import { db, nodes, routes, theaterZones, items as itemsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  computeRiskByNode,
  computeInFlightShipments,
  computeRouteCategories,
  THREATS,
  AOR_BOUNDARY,
} from "../lib/snapshot";
import { computeBloodReadinessByNode } from "../lib/blood-readiness";

// Hide supply-demo placeholder nodes from any endpoint that drives the
// network map. They live in the table so we have a real FK target for
// supply_demo_v2_facilities.node_id, but they have no real geography.
const VISIBLE_NODES_FILTER = eq(nodes.hiddenFromMap, false);

const router: IRouter = Router();

router.get("/network/nodes", async (_req, res, next) => {
  try {
    const rows = await db.select().from(nodes).where(VISIBLE_NODES_FILTER);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/network/routes", async (_req, res, next) => {
  try {
    const rows = await db.select().from(routes);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get("/network/snapshot", async (_req, res, next) => {
  try {
    const [
      nodeRows,
      routeRows,
      risk,
      shipments,
      routeCats,
      zoneRows,
      bloodReadinessByNode,
      itemRows,
    ] = await Promise.all([
      db.select().from(nodes).where(VISIBLE_NODES_FILTER),
      db.select().from(routes),
      computeRiskByNode(),
      computeInFlightShipments(),
      computeRouteCategories(),
      db.select().from(theaterZones).orderBy(desc(theaterZones.createdAt)),
      computeBloodReadinessByNode(),
      db.select().from(itemsTable),
    ]);
    const decoratedRoutes = routeRows.map((r) => ({
      ...r,
      categories: Array.from(routeCats.get(`${r.fromNode}::${r.toNode}`) ?? []),
    }));
    // Drop risk entries for hidden nodes so the snapshot's riskByNode array
    // exactly matches the visible nodes set returned above. computeRiskByNode
    // iterates every node in the sim context, including the hidden
    // supplyV2_* placeholders, so we filter at the wire boundary.
    const visibleNodeIds = new Set(nodeRows.map((n) => n.id));
    const filteredRisk = risk.riskByNode.filter((r) =>
      visibleNodeIds.has(r.nodeId),
    );
    const focusedHubId =
      risk.focusedHubId && visibleNodeIds.has(risk.focusedHubId)
        ? risk.focusedHubId
        : null;
    res.json({
      generatedAt: new Date().toISOString(),
      nodes: nodeRows,
      routes: decoratedRoutes,
      shipments,
      riskByNode: filteredRisk,
      threats: THREATS,
      zones: zoneRows.map((z) => ({
        ...z,
        createdAt: z.createdAt.toISOString(),
      })),
      aorBoundary: AOR_BOUNDARY,
      focusedHubId,
      operationalState: risk.operationalState,
      bloodReadinessByNode,
      // Lightweight catalog payload that drives the Network Map's
      // Layers panel (built-in sub-layer tree + custom layer builder).
      // Strips persistence-only columns the UI doesn't need.
      items: itemRows.map((i) => ({
        id: i.id,
        name: i.name,
        category: i.category,
        commodityType: i.commodityType,
        productNoun: i.productNoun,
        criticality: i.criticality,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------------------
// Theater zones — operator-drawn polygons that persist server-side and
// propagate to other clients via the snapshot endpoint.
// ----------------------------------------------------------------------------

router.get("/network/zones", async (_req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(theaterZones)
      .orderBy(desc(theaterZones.createdAt));
    res.json(
      rows.map((z) => ({ ...z, createdAt: z.createdAt.toISOString() })),
    );
  } catch (err) {
    next(err);
  }
});

const SEVERITY_VALUES = ["WATCH", "WARNING", "CRITICAL"] as const;

const CreateZoneInput = z.object({
  name: z.string().min(1).max(120),
  severity: z.enum(SEVERITY_VALUES).optional(),
  kind: z.string().min(1).max(40).optional(),
  polygon: z
    .array(z.array(z.number()).length(2))
    .min(3, "polygon needs at least 3 vertices"),
  notes: z.string().max(500).nullish(),
  createdBy: z.string().max(120).nullish(),
});

router.post("/network/zones", async (req, res, next) => {
  try {
    const parsed = CreateZoneInput.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid zone payload",
        details: parsed.error.flatten(),
      });
    }
    const data = parsed.data;
    // Ensure ring is closed (first == last)
    const poly = data.polygon.map((p) => [p[0], p[1]] as [number, number]);
    const first = poly[0];
    const last = poly[poly.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) poly.push([first[0], first[1]]);

    const id = `zn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const [row] = await db
      .insert(theaterZones)
      .values({
        id,
        name: data.name.trim(),
        severity: data.severity ?? "WATCH",
        kind: data.kind ?? "custom",
        polygon: poly,
        notes: data.notes ?? null,
        createdBy: data.createdBy ?? null,
      })
      .returning();
    res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
  } catch (err) {
    next(err);
  }
});

router.delete("/network/zones/:zoneId", async (req, res, next) => {
  try {
    await db.delete(theaterZones).where(eq(theaterZones.id, req.params.zoneId));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
