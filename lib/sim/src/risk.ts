export type RiskInputs = {
  daysOfSupply: number;
  criticalShortItems: number;
  openAlertsCritical: number;
  openAlertsWarning: number;
  upstreamRouteDelayDays: number;
  routeReliability: number;
};

export function computeRiskScore(inp: RiskInputs): number {
  const dosScore = Math.max(0, Math.min(1, (14 - inp.daysOfSupply) / 14));
  const critItemsScore = Math.min(1, inp.criticalShortItems / 5);
  const alertScore = Math.min(
    1,
    (inp.openAlertsCritical * 0.35 + inp.openAlertsWarning * 0.12),
  );
  const routeScore = Math.min(1, inp.upstreamRouteDelayDays / 7);
  const reliabilityScore = 1 - inp.routeReliability;
  const raw =
    dosScore * 0.4 +
    critItemsScore * 0.2 +
    alertScore * 0.2 +
    routeScore * 0.1 +
    reliabilityScore * 0.1;
  return Math.round(Math.min(1, Math.max(0, raw)) * 100);
}

/**
 * Map a days-of-supply value into the four-tier status enum used by the
 * OpenAPI contract (`healthy | watch | warn | critical`). The string values
 * intentionally match `InventoryBalanceStatus` / `DaysOfSupplyEntryStatus` so
 * the API response and the TypeScript types stay in sync — callers comparing
 * `=== "critical"` etc. on the client side only work because of this.
 */
export function statusFromDOS(
  dos: number,
  watchDays: number,
  criticalDays: number,
): "healthy" | "watch" | "warn" | "critical" {
  if (dos <= criticalDays) return "critical";
  if (dos <= criticalDays + 2) return "warn";
  if (dos <= watchDays) return "watch";
  return "healthy";
}
