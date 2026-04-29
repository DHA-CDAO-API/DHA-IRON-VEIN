import { Router, type IRouter } from "express";
import { z } from "zod";

// Inline body validator — matches the OpenAPI MfaCodeRequest contract.
// 6-digit TOTP **or** 14-char recovery code (e.g. "ABCD-EFGH-JKMN").
const MfaCodeRequest = z.object({
  code: z.string().min(6).max(20),
});
import {
  buildOtpauthUri,
  consumeRecoveryCode,
  finalizeEnrollment,
  generateRecoveryCodes,
  generateSecret,
  getDecryptedSecret,
  getIssuer,
  getMfaRow,
  getOrCreatePendingSecret,
  hashRecoveryCodes,
  isLockedOut,
  logAudit,
  recordFailure,
  recordSuccess,
  renderQrSvg,
  verifyToken,
} from "../lib/mfa";
import {
  markMfaVerified,
  updateSession,
} from "../lib/auth";
import { requireAuth } from "../middlewares/authMiddleware";
import { audit, getClientIp } from "../lib/audit";

const router: IRouter = Router();

router.get("/mfa/status", requireAuth, async (req, res, next) => {
  try {
    const row = await getMfaRow(req.user!.id);
    // Demo bypass: when MFA_BYPASS=true, advertise enrolled+verified so the gate passes.
    const bypass = process.env.MFA_BYPASS === "true";
    const verified = bypass || Date.now() < (req.session?.mfaVerifiedUntilMs ?? 0);
    res.json(
      ({
        enrolled: bypass ? true : !!row?.enrolledAt,
        verified,
        required: !bypass,
        sessionExpiresAt: req.session
          ? new Date(req.session.absoluteExpireAtMs).toISOString()
          : null,
      }),
    );
  } catch (err) {
    next(err);
  }
});

router.post("/mfa/enroll/start", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;

    // Block accidental re-enrollment of an already-finalized account.
    // True re-enrollment (e.g. lost-device flow) requires explicit reset
    // through a separate, audited endpoint — not the standard onboarding
    // screen.
    const row = await getMfaRow(userId);
    if (row?.enrolledAt) {
      res.status(409).json({ error: "already_enrolled" });
      return;
    }

    // Reuse the existing pending secret if one is present so the user's
    // authenticator entry from a prior page load stays valid. Rotating on
    // every screen mount silently invalidates whatever they scanned and
    // shows up as "code didn't match". The helper is atomic across
    // concurrent calls (StrictMode double-mount, two browser tabs, etc.):
    // a single SQL statement INSERTs a candidate ON CONFLICT DO NOTHING
    // and returns whichever secret actually persisted, so all callers
    // observe the same value.
    const candidate = generateSecret();
    const { secret, created } = await getOrCreatePendingSecret(userId, candidate);

    const account = req.user!.email || userId;
    const otpauthUri = buildOtpauthUri(account, secret);
    const qrSvg = await renderQrSvg(otpauthUri);
    await logAudit(
      userId,
      created ? "mfa.enroll.start" : "mfa.enroll.resume",
      null,
      getClientIp(req),
    );
    audit({
      event: created ? "mfa.enroll.start" : "mfa.enroll.resume",
      outcome: "success",
      actorId: userId,
      actorRole: req.user!.role,
      ip: getClientIp(req),
    });
    res.json(
      ({
        secret,
        otpauthUri,
        qrSvg,
        issuer: getIssuer(),
        account,
      }),
    );
  } catch (err) {
    next(err);
  }
});

router.post("/mfa/enroll/verify", requireAuth, async (req, res, next) => {
  try {
    const parsed = MfaCodeRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(401).json(({ error: "invalid_request" }));
      return;
    }
    const userId = req.user!.id;
    const secret = await getDecryptedSecret(userId);
    if (!secret) {
      res.status(401).json(({ error: "no_pending_enrollment" }));
      return;
    }
    if (!verifyToken(parsed.data.code, secret)) {
      await logAudit(userId, "mfa.enroll.verify.fail", null, getClientIp(req));
      audit({
        event: "mfa.enroll.verify",
        outcome: "failure",
        actorId: userId,
        actorRole: req.user!.role,
        ip: getClientIp(req),
      });
      res.status(401).json(({ error: "bad_code" }));
      return;
    }

    const codes = generateRecoveryCodes();
    const hashes = await hashRecoveryCodes(codes);
    await finalizeEnrollment(userId, hashes);
    if (req.session && req.sessionId) {
      const next_ = markMfaVerified(req.session);
      await updateSession(req.sessionId, next_);
      req.session = next_;
    }
    await logAudit(userId, "mfa.enroll.verify.ok", null, getClientIp(req));
    audit({
      event: "mfa.enroll.verify",
      outcome: "success",
      actorId: userId,
      actorRole: req.user!.role,
      ip: getClientIp(req),
    });
    res.json(({ enrolled: true, recoveryCodes: codes }));
  } catch (err) {
    next(err);
  }
});

router.post("/mfa/verify", requireAuth, async (req, res, next) => {
  try {
    const parsed = MfaCodeRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(401).json(({ error: "invalid_request" }));
      return;
    }
    const userId = req.user!.id;
    const row = await getMfaRow(userId);
    if (!row?.enrolledAt) {
      res.status(401).json(({ error: "not_enrolled" }));
      return;
    }
    const lockout = isLockedOut(row);
    if (lockout.locked) {
      res
        .status(429)
        .json(
          ({
            error: "locked_out",
            retryAfterSeconds: lockout.retryAfterSeconds,
          }),
        );
      return;
    }

    const secret = await getDecryptedSecret(userId);
    let success = !!secret && verifyToken(parsed.data.code, secret);

    if (!success && row.recoveryCodesHashes && row.recoveryCodesHashes.length > 0) {
      const consumed = await consumeRecoveryCode(
        userId,
        parsed.data.code,
        row.recoveryCodesHashes,
      );
      success = consumed.matched;
      if (success) {
        await logAudit(userId, "mfa.recovery_used", null, getClientIp(req));
      }
    }

    if (!success) {
      const fail = await recordFailure(userId);
      await logAudit(
        userId,
        "mfa.verify.fail",
        `count=${fail.failureCount}`,
        getClientIp(req),
      );
      audit({
        event: "mfa.verify",
        outcome: "failure",
        actorId: userId,
        actorRole: req.user!.role,
        ip: getClientIp(req),
        detail: { failureCount: fail.failureCount },
      });
      if (fail.lockoutUntil) {
        res
          .status(429)
          .json(
            ({
              error: "locked_out",
              retryAfterSeconds: Math.ceil(
                (fail.lockoutUntil.getTime() - Date.now()) / 1000,
              ),
            }),
          );
        return;
      }
      res.status(401).json(({ error: "bad_code" }));
      return;
    }

    await recordSuccess(userId);
    if (req.session && req.sessionId) {
      const next_ = markMfaVerified(req.session);
      await updateSession(req.sessionId, next_);
      req.session = next_;
    }
    await logAudit(userId, "mfa.verify.ok", null, getClientIp(req));
    audit({
      event: "mfa.verify",
      outcome: "success",
      actorId: userId,
      actorRole: req.user!.role,
      ip: getClientIp(req),
    });
    res.json(
      ({
        verified: true,
        sessionExpiresAt: new Date(req.session!.absoluteExpireAtMs).toISOString(),
      }),
    );
  } catch (err) {
    next(err);
  }
});

router.post("/mfa/recovery-codes/regenerate", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const row = await getMfaRow(userId);
    if (!row?.enrolledAt) {
      res.status(401).json(({ error: "not_enrolled" }));
      return;
    }
    if (Date.now() >= (req.session?.mfaVerifiedUntilMs ?? 0)) {
      res.status(401).json(({ error: "mfa_required" }));
      return;
    }
    const codes = generateRecoveryCodes();
    const hashes = await hashRecoveryCodes(codes);
    await finalizeEnrollment(userId, hashes);
    await logAudit(userId, "mfa.recovery.regenerate", null, getClientIp(req));
    audit({
      event: "mfa.recovery.regenerate",
      outcome: "success",
      actorId: userId,
      actorRole: req.user!.role,
      ip: getClientIp(req),
    });
    res.json(({ recoveryCodes: codes }));
  } catch (err) {
    next(err);
  }
});

export default router;
