import type {
  ColdChainAssetView,
  NodeBloodReadiness,
} from "@workspace/api-client-react";

const COMPONENT_LABELS: Record<string, string> = {
  LTOWB: "LTOWB",
  PRBC: "PRBC",
  FFP: "FFP",
  PLASMA: "Plasma",
  PLATELETS: "Platelets",
  CRYO: "Cryo",
  FDP: "FDP",
};

export function componentLabel(component: string): string {
  return COMPONENT_LABELS[component] ?? component;
}

export function aboLabel(
  abo: string | null | undefined,
  rh: string | null | undefined,
): string {
  if (!abo) return "—";
  const sign = rh === "POS" ? "+" : rh === "NEG" ? "−" : "";
  return `${abo}${sign}`;
}

const ASSET_TYPE_LABELS: Record<string, string> = {
  refrigerator: "Refrigerator",
  freezer: "Freezer",
  cryopreserver: "Cryopreserver",
  platelet_incubator: "Platelet Incubator",
  transport_cooler: "Transport Cooler",
  generator: "Generator",
};

export function assetTypeLabel(type: ColdChainAssetView["assetType"]): string {
  return ASSET_TYPE_LABELS[type] ?? type;
}

export function totalUnits(row: NodeBloodReadiness["viability"][number]): number {
  return row.viableUnits + row.expiredUnits + row.compromisedUnits;
}

export function statusTone(status: string): {
  border: string;
  text: string;
  bg: string;
} {
  if (status === "FAILED")
    return {
      border: "border-destructive/60",
      text: "text-destructive",
      bg: "bg-destructive/10",
    };
  if (status === "EXCURSION")
    return {
      border: "border-amber-500/60",
      text: "text-amber-500",
      bg: "bg-amber-500/10",
    };
  return {
    border: "border-emerald-500/60",
    text: "text-emerald-500",
    bg: "bg-emerald-500/10",
  };
}

export function fuelTone(days: number): string {
  if (!Number.isFinite(days)) return "text-muted-foreground";
  if (days <= 1) return "text-destructive font-bold";
  if (days <= 3) return "text-amber-500 font-bold";
  return "text-emerald-500";
}

export function healthTone(percent: number): string {
  if (!Number.isFinite(percent)) return "text-muted-foreground";
  if (percent < 60) return "text-destructive";
  if (percent < 85) return "text-amber-500";
  return "text-emerald-500";
}

export function tempInRange(
  current: number,
  min: number | undefined,
  max: number | undefined,
): boolean {
  if (min == null || max == null) return true;
  return current >= min && current <= max;
}
