import { Router, type IRouter } from "express";
import {
  computeNodeBloodReadiness,
  computeTheaterBloodReadiness,
  listRecentTemperatureEvents,
} from "../lib/blood-readiness";

const router: IRouter = Router();

router.get("/sites/:nodeId/blood-readiness", async (req, res, next) => {
  try {
    const result = await computeNodeBloodReadiness(req.params.nodeId);
    if (!result) return res.status(404).json({ error: "node not found" });
    const events = await listRecentTemperatureEvents(req.params.nodeId, 10);
    res.json({
      ...result,
      recentTemperatureEvents: events.map((e) => ({
        id: e.id,
        assetId: e.assetId,
        nodeId: e.nodeId,
        occurredAt: e.occurredAt.toISOString(),
        recordedTempC: e.recordedTempC,
        severity: e.severity,
        resolvedAt: e.resolvedAt ? e.resolvedAt.toISOString() : null,
        notes: e.notes,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/blood-readiness", async (_req, res, next) => {
  try {
    const result = await computeTheaterBloodReadiness();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
