import React from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Crosshair } from "lucide-react";
import {
  useGetOverviewMissionRiskMatrix,
  getGetOverviewMissionRiskMatrixQueryKey,
  type MissionRiskCell,
} from "@workspace/api-client-react";
import { tierFromString, TIER_DOT, TIER_TEXT } from "./tier";

export function MissionRiskMatrix() {
  const [, setLocation] = useLocation();
  const queryKey = getGetOverviewMissionRiskMatrixQueryKey();
  const { data, isLoading } = useGetOverviewMissionRiskMatrix({
    query: { queryKey },
  });

  const cellLookup = React.useMemo(() => {
    const m = new Map<string, MissionRiskCell>();
    for (const c of data?.cells ?? []) {
      m.set(`${c.missionId}:${c.columnId}`, c);
    }
    return m;
  }, [data]);

  const handleCellClick = (cell: MissionRiskCell | undefined) => {
    if (!cell) return;
    if (cell.affectedSites > 0) {
      setLocation(`/network?focus=mission&missionId=${cell.missionId}&column=${cell.columnId}`);
    }
  };

  return (
    <Card
      className="bg-card/50 backdrop-blur border-border h-full"
      data-testid="mission-risk-matrix"
    >
      <CardHeader className="pb-2 border-b border-border/50">
        <CardTitle className="text-sm font-medium flex items-center gap-2 text-primary">
          <Crosshair className="h-4 w-4" />
          Mission-Risk Stoplight Matrix
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3">
        {isLoading && !data ? (
          <Skeleton className="h-44" />
        ) : !data || data.missions.length === 0 ? (
          <EmptyState />
        ) : (
          <TooltipProvider>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left text-[10px] uppercase tracking-wider text-muted-foreground font-normal py-1.5 pr-2">
                      Mission
                    </th>
                    {data.supplyColumns.map((col) => (
                      <th
                        key={col.id}
                        className="text-center text-[10px] uppercase tracking-wider text-muted-foreground font-normal py-1.5 px-1"
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.missions.map((row) => (
                    <tr
                      key={row.id}
                      className="border-t border-border/40"
                    >
                      <td className="py-2 pr-2">
                        <div className="font-medium text-foreground/90">
                          {row.label}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {row.siteCount} site{row.siteCount === 1 ? "" : "s"}
                        </div>
                      </td>
                      {data.supplyColumns.map((col) => {
                        const cell = cellLookup.get(`${row.id}:${col.id}`);
                        const tier = tierFromString(cell?.tier);
                        return (
                          <td
                            key={col.id}
                            className="py-2 px-1 text-center align-middle"
                          >
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => handleCellClick(cell)}
                                  data-testid={`matrix-cell-${row.id}-${col.id}`}
                                  className="inline-flex items-center justify-center group"
                                >
                                  <span
                                    className={`block h-4 w-4 rounded-full ${TIER_DOT[tier]} ring-1 ring-foreground/15 transition-transform group-hover:scale-110`}
                                  />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[260px]">
                                <div className="text-xs space-y-1">
                                  <div className="font-medium">
                                    {row.label} · {col.label}
                                  </div>
                                  <div className={`text-[11px] ${TIER_TEXT[tier]}`}>
                                    {tier.toUpperCase()}
                                    {cell?.affectedSites
                                      ? ` · ${cell.affectedSites} site${cell.affectedSites === 1 ? "" : "s"}`
                                      : ""}
                                  </div>
                                  <div className="text-muted-foreground text-[11px] leading-snug">
                                    {cell?.rationale ?? "No rationale available."}
                                  </div>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="text-xs text-muted-foreground p-6 text-center">
      No mission-risk data available.
    </div>
  );
}
