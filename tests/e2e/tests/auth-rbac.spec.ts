import { test, expect, type APIRequestContext, type BrowserContext } from "@playwright/test";

/**
 * End-to-end coverage for the auth + MFA + RBAC stack.
 *
 *  1. Each of the four app roles can sign in (via the test-only auth
 *     bypass) and the dashboard renders.
 *  2. The MFA gate appears for an authenticated-but-unenrolled user.
 *  3. The "New Order" button is disabled for read-only roles
 *     (analyst, medical_planner) and enabled for write roles
 *     (commander, logistician).
 *  4. POST /api/orders is rejected with 403 for read-only roles, but
 *     not rejected with 403 for write roles (any non-403 response means
 *     the RBAC middleware let the request through to the handler).
 *
 * Pre-flight check: every spec asserts the test-auth bypass is mounted.
 * If it isn't, the suite fails fast with an actionable message instead
 * of producing confusing red output.
 */

type Role = "commander" | "logistician" | "analyst" | "medical_planner";
const WRITE_ROLES: Role[] = ["commander", "logistician"];
const READ_ROLES: Role[] = ["analyst", "medical_planner"];
const ALL_ROLES: Role[] = [...WRITE_ROLES, ...READ_ROLES];

interface LoginResponse {
  ok: boolean;
  userId: string;
  role: Role;
  csrf: string;
  mfa: { enrolled: boolean; verified: boolean };
}

async function ensureTestHooksMounted(request: APIRequestContext): Promise<void> {
  const probe = await request.get("/api/test-auth/whoami");
  if (probe.status() === 404) {
    throw new Error(
      "test-auth bypass not mounted. Set E2E_TEST_HOOKS=1 on the api-server " +
        "workflow (and ensure NODE_ENV !== 'production') and restart it.",
    );
  }
  expect(probe.status(), "test-auth/whoami should be reachable").toBe(200);
}

async function loginAs(
  request: APIRequestContext,
  role: Role,
  opts: { mfaEnrolled?: boolean; mfaVerified?: boolean } = {},
): Promise<LoginResponse> {
  const res = await request.post("/api/test-auth/login", {
    data: {
      role,
      mfaEnrolled: opts.mfaEnrolled ?? true,
      mfaVerified: opts.mfaVerified ?? true,
    },
  });
  expect(res.ok(), `login as ${role} failed: ${res.status()}`).toBeTruthy();
  return (await res.json()) as LoginResponse;
}

async function clearAllTestUsers(request: APIRequestContext): Promise<void> {
  const res = await request.post("/api/test-auth/reset", { data: {} });
  expect(res.ok(), `reset failed: ${res.status()}`).toBeTruthy();
}

/**
 * Copy the cookies the api-server set for our APIRequestContext into
 * the browser context, so the SPA running in the page sees the same
 * session cookie + csrf cookie. We strip the leading "https://" from
 * the BASE_URL so the cookie domain matches what the browser sees.
 */
async function syncCookiesToBrowser(
  request: APIRequestContext,
  context: BrowserContext,
  baseURL: string,
): Promise<void> {
  const state = await request.storageState();
  const url = new URL(baseURL);
  const cookies = state.cookies
    .filter((c) => c.name === "sid" || c.name === "csrf")
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: url.hostname,
      path: "/",
      httpOnly: c.name === "sid",
      secure: url.protocol === "https:",
      sameSite: "Lax" as const,
      expires: c.expires === -1 ? -1 : c.expires,
    }));
  if (cookies.length === 0) {
    throw new Error("no auth cookies available to sync to browser");
  }
  await context.addCookies(cookies);
}

test.beforeEach(async ({ request }) => {
  await ensureTestHooksMounted(request);
});

test.afterAll(async ({ request }) => {
  // Don't leak the test users across runs.
  await clearAllTestUsers(request);
});

test.describe("auth: sign-in for every role", () => {
  for (const role of ALL_ROLES) {
    test(`signs in as ${role} and the dashboard renders`, async ({
      request,
      context,
      page,
      baseURL,
    }) => {
      const session = await loginAs(request, role);
      expect(session.role).toBe(role);
      expect(session.mfa.enrolled).toBe(true);
      expect(session.mfa.verified).toBe(true);

      await syncCookiesToBrowser(request, context, baseURL!);

      // Confirm the auth envelope reports the role we minted.
      const envelope = await request.get("/api/auth/user");
      expect(envelope.ok()).toBeTruthy();
      const body = (await envelope.json()) as {
        user: { id: string; role: Role } | null;
        mfa: { enrolled: boolean; verified: boolean };
      };
      expect(body.user?.role).toBe(role);
      expect(body.mfa.enrolled).toBe(true);
      expect(body.mfa.verified).toBe(true);

      // The orders board is the most representative dashboard surface
      // because it's the page the RBAC test depends on too.
      await page.goto("/orders");
      await expect(
        page.getByRole("heading", { name: /orders board/i }),
      ).toBeVisible();
      await expect(page.getByTestId("button-new-order")).toBeVisible();
    });
  }
});

test.describe("mfa: enrollment gate", () => {
  test("an authenticated-but-unenrolled user lands on the MFA enrollment screen", async ({
    request,
    context,
    page,
    baseURL,
  }) => {
    await loginAs(request, "commander", {
      mfaEnrolled: false,
      mfaVerified: false,
    });
    await syncCookiesToBrowser(request, context, baseURL!);

    await page.goto("/");
    // The enrollment screen renders this exact heading from MfaGate.
    await expect(
      page.getByRole("heading", { name: /set up microsoft authenticator/i }),
    ).toBeVisible();
    // And it should NOT yet render the dashboard chrome.
    await expect(page.getByTestId("button-new-order")).toHaveCount(0);

    // Server-side, write endpoints must reject with 401 mfa_required —
    // the MFA gate is the security boundary, not just the UI.
    const csrf = (
      await loginAs(request, "commander", {
        mfaEnrolled: false,
        mfaVerified: false,
      })
    ).csrf;
    const blocked = await request.post("/api/orders", {
      data: { items: [] },
      headers: { "x-csrf-token": csrf },
    });
    expect(blocked.status()).toBe(401);
    const blockedBody = await blocked.json().catch(() => ({}));
    expect(blockedBody?.error).toBe("mfa_required");
  });
});

test.describe("rbac: New Order button + write endpoint gating", () => {
  for (const role of READ_ROLES) {
    test(`${role}: 'New Order' button is disabled and POST /api/orders is 403`, async ({
      request,
      context,
      page,
      baseURL,
    }) => {
      const session = await loginAs(request, role);
      await syncCookiesToBrowser(request, context, baseURL!);

      await page.goto("/orders");
      const btn = page.getByTestId("button-new-order");
      await expect(btn).toBeVisible();
      await expect(btn).toBeDisabled();

      const res = await request.post("/api/orders", {
        data: { items: [] },
        headers: { "x-csrf-token": session.csrf },
      });
      expect(res.status(), `expected 403 for ${role} POST /api/orders`).toBe(
        403,
      );
      const body = (await res.json()) as {
        error?: string;
        requiredRoles?: string[];
      };
      expect(body.error).toBe("forbidden");
      expect(body.requiredRoles).toContain("commander");
      expect(body.requiredRoles).toContain("logistician");
    });
  }

  for (const role of WRITE_ROLES) {
    test(`${role}: 'New Order' button is enabled and POST /api/orders passes RBAC`, async ({
      request,
      context,
      page,
      baseURL,
    }) => {
      const session = await loginAs(request, role);
      await syncCookiesToBrowser(request, context, baseURL!);

      await page.goto("/orders");
      const btn = page.getByTestId("button-new-order");
      await expect(btn).toBeVisible();
      await expect(btn).toBeEnabled();

      const res = await request.post("/api/orders", {
        data: { items: [] },
        headers: { "x-csrf-token": session.csrf },
      });
      // We deliberately POST an invalid body so the handler rejects with
      // a 4xx schema/validation error. The point is just to prove the
      // RBAC middleware did NOT short-circuit with 403 before the
      // handler ran.
      expect(
        res.status(),
        `${role} should NOT get 403 (got ${res.status()})`,
      ).not.toBe(403);
    });
  }
});
