import { Router, type IRouter } from "express";
import { db, alerts, activityEntries, type Alert as DbAlert } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";

const router: IRouter = Router();

// Map a DB alert row to the public Alert shape consumed by the UI and
// described in the OpenAPI spec. The DB stores raw operational fields
// (severity in screaming snake case, a single `message` blob, openedAt
// timestamps, ACK status code), but the UI works in spec-friendly shape
// (lowercase severity/status, title + body, createdAt, acknowledgedAt).
// Without this mapper the React side reads `alert.title` / `alert.body`
// / `alert.createdAt` from raw rows and renders blanks plus
// "Invalid Date" everywhere it shows alerts.
const SEVERITY_MAP: Record<string, "critical" | "warn" | "info" | "watch"> = {
  CRITICAL: "critical",
  WARNING: "warn",
  WARN: "warn",
  INFO: "info",
  WATCH: "watch",
};

const STATUS_MAP: Record<string, "open" | "acknowledged" | "resolved"> = {
  OPEN: "open",
  ACK: "acknowledged",
  ACKED: "acknowledged",
  ACKNOWLEDGED: "acknowledged",
  RESOLVED: "resolved",
  CLOSED: "resolved",
};

const CATEGORY_TITLE: Record<string, string> = {
  DOS_SHORTFALL: "Days-of-Supply Shortfall",
  COLD_CHAIN: "Cold-Chain Integrity",
  ROUTE_DELAY: "Route Disruption",
  ROUTE_DEGRADATION: "Route Degradation",
  REAGENT: "Reagent Cascade Risk",
  AIRLIFT: "Airlift Window Slip",
  STOCK_OUT: "Stock-Out Imminent",
  WASTE: "Waste-Spike Detected",
  SUPPLIER: "Supplier Disruption",
};

function titleCaseFromCode(code: string): string {
  return code
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function mapDbAlertToApi(a: DbAlert): {
  id: string;
  severity: "critical" | "warn" | "info" | "watch";
  status: "open" | "acknowledged" | "resolved";
  title: string;
  body: string;
  nodeId: string | null;
  itemId: string | null;
  category: string;
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
} {
  const severity = SEVERITY_MAP[a.severity?.toUpperCase?.() ?? ""] ?? "info";
  const status = STATUS_MAP[a.status?.toUpperCase?.() ?? ""] ?? "open";
  const categoryUpper = a.category?.toUpperCase?.() ?? "";
  const title =
    CATEGORY_TITLE[categoryUpper] ??
    (a.category ? titleCaseFromCode(a.category) : "Alert");
  return {
    id: a.id,
    severity,
    status,
    title,
    body: a.message,
    nodeId: a.nodeId ?? null,
    itemId: a.itemId ?? null,
    category: a.category,
    createdAt: a.openedAt.toISOString(),
    acknowledgedAt: a.ackedAt ? a.ackedAt.toISOString() : null,
    acknowledgedBy: a.ackedBy ?? null,
  };
}

router.get("/alerts", async (req, res, next) => {
  try {
    const statusParam =
      typeof req.query.status === "string" ? req.query.status : undefined;
    const severityParam =
      typeof req.query.severity === "string" ? req.query.severity : undefined;
    // The query string speaks the public (lowercase) vocabulary; translate
    // back to the DB's stored screaming-case codes before filtering.
    const STATUS_FROM_PUBLIC: Record<string, string> = {
      open: "OPEN",
      acknowledged: "ACK",
      resolved: "RESOLVED",
    };
    const SEVERITY_FROM_PUBLIC: Record<string, string> = {
      critical: "CRITICAL",
      warn: "WARNING",
      info: "INFO",
      watch: "WATCH",
    };
    const status = statusParam
      ? STATUS_FROM_PUBLIC[statusParam.toLowerCase()] ?? statusParam
      : undefined;
    const severity = severityParam
      ? SEVERITY_FROM_PUBLIC[severityParam.toLowerCase()] ?? severityParam
      : undefined;
    const conds: import("drizzle-orm").SQL[] = [];
    if (status) conds.push(eq(alerts.status, status));
    if (severity) conds.push(eq(alerts.severity, severity));
    const rows = conds.length
      ? await db.select().from(alerts).where(and(...conds)).orderBy(desc(alerts.openedAt))
      : await db.select().from(alerts).orderBy(desc(alerts.openedAt));
    res.json(rows.map(mapDbAlertToApi));
  } catch (err) {
    next(err);
  }
});

router.post("/alerts/:alertId/ack", async (req, res, next) => {
  try {
    const id = req.params.alertId;
    const ackedBy = (req.body as { ackedBy?: string }).ackedBy ?? "operator";
    await db
      .update(alerts)
      .set({ status: "ACK", ackedBy, ackedAt: new Date() })
      .where(eq(alerts.id, id));
    const [row] = await db.select().from(alerts).where(eq(alerts.id, id));
    if (!row) return res.status(404).json({ error: "alert not found" });
    await db.insert(activityEntries).values({
      kind: "ALERT_ACK",
      actor: ackedBy,
      message: `Alert ${id} acknowledged`,
      refType: "alert",
      refId: id,
      meta: {},
    });
    res.json(mapDbAlertToApi(row));
  } catch (err) {
    next(err);
  }
});

export default router;
