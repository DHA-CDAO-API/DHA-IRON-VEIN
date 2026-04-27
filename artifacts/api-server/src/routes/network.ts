import { Router, type IRouter } from "express";
import { db, nodes, routes } from "@workspace/db";
import { computeRiskByNode, computeInFlightShipments, THREATS } from "../lib/snapshot";

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
    const [nodeRows, routeRows, risk, shipments] = await Promise.all([
      db.select().from(nodes),
      db.select().from(routes),
      computeRiskByNode(),
      computeInFlightShipments(),
    ]);
    res.json({
      generatedAt: new Date().toISOString(),
      nodes: nodeRows,
      routes: routeRows,
      shipments,
      riskByNode: risk.riskByNode,
      threats: THREATS,
      focusedHubId: risk.focusedHubId,
      operationalState: risk.operationalState,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
