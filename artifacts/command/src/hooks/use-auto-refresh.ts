import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

export interface UseAutoRefreshOptions {
  /**
   * Refresh interval in milliseconds. Use `0` (or any non-positive value)
   * to disable automatic refreshes — manual `refreshNow` calls still work.
   */
  intervalMs: number;
  /**
   * Query keys whose queries will be invalidated (and therefore refetched
   * if mounted) on every tick and on every `refreshNow` call.
   */
  queryKeys: QueryKey[];
}

export interface UseAutoRefreshResult {
  /** Trigger an immediate refresh. Resolves once the invalidations settle. */
  refreshNow: () => Promise<void>;
  /** True while a refresh (auto or manual) is in flight. */
  isRefreshing: boolean;
  /** Wall-clock timestamp (ms since epoch) of the last completed refresh. */
  lastUpdatedAt: number;
}

/**
 * Drive a periodic invalidation of the supplied React Query keys.
 *
 * Behavior:
 * - Pauses while the tab is hidden (Page Visibility API) and resumes on focus.
 * - Skips a tick if the previous refresh is still in flight (no stacking).
 * - Returns a `refreshNow` callback for manual refreshes.
 * - Returns `lastUpdatedAt` so callers can show a relative-time chip without
 *   re-fetching to compute "freshness".
 *
 * The hook is intentionally page-agnostic: pass any list of query keys.
 */
export function useAutoRefresh({
  intervalMs,
  queryKeys,
}: UseAutoRefreshOptions): UseAutoRefreshResult {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number>(() => Date.now());

  // Keep the latest queryKeys reference without triggering interval restarts
  // when the array identity changes between renders.
  const queryKeysRef = useRef(queryKeys);
  queryKeysRef.current = queryKeys;

  const inFlightRef = useRef(false);

  const refreshNow = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsRefreshing(true);
    try {
      await Promise.all(
        queryKeysRef.current.map((qk) =>
          queryClient.invalidateQueries({ queryKey: qk }),
        ),
      );
      setLastUpdatedAt(Date.now());
    } finally {
      inFlightRef.current = false;
      setIsRefreshing(false);
    }
  }, [queryClient]);

  useEffect(() => {
    if (!intervalMs || intervalMs <= 0) {
      // Manual mode — no timer, no visibility wiring needed.
      return;
    }

    let timerId: number | null = null;

    const start = () => {
      if (timerId != null) return;
      timerId = window.setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        void refreshNow();
      }, intervalMs);
    };

    const stop = () => {
      if (timerId != null) {
        window.clearInterval(timerId);
        timerId = null;
      }
    };

    const handleVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) {
        stop();
      } else {
        start();
        // Returning to the tab? Refresh immediately so the user sees
        // current data without waiting up to a full interval.
        void refreshNow();
      }
    };

    if (typeof document === "undefined" || !document.hidden) {
      start();
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }

    return () => {
      stop();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
    };
  }, [intervalMs, refreshNow]);

  return { refreshNow, isRefreshing, lastUpdatedAt };
}
