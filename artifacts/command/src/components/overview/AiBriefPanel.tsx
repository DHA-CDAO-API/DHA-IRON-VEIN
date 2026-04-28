import React, { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles, AlertCircle } from "lucide-react";
import {
  useGetOverviewAiBrief,
  getGetOverviewAiBriefQueryKey,
  getOverviewAiBrief,
} from "@workspace/api-client-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelHeader } from "./PanelHeader";

const BULLET_LABELS: Array<{
  key: "topRisk" | "recommendedAction" | "change";
  label: string;
}> = [
  { key: "topRisk", label: "Top Risk" },
  { key: "recommendedAction", label: "Recommended Action" },
  { key: "change", label: "Change Since Last Brief" },
];

export function AiBriefPanel() {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => getGetOverviewAiBriefQueryKey(), []);
  const [isManualRefreshing, setIsManualRefreshing] = React.useState(false);

  const { data, isLoading, isFetching } = useGetOverviewAiBrief(undefined, {
    query: { queryKey },
  });

  const handleRefresh = React.useCallback(async () => {
    setIsManualRefreshing(true);
    try {
      // Force a server-side regeneration (bypasses the 60s cache) and seed it
      // back into React Query under the cached (no-refresh) key so the rest of
      // the page picks it up too.
      const fresh = await getOverviewAiBrief({ refresh: true });
      queryClient.setQueryData(queryKey, fresh);
    } finally {
      setIsManualRefreshing(false);
    }
  }, [queryClient, queryKey]);

  return (
    <Card className="bg-card/60 backdrop-blur border-border overflow-hidden">
      <PanelHeader
        title="AI Commander Brief"
        icon={<Sparkles className="h-4 w-4 text-primary" />}
        generatedAt={data?.generatedAt}
        isRefreshing={isManualRefreshing || isFetching}
        onRefresh={handleRefresh}
        trailing={
          <>
            {data?.fallback && (
              <Badge
                variant="outline"
                className="text-[10px] uppercase tracking-wider border-amber-400/50 text-amber-400"
                title="AI provider unreachable — showing deterministic fallback brief."
              >
                <AlertCircle className="h-3 w-3 mr-1" /> Fallback
              </Badge>
            )}
            {data && !data.fallback && (
              <Badge
                variant="outline"
                className="text-[10px] uppercase tracking-wider border-primary/40 text-primary"
                title={`${data.provider} · ${data.model}`}
              >
                {data.provider}
              </Badge>
            )}
          </>
        }
      />
      <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        {isLoading || !data
          ? BULLET_LABELS.map((b) => (
              <BriefSkeleton key={b.key} label={b.label} />
            ))
          : BULLET_LABELS.map((b) => (
              <BriefCard
                key={b.key}
                label={b.label}
                value={data.bullets[b.key]}
              />
            ))}
      </div>
    </Card>
  );
}

function BriefCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/50 bg-background/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-mono">
        {label}
      </div>
      <p className="text-sm leading-snug text-foreground/90">{value}</p>
    </div>
  );
}

function BriefSkeleton({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-border/50 bg-background/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-mono">
        {label}
      </div>
      <Skeleton className="h-4 w-full mb-1.5" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}
