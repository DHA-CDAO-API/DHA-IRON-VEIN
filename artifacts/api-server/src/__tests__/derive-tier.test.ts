import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveTier,
  TIER_CRITICAL_RISK_SCORE,
  TIER_HEIGHTENED_RISK_SCORE,
  TIER_CRITICAL_MIN_ALERTS,
  TIER_HEIGHTENED_MIN_WARNINGS,
} from "../lib/snapshot.js";

describe("deriveTier — site-tier rollup", () => {
  it("nominal when no alerts and low risk", () => {
    assert.equal(
      deriveTier({
        riskScore: 10,
        openAlertsCritical: 0,
        openAlertsWarning: 0,
        nodeCatalogSize: 30,
      }),
      "nominal",
    );
  });

  it("a single critical alert does NOT flip a hub to critical (regression)", () => {
    // The whole point of the rollup tightening: one short item should not
    // paint the entire site CRITICAL on the network map.
    assert.equal(
      deriveTier({
        riskScore: 30,
        openAlertsCritical: 1,
        openAlertsWarning: 0,
        nodeCatalogSize: 30,
      }),
      "heightened",
    );
  });

  it("a single critical alert at a small forward node also stays heightened", () => {
    // Even at a tiny BAS (5 items stocked), one short item alone is not
    // enough to flip the rollup; the floor is `TIER_CRITICAL_MIN_ALERTS`.
    assert.equal(
      deriveTier({
        riskScore: 20,
        openAlertsCritical: 1,
        openAlertsWarning: 0,
        nodeCatalogSize: 5,
      }),
      "heightened",
    );
  });

  it("multiple critical alerts (>= floor) flip a small site to critical", () => {
    assert.equal(
      deriveTier({
        riskScore: 20,
        openAlertsCritical: TIER_CRITICAL_MIN_ALERTS,
        openAlertsWarning: 0,
        nodeCatalogSize: 8,
      }),
      "critical",
    );
  });

  it("a deep hub needs more than the floor — it needs the share threshold too", () => {
    // 30 items × 10% = 3 required critical alerts. Two alerts on a hub
    // is below the share threshold and stays heightened.
    assert.equal(
      deriveTier({
        riskScore: 30,
        openAlertsCritical: 2,
        openAlertsWarning: 0,
        nodeCatalogSize: 30,
      }),
      "heightened",
    );
    assert.equal(
      deriveTier({
        riskScore: 30,
        openAlertsCritical: 3,
        openAlertsWarning: 0,
        nodeCatalogSize: 30,
      }),
      "critical",
    );
  });

  it("a high enough risk score still flips critical regardless of alerts", () => {
    assert.equal(
      deriveTier({
        riskScore: TIER_CRITICAL_RISK_SCORE,
        openAlertsCritical: 0,
        openAlertsWarning: 0,
        nodeCatalogSize: 30,
      }),
      "critical",
    );
  });

  it("heightened by risk band when no critical alerts are open", () => {
    assert.equal(
      deriveTier({
        riskScore: TIER_HEIGHTENED_RISK_SCORE,
        openAlertsCritical: 0,
        openAlertsWarning: 0,
        nodeCatalogSize: 30,
      }),
      "heightened",
    );
  });

  it("a single warning alert does not flip — heightened needs the warning floor", () => {
    assert.equal(
      deriveTier({
        riskScore: 5,
        openAlertsCritical: 0,
        openAlertsWarning: 1,
        nodeCatalogSize: 30,
      }),
      "nominal",
    );
    assert.equal(
      deriveTier({
        riskScore: 5,
        openAlertsCritical: 0,
        openAlertsWarning: TIER_HEIGHTENED_MIN_WARNINGS,
        nodeCatalogSize: 30,
      }),
      "heightened",
    );
  });

  it("falls back gracefully when nodeCatalogSize is missing", () => {
    // Without catalog info, the alert floor still applies — no
    // ZeroDivisionError-style edge cases.
    assert.equal(
      deriveTier({
        riskScore: 30,
        openAlertsCritical: 1,
        openAlertsWarning: 0,
      }),
      "heightened",
    );
    assert.equal(
      deriveTier({
        riskScore: 30,
        openAlertsCritical: TIER_CRITICAL_MIN_ALERTS,
        openAlertsWarning: 0,
      }),
      "critical",
    );
  });
});
