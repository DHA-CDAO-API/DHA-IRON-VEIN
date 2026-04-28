import React, { useEffect, useRef } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingDown, ArrowUp, ArrowDown, Minus, Timer } from "lucide-react";
import {
  useGetOverviewLeaderboard,
  getGetOverviewLeaderboardQueryKey,
  type ReadinessLeaderboardEntry,
} from "@workspace/api-client-react";
import { tierFromString, TIER_DOT, TIER_TEXT } from "./tier";
import { formatDOS } from "@/lib/format";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";

const LIMIT = 10;

export function TimeToFailLeaderboard() {
  const params = { limit: LIMIT };
  const queryKey = getGetOverviewLeaderboardQueryKey(params);
  const { data, isLoading } = useGetOverviewLeaderboard(params, {
    query: { queryKey },
  });

  const reducedMotion = usePrefersReducedMotion();

  // Track previous rank for each entry so we can show ↑/↓ vs the prior tick.
  const prevRankRef = useRef<Map<string, number>>(new Map());
  const ranks = new Map<string, number>();
  (data?.entries ?? []).forEach((e, i) => ranks.set(e.nodeId, i));
  const prevRanks = prevRankRef.current;
  useEffect(() => {
    prevRankRef.current = new Map(ranks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.generatedAt]);

  return (
    <Card
      className="bg-card/50 backdrop-blur border-border h-full flex flex-col"
      data-testid="leaderboard-card"
    >
      <CardHeader className="pb-2 border-b border-border/50">
        <CardTitle className="text-sm font-medium flex items-center gap-2 text-primary">
          <Timer className="h-4 w-4" />
          Time-to-Fail Leaderboard
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 overflow-y-auto flex-1">
        {isLoading && !data ? (
          <div className="p-3 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : !data || data.entries.length === 0 ? (
          <div className="text-xs text-muted-foreground p-6 text-center">
            No fragile sites — theater is healthy.
          </div>
        ) : (
          <ul>
            {data.entries.map((entry, idx) => (
              <LeaderboardRow
                key={entry.nodeId}
                entry={entry}
                rank={idx + 1}
                prevRank={prevRanks.get(entry.nodeId)}
                animated={!reducedMotion}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function LeaderboardRow({
  entry,
  rank,
  prevRank,
  animated,
}: {
  entry: ReadinessLeaderboardEntry;
  rank: number;
  prevRank: number | undefined;
  animated: boolean;
}) {
  const tier = tierFromString(entry.tier);
  let rankDelta: number | null = null;
  if (prevRank != null) rankDelta = prevRank - (rank - 1);

  return (
    <li
      data-testid={`leaderboard-row-${entry.nodeId}`}
      className={`border-t border-border/40 first:border-t-0 transition-all ${animated ? "duration-500 ease-out" : ""}`}
    >
      <Link href={entry.deeplink || `/sites/${entry.nodeId}`}>
        <div className="px-3 py-2 hover:bg-muted/40 cursor-pointer flex items-center gap-3">
          <div className="text-[11px] font-mono text-muted-foreground w-6 text-right shrink-0">
            #{rank}
          </div>
          <span
            className={`inline-block w-1.5 h-6 rounded ${TIER_DOT[tier]} shrink-0`}
            aria-hidden
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium truncate text-foreground/90">
                {entry.nodeName}
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider shrink-0">
                {entry.nodeType}
              </span>
            </div>
            <div className="flex items-baseline gap-2 text-[11px] mt-0.5">
              <span className={TIER_TEXT[tier]}>
                {formatDOS(entry.viableDaysOfSupply)} d DOS
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">
                stockout in {formatDOS(entry.daysUntilStockout)} d
              </span>
              {entry.constraintCategory && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground capitalize">
                    {entry.constraintCategory.replace(/_/g, " ")}
                  </span>
                </>
              )}
            </div>
          </div>
          <Sparkline points={entry.sparkline} animated={animated} />
          <DosDelta entry={entry} />
          <RankDelta delta={rankDelta} />
        </div>
      </Link>
    </li>
  );
}

function Sparkline({
  points,
  animated,
}: {
  points: ReadinessLeaderboardEntry["sparkline"];
  animated: boolean;
}) {
  if (!points || points.length < 2) {
    return <div className="w-16 h-6 shrink-0" aria-hidden />;
  }
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 64;
  const H = 24;
  const stepX = W / (points.length - 1);
  const path = points
    .map((p, i) => {
      const x = i * stepX;
      const y = H - ((p.value - min) / range) * H;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const lastVal = values[values.length - 1];
  const firstVal = values[0];
  const stroke = lastVal < firstVal ? "rgb(220,64,76)" : "rgb(88,196,158)";

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="shrink-0"
      role="img"
      aria-label="DOS trend"
    >
      <path
        d={path}
        stroke={stroke}
        strokeWidth={1.25}
        fill="none"
        className={animated ? "transition-all duration-500" : ""}
      />
    </svg>
  );
}

function DosDelta({ entry }: { entry: ReadinessLeaderboardEntry }) {
  if (!entry.hasBaseline) {
    return (
      <span className="w-12 text-right text-[10px] text-muted-foreground/60 shrink-0">
        —
      </span>
    );
  }
  const d = entry.deltaDosVs24h;
  if (Math.abs(d) < 0.05) {
    return (
      <span className="w-12 inline-flex items-center justify-end text-[10px] text-muted-foreground/60 shrink-0">
        <Minus className="h-3 w-3" />
      </span>
    );
  }
  const positive = d > 0;
  const Icon = positive ? ArrowUp : ArrowDown;
  return (
    <span
      className={`w-12 inline-flex items-center justify-end gap-0.5 text-[10px] font-mono shrink-0 ${
        positive ? "text-emerald-500" : "text-destructive"
      }`}
      title={`Δ ${d > 0 ? "+" : ""}${d.toFixed(1)} d vs 24h`}
    >
      {positive ? "+" : ""}
      {d.toFixed(1)}
      <Icon className="h-3 w-3" />
    </span>
  );
}

function RankDelta({ delta }: { delta: number | null }) {
  if (delta == null || delta === 0) {
    return (
      <span className="w-6 inline-flex items-center justify-end text-[10px] text-muted-foreground/40 shrink-0">
        <TrendingDown className="h-3 w-3 invisible" />
      </span>
    );
  }
  const Icon = delta > 0 ? ArrowUp : ArrowDown;
  return (
    <span
      className={`w-6 inline-flex items-center justify-end text-[10px] shrink-0 ${
        delta > 0 ? "text-emerald-500" : "text-destructive"
      }`}
      title={`Rank ${delta > 0 ? "improved" : "worsened"} by ${Math.abs(delta)}`}
    >
      <Icon className="h-3 w-3" />
    </span>
  );
}
