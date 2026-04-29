import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import mfaRouter from "./mfa";
import adminRouter from "./admin";
import catalogRouter from "./catalog";
import networkRouter from "./network";
import sitesRouter from "./sites";
import itemsRouter from "./items";
import inventoryRouter from "./inventory";
import suppliersRouter from "./suppliers";
import ordersRouter from "./orders";
import alertsRouter from "./alerts";
import scenariosRouter from "./scenarios";
import predictiveRouter from "./predictive";
import copilotRouter from "./copilot";
import settingsRouter from "./settings";
import profileRouter from "./profile";
import dashboardRouter from "./dashboard";
import activityRouter from "./activity";
import bloodRouter from "./blood";
import overviewRouter from "./overview";
import adminSupplyImportRouter from "./admin-supply-import";
import tagsRouter from "./tags";
import casualtyRouter from "./casualty";
import proceduresRouter from "./procedures";
import testAuthRouter, { testAuthEnabled } from "./test-auth";
import { requireAuth, requireMfa } from "../middlewares/authMiddleware";

const router: IRouter = Router();

// Public — no auth required (health probe + auth flow + MFA challenge).
router.use(healthRouter);
router.use(authRouter);
// MFA endpoints handle their own auth/mfa gating internally so the user
// can enroll/verify before any other API works.
router.use(mfaRouter);
// Test-only auth bypass. Only mounted when E2E_TEST_HOOKS=1 and we're
// not in production. The router itself also gates every endpoint, so a
// rogue mount is still safe.
if (testAuthEnabled()) {
  router.use(testAuthRouter);
}

/**
 * Everything below the gate requires (1) a valid session and (2) a
 * passed MFA challenge in this session. The MFA gate is the security
 * boundary — without it, even an authenticated user cannot read or
 * write business data.
 */
function appGate(req: Request, res: Response, next: NextFunction) {
  return requireAuth(req, res, () => requireMfa(req, res, next));
}
router.use(appGate);

router.use(adminRouter);
router.use(catalogRouter);
router.use(networkRouter);
router.use(sitesRouter);
router.use(itemsRouter);
router.use(inventoryRouter);
router.use(suppliersRouter);
router.use(ordersRouter);
router.use(alertsRouter);
router.use(scenariosRouter);
router.use(predictiveRouter);
router.use(copilotRouter);
router.use(settingsRouter);
router.use(profileRouter);
router.use(dashboardRouter);
router.use(activityRouter);
router.use(bloodRouter);
router.use(overviewRouter);
router.use(adminSupplyImportRouter);
router.use(tagsRouter);
router.use(casualtyRouter);
router.use(proceduresRouter);

export default router;
