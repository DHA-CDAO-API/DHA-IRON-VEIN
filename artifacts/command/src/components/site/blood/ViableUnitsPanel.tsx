import { Droplet } from "lucide-react";
import type { BloodViabilityRow, NodeBloodReadiness } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SortableTable, type SortableColumn } from "@/components/ui/sortable-table";
import { dosClass, formatDOS, formatNumber } from "@/lib/format";
import { aboLabel, componentLabel, totalUnits } from "./format";

export function ViableUnitsPanel({ data }: { data: NodeBloodReadiness }) {
  const rows: BloodViabilityRow[] = data.viability;
  const totalAllUnits = rows.reduce((s, r) => s + totalUnits(r), 0);

  return (
    <Card className="bg-card/50 backdrop-blur border-border">
      <CardHeader className="pb-3 border-b border-border/50">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-primary">
            <Droplet className="h-4 w-4" />
            Viable Units by Component
          </CardTitle>
          <div className="text-xs text-muted-foreground">
            <span className="font-mono text-foreground">{formatNumber(data.totalViableUnits)}</span>
            {" / "}
            <span className="font-mono">{formatNumber(totalAllUnits)}</span> viable
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {/* KPI strip — node-level expiring/DOS */}
        <div className="grid grid-cols-4 divide-x divide-border/40 border-b border-border/40">
          <KpiCell label="Viable DOS" value={formatDOS(data.viableDaysOfSupply)} valueClass={dosClass(data.viableDaysOfSupply)} />
          <KpiCell label="Expiring 24h" value={formatNumber(data.unitsExpiringWithin24h)} valueClass={data.unitsExpiringWithin24h > 0 ? "text-destructive" : "text-muted-foreground"} />
          <KpiCell label="Expiring 72h" value={formatNumber(data.unitsExpiringWithin72h)} valueClass={data.unitsExpiringWithin72h > 0 ? "text-amber-400" : "text-muted-foreground"} />
          <KpiCell label="Expiring 7d" value={formatNumber(data.unitsExpiringWithin7d)} valueClass={data.unitsExpiringWithin7d > 0 ? "text-amber-400/80" : "text-muted-foreground"} />
        </div>

        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No blood units stored at this site
          </div>
        ) : (
          <SortableTable
            data={rows}
            rowKey={(r) => `${r.component}|${r.aboGroup ?? ""}|${r.rhFactor ?? ""}`}
            initialSort={{ key: "viable", direction: "desc" }}
            columns={([
              {
                key: "component",
                label: "Component",
                sortAccessor: (r) => `${r.component}${r.aboGroup ?? ""}${r.rhFactor ?? ""}`,
                render: (r) => (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{componentLabel(r.component)}</span>
                    {r.aboGroup && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {aboLabel(r.aboGroup, r.rhFactor)}
                      </span>
                    )}
                  </div>
                ),
              },
              {
                key: "viable",
                label: "Viable",
                align: "right",
                sortAccessor: (r) => r.viableUnits,
                render: (r) => (
                  <span className="font-mono text-emerald-500">{formatNumber(r.viableUnits)}</span>
                ),
              },
              {
                key: "near",
                label: "Near Expiry (72h)",
                align: "right",
                sortAccessor: (r) => r.nearExpiryUnits,
                render: (r) => (
                  <span className={`font-mono ${r.nearExpiryUnits > 0 ? "text-amber-400" : "text-muted-foreground"}`}>
                    {formatNumber(r.nearExpiryUnits)}
                  </span>
                ),
              },
              {
                key: "expired",
                label: "Expired",
                align: "right",
                sortAccessor: (r) => r.expiredUnits,
                render: (r) => (
                  <span className={`font-mono ${r.expiredUnits > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {formatNumber(r.expiredUnits)}
                  </span>
                ),
              },
              {
                key: "compromised",
                label: "Compromised",
                align: "right",
                sortAccessor: (r) => r.compromisedUnits,
                render: (r) => (
                  <span className={`font-mono ${r.compromisedUnits > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {formatNumber(r.compromisedUnits)}
                  </span>
                ),
              },
              {
                key: "total",
                label: "Total",
                align: "right",
                sortAccessor: (r) => totalUnits(r),
                render: (r) => (
                  <span className="font-mono">{formatNumber(totalUnits(r))}</span>
                ),
              },
            ] as SortableColumn<BloodViabilityRow>[])}
          />
        )}
      </CardContent>
    </Card>
  );
}

function KpiCell({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold font-mono mt-1 ${valueClass ?? ""}`}>{value}</div>
    </div>
  );
}
