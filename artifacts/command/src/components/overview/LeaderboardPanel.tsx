import React, { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trophy, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { Link } from "wouter";
import {
  useGetOverviewLeaderboard,
  getGetOverviewLeaderboardQueryKey,
} from "@workspace/api-client-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDOS } from "@/lib/format";
import { PanelHeader, tierBadgeClasses } from "./PanelHeader";

const CONSTRAINT_LABELS: Record<string, string> = {
  cold_chain: "Cold chain",
  reagents: "Reagents",
  blood: "Blood supply",
  donors: "Donor capacity",
};

export function LeaderboardPanel({ limit = 8 }: { limit?: number }) {
  const queryClient = useQueryClient();
  const params = useMemo(() => ({ limit }), [limit]);
  const queryKey = useMemo(
    () => getGetOverviewLeaderboardQueryKey(params),
    [params],
  );
  const { data, isFetching, isLoading } = useGetOverviewLeaderboard(params, {
    query: { queryKey },
  });

  const handleRefresh = React.useCallback(
    () => queryClient.invalidateQueries({ queryKey }),
    [queryClient, queryKey],
  );

  const entries = data?.entries ?? [];

  return (
    <Card className="bg-card/60 backdrop-blur border-border overflow-hidden">
      <PanelHeader
        title="Readiness Leaderboard"
        icon={<Trophy className="h-4 w-4 text-primary" />}
        generatedAt={data?.generatedAt}
        isRefreshing={isFetching}
        onRefresh={() => void handleRefresh()}
      />
      <div className="overflow-x-auto">
        {isLoading ? (
          <div className="p-4 space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-8">
            No blood-storing sites tracked yet.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border/50">
                <Th>Site</Th>
                <Th align="right">Viable units</Th>
                <Th align="right">DOS</Th>
                <Th align="right">Δ vs 24h</Th>
                <Th>7d trend</Th>
                <Th>Constraint</Th>
                <Th align="right">Tier</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr
                  key={e.nodeId}
                  className="border-b border-border/30 last:border-b-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-3 py-2">
                    <Link
                      href={e.deeplink}
                      className="font-medium text-foreground hover:text-primary transition-colors"
                    >
                      {e.nodeName}
                    </Link>
                    <div className="text-[10px] text-muted-foreground font-mono uppercase">
                      {e.nodeType}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {e.viableUnits.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {formatDOS(e.viableDaysOfSupply)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    <DeltaCell value={e.deltaDosVs24h} hasBaseline={e.hasBaseline} />
                  </td>
                  <td className="px-3 py-2 w-24">
                    <Sparkline points={e.sparkline.map((p) => p.value)} tier={e.tier} />
                  </td>
                  <td className="px-3 py-2 text-[11px] text-muted-foreground">
                    {e.constraintCategory
                      ? CONSTRAINT_LABELS[e.constraintCategory] ??
                        e.constraintCategory
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] uppercase tracking-wider",
                        tierBadgeClasses(e.tier),
                      )}
                    >
                      {e.tier}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "right";
}) {
  return (
    <th
      className={cn(
        "font-normal uppercase tracking-wider text-[10px] px-3 py-2",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

function DeltaCell({
  value,
  hasBaseline,
}: {
  value: number;
  hasBaseline: boolean;
}) {
  if (!hasBaseline) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (value === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Minus className="h-3 w-3" />
        0
      </span>
    );
  }
  const positive = value > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1",
        positive ? "text-emerald-500" : "text-destructive",
      )}
    >
      {positive ? (
        <ArrowUp className="h-3 w-3" />
      ) : (
        <ArrowDown className="h-3 w-3" />
      )}
      {Math.abs(value).toFixed(1)}d
    </span>
  );
}

function Sparkline({
  points,
  tier,
}: {
  points: number[];
  tier: string;
}) {
  if (points.length === 0) {
    return <div className="text-muted-foreground text-[10px]">—</div>;
  }
  const w = 80;
  const h = 24;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = Math.max(1e-6, max - min);
  const stepX = points.length > 1 ? w / (points.length - 1) : 0;
  const path = points
    .map((p, i) => {
      const x = i * stepX;
      const y = h - ((p - min) / range) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const stroke =
    tier === "CRITICAL"
      ? "rgb(220,64,76)"
      : tier === "WATCH"
        ? "rgb(232,168,76)"
        : "rgb(88,196,158)";
  const last = points[points.length - 1] ?? 0;
  const lastY = h - ((last - min) / range) * h;
  const lastX = (points.length - 1) * stepX;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r={2} fill={stroke} />
    </svg>
  );
}
