import type { Request } from "express";
import { logger } from "./logger";

/**
 * Centralized audit logger for security-relevant events. Writes a single
 * structured pino line tagged `audit:true` so it can be grepped or
 * shipped to a SIEM. Never logs request bodies (which can contain PHI
 * or freeform notes); always logs the actor, the action, and the
 * subject identifier.
 */
export interface AuditEvent {
  event: string;
  outcome: "success" | "failure" | "denied";
  actorId?: string | null;
  actorRole?: string | null;
  subject?: string | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
}

export function audit(event: AuditEvent): void {
  logger.info({ audit: true, ...event }, `audit:${event.event}`);
}

export function auditFromReq(
  req: Request,
  event: string,
  outcome: AuditEvent["outcome"],
  extras: Pick<AuditEvent, "subject" | "detail"> = {},
): void {
  audit({
    event,
    outcome,
    actorId: req.user?.id ?? null,
    actorRole: req.user?.role ?? null,
    ip: getClientIp(req),
    ...extras,
  });
}

export function getClientIp(req: Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0]!.trim();
  }
  return req.ip ?? null;
}
