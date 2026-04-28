import React, { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, ChevronDown } from "lucide-react";
import { Link } from "wouter";
import {
  useGetOverviewActivityStream,
  getGetOverviewActivityStreamQueryKey,
  getOverviewActivityStream,
  type OverviewActivityItem,
} from "@workspace/api-client-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/format";
import { PanelHeader } from "./PanelHeader";

const SEVERITY_BADGE: Record<string, string> = {
  critical: "border-destructive/50 text-destructive",
  warning: "border-amber-400/50 text-amber-400",
  watch: "border-amber-400/40 text-amber-400",
  info: "border-border/60 text-muted-foreground",
};

const KIND_LABELS: Record<string, string> = {
  shipment_milestone: "Shipment",
  alert: "Alert",
  recommendation_promoted: "Recommendation",
  order_state_change: "Order",
  cold_chain_event: "Cold chain",
  generic: "Event",
};

export function ActivityStreamPanel({ pageSize = 20 }: { pageSize?: number }) {
  const queryClient = useQueryClient();
  const params = useMemo(() => ({ limit: pageSize }), [pageSize]);
  const queryKey = useMemo(
    () => getGetOverviewActivityStreamQueryKey(params),
    [params],
  );
  const { data, isFetching, isLoading } = useGetOverviewActivityStream(params, {
    query: { queryKey },
  });

  const handleRefresh = React.useCallback(() => {
    setLoadedPages([]);
    return queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  const [loadedPages, setLoadedPages] = useState<OverviewActivityItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Reset cursor whenever the first page payload changes (e.g. after refresh).
  React.useEffect(() => {
    setNextCursor(data?.nextCursor ?? null);
  }, [data?.nextCursor, data?.generatedAt]);

  React.useEffect(() => {
    if (data) setLoadedPages([]);
  }, [data?.generatedAt]);

  const allItems = useMemo<OverviewActivityItem[]>(() => {
    const seen = new Set<string>();
    const merged: OverviewActivityItem[] = [];
    for (const it of [...(data?.items ?? []), ...loadedPages]) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      merged.push(it);
    }
    return merged;
  }, [data?.items, loadedPages]);

  const handleLoadMore = async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const page = await getOverviewActivityStream({
        limit: pageSize,
        cursor: nextCursor,
      });
      setLoadedPages((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor ?? null);
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <Card className="bg-card/60 backdrop-blur border-border overflow-hidden flex flex-col">
      <PanelHeader
        title="Activity Stream"
        icon={<Activity className="h-4 w-4 text-primary" />}
        generatedAt={data?.generatedAt}
        isRefreshing={isFetching}
        onRefresh={() => void handleRefresh()}
      />
      <div className="flex-1 overflow-y-auto max-h-[420px]">
        {isLoading ? (
          <div className="p-4 space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : allItems.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-8">
            No recent activity recorded.
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {allItems.map((it) => (
              <ActivityRow key={it.id} item={it} />
            ))}
          </ul>
        )}
      </div>
      {nextCursor && (
        <div className="border-t border-border/40 p-2 flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={handleLoadMore}
            disabled={isLoadingMore}
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 mr-1",
                isLoadingMore && "animate-pulse",
              )}
            />
            {isLoadingMore ? "Loading…" : "Load older"}
          </Button>
        </div>
      )}
    </Card>
  );
}

function ActivityRow({ item }: { item: OverviewActivityItem }) {
  const tsMs = useMemo(() => {
    const t = new Date(item.createdAt).getTime();
    return Number.isFinite(t) ? t : null;
  }, [item.createdAt]);

  const body = (
    <div className="px-3 py-2 hover:bg-muted/30 transition-colors">
      <div className="flex items-start gap-2">
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] uppercase tracking-wider shrink-0",
            SEVERITY_BADGE[item.severity] ?? SEVERITY_BADGE.info,
          )}
        >
          {KIND_LABELS[item.kind] ?? item.kind}
        </Badge>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground/90 leading-snug">
            {item.summary}
          </p>
          <div className="text-[10px] text-muted-foreground font-mono mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span title={item.createdAt}>
              {tsMs ? formatRelativeTime(tsMs) : "—"}
            </span>
            {item.nodeName && <span>· {item.nodeName}</span>}
            {item.actorRole && <span>· {item.actorRole}</span>}
          </div>
        </div>
      </div>
    </div>
  );

  if (item.deeplink) {
    return (
      <li>
        <Link href={item.deeplink} className="block">
          {body}
        </Link>
      </li>
    );
  }
  return <li>{body}</li>;
}
