import { defineConfig, devices } from "@playwright/test";

/**
 * E2E suite for the auth + MFA + RBAC stack.
 *
 * The suite runs against the dev workflow (the same api-server + web
 * artifacts the user sees in the preview pane), so the api-server
 * workflow must have `E2E_TEST_HOOKS=1` set or the test bypass route
 * is not mounted and every test will fail fast with a clear error.
 *
 * BASE_URL precedence:
 *   1. process.env.E2E_BASE_URL (explicit)
 *   2. https://${REPLIT_DEV_DOMAIN} (Replit workspace default)
 *   3. http://localhost:5000 (local fallback)
 */
function resolveBaseUrl(): string {
  const explicit = process.env.E2E_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const dev = process.env.REPLIT_DEV_DOMAIN;
  if (dev) return `https://${dev}`;
  return "http://localhost:5000";
}

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  // Each role tweaks shared user/session rows; keep the whole suite serial
  // so two specs cannot stomp on each other's MFA/role state.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: resolveBaseUrl(),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
