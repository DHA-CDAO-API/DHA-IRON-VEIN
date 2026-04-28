import React, { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  AlertTriangle,
  Truck,
  ShoppingCart,
  Snowflake,
  Sparkles,
  Pause,
  Play,
} from "lucide-react";
import {
  useGetOverviewActivityStream,
  getGetOverviewActivityStreamQueryKey,
  type OverviewActivityItem,
  type OverviewActivityItemSeverity,
} from "@workspace/api-client-react";
import { tierFromString, TIER_TEXT, TIER_DOT } from "./tier";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";

const LIMIT = 30;

function severityToTier(s: OverviewActivityItemSeverity) {
  return tierFromString(s);
}

function iconForKind(kind: string) {
  const k = kind.toLowerCase();
  if (k.includes("alert")) return AlertTriangle;
  if (k.includes("ship")) return Truck;
  if (k.includes("order")) return ShoppingCart;
  if (k.includes("cold") || k.includes("excursion")) return Snowflake;
  if (k.includes("recommend")) return Sparkles;
  return Activity;
}

function fmtZulu(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}Z`;
}

export function LiveActivityStream() {
  const params = { limit: LIMIT };
  const queryKey = getGetOverviewActivityStreamQueryKey(params);
  const { data, isLoading } = useGetOverviewActivityStream(params, {
    query: { queryKey },
  });

  const reducedMotion = usePrefersReducedMotion();
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  // Auto-scroll loop. Skipped entirely when reduced-motion is on or the user
  // hovers the card; in those cases the stream is just a normal scrollable
  // list.
  useEffect(() => {
    if (reducedMotion) return;
    if (paused) return;
    const el = scrollRef.current;
    if (!el) return;

    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      const max = el.scrollHeight - el.clientHeight;
      if (max > 0) {
        offsetRef.current += dt * 0.012;
        if (offsetRef.current > max) {
          offsetRef.current = 0;
        }
        el.scrollTop = offsetRef.current;
      }
      rafRef.current = window.requestAnimationFrame(tick);
    };
    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
    };
  }, [paused, reducedMotion, data?.generatedAt]);

  const items = data?.items ?? [];

  return (
    <Card
      className="bg-card/50 backdrop-blur border-border h-full flex flex-col"
      data-testid="activity-stream-card"
    >
      <CardHeader className="pb-2 border-b border-border/50">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-primary">
            <Activity className="h-4 w-4" />
            Live Activity Stream
          </CardTitle>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            data-testid="activity-stream-pause"
            disabled={reducedMotion}
            title={reducedMotion ? "Auto-scroll disabled (reduced motion)" : paused ? "Resume" : "Pause"}
          >
            {paused || reducedMotion ? (
              <>
                <Play className="h-3 w-3" /> {reducedMotion ? "Static" : "Paused"}
              </>
            ) : (
              <>
                <Pause className="h-3 w-3" /> Auto
              </>
            )}
          </button>
        </div>
      </CardHeader>
      <CardContent
        className="p-0 flex-1 overflow-hidden"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {isLoading && !data ? (
          <div className="p-3 space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-xs text-muted-foreground p-6 text-center">
            No recent activity.
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="h-full overflow-y-auto"
            data-testid="activity-stream-list"
          >
            <ul>
              {items.map((it) => (
                <ActivityRow key={it.id} item={it} />
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityRow({ item }: { item: OverviewActivityItem }) {
  const tier = severityToTier(item.severity);
  const Icon = iconForKind(item.kind);
  const inner = (
    <div className="flex gap-2 items-start px-3 py-2 hover:bg-muted/30 transition-colors">
      <span
        className={`inline-block w-1 h-full self-stretch rounded ${TIER_DOT[tier]} shrink-0`}
        aria-hidden
      />
      <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${TIER_TEXT[tier]}`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-foreground/90 leading-snug">{item.summary}</p>
        <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-2 font-mono">
          <span>{fmtZulu(item.createdAt)}</span>
          {item.actorRole && <span>· {item.actorRole}</span>}
          {item.nodeName && <span>· {item.nodeName}</span>}
        </div>
      </div>
    </div>
  );

  if (item.deeplink) {
    return (
      <li
        className="border-t border-border/30 first:border-t-0"
        data-testid={`activity-${item.id}`}
      >
        <Link href={item.deeplink}>
          <div className="cursor-pointer">{inner}</div>
        </Link>
      </li>
    );
  }
  return (
    <li
      className="border-t border-border/30 first:border-t-0"
      data-testid={`activity-${item.id}`}
    >
      {inner}
    </li>
  );
}
