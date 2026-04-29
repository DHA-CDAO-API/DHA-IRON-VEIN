import { type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { CSRF_COOKIE } from "../lib/auth";

/**
 * Stateless CSRF guard, double-submit pattern.
 *
 * - On any authenticated request we make sure the response carries a
 *   readable `csrf` cookie matching the per-session secret. The web
 *   client mirrors that value back as `X-CSRF-Token` for mutations.
 * - State-changing methods (POST/PATCH/PUT/DELETE) without a matching
 *   token are rejected 403 — this defeats classic browser CSRF without
 *   blocking the OIDC redirect handshake (those routes are GETs).
 *
 * Routes mounted *before* the auth middleware (e.g. /healthz) and the
 * OIDC routes that intentionally do not have a session yet are exempt
 * via `csrfExemptPath`.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const EXEMPT_PREFIXES = [
  "/healthz",
  "/login",
  "/callback",
  "/logout",
  "/auth/csrf",
];

export function csrfExemptPath(path: string): boolean {
  return EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export function csrfMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Mirror the per-session csrf secret as a non-HttpOnly cookie that the
  // browser JS can read, *only* for authenticated requests.
  const secret = req.session?.csrf;
  if (secret) {
    const incoming = req.cookies?.[CSRF_COOKIE];
    if (incoming !== secret) {
      res.cookie(CSRF_COOKIE, secret, {
        httpOnly: false,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 12 * 60 * 60 * 1000,
      });
    }
  }

  if (SAFE_METHODS.has(req.method)) return next();
  if (csrfExemptPath(req.path)) return next();
  if (!req.session) return next();

  const sent =
    (req.headers["x-csrf-token"] as string | undefined) ??
    (req.headers["x-xsrf-token"] as string | undefined);

  if (!sent || !timingSafeEqual(sent, req.session.csrf)) {
    res.status(403).json({ error: "csrf_token_invalid" });
    return;
  }
  next();
}
