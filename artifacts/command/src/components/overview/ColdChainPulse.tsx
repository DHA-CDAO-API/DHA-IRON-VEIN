import React, { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity } from "lucide-react";
import {
  useGetOverviewColdChainPulse,
  getGetOverviewColdChainPulseQueryKey,
  type ColdChainPulseEvent,
} from "@workspace/api-client-react";
import { tierFromString, TIER_TEXT } from "./tier";

const WINDOW_MIN = 60;
const W = 520;
const H = 80;
const PADDING = 4;

export function ColdChainPulse() {
  const params = { windowMinutes: WINDOW_MIN };
  const queryKey = getGetOverviewColdChainPulseQueryKey(params);
  const { data, isLoading } = useGetOverviewColdChainPulse(params, {
    query: { queryKey },
  });
  const [, setLocation] = useLocation();
  const [hover, setHover] = useState<ColdChainPulseEvent | null>(null);

  const now = useMemo(
    () => (data?.generatedAt ? new Date(data.generatedAt).getTime() : Date.now()),
    [data?.generatedAt],
  );

  const events = data?.events ?? [];

  const points = useMemo(() => {
    return events
      .map((e) => {
        const t = new Date(e.occurredAt).getTime();
        const ageMin = (now - t) / 60_000;
        if (ageMin < 0 || ageMin > WINDOW_MIN) return null;
        const x = ((WINDOW_MIN - ageMin) / WINDOW_MIN) * (W - 2 * PADDING) + PADDING;
        const tier = tierFromString(e.severity);
        const sev = tier === "critical" ? 1 : tier === "watch" ? 0.6 : 0.3;
        const y = H - PADDING - sev * (H - 2 * PADDING);
        const color =
          tier === "critical"
            ? "rgb(220,64,76)"
            : tier === "watch"
              ? "rgb(232,168,76)"
              : "rgb(88,196,158)";
        return { x, y, color, event: e, sev };
      })
      .filter((p): p is NonNullable<typeof p> => p != null);
  }, [events, now]);

  // Build the underlying ECG baseline path. Between spikes the line dwells at
  // the bottom of the chart; at each spike the line jumps to the spike y, then
  // returns to baseline. This produces the characteristic ECG silhouette.
  const baselineY = H - PADDING;
  const path = useMemo(() => {
    if (points.length === 0) {
      return `M${PADDING},${baselineY} L${W - PADDING},${baselineY}`;
    }
    let d = `M${PADDING},${baselineY}`;
    const sorted = [...points].sort((a, b) => a.x - b.x);
    for (const p of sorted) {
      d += ` L${(p.x - 2).toFixed(1)},${baselineY}`;
      d += ` L${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      d += ` L${(p.x + 2).toFixed(1)},${baselineY}`;
    }
    d += ` L${W - PADDING},${baselineY}`;
    return d;
  }, [points, baselineY]);

  const handleSpikeClick = (e: ColdChainPulseEvent) => {
    setLocation(`/sites/${e.nodeId}?tab=blood`);
  };

  const counts = useMemo(() => {
    let c = 0,
      w = 0;
    for (const e of events) {
      const t = tierFromString(e.severity);
      if (t === "critical") c++;
      else if (t === "watch") w++;
    }
    return { critical: c, watch: w };
  }, [events]);

  return (
    <Card
      className="bg-card/50 backdrop-blur border-border h-full flex flex-col"
      data-testid="cold-chain-pulse-card"
    >
      <CardHeader className="pb-2 border-b border-border/50">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-primary">
            <Activity className="h-4 w-4" />
            Cold-Chain Pulse · last 60 min
          </CardTitle>
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider">
            <span className="text-destructive">
              {counts.critical} critical
            </span>
            <span className="text-amber-400">{counts.watch} watch</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 flex-1 flex flex-col">
        {isLoading && !data ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <>
            <div className="relative">
              <svg
                viewBox={`0 0 ${W} ${H}`}
                width="100%"
                height={H}
                preserveAspectRatio="none"
                className="bg-background/40 rounded border border-border/40"
                role="img"
                aria-label="Cold chain pulse waveform"
              >
                <line
                  x1={PADDING}
                  x2={W - PADDING}
                  y1={baselineY}
                  y2={baselineY}
                  stroke="rgba(148,163,184,0.2)"
                  strokeWidth={0.5}
                />
                <path
                  d={path}
                  stroke="rgb(148,163,184)"
                  strokeWidth={1}
                  fill="none"
                />
                {points.map((p, i) => (
                  <g key={i}>
                    <line
                      x1={p.x}
                      x2={p.x}
                      y1={baselineY}
                      y2={p.y}
                      stroke={p.color}
                      strokeWidth={2}
                    />
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={3}
                      fill={p.color}
                      onMouseEnter={() => setHover(p.event)}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => handleSpikeClick(p.event)}
                      style={{ cursor: "pointer" }}
                      data-testid={`pulse-spike-${p.event.id}`}
                    />
                  </g>
                ))}
              </svg>
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-muted-foreground font-mono">
              <span>−60m</span>
              <span>−30m</span>
              <span>now</span>
            </div>
            <div className="mt-2 text-xs min-h-[34px]">
              {hover ? (
                <div className="px-2 py-1 rounded bg-background/60 border border-border/50">
                  <div className="font-medium text-foreground/90">
                    {hover.assetName}{" "}
                    <span className="text-muted-foreground">
                      · {hover.nodeName}
                    </span>
                  </div>
                  <div
                    className={`text-[11px] ${TIER_TEXT[tierFromString(hover.severity)]}`}
                  >
                    {hover.severity} · {hover.recordedTempC.toFixed(1)}°C ·
                    Δ{hover.peakTempDeltaC.toFixed(1)}°C ·{" "}
                    {hover.affectedUnits} units
                  </div>
                </div>
              ) : events.length === 0 ? (
                <div className="text-muted-foreground text-[11px]">
                  No excursions in the last 60 minutes.
                </div>
              ) : (
                <div className="text-muted-foreground text-[11px]">
                  Hover a spike for asset detail · click to inspect site.
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
