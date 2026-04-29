# Security Posture — INDOPACOM IRONVEIN (Resilient Operational Network for Vital Expeditionary Inventory Nodes)

This document describes the security controls in force for the
**INDOPACOM IRONVEIN** workspace (web app + API server) and
how they are verified.

---

## 1. Authentication

**Replit OIDC** (PKCE, code flow) is the sole identity provider.

- Implementation: `artifacts/api-server/src/auth/*`
- Session store: PostgreSQL (`sessions` table), backed by `connect-pg-simple`.
- Session cookie: `httpOnly`, `sameSite=lax`, `secure` in production.
- **Absolute session lifetime: 12 hours.** There is **no** idle timeout —
  the session survives inactivity, but is forcibly invalidated 12 hours
  after sign-in.
- Logout endpoint clears the local session and redirects through the
  Replit end-session endpoint.

### Lockout protection
The `OWNER_USER_ID` environment variable, when set, grants the named
Replit user `commander` role on every login. In addition, **the first
user ever to sign in is automatically promoted to `commander`** so the
operator can never accidentally lock themselves out of their own
deployment.

## 2. Multi-Factor Authentication (TOTP)

After Replit sign-in, every user must complete a TOTP challenge using
**Microsoft Authenticator** (or any RFC 6238 authenticator).

- Library: `otplib` (`epochTolerance` set so users have ~90 seconds of
  slack across clock skew).
- Per-user secret stored encrypted at rest (`user_mfa.totp_secret_enc`,
  bytea, AES-256 via pgcrypto).
- Recovery codes: 10 single-use codes issued at enrollment, hashed with
  bcrypt before storage. Regenerate endpoint invalidates the prior set.
- Audit trail: every enroll / verify / reset / recovery-code-use is
  written to `mfa_audit`.
- Rate limit: 10 verification attempts per 5-minute window per IP.

The frontend `MfaGate` component blocks access to the rest of the app
until enrollment + verification have completed in the current session.

## 3. Role-Based Access Control

Roles are stored on `users.role`:

| Role               | Can read | Can write purchase orders |
|--------------------|:--------:|:-------------------------:|
| `analyst`          |    ✓     |              ✗            |
| `medical_planner`  |    ✓     |              ✗            |
| `logistician`      |    ✓     |              ✓            |
| `commander`        |    ✓     |              ✓            |

Server-side enforcement (`requireRole("commander", "logistician")`):
- `POST   /api/orders`
- `PATCH  /api/orders/:id`
- `POST   /api/predictive/recommendations/:id/promote`

Client-side enforcement (`useCanWrite()` hook): the New-Order, Promote,
CasualtyPlanner bulk-order, and NetworkMap "Order resupply" controls
are disabled with an explanatory tooltip for read-only roles. The
server is the source of truth — the client gate is purely a UX courtesy.

## 4. Encryption At Rest

Sensitive columns are stored as `bytea` and read/written through
`pgp_sym_encrypt` / `pgp_sym_decrypt` (pgcrypto, AES-256-CFB).

| Table          | Column                       |
|----------------|------------------------------|
| `profiles`     | `display_name_enc`           |
| `profiles`     | `contact_email_enc`          |
| `scenarios`    | `summary_enc`                |
| `scenarios`    | `coa_brief_enc`              |
| `orders`       | `notes_enc`                  |
| `app_settings` | `ai_provider_api_key_enc`    |
| `user_mfa`     | `secret_enc`                 |

The symmetric key is read from the `DATA_ENCRYPTION_KEY` environment
secret (≥ 32 chars). The key is never logged and never returned to the
client. Helpers live in `artifacts/api-server/src/lib/crypto.ts`.

## 5. Transport & HTTP Hardening

`artifacts/api-server/src/app.ts` mounts:

- **helmet** with HSTS (`max-age=31536000; includeSubDomains; preload`),
  a strict CSP, `X-Frame-Options: DENY`, `Referrer-Policy:
  no-referrer`, and the standard cross-origin isolation headers.
- **cors** locked to the workspace's `REPLIT_DOMAINS` allow-list with
  `credentials: true`. No wildcard origin.
- **trust proxy** on (Replit terminates TLS upstream) so `secure` cookies
  and `req.ip` work correctly.
- **cookie-parser** so the CSRF middleware can read `csrf`.
- **CSRF (double-submit cookie)** middleware: every state-changing
  request must echo the value of cookie `csrf` in header
  `x-csrf-token`. Rejected with 403 otherwise. The frontend api client
  attaches this header automatically.
- **Rate limiters**:
  - `authLimiter`  — `/api/auth/*`  (20 req / 15 min / IP)
  - `mfaLimiter`   — `/api/mfa/*`   (10 verifications / 5 min / IP)
  - `writeLimiter` — all `POST/PATCH/DELETE` (60 req / min / IP)

## 6. Audit Logging

Mutating operations and security events are written to the structured
audit logger (`artifacts/api-server/src/lib/audit.ts`). Each entry
records `actor_user_id`, `action`, `target`, `outcome`, `ip`, and a
correlation `request_id`. Errors returned to the client are sanitized
in production so internal stack traces never leak.

## 7. Verification

```bash
pnpm run security:verify
```

The script (`scripts/src/security-verify.ts`) verifies:

1. Required env (`DATABASE_URL`, `DATA_ENCRYPTION_KEY`, `REPL_ID`,
   `REPLIT_DEV_DOMAIN`) is present and the key is ≥ 32 chars.
2. The `pgcrypto` extension is installed.
3. Each protected column exists as `bytea`, contains ciphertext (the
   first byte has the high bit set — OpenPGP packet tag), and decrypts
   cleanly with the env key.
4. RBAC middleware is wired on the documented write endpoints.
5. helmet, cors, cookie-parser, csrf, trust-proxy, and the three rate
   limiters are mounted in `app.ts`.
6. `requireAuth` is applied at the `/api` router.

## 8. Operating Procedure

- **Rotating the encryption key**: provision the new key as
  `DATA_ENCRYPTION_KEY_NEXT`, run a one-shot re-encrypt migration that
  decrypts with the old key and re-encrypts with the new, then promote
  `_NEXT` to `DATA_ENCRYPTION_KEY` and restart.
- **Resetting a user's MFA**: a `commander` may call
  `POST /api/mfa/reset` with the target `userId`. The action is logged
  in `mfa_audit`.
- **Revoking a session**: deleting the row from `sessions` is
  sufficient — the cookie becomes inert immediately.

---

_Last updated automatically by the security:verify pipeline._
