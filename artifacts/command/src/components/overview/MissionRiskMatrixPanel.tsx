import React, { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Grid3x3 } from "lucide-react";
import {
  useGetOverviewMissionRiskMatrix,
  getGetOverviewMissionRiskMatrixQueryKey,
} from "@workspace/api-client-react";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { PanelHeader, tierCellClasses } from "./PanelHeader";

export function MissionRiskMatrixPanel() {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => getGetOverviewMissionRiskMatrixQueryKey(), []);
  const { data, isFetching, isLoading } = useGetOverviewMissionRiskMatrix({
    query: { queryKey },
  });

  const handleRefresh = React.useCallback(
    () => queryClient.invalidateQueries({ queryKey }),
    [queryClient, queryKey],
  );

  const cellLookup = useMemo(() => {
    const map = new Map<string, NonNullable<typeof data>["cells"][number]>();
    if (!data) return map;
    for (const c of data.cells) {
      map.set(`${c.missionId}:${c.columnId}`, c);
    }
    return map;
  }, [data]);

  return (
    <Card className="bg-card/60 backdrop-blur border-border overflow-hidden">
      <PanelHeader
        title="Mission Risk Matrix"
        icon={<Grid3x3 className="h-4 w-4 text-primary" />}
        generatedAt={data?.generatedAt}
        isRefreshing={isFetching}
        onRefresh={() => void handleRefresh()}
      />
      <div className="overflow-x-auto">
        {isLoading || !data ? (
          <div className="p-4 space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border/50">
                <th className="text-left font-normal uppercase tracking-wider text-[10px] px-3 py-2 sticky left-0 bg-card/80 backdrop-blur">
                  Mission
                </th>
                {data.supplyColumns.map((col) => (
                  <th
                    key={col.id}
                    className="text-left font-normal uppercase tracking-wider text-[10px] px-3 py-2"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.missions.map((mission) => (
                <tr
                  key={mission.id}
                  className="border-b border-border/30 last:border-b-0"
                >
                  <td className="px-3 py-2 sticky left-0 bg-card/80 backdrop-blur">
                    <div className="font-medium text-foreground">
                      {mission.label}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {mission.siteCount} site
                      {mission.siteCount === 1 ? "" : "s"}
                    </div>
                  </td>
                  {data.supplyColumns.map((col) => {
                    const cell = cellLookup.get(`${mission.id}:${col.id}`);
                    return (
                      <td key={col.id} className="px-2 py-2 align-top">
                        {cell ? (
                          <div
                            className={cn(
                              "rounded border px-2 py-1.5",
                              tierCellClasses(cell.tier),
                            )}
                            title={cell.rationale}
                          >
                            <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider font-mono">
                              <span>{cell.tier}</span>
                              {cell.affectedSites > 0 && (
                                <span>{cell.affectedSites}</span>
                              )}
                            </div>
                            <div className="mt-0.5 text-[11px] leading-tight text-foreground/85 line-clamp-2">
                              {cell.rationale}
                            </div>
                          </div>
                        ) : (
                          <div className="text-muted-foreground text-[10px]">
                            —
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}
