import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

// Always pull the largest selectable window from the server so the kind
// filter has a real population to draw from regardless of the operator's
// chosen display limit. The OpenAPI contract caps this at 100.
const FETCH_LIMIT = 100;
const DEFAULT_DISPLAY_LIMIT = 10;
const DISPLAY_LIMIT_OPTIONS = [10, 25, 50, 75, 100] as const;

// Kind families surfaced as filter chips. The server-side classifier in
// /overview/activity-stream collapses raw activity_entries.kind values down
// to one of these buckets (plus a generic catch-all).
type KindFamily =
  | "alert"
  | "shipment_milestone"
  | "order_state_change"
  | "cold_chain_event"
  | "recommendation_promoted"
  | "other";

const KIND_FAMILY_META: Record<
  KindFamily,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  alert: { label: "Alerts", icon: AlertTriangle },
  shipment_milestone: { label: "Shipments", icon: Truck },
  order_state_change: { label: "Orders", icon: ShoppingCart },
  cold_chain_event: { label: "Cold-chain", icon: Snowflake },
  recommendation_promoted: { label: "Recs", icon: Sparkles },
  other: { label: "Other", icon: Activity },
};

const FILTER_ORDER: KindFamily[] = [
  "alert",
  "shipment_milestone",
  "order_state_change",
  "cold_chain_event",
  "recommendation_promoted",
  "other",
];

function familyForKind(kind: string): KindFamily {
  const k = (kind ?? "").toLowerCase();
  if (k === "alert" || k.startsWith("alert")) return "alert";
  if (k === "shipment_milestone" || k.startsWith("shipment")) return "shipment_milestone";
  if (k === "order_state_change" || k.startsWith("order")) return "order_state_change";
  if (
    k === "cold_chain_event" ||
    k.startsWith("cold_chain") ||
    k.includes("temperature") ||
    k.includes("excursion")
  )
    return "cold_chain_event";
  if (k === "recommendation_promoted" || k.startsWith("recommend")) return "recommendation_promoted";
  return "other";
}

function severityToTier(s: OverviewActivityItemSeverity) {
  return tierFromString(s);
}

function iconForKind(kind: string) {
  return KIND_FAMILY_META[familyForKind(kind)].icon;
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
  const params = { limit: FETCH_LIMIT };
  const queryKey = getGetOverviewActivityStreamQueryKey(params);
  const { data, isLoading } = useGetOverviewActivityStream(params, {
    query: { queryKey },
  });

  const reducedMotion = usePrefersReducedMotion();
  const [paused, setPaused] = useState(false);
  const [displayLimit, setDisplayLimit] = useState<number>(DEFAULT_DISPLAY_LIMIT);
  // An empty set means "all kinds visible" — the chip toolbar is in
  // include-mode (clicking a chip toggles it on/off).
  const [activeKinds, setActiveKinds] = useState<Set<KindFamily>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const allItems = data?.items ?? [];

  // Per-family counts off the full fetched window so the chip badges
  // don't change as the operator narrows the display.
  const familyCounts = useMemo(() => {
    const out: Record<KindFamily, number> = {
      alert: 0,
      shipment_milestone: 0,
      order_state_change: 0,
      cold_chain_event: 0,
      recommendation_promoted: 0,
      other: 0,
    };
    for (const it of allItems) out[familyForKind(it.kind)] += 1;
    return out;
  }, [allItems]);

  const filteredItems = useMemo(() => {
    if (activeKinds.size === 0) return allItems;
    return allItems.filter((it) => activeKinds.has(familyForKind(it.kind)));
  }, [allItems, activeKinds]);

  const visibleItems = useMemo(
    () => filteredItems.slice(0, displayLimit),
    [filteredItems, displayLimit],
  );

  // Auto-scroll loop. Skipped entirely when reduced-motion is on, the user
  // hovers the card, or the visible list fits without overflow. Resets the
  // scroll position whenever the visible item set changes so the loop
  // restarts from the top instead of jumping to a now-out-of-range offset.
  useEffect(() => {
    offsetRef.current = 0;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [displayLimit, activeKinds, data?.generatedAt]);

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
  }, [paused, reducedMotion, data?.generatedAt, visibleItems.length]);

  function toggleKind(family: KindFamily) {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      if (next.has(family)) next.delete(family);
      else next.add(family);
      return next;
    });
  }

  function clearKinds() {
    setActiveKinds(new Set());
  }

  return (
    <Card
      className="bg-card/50 backdrop-blur border-border h-full flex flex-col"
      data-testid="activity-stream-card"
    >
      <CardHeader className="pb-2 border-b border-border/50 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-primary">
            <Activity className="h-4 w-4" />
            Live Activity Stream
            <span className="text-[10px] text-muted-foreground font-mono">
              · showing {visibleItems.length} of {filteredItems.length}
              {activeKinds.size > 0 && ` (filtered from ${allItems.length})`}
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              Show
              <Select
                value={String(displayLimit)}
                onValueChange={(v) => setDisplayLimit(Number(v))}
              >
                <SelectTrigger
                  className="h-7 w-[72px] text-xs"
                  data-testid="activity-stream-limit"
                  aria-label="Number of activity items to display"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISPLAY_LIMIT_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)} className="text-xs">
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              data-testid="activity-stream-pause"
              disabled={reducedMotion}
              title={
                reducedMotion
                  ? "Auto-scroll disabled (reduced motion)"
                  : paused
                    ? "Resume"
                    : "Pause"
              }
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
        </div>
        <div
          className="flex items-center gap-1.5 flex-wrap"
          data-testid="activity-stream-filters"
        >
          <FilterChip
            label="All"
            count={allItems.length}
            active={activeKinds.size === 0}
            onClick={clearKinds}
          />
          {FILTER_ORDER.map((family) => {
            const meta = KIND_FAMILY_META[family];
            const Icon = meta.icon;
            const count = familyCounts[family];
            // Hide families with zero items so the toolbar doesn't show
            // dead chips on a quiet feed.
            if (count === 0 && !activeKinds.has(family)) return null;
            return (
              <FilterChip
                key={family}
                label={meta.label}
                count={count}
                active={activeKinds.has(family)}
                icon={Icon}
                onClick={() => toggleKind(family)}
              />
            );
          })}
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
        ) : visibleItems.length === 0 ? (
          <div className="text-xs text-muted-foreground p-6 text-center">
            {activeKinds.size > 0
              ? "No activity matches the current filters."
              : "No recent activity."}
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="h-full overflow-y-auto"
            data-testid="activity-stream-list"
          >
            <ul>
              {visibleItems.map((it) => (
                <ActivityRow key={it.id} item={it} />
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FilterChip({
  label,
  count,
  active,
  icon: Icon,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
        active
          ? "border-primary bg-primary/15 text-primary"
          : "border-border text-muted-foreground hover:border-border/80 hover:bg-muted/40 hover:text-foreground"
      }`}
      data-testid={`activity-stream-filter-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {Icon ? <Icon className="h-3 w-3" /> : null}
      <span>{label}</span>
      <span className="font-mono text-[10px] opacity-70">({count})</span>
    </button>
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
