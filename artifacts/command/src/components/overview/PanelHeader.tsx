import React from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/format";

export interface PanelHeaderProps {
  title: React.ReactNode;
  icon?: React.ReactNode;
  /** ISO timestamp from the panel's payload. */
  generatedAt: string | null | undefined;
  isRefreshing: boolean;
  onRefresh: () => void;
  /** Optional secondary action rendered before the refresh button. */
  trailing?: React.ReactNode;
  className?: string;
}

/**
 * Small per-panel header with a title, the payload's generatedAt freshness
 * chip, and a refresh affordance that only invalidates this panel's query.
 *
 * The freshness label re-derives once per render. It is parented under the
 * page-wide auto-refresh tick so the displayed staleness updates regularly
 * without a per-panel timer.
 */
export function PanelHeader({
  title,
  icon,
  generatedAt,
  isRefreshing,
  onRefresh,
  trailing,
  className,
}: PanelHeaderProps) {
  const generatedAtMs = React.useMemo(() => {
    if (!generatedAt) return null;
    const t = new Date(generatedAt).getTime();
    return Number.isFinite(t) ? t : null;
  }, [generatedAt]);

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-2 border-b border-border/50",
        className,
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <span className="text-sm font-medium truncate">{title}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span
          className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono"
          title={generatedAt ?? undefined}
        >
          {generatedAtMs ? formatRelativeTime(generatedAtMs) : "—"}
        </span>
        {trailing}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label="Refresh panel"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
          />
        </Button>
      </div>
    </div>
  );
}

const TIER_STYLES: Record<string, string> = {
  CRITICAL: "border-destructive/40 bg-destructive/15 text-destructive",
  WATCH: "border-amber-400/40 bg-amber-400/10 text-amber-400",
  NOMINAL: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
};

const TIER_CELL_STYLES: Record<string, string> = {
  CRITICAL: "bg-destructive/20 text-destructive border-destructive/40",
  WATCH: "bg-amber-400/15 text-amber-400 border-amber-400/40",
  NOMINAL: "bg-emerald-500/10 text-emerald-400 border-emerald-500/40",
};

export function tierBadgeClasses(tier: string | null | undefined): string {
  if (!tier) return "border-border/50 text-muted-foreground bg-muted/40";
  return TIER_STYLES[tier.toUpperCase()] ?? TIER_STYLES.NOMINAL!;
}

export function tierCellClasses(tier: string | null | undefined): string {
  if (!tier) return "bg-muted/30 text-muted-foreground border-border/40";
  return TIER_CELL_STYLES[tier.toUpperCase()] ?? TIER_CELL_STYLES.NOMINAL!;
}
