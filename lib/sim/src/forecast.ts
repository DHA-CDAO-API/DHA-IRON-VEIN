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

  return args.items.map((it) => {
    const skew = args.itemSkew[it.id] ?? 1;
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
