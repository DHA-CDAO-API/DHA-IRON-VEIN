export type Tier = "nominal" | "watch" | "critical";

export const TIER_TEXT: Record<Tier, string> = {
  nominal: "text-emerald-500",
  watch: "text-amber-500",
  critical: "text-destructive",
};

export const TIER_BORDER: Record<Tier, string> = {
  nominal: "border-emerald-500/40",
  watch: "border-amber-500/40",
  critical: "border-destructive/50",
};

export const TIER_BG: Record<Tier, string> = {
  nominal: "bg-emerald-500/10",
  watch: "bg-amber-500/10",
  critical: "bg-destructive/10",
};

export const TIER_DOT: Record<Tier, string> = {
  nominal: "bg-emerald-500",
  watch: "bg-amber-500",
  critical: "bg-destructive",
};

export function tierFromString(
  raw: string | null | undefined,
): Tier {
  if (!raw) return "nominal";
  const v = raw.toLowerCase();
  if (v === "critical") return "critical";
  if (v === "watch" || v === "warning" || v === "warn" || v === "heightened")
    return "watch";
  return "nominal";
}

export interface ThresholdRule {
  /** Lower-is-worse (e.g., DOS, reagent days). */
  direction: "lower_is_worse" | "higher_is_worse";
  /** Trigger CRITICAL at or beyond this value. */
  critical: number;
  /** Trigger WATCH at or beyond this value. */
  watch: number;
}

export function tierForValue(
  value: number | null | undefined,
  rule: ThresholdRule,
): Tier {
  if (value == null || !Number.isFinite(value)) return "nominal";
  if (rule.direction === "lower_is_worse") {
    if (value <= rule.critical) return "critical";
    if (value <= rule.watch) return "watch";
    return "nominal";
  }
  if (value >= rule.critical) return "critical";
  if (value >= rule.watch) return "watch";
  return "nominal";
}
