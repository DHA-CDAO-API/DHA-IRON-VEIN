import React from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/format";

export interface RefreshIntervalOption {
  /** Interval in milliseconds. `0` means manual (no auto-refresh). */
  value: number;
  label: string;
}

export const REFRESH_INTERVAL_OPTIONS: RefreshIntervalOption[] = [
  { value: 15_000, label: "15s" },
  { value: 30_000, label: "30s" },
  { value: 60_000, label: "1m" },
  { value: 300_000, label: "5m" },
  { value: 0, label: "Manual" },
];

export const DEFAULT_REFRESH_INTERVAL_MS = 60_000;

/**
 * Read a persisted interval from localStorage, falling back to the default.
 * Validates the stored value against the known option list so a stale or
 * tampered value never sneaks through.
 */
export function readPersistedInterval(
  storageKey: string,
  fallbackMs: number = DEFAULT_REFRESH_INTERVAL_MS,
): number {
  if (typeof window === "undefined") return fallbackMs;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw == null) return fallbackMs;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return fallbackMs;
    const allowed = REFRESH_INTERVAL_OPTIONS.some((o) => o.value === parsed);
    return allowed ? parsed : fallbackMs;
  } catch {
    return fallbackMs;
  }
}

export function writePersistedInterval(storageKey: string, value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, String(value));
  } catch {
    /* ignore quota / privacy-mode failures */
  }
}

export interface RefreshControlsProps {
  /** Interval in ms; `0` means manual. */
  intervalMs: number;
  onIntervalChange: (ms: number) => void;
  /** Wall-clock timestamp (ms) of last successful refresh. */
  lastUpdatedAt: number;
  isRefreshing: boolean;
  onRefreshNow: () => void;
  className?: string;
}

/**
 * Header controls for a page that auto-refreshes its data:
 * - "Updated Xs ago" chip (ticks once per second, no re-fetch)
 * - Manual "Refresh now" button (spinner while in flight)
 * - Interval picker (15s / 30s / 1m / 5m / Manual)
 *
 * Pair with `useAutoRefresh` and `readPersistedInterval` for a complete setup.
 */
export default function RefreshControls({
  intervalMs,
  onIntervalChange,
  lastUpdatedAt,
  isRefreshing,
  onRefreshNow,
  className,
}: RefreshControlsProps) {
  // Tick once per second so the chip's relative time updates without
  // triggering any data re-fetch on the page.
  const [now, setNow] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const isManual = intervalMs <= 0;
  const relative = formatRelativeTime(lastUpdatedAt, now);

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-xs",
        className,
      )}
    >
      <div
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border bg-card/60 backdrop-blur font-mono text-muted-foreground"
        aria-live="polite"
      >
        <span
          className={cn(
            "inline-block w-1.5 h-1.5 rounded-full",
            isManual
              ? "bg-muted-foreground/60"
              : isRefreshing
                ? "bg-amber-400 animate-pulse"
                : "bg-emerald-500",
          )}
          aria-hidden
        />
        <span className="text-muted-foreground/80 uppercase tracking-wider">
          Updated
        </span>
        <span className="text-foreground/90">{relative}</span>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-2 border-border bg-card/60 hover:bg-secondary"
        onClick={onRefreshNow}
        disabled={isRefreshing}
        aria-label="Refresh now"
      >
        <RefreshCw
          className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
        />
        <span className="hidden sm:inline">Refresh</span>
      </Button>

      <Select
        value={String(intervalMs)}
        onValueChange={(v) => onIntervalChange(Number.parseInt(v, 10))}
      >
        <SelectTrigger
          className="h-8 w-[110px] bg-card/60 border-border text-xs"
          aria-label="Auto-refresh interval"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {REFRESH_INTERVAL_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={String(opt.value)} className="text-xs">
              {opt.value === 0 ? "Manual" : `Every ${opt.label}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
