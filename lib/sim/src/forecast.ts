import type {
  SimDemandProfile,
  SimItem,
  SimOperationalState,
} from "./types";

export type DailyDemand = { itemId: string; quantity: number };

export function computeDailyDemand(args: {
  profile: SimDemandProfile;
  items: SimItem[];
  operationalState: SimOperationalState | undefined;
  itemSkew: Record<string, number>;
  wasteOverride?: number;
  encounterMultiplierOverride?: number;
  populationMultiplierOverride?: number;
  specimensMultiplier?: number;
  /**
   * Optional per-item override of the daily burn rate, sourced from real
   * issue history (see `item_facility_demand_rollup`). When a value is
   * present for an item, the historical burn rate is used as the daily
   * demand directly — multiplied only by the operational-state encounter
   * multiplier and the encounter multiplier override so scenario knobs
   * (combat ramp, etc.) still flex the projection.
   *
   * Items without a historical rate fall back to the synthetic
   * encounter-based math below.
   */
  historicalBurnByItem?: Map<string, number>;
}): DailyDemand[] {
  const stateMult = args.operationalState?.encounterMultiplier ?? 1;
  const popMult = args.operationalState?.populationMultiplier ?? 1;
  const encMult = args.encounterMultiplierOverride ?? 1;
  const populationMult = args.populationMultiplierOverride ?? 1;
  const waste = args.wasteOverride ?? args.profile.wasteFactor ?? 1.1;

  const effectivePop =
    args.profile.activeSupportedPopulation * popMult * populationMult;
  const dailyEncounters =
    effectivePop * args.profile.dailyEncounterRate * stateMult * encMult;
  const phlebotomyEvents = dailyEncounters * args.profile.phlebotomyProbability;
  const specimens =
    phlebotomyEvents *
    args.profile.specimensPerPhlebotomy *
    (args.specimensMultiplier ?? 1);

  // Transfusion events are a small fraction of encounters (emergency
  // surgery / mass-cas casualty volume). Scales up with operational tempo
  // because the encounter multiplier already reflects optempo.
  // Garrison ~0.5%, conflict ramps via stateMult.
  const transfusionEvents = dailyEncounters * 0.005;
  // Cold-chain shipments per day at the node (1 per ~50 transfusion events)
  const shipmentEvents = transfusionEvents * 0.02 + 0.05;

  // Effective scenario multiplier applied to historical-burn rates so
  // simulator knobs like the combat ramp still influence the projection
  // even for items whose baseline comes from real issues data.
  const histScenarioMult = stateMult * encMult;

  return args.items.map((it) => {
    const skew = args.itemSkew[it.id] ?? 1;
    const histRate = args.historicalBurnByItem?.get(it.id);
    if (histRate !== undefined && histRate > 0) {
      const qty = histRate * histScenarioMult * skew;
      return { itemId: it.id, quantity: Math.max(0, qty) };
    }
    let qty = 0;
    switch (it.trigger) {
      case "phlebotomy_event":
        qty = phlebotomyEvents * it.wasteAdjustedDemand * skew * waste;
        break;
      case "specimen":
        qty = specimens * it.wasteAdjustedDemand * skew * waste;
        break;
      case "encounter":
        qty = dailyEncounters * it.wasteAdjustedDemand * skew * waste;
        break;
      case "population":
        qty = effectivePop * it.wasteAdjustedDemand * skew * waste;
        break;
      case "transfusion_event":
        qty = transfusionEvents * it.wasteAdjustedDemand * skew * waste;
        break;
      case "shipment_event":
        qty = shipmentEvents * it.wasteAdjustedDemand * skew * waste;
        break;
      default:
        qty = phlebotomyEvents * it.wasteAdjustedDemand * skew * waste;
    }
    return { itemId: it.id, quantity: Math.max(0, qty) };
  });
}

export function projectDaysOfSupply(
  onHand: number,
  dailyBurnRate: number,
): number {
  if (dailyBurnRate <= 0.0001) return 999;
  return onHand / dailyBurnRate;
}
