import { Router, type IRouter } from "express";
import { db, nodes, routes, theaterZones } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  computeRiskByNode,
  computeInFlightShipments,
  computeRouteCategories,
  THREATS,
  AOR_BOUNDARY,
} from "../lib/snapshot";

const router: IRouter = Router();

router.get("/network/nodes", async (_req, res, next) => {
  try {
    const rows = await db.select().from(nodes);
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
    const [nodeRows, routeRows, risk, shipments, routeCats, zoneRows] =
      await Promise.all([
        db.select().from(nodes),
        db.select().from(routes),
        computeRiskByNode(),
        computeInFlightShipments(),
        computeRouteCategories(),
        db.select().from(theaterZones).orderBy(desc(theaterZones.createdAt)),
      ]);
    const decoratedRoutes = routeRows.map((r) => ({
      ...r,
      categories: Array.from(routeCats.get(`${r.fromNode}::${r.toNode}`) ?? []),
    }));
    res.json({
      generatedAt: new Date().toISOString(),
      nodes: nodeRows,
      routes: decoratedRoutes,
      shipments,
      riskByNode: risk.riskByNode,
      threats: THREATS,
      zones: zoneRows.map((z) => ({
        ...z,
        createdAt: z.createdAt.toISOString(),
      })),
      aorBoundary: AOR_BOUNDARY,
      focusedHubId: risk.focusedHubId,
      operationalState: risk.operationalState,
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
