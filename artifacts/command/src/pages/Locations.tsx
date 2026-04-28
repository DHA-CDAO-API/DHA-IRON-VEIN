import React, { useMemo } from "react";
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
import { formatDOS, dosClass } from "@/lib/format";

function threatTier(riskScore: number): { label: string; cls: string } {
  if (riskScore >= 70) return { label: "TIER 1", cls: "border-destructive text-destructive bg-destructive/10" };
  if (riskScore >= 40) return { label: "TIER 2", cls: "border-amber-500 text-amber-500 bg-amber-500/10" };
  if (riskScore >= 15) return { label: "TIER 3", cls: "border-yellow-500 text-yellow-500 bg-yellow-500/10" };
  return { label: "TIER 4", cls: "border-emerald-500 text-emerald-500 bg-emerald-500/10" };
}

export default function Locations() {
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

  const rows = useMemo(() => {
    return (sites ?? []).map((s) => {
      const meta = nodeMeta.get(s.nodeId);
      return {
        ...s,
        country: meta?.country ?? "—",
      };
    });
  }, [sites, nodeMeta]);

  const totals = useMemo(() => {
    const total = rows.length;
    const critical = rows.filter((r) => (r.daysOfSupply ?? 0) <= 3).length;
    const watch = rows.filter((r) => {
      const d = r.daysOfSupply ?? 0;
      return d > 3 && d <= 7;
    }).length;
    const openAlerts = rows.reduce((s, r) => s + (r.openAlerts ?? 0), 0);
    return { total, critical, watch, openAlerts };
  }, [rows]);

  const isLoading = sitesLoading || snapLoading;

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-y-auto bg-background text-foreground">
      <div className="flex items-start justify-between shrink-0 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Building2 className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold uppercase tracking-wider">Locations</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Every MTF, hub and forward node in the AOR. Click a row to drill into its inventory, alerts and forecast.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 shrink-0">
        <SummaryCard label="Total Sites" value={totals.total} icon={<Globe2 className="h-5 w-5 text-primary/60" />} />
        <SummaryCard label="Critical (≤3 DOS)" value={totals.critical} accent={totals.critical > 0 ? "destructive" : undefined} icon={<ShieldAlert className="h-5 w-5 text-destructive/60" />} />
        <SummaryCard label="Watch (≤7 DOS)" value={totals.watch} accent={totals.watch > 0 ? "amber" : undefined} icon={<AlertTriangle className="h-5 w-5 text-amber-500/60" />} />
        <SummaryCard label="Open Alerts" value={totals.openAlerts} accent={totals.openAlerts > 0 ? "destructive" : undefined} icon={<AlertTriangle className="h-5 w-5 text-destructive/60" />} />
      </div>

      <Card className="bg-card/50 border-border flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="px-4 py-3 border-b border-border/50 bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground font-medium flex items-center justify-between">
          <span>Site Roster</span>
          <span>{rows.length} sites</span>
        </div>
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <SortableTable
              stickyHeader
              initialSort={{ key: "dos", direction: "asc" }}
              data={rows}
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
                  label: "DOS",
                  align: "right",
                  sortAccessor: (r) => r.daysOfSupply ?? 0,
                  render: (r) => (
                    <span className={`font-mono ${dosClass(r.daysOfSupply)}`}>{formatDOS(r.daysOfSupply)}</span>
                  ),
                },
                {
                  key: "critItems",
                  label: "Crit Items",
                  align: "right",
                  sortAccessor: (r) => r.criticalShortItems ?? 0,
                  render: (r) => (
                    <span className={`font-mono ${(r.criticalShortItems ?? 0) > 0 ? "text-destructive font-bold" : "text-muted-foreground"}`}>
                      {r.criticalShortItems ?? 0}
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
