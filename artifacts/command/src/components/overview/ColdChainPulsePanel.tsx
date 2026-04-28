import React, { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Thermometer, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import {
  useGetOverviewColdChainPulse,
  getGetOverviewColdChainPulseQueryKey,
} from "@workspace/api-client-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { PanelHeader, tierBadgeClasses } from "./PanelHeader";

const SEVERITY_TO_TIER: Record<string, "CRITICAL" | "WATCH" | "NOMINAL"> = {
  CRITICAL: "CRITICAL",
  WARNING: "WATCH",
  WATCH: "WATCH",
};

export function ColdChainPulsePanel({
  windowMinutes = 60,
}: {
  windowMinutes?: number;
}) {
  const queryClient = useQueryClient();
  const params = useMemo(() => ({ windowMinutes }), [windowMinutes]);
  const queryKey = useMemo(
    () => getGetOverviewColdChainPulseQueryKey(params),
    [params],
  );
  const { data, isFetching, isLoading } = useGetOverviewColdChainPulse(params, {
    query: { queryKey },
  });

  const handleRefresh = React.useCallback(
    () => queryClient.invalidateQueries({ queryKey }),
    [queryClient, queryKey],
  );

  const events = data?.events ?? [];

  return (
    <Card className="bg-card/60 backdrop-blur border-border overflow-hidden flex flex-col">
      <PanelHeader
        title={
          <span>
            Cold-Chain Pulse{" "}
            <span className="text-muted-foreground font-mono text-[10px]">
              · last {windowMinutes}m
            </span>
          </span>
        }
        icon={<Thermometer className="h-4 w-4 text-primary" />}
        generatedAt={data?.generatedAt}
        isRefreshing={isFetching}
        onRefresh={() => void handleRefresh()}
      />
      <div className="p-3 flex-1 overflow-y-auto max-h-[420px] space-y-2">
        {isLoading ? (
          <>
            <Skeleton className="h-20 rounded-md" />
            <Skeleton className="h-20 rounded-md" />
          </>
        ) : events.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-8 flex flex-col items-center gap-2">
            <ShieldCheck className="h-8 w-8 text-emerald-500/60" />
            <span>All clear — no excursions in the last {windowMinutes} minutes.</span>
          </div>
        ) : (
          events
            .slice()
            .reverse()
            .map((e) => {
              const tier = SEVERITY_TO_TIER[e.severity] ?? "WATCH";
              const occurred = new Date(e.occurredAt);
              return (
                <div
                  key={e.id}
                  className={cn(
                    "rounded-md border p-3 bg-background/40",
                    tierBadgeClasses(tier),
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0">
                      <Link
                        href={`/sites/${e.nodeId}`}
                        className="font-medium text-sm text-foreground hover:text-primary transition-colors block truncate"
                      >
                        {e.nodeName}
                      </Link>
                      <div className="text-[10px] text-muted-foreground font-mono uppercase truncate">
                        {e.assetType} · {e.assetName}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] uppercase tracking-wider",
                          tierBadgeClasses(tier),
                        )}
                      >
                        {e.severity}
                      </Badge>
                      {e.recovered && (
                        <Badge
                          variant="outline"
                          className="text-[10px] uppercase tracking-wider border-emerald-500/40 text-emerald-500"
                        >
                          Recovered
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2 text-[11px]">
                    <Stat
                      label="Recorded"
                      value={`${e.recordedTempC.toFixed(1)}°C`}
                    />
                    <Stat
                      label="Δ vs target"
                      value={`${e.peakTempDeltaC > 0 ? "+" : ""}${e.peakTempDeltaC.toFixed(1)}°`}
                    />
                    <Stat
                      label="Affected units"
                      value={e.affectedUnits.toLocaleString()}
                    />
                  </div>
                  <div className="mt-2 text-[10px] text-muted-foreground font-mono">
                    {occurred.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · target {e.targetTempMinC}–{e.targetTempMaxC}°C
                  </div>
                  {e.notes && (
                    <div className="mt-1 text-[11px] text-foreground/80 leading-snug">
                      {e.notes}
                    </div>
                  )}
                </div>
              );
            })
        )}
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border/40 bg-background/40 px-2 py-1">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-mono">
        {label}
      </div>
      <div className="text-xs font-semibold text-foreground">{value}</div>
    </div>
  );
}
