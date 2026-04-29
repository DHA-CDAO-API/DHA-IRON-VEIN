import React, { useEffect, useRef } from "react";
import {
  Droplet,
  Snowflake,
  Users,
  FlaskConical,
  Truck,
  AlertTriangle,
  Sparkles,
  Activity,
  ArrowUp,
  ArrowDown,
  Minus,
} from "lucide-react";
import {
  type Tier,
  TIER_BORDER,
  TIER_BG,
  TIER_TEXT,
  TIER_DOT,
  tierForValue,
} from "./tier";
import { formatNumber } from "@/lib/format";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type IconType = React.ComponentType<{ className?: string }>;

interface VitalChip {
  id: string;
  label: string;
  value: number;
  formatted: string;
  unit?: string;
  tier: Tier;
  icon: IconType;
  /** Plain-language explanation of the metric. */
  description: string;
  /** Plain-language summary of what each color tier means. */
  tierExplanation: string;
}

interface VitalSignsStripProps {
  bloodReadiness?: {
    totalViableUnits?: number;
    coldChainHealthPercent?: number;
    walkingBloodBankReadyDonors?: number;
    reagentDaysRemaining?: number;
  } | null;
  kpis?: {
    theaterDaysOfSupply?: number;
    shipmentsInFlight?: number;
    openAlertsTotal?: number;
    openCriticalAlerts?: number;
    recommendationsAwaitingPromotion?: number;
  } | null;
  /** Resets when this changes; used to capture deltas vs the previous tick. */
  refreshTick?: number;
}

export function VitalSignsStrip({
  bloodReadiness,
  kpis,
  refreshTick = 0,
}: VitalSignsStripProps) {
  const viableUnits = bloodReadiness?.totalViableUnits ?? 0;
  const dos = kpis?.theaterDaysOfSupply ?? 0;
  const coldChain = bloodReadiness?.coldChainHealthPercent ?? 0;
  const wbb = bloodReadiness?.walkingBloodBankReadyDonors ?? 0;
  const reagent = bloodReadiness?.reagentDaysRemaining ?? 0;
  const inFlight = kpis?.shipmentsInFlight ?? 0;
  const openAlerts = kpis?.openAlertsTotal ?? 0;
  const pendingRecs = kpis?.recommendationsAwaitingPromotion ?? 0;

  const chips: VitalChip[] = [
    {
      id: "viable_units",
      label: "Viable Blood Units",
      value: viableUnits,
      formatted: formatNumber(viableUnits),
      unit: "u",
      icon: Droplet,
      tier: tierForValue(viableUnits, {
        direction: "lower_is_worse",
        critical: 250,
        watch: 600,
      }),
      description:
        "Total viable blood units (u) on hand across the theater, ready for transfusion.",
      tierExplanation:
        "Critical at or below 250 u, Watch at or below 600 u, Nominal above that.",
    },
    {
      id: "blood_dos",
      label: "Blood DOS",
      value: dos,
      formatted: dos.toFixed(1),
      unit: "d",
      icon: Activity,
      tier: tierForValue(dos, {
        direction: "lower_is_worse",
        critical: 3,
        watch: 7,
      }),
      description:
        "Theater-wide days of blood supply (d) at the current consumption rate.",
      tierExplanation:
        "Critical at or below 3 days, Watch at or below 7 days, Nominal above that.",
    },
    {
      id: "cold_chain",
      label: "Cold-Chain Health",
      value: coldChain,
      formatted: `${coldChain.toFixed(0)}`,
      unit: "%",
      icon: Snowflake,
      tier: tierForValue(coldChain, {
        direction: "higher_is_worse",
        critical: -1,
        watch: -1,
      }) === "nominal"
        ? coldChain < 60
          ? "critical"
          : coldChain < 85
            ? "watch"
            : "nominal"
        : "nominal",
      description:
        "Percent (%) of cold-chain assets reporting in-spec temperatures right now.",
      tierExplanation:
        "Critical below 60%, Watch below 85%, Nominal at 85% or above.",
    },
    {
      id: "wbb_ready",
      label: "WBB Ready Donors",
      value: wbb,
      formatted: formatNumber(wbb),
      icon: Users,
      tier: tierForValue(wbb, {
        direction: "lower_is_worse",
        critical: 50,
        watch: 150,
      }),
      description:
        "Walking Blood Bank donors who are screened, typed, and ready to donate on call.",
      tierExplanation:
        "Critical at or below 50 donors, Watch at or below 150, Nominal above that.",
    },
    {
      id: "reagent_days",
      label: "Reagent Days",
      value: reagent,
      formatted: reagent >= 999 ? "∞" : reagent.toFixed(1),
      unit: "d",
      icon: FlaskConical,
      tier: tierForValue(reagent, {
        direction: "lower_is_worse",
        critical: 3,
        watch: 7,
      }),
      description:
        "Days (d) of typing and screening reagents remaining at current burn rate.",
      tierExplanation:
        "Critical at or below 3 days, Watch at or below 7 days, Nominal above that.",
    },
    {
      id: "in_flight",
      label: "In-Transit Shipments",
      value: inFlight,
      formatted: formatNumber(inFlight),
      icon: Truck,
      tier: "nominal",
      description:
        "Number of shipments currently moving across the theater by air, sea, or ground.",
      tierExplanation:
        "Informational — this chip stays Nominal regardless of count.",
    },
    {
      id: "open_alerts",
      label: "Open Alerts",
      value: openAlerts,
      formatted: formatNumber(openAlerts),
      icon: AlertTriangle,
      tier:
        (kpis?.openCriticalAlerts ?? 0) > 0
          ? "critical"
          : openAlerts > 0
            ? "watch"
            : "nominal",
      description:
        "Total alerts that are currently open and awaiting acknowledgment or action.",
      tierExplanation:
        "Critical when any open alert is critical-severity, Watch when alerts exist but none are critical, Nominal when there are zero open alerts.",
    },
    {
      id: "pending_recs",
      label: "Pending Recs",
      value: pendingRecs,
      formatted: formatNumber(pendingRecs),
      icon: Sparkles,
      tier: pendingRecs > 8 ? "watch" : "nominal",
      description:
        "AI recommendations queued and waiting for an operator to promote them to action.",
      tierExplanation:
        "Watch when more than 8 are pending, Nominal at 8 or fewer.",
    },
  ];

  // Track the previous-tick value for each chip so we can render a delta
  // arrow vs the last refresh.
  const prevRef = useRef<Map<string, number>>(new Map());
  const deltas = new Map<string, number>();
  for (const c of chips) {
    const prev = prevRef.current.get(c.id);
    if (prev != null) deltas.set(c.id, c.value - prev);
  }
  useEffect(() => {
    const next = new Map<string, number>();
    for (const c of chips) next.set(c.id, c.value);
    prevRef.current = next;
    // We intentionally only re-snapshot on refreshTick changes so the delta
    // reflects the post-refresh delta, not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  return (
    <div
      className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 shrink-0"
      data-testid="vital-signs-strip"
    >
      {chips.map((c) => (
        <VitalSignChip key={c.id} chip={c} delta={deltas.get(c.id)} />
      ))}
    </div>
  );
}

function VitalSignChip({
  chip,
  delta,
}: {
  chip: VitalChip;
  delta?: number;
}) {
  const Icon = chip.icon;
  const valueWithUnit = chip.unit
    ? `${chip.formatted} ${chip.unit}`
    : chip.formatted;
  const ariaLabel = `${chip.label}: ${valueWithUnit}. ${chip.description} ${chip.tierExplanation}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid={`vital-${chip.id}`}
          aria-label={ariaLabel}
          className={`shrink-0 min-w-[160px] text-left rounded-lg border ${TIER_BORDER[chip.tier]} ${TIER_BG[chip.tier]} px-3 py-2 backdrop-blur focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background`}
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              <Icon className={`h-3 w-3 ${TIER_TEXT[chip.tier]}`} />
              <span className="truncate">{chip.label}</span>
            </div>
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${TIER_DOT[chip.tier]}`}
              aria-hidden
            />
          </div>
          <div className="flex items-baseline gap-1">
            <span
              className={`text-lg font-bold font-mono ${TIER_TEXT[chip.tier]}`}
            >
              {chip.formatted}
            </span>
            {chip.unit && (
              <span className="text-[11px] text-muted-foreground">
                {chip.unit}
              </span>
            )}
            <DeltaIndicator delta={delta} />
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="max-w-[260px] bg-popover text-popover-foreground border border-border shadow-lg"
      >
        <div className="text-xs space-y-1">
          <div className="font-medium text-foreground">{chip.label}</div>
          <div className={`text-[11px] font-semibold ${TIER_TEXT[chip.tier]}`}>
            {chip.tier.toUpperCase()} · {valueWithUnit}
          </div>
          <div className="text-foreground/80 text-[11px] leading-snug">
            {chip.description}
          </div>
          <div className="text-muted-foreground text-[11px] leading-snug">
            {chip.tierExplanation}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function DeltaIndicator({ delta }: { delta: number | undefined }) {
  if (delta == null) {
    return null;
  }
  if (Math.abs(delta) < 1e-3) {
    return (
      <span className="ml-auto inline-flex items-center text-[10px] text-muted-foreground/60">
        <Minus className="h-3 w-3" />
      </span>
    );
  }
  const positive = delta > 0;
  const Icon = positive ? ArrowUp : ArrowDown;
  return (
    <span
      className={`ml-auto inline-flex items-center gap-0.5 text-[10px] font-mono ${
        positive ? "text-emerald-500" : "text-amber-500"
      }`}
      title={`Δ ${delta > 0 ? "+" : ""}${delta.toFixed(delta % 1 === 0 ? 0 : 1)} since last refresh`}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(delta) >= 100
        ? Math.round(Math.abs(delta))
        : Math.abs(delta).toFixed(Math.abs(delta) >= 10 ? 0 : 1)}
    </span>
  );
}
