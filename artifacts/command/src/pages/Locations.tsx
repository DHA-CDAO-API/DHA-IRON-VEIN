import React, { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useListSites,
  getListSitesQueryKey,
  useGetNetworkSnapshot,
  getGetNetworkSnapshotQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SortableTable } from "@/components/ui/sortable-table";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, AlertTriangle, ShieldAlert, Globe2 } from "lucide-react";
import {
  formatDOS,
  dosClass,
  categoryKey,
  categoryMatches,
  type CategoryFilter,
} from "@/lib/format";
import { CategoryFilterToggle } from "@/components/CategoryFilterToggle";
import { EchelonRoleBadge } from "@/components/EchelonRoleBadge";

function threatTier(riskScore: number): { label: string; cls: string } {
  if (riskScore >= 70) return { label: "TIER 1", cls: "border-destructive text-destructive bg-destructive/10" };
  if (riskScore >= 40) return { label: "TIER 2", cls: "border-amber-500 text-amber-500 bg-amber-500/10" };
  if (riskScore >= 15) return { label: "TIER 3", cls: "border-yellow-500 text-yellow-500 bg-yellow-500/10" };
  return { label: "TIER 4", cls: "border-emerald-500 text-emerald-500 bg-emerald-500/10" };
}

// The network snapshot exposes per-site DOS broken out by category. We use
// these breakdowns when the operator narrows the table to a single supply
// class (Blood vs. Medical) so DOS and crit-item totals reflect just the
// items they actually care about. Mirrors the casualty-planner toggle
// semantics: "blood" = blood_products only; "medical" = everything else.
function categoryDosForFilter(
  filter: CategoryFilter,
  dosByCategory: Record<string, number> | undefined,
  fallback: number,
): number {
  if (filter === "both") return fallback;
  if (!dosByCategory) return 999;
  if (filter === "blood") {
    const v = dosByCategory.blood_products;
    return Number.isFinite(v) ? v : 999;
  }
  // Medical: take the worst (lowest) DOS across non-blood categories so
  // a critically-low PPE item still surfaces under the Medical view.
  let min: number | null = null;
  for (const [k, v] of Object.entries(dosByCategory)) {
    if (categoryKey(k) === "blood_products") continue;
    if (!Number.isFinite(v)) continue;
    if (min == null || v < min) min = v;
  }
  return min ?? 999;
}

type SiteRow = {
  nodeId: string;
  name: string;
  type: string;
  role?: string | null;
  country: string;
  riskScore: number;
  daysOfSupply: number;
  // DOS as it should be displayed for the current filter (may be the
  // category-specific value or the original aggregate when "Both").
  displayedDos: number;
  // Number of critical items in the current category — best-effort,
  // computed from `topCriticalItems` (top 3 per node) when filtered, or
  // the API's pre-aggregated `criticalShortItems` when "Both".
  displayedCritItems: number;
  openAlerts: number;
};

export default function Locations() {
  const [filter, setFilter] = useState<CategoryFilter>("both");

  const { data: sites, isLoading: sitesLoading } = useListSites({
    query: { queryKey: getListSitesQueryKey() },
  });
  const { data: snapshot, isLoading: snapLoading } = useGetNetworkSnapshot({
    query: { queryKey: getGetNetworkSnapshotQueryKey() },
  });

  const nodeMeta = useMemo(() => {
    const m = new Map<string, { country?: string | null; type: string }>();
    for (const n of snapshot?.nodes ?? []) {
      m.set(n.id, { country: n.countryCode ?? null, type: n.type });
    }
    return m;
  }, [snapshot]);

  // Pull the per-node category breakdowns out of the snapshot so the
  // table can re-display DOS / crit counts under the current filter
  // without needing an extra API round-trip.
  const riskByNode = useMemo(() => {
    const m = new Map<
      string,
      {
        dosByCategory: Record<string, number>;
        topCriticalItems: Array<{ category?: string }>;
      }
    >();
    for (const r of snapshot?.riskByNode ?? []) {
      m.set(r.nodeId, {
        dosByCategory: (r.dosByCategory ?? {}) as Record<string, number>,
        topCriticalItems: (r.topCriticalItems ?? []) as Array<{ category?: string }>,
      });
    }
    return m;
  }, [snapshot]);

  const rows = useMemo<SiteRow[]>(() => {
    return (sites ?? []).map((s) => {
      const meta = nodeMeta.get(s.nodeId);
      const risk = riskByNode.get(s.nodeId);
      const fallbackDos = s.daysOfSupply ?? 999;
      const displayedDos = categoryDosForFilter(
        filter,
        risk?.dosByCategory,
        fallbackDos,
      );
      let displayedCritItems = s.criticalShortItems ?? 0;
      if (filter !== "both") {
        // Approximate the category-specific count from the top critical
        // items the snapshot ships with each node (capped at 3). It's
        // not the full count, but it's the most accurate signal we have
        // without expanding the snapshot payload.
        const topMatching = (risk?.topCriticalItems ?? []).filter((it) =>
          categoryMatches(filter, it.category ?? null),
        );
        displayedCritItems = topMatching.length;
      }
      return {
        nodeId: s.nodeId,
        name: s.name,
        type: s.type,
        role: s.role,
        country: meta?.country ?? "—",
        riskScore: s.riskScore,
        daysOfSupply: s.daysOfSupply ?? 999,
        displayedDos,
        displayedCritItems,
        openAlerts: s.openAlerts ?? 0,
      };
    });
  }, [sites, nodeMeta, riskByNode, filter]);

  // When narrowed by category, hide sites that simply don't carry items
  // in that supply class — otherwise the table fills up with rows that
  // all show "∞ DOS / 0 crit", which is just noise. "Both" shows
  // everything as before.
  const visibleRows = useMemo(() => {
    if (filter === "both") return rows;
    return rows.filter(
      (r) => r.displayedDos < 999 || r.displayedCritItems > 0,
    );
  }, [rows, filter]);

  const totals = useMemo(() => {
    const total = visibleRows.length;
    const critical = visibleRows.filter((r) => r.displayedDos <= 3).length;
    const watch = visibleRows.filter((r) => {
      const d = r.displayedDos;
      return d > 3 && d <= 7;
    }).length;
    const openAlerts = visibleRows.reduce((s, r) => s + (r.openAlerts ?? 0), 0);
    return { total, critical, watch, openAlerts };
  }, [visibleRows]);

  const isLoading = sitesLoading || snapLoading;

  const summaryLabelSuffix =
    filter === "blood" ? " · Blood" : filter === "medical" ? " · Medical" : "";

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-y-auto bg-background text-foreground">
      <div className="flex items-start justify-between shrink-0 border-b border-border pb-4 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Building2 className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold uppercase tracking-wider">Locations</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Every MTF, hub and forward node in the AOR. Click a row to drill into its inventory, alerts and forecast.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Supply class
          </span>
          <CategoryFilterToggle
            value={filter}
            onChange={setFilter}
            testId="locations"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 shrink-0">
        <SummaryCard
          label={`Sites${summaryLabelSuffix}`}
          value={totals.total}
          icon={<Globe2 className="h-5 w-5 text-primary/60" />}
        />
        <SummaryCard
          label={`Critical (≤3 DOS)${summaryLabelSuffix}`}
          value={totals.critical}
          accent={totals.critical > 0 ? "destructive" : undefined}
          icon={<ShieldAlert className="h-5 w-5 text-destructive/60" />}
        />
        <SummaryCard
          label={`Watch (≤7 DOS)${summaryLabelSuffix}`}
          value={totals.watch}
          accent={totals.watch > 0 ? "amber" : undefined}
          icon={<AlertTriangle className="h-5 w-5 text-amber-500/60" />}
        />
        <SummaryCard
          label="Open Alerts"
          value={totals.openAlerts}
          accent={totals.openAlerts > 0 ? "destructive" : undefined}
          icon={<AlertTriangle className="h-5 w-5 text-destructive/60" />}
        />
      </div>

      <Card className="bg-card/50 border-border flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="px-4 py-3 border-b border-border/50 bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground font-medium flex items-center justify-between">
          <span>Site Roster</span>
          <span>
            {visibleRows.length} sites
            {filter !== "both" && rows.length !== visibleRows.length && (
              <span className="ml-1 text-muted-foreground/70">
                of {rows.length}
              </span>
            )}
          </span>
        </div>
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground" data-testid="locations-empty">
              {filter === "blood"
                ? "No sites are tracking blood-product inventory right now."
                : filter === "medical"
                  ? "No sites are tracking medical / supply inventory right now."
                  : "No locations available"}
            </div>
          ) : (
            <SortableTable
              stickyHeader
              initialSort={{ key: "dos", direction: "asc" }}
              data={visibleRows}
              rowKey={(r) => r.nodeId}
              emptyMessage="No locations available"
              columns={[
                {
                  key: "name",
                  label: "Name",
                  sortAccessor: (r) => r.name,
                  render: (r) => (
                    <Link href={`/sites/${r.nodeId}`} className="font-medium hover:text-primary hover:underline">
                      {r.name}
                    </Link>
                  ),
                },
                {
                  key: "type",
                  label: "Type",
                  sortAccessor: (r) => r.type,
                  render: (r) => (
                    <Badge variant="outline" className="text-xs font-mono">
                      {r.type}
                    </Badge>
                  ),
                },
                {
                  key: "role",
                  label: "Role",
                  sortAccessor: (r) => r.role ?? "zzz",
                  render: (r) => <EchelonRoleBadge role={r.role ?? null} />,
                },
                {
                  key: "country",
                  label: "Country",
                  sortAccessor: (r) => r.country ?? "",
                  render: (r) => <span className="font-mono text-xs text-muted-foreground">{r.country || "—"}</span>,
                },
                {
                  key: "tier",
                  label: "Threat Tier",
                  sortAccessor: (r) => -r.riskScore,
                  render: (r) => {
                    const t = threatTier(r.riskScore);
                    return (
                      <Badge variant="outline" className={t.cls}>
                        {t.label}
                      </Badge>
                    );
                  },
                },
                {
                  key: "dos",
                  label: filter === "both" ? "DOS" : `DOS · ${filter === "blood" ? "Blood" : "Medical"}`,
                  align: "right",
                  sortAccessor: (r) => r.displayedDos ?? 0,
                  render: (r) => (
                    <span className={`font-mono ${dosClass(r.displayedDos)}`}>{formatDOS(r.displayedDos)}</span>
                  ),
                },
                {
                  key: "critItems",
                  label: filter === "both" ? "Crit Items" : `Crit · ${filter === "blood" ? "Blood" : "Med"}`,
                  align: "right",
                  sortAccessor: (r) => r.displayedCritItems ?? 0,
                  render: (r) => (
                    <span className={`font-mono ${(r.displayedCritItems ?? 0) > 0 ? "text-destructive font-bold" : "text-muted-foreground"}`}>
                      {r.displayedCritItems ?? 0}
                    </span>
                  ),
                },
                {
                  key: "alerts",
                  label: "Open Alerts",
                  align: "right",
                  sortAccessor: (r) => r.openAlerts ?? 0,
                  render: (r) => (
                    <span className={`font-mono ${(r.openAlerts ?? 0) > 0 ? "text-destructive font-bold" : "text-muted-foreground"}`}>
                      {r.openAlerts ?? 0}
                    </span>
                  ),
                },
                {
                  key: "risk",
                  label: "Risk",
                  align: "right",
                  sortAccessor: (r) => r.riskScore,
                  render: (r) => (
                    <span className="font-mono text-xs text-muted-foreground">{r.riskScore.toFixed(0)}</span>
                  ),
                },
              ]}
            />
          )}
        </div>
      </Card>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: number | string;
  accent?: "destructive" | "amber";
  icon?: React.ReactNode;
}) {
  const valCls =
    accent === "destructive"
      ? "text-destructive"
      : accent === "amber"
      ? "text-amber-500"
      : "text-foreground";
  return (
    <Card className="bg-card/50 border-border">
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
          <h3 className={`text-2xl font-bold mt-1 ${valCls}`}>{value}</h3>
        </div>
        {icon}
      </CardContent>
    </Card>
  );
}
