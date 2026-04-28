import { Users, AlertCircle } from "lucide-react";
import type { NodeBloodReadiness } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNumber, formatShortDate } from "@/lib/format";

type WBB = NodeBloodReadiness["donors"]["wbbReady"];

const ABO_CHIPS: Array<{ key: keyof WBB; label: string }> = [
  { key: "oPos", label: "O+" },
  { key: "oNeg", label: "O−" },
  { key: "aPos", label: "A+" },
  { key: "aNeg", label: "A−" },
  { key: "bPos", label: "B+" },
  { key: "bNeg", label: "B−" },
  { key: "abPos", label: "AB+" },
  { key: "abNeg", label: "AB−" },
];

export function DonorPoolPanel({ data }: { data: NodeBloodReadiness["donors"] }) {
  const constrained = data.effectiveCollectionCapacity < data.weeklyCollectionCapacity;
  const haircutPct = data.weeklyCollectionCapacity > 0
    ? Math.round((1 - data.effectiveCollectionCapacity / data.weeklyCollectionCapacity) * 100)
    : 0;

  return (
    <Card className="bg-card/50 backdrop-blur border-border">
      <CardHeader className="pb-3 border-b border-border/50">
        <CardTitle className="text-sm font-medium flex items-center gap-2 text-primary">
          <Users className="h-4 w-4" />
          Donor Pool & Walking Blood Bank
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {/* Top metrics */}
        <div className="grid grid-cols-3 gap-3">
          <Metric label="Eligible Donors" value={formatNumber(data.eligibleDonors)} />
          <Metric label="Weekly Capacity" value={formatNumber(data.weeklyCollectionCapacity)} suffix="u" />
          <Metric
            label="Effective Capacity"
            value={formatNumber(data.effectiveCollectionCapacity)}
            suffix="u"
            valueClass={constrained ? "text-amber-400" : "text-emerald-500"}
          />
        </div>

        {/* Constraint banner */}
        {constrained && data.weeklyCollectionCapacity > 0 && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-md border border-amber-400/40 bg-amber-400/10 text-xs">
            <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <span className="text-amber-400">
              Reagent shortages reduce effective collection by ~{haircutPct}% — replenish testing supplies to restore the pipeline.
            </span>
          </div>
        )}

        {/* WBB chip strip */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            Walking Blood Bank — ready by ABO
            <span className="ml-2 font-mono text-foreground">{formatNumber(data.wbbReady.total)} total</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ABO_CHIPS.map((c) => {
              const v = data.wbbReady[c.key] as number;
              const empty = !v;
              return (
                <Badge
                  key={c.key}
                  variant="outline"
                  className={`px-2 py-1 text-[11px] font-mono gap-1 ${
                    empty
                      ? "border-border/40 text-muted-foreground/70"
                      : "border-primary/40 text-primary bg-primary/5"
                  }`}
                >
                  <span className="font-medium">{c.label}</span>
                  <span>{v}</span>
                </Badge>
              );
            })}
          </div>
        </div>

        <div className="text-[11px] text-muted-foreground">
          Last donor drive: <span className="font-mono text-foreground">{data.lastDriveAt ? formatShortDate(data.lastDriveAt) : "—"}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  suffix,
  valueClass,
}: {
  label: string;
  value: string;
  suffix?: string;
  valueClass?: string;
}) {
  return (
    <div className="px-3 py-2 rounded-md border border-border/50 bg-muted/10">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="flex items-baseline gap-1 mt-1">
        <span className={`text-lg font-bold font-mono ${valueClass ?? ""}`}>{value}</span>
        {suffix && <span className="text-[11px] text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}
