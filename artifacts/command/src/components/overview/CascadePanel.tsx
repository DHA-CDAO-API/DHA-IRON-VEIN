import React, { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Workflow, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import {
  useGetOverviewCascade,
  getGetOverviewCascadeQueryKey,
} from "@workspace/api-client-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { PanelHeader, tierBadgeClasses } from "./PanelHeader";

const TRIGGER_LABELS: Record<string, string> = {
  hub_loss: "Hub loss",
  generator_failure: "Generator failure",
  route_interdiction: "Route interdiction",
};

export function CascadePanel() {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => getGetOverviewCascadeQueryKey(), []);
  const { data, isFetching, isLoading } = useGetOverviewCascade({
    query: { queryKey },
  });

  const handleRefresh = React.useCallback(
    () => queryClient.invalidateQueries({ queryKey }),
    [queryClient, queryKey],
  );

  const scenarios = data?.scenarios ?? [];

  return (
    <Card className="bg-card/60 backdrop-blur border-border overflow-hidden">
      <PanelHeader
        title="Cascade Scenarios"
        icon={<Workflow className="h-4 w-4 text-primary" />}
        generatedAt={data?.generatedAt}
        isRefreshing={isFetching}
        onRefresh={() => void handleRefresh()}
      />
      <div className="p-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
        {isLoading ? (
          <>
            <Skeleton className="h-40 rounded-md" />
            <Skeleton className="h-40 rounded-md" />
            <Skeleton className="h-40 rounded-md" />
          </>
        ) : scenarios.length === 0 ? (
          <div className="col-span-full text-center text-xs text-muted-foreground py-8">
            No single-point-of-failure cascades detected.
          </div>
        ) : (
          scenarios.map((s, idx) => (
            <div
              key={s.id}
              className={cn(
                "rounded-md border bg-background/40 p-3 flex flex-col gap-2",
                tierBadgeClasses(s.severity),
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    #{idx + 1}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] uppercase tracking-wider",
                      tierBadgeClasses(s.severity),
                    )}
                  >
                    {s.severity}
                  </Badge>
                </div>
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase tracking-wider border-border/60 text-muted-foreground"
                  title="Confidence in scenario projection"
                >
                  {s.confidence}
                </Badge>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                  {TRIGGER_LABELS[s.triggerType] ?? s.triggerType}
                </div>
                <Link
                  href={`/sites/${s.triggerNodeId}`}
                  className="text-sm font-semibold text-foreground hover:text-primary transition-colors block truncate"
                  title={s.triggerLabel}
                >
                  {s.triggerLabel}
                </Link>
              </div>

              <p className="text-xs text-foreground/85 leading-snug">
                {s.narrative}
              </p>

              <div className="grid grid-cols-3 gap-2 text-[11px] mt-auto">
                <Stat
                  label="Sites"
                  value={s.affectedSiteCount.toString()}
                />
                <Stat
                  label="DOS impact"
                  value={`-${s.projectedDosImpact.toFixed(1)}d`}
                />
                <Stat
                  label="Lead time"
                  value={`${Math.round(s.leadTimeImpactHours)}h`}
                />
              </div>

              {s.affectedSiteNames.length > 0 && (
                <div className="text-[10px] text-muted-foreground border-t border-border/40 pt-2 mt-1 flex items-start gap-1">
                  <ArrowRight className="h-3 w-3 mt-0.5 shrink-0" />
                  <span className="line-clamp-2">
                    {s.affectedSiteNames.slice(0, 4).join(", ")}
                    {s.affectedSiteNames.length > 4
                      ? ` +${s.affectedSiteNames.length - 4} more`
                      : ""}
                  </span>
                </div>
              )}
            </div>
          ))
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
