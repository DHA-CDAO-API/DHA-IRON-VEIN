import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, RefreshCw, AlertCircle, Lightbulb, GitCompare } from "lucide-react";
import {
  useGetOverviewAiBrief,
  getGetOverviewAiBriefQueryKey,
  getOverviewAiBrief,
  type AiOverviewBrief,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatRelativeTime } from "@/lib/format";

export function AiBriefCard() {
  const queryClient = useQueryClient();
  const baseKey = getGetOverviewAiBriefQueryKey();
  const { data, isLoading, isFetching } = useGetOverviewAiBrief(undefined, {
    query: { queryKey: baseKey },
  });

  const [isRegenerating, setIsRegenerating] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      const fresh = await getOverviewAiBrief({ refresh: true });
      queryClient.setQueryData(baseKey, fresh);
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <Card
      className="bg-card/50 backdrop-blur border-border"
      data-testid="ai-brief-card"
    >
      <CardHeader className="pb-2 border-b border-border/50">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-primary">
            <Sparkles className="h-4 w-4" />
            AI Commander Brief
          </CardTitle>
          <div className="flex items-center gap-2">
            <ModelBadge data={data} />
            <span className="text-[10px] text-muted-foreground">
              {data?.generatedAt
                ? `generated ${formatRelativeTime(new Date(data.generatedAt).getTime(), now)}`
                : ""}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRegenerate}
              disabled={isRegenerating || isFetching}
              data-testid="ai-brief-regenerate"
              className="h-7 px-2 text-xs"
            >
              <RefreshCw
                className={`h-3 w-3 mr-1 ${isRegenerating ? "animate-spin" : ""}`}
              />
              Regenerate
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        {isLoading && !data ? (
          <div className="space-y-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Bullet
              icon={<AlertCircle className="h-4 w-4 text-destructive" />}
              label="Top risk"
              text={data?.bullets?.topRisk ?? "—"}
            />
            <Bullet
              icon={<Lightbulb className="h-4 w-4 text-amber-400" />}
              label="Recommended action"
              text={data?.bullets?.recommendedAction ?? "—"}
            />
            <Bullet
              icon={<GitCompare className="h-4 w-4 text-primary" />}
              label="Top change"
              text={data?.bullets?.change ?? "—"}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ModelBadge({ data }: { data: AiOverviewBrief | undefined }) {
  if (!data) return null;
  if (data.fallback) {
    return (
      <Badge
        variant="outline"
        className="border-amber-400/40 text-amber-400 bg-amber-400/10 text-[10px] uppercase tracking-wider"
      >
        Fallback
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-primary/30 text-primary bg-primary/5 text-[10px] uppercase tracking-wider"
      title={`${data.provider} · ${data.model}${data.cached ? " · cached" : ""}`}
    >
      {data.provider}/{data.model}
      {data.cached && <span className="ml-1 opacity-70">·cached</span>}
    </Badge>
  );
}

function Bullet({
  icon,
  label,
  text,
}: {
  icon: React.ReactNode;
  label: string;
  text: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2 rounded-md bg-background/40 border border-border/50">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="text-sm text-foreground leading-snug">{text}</p>
    </div>
  );
}
