import React from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Network, ArrowRight } from "lucide-react";
import {
  useGetOverviewCascade,
  getGetOverviewCascadeQueryKey,
} from "@workspace/api-client-react";
import { tierFromString, TIER_BORDER, TIER_TEXT } from "./tier";

export function ConstraintCascade() {
  const queryKey = getGetOverviewCascadeQueryKey();
  const { data, isLoading } = useGetOverviewCascade({ query: { queryKey } });

  const top3 = (data?.scenarios ?? []).slice(0, 3);

  return (
    <Card
      className="bg-card/50 backdrop-blur border-border h-full flex flex-col"
      data-testid="cascade-card"
    >
      <CardHeader className="pb-2 border-b border-border/50">
        <CardTitle className="text-sm font-medium flex items-center gap-2 text-primary">
          <Network className="h-4 w-4" />
          Constraint Cascade
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 grid grid-cols-1 md:grid-cols-3 gap-2 flex-1">
        {isLoading && !data ? (
          <>
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </>
        ) : top3.length === 0 ? (
          <div className="text-xs text-muted-foreground p-6 text-center md:col-span-3">
            No single-point-of-failure cascades detected.
          </div>
        ) : (
          top3.map((s) => {
            const tier = tierFromString(s.severity);
            return (
              <Link key={s.id} href={`/sites/${s.triggerNodeId}`}>
                <div
                  data-testid={`cascade-${s.id}`}
                  className={`block h-full rounded-md border ${TIER_BORDER[tier]} bg-background/40 p-3 hover:bg-muted/30 cursor-pointer transition-colors`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge
                        variant="outline"
                        className={`${TIER_BORDER[tier]} ${TIER_TEXT[tier]} bg-background/50 text-[10px] uppercase tracking-wider shrink-0`}
                      >
                        {s.severity}
                      </Badge>
                      <span className="text-xs font-medium truncate text-foreground/90">
                        {s.triggerLabel}
                      </span>
                    </div>
                    <Badge
                      variant="outline"
                      className="border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground shrink-0"
                    >
                      {s.confidence} conf
                    </Badge>
                  </div>
                  <p className="text-xs text-foreground/80 leading-snug mb-1.5">
                    {s.narrative}
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{s.affectedSiteCount} site{s.affectedSiteCount === 1 ? "" : "s"} affected</span>
                    <span>·</span>
                    <span>−{Math.abs(s.projectedDosImpact).toFixed(1)} d DOS</span>
                    <span>·</span>
                    <span>+{s.leadTimeImpactHours}h lead</span>
                    <ArrowRight className="h-3 w-3 ml-auto text-primary/60" />
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
