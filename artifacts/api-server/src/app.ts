import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";
import { csrfMiddleware } from "./middlewares/csrf";
import { isEncryptionEnabled } from "./lib/crypto";

const app: Express = express();

/**
 * Security posture, applied in order:
 *   1. trust the Replit proxy (so x-forwarded-* is honored for IP and proto)
 *   2. helmet for browser security headers (HSTS, CSP, X-Frame-Options, etc.)
 *   3. CORS — locked to the Replit dev domain + same origin (credentials on)
 *   4. structured request logging (pino), with PHI/secret redaction inherited
 *      from the logger configuration
 *   5. cookie + body parsing
 *   6. authMiddleware — populates req.user / req.session
 *   7. CSRF guard on mutations
 *   8. rate limiters on the most-abused endpoints
 *   9. routes (mounted under /api), with auth/mfa gating inside the router
 *  10. error handler that sanitizes 5xx in production
 */

app.set("trust proxy", 1);
app.disable("x-powered-by");

// 1. Helmet — restrictive defaults; CSP is the most impactful header.
const replDomain = process.env.REPLIT_DEV_DOMAIN ?? "";
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"], // tailwind utility-class only
        "img-src": ["'self'", "data:", "blob:", "https:"],
        "connect-src": ["'self'", "https:", "wss:"],
        "frame-ancestors": ["'self'", "https://*.replit.dev", "https://*.replit.com"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'", "https://replit.com"],
        "upgrade-insecure-requests": [],
      },
    },
    hsts: {
      maxAge: 60 * 60 * 24 * 365, // 1 year
      includeSubDomains: true,
      preload: false, // we don't control the apex
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    crossOriginEmbedderPolicy: false, // disabled to keep map tiles working
  }),
);

// 2. CORS — explicit allowlist; cookies must be allowed for the SPA.
const allowList = new Set<string>(
  [
    replDomain ? `https://${replDomain}` : "",
    "http://localhost",
    "http://localhost:3000",
    "http://localhost:5000",
    "http://localhost:5173",
  ].filter(Boolean),
);
app.use(
  cors({
    credentials: true,
    origin(origin, cb) {
      // Same-origin (no Origin header), explicit allowlist, or any
      // *.replit.dev / *.replit.com which the workspace proxies through.
      if (!origin) return cb(null, true);
      if (allowList.has(origin)) return cb(null, true);
      try {
        const u = new URL(origin);
        if (u.host.endsWith(".replit.dev") || u.host.endsWith(".replit.com")) {
          return cb(null, true);
        }
      } catch {
        /* fall-through */
      }
      cb(new Error("CORS: origin not allowed"));
    },
  }),
);

// 3. Logging.
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// 4. Cookie + body parsing (note: bodies are size-limited to defeat trivial DoS).
app.use(cookieParser());
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true, limit: "256kb" }));

// 5. Auth (loads req.user/session if a session cookie is present).
app.use(authMiddleware);

// 6. CSRF on all state-changing requests for an authenticated session.
app.use("/api", csrfMiddleware);

// 7. Rate limiters — keep the auth/MFA endpoints from being brute forced.
//    `windowMs` and `max` are deliberately permissive enough not to break
//    a live demo while still throttling automation.
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});
const mfaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/login", authLimiter);
app.use("/api/callback", authLimiter);
app.use("/api/mfa", mfaLimiter);
app.use("/api/orders", (req, res, next) =>
  req.method === "GET" ? next() : writeLimiter(req, res, next),
);
app.use("/api/predictive/recommendations", (req, res, next) =>
  req.method === "GET" ? next() : writeLimiter(req, res, next),
);

// 8. Routes.
app.use("/api", router);

// 9. Error handler — never leak internal details to the client in prod,
//    EXCEPT for the Copilot family of routes during the hackathon demo.
//    Background: the deployed Copilot endpoints have been failing with an
//    opaque HTTP 500 and the deployment logs API only returns stale logs,
//    so the actual cause cannot be diagnosed from outside. Surfacing the
//    real error message under /api/copilot/* keeps the demo debuggable
//    without widening the blast radius for the rest of the API. The
//    follow-up "Hide raw error details from end users in the chat" task
//    tracks reverting this once a hardened deployment is needed.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  req.log?.error({ err, url: req.originalUrl }, "request failed");
  if (res.headersSent) return;
  const message = err instanceof Error ? err.message : "internal_error";
  const isProd = process.env.NODE_ENV === "production";
  const isCopilotRoute = req.originalUrl.startsWith("/api/copilot");
  if (isProd && !isCopilotRoute) {
    res.status(500).json({ error: "internal_error" });
    return;
  }
  res.status(500).json({ error: "internal_error", detail: message });
});

// Startup safety check: encryption key MUST be configured.
if (!isEncryptionEnabled()) {
  logger.error(
    "DATA_ENCRYPTION_KEY is not set or is too short — sensitive columns will not be writable. Set a secret of >=32 chars to enable column encryption.",
  );
}

export default app;
