import { Snowflake, Fuel, ThermometerSun } from "lucide-react";
import type { NodeBloodReadiness } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatDays, formatNumber } from "@/lib/format";
import { assetTypeLabel, fuelTone, healthTone, statusTone, tempInRange } from "./format";

export function ColdChainPanel({ data }: { data: NodeBloodReadiness["coldChain"] }) {
  const storage = data.assets.filter((a) => a.assetType !== "generator");
  const generators = data.assets.filter((a) => a.assetType === "generator");

  return (
    <Card className="bg-card/50 backdrop-blur border-border">
      <CardHeader className="pb-3 border-b border-border/50">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-primary">
            <Snowflake className="h-4 w-4" />
            Cold Chain Health
          </CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {data.activeExcursions > 0 && (
              <Badge variant="outline" className="border-amber-500/60 text-amber-500 bg-amber-500/10">
                {data.activeExcursions} excursion{data.activeExcursions === 1 ? "" : "s"}
              </Badge>
            )}
            {data.failedAssets > 0 && (
              <Badge variant="outline" className="border-destructive/60 text-destructive bg-destructive/10">
                {data.failedAssets} failed
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {/* Health gauge */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Storage health</span>
            <span className={`text-sm font-bold font-mono ${healthTone(data.healthPercent)}`}>
              {data.healthPercent.toFixed(0)}%
            </span>
          </div>
          <Progress value={Math.max(0, Math.min(100, data.healthPercent))} className="h-2" />
        </div>

        {/* Generator fuel summary */}
        {generators.length > 0 && (
          <div className="flex items-center justify-between text-xs px-3 py-2 rounded-md border border-border/50 bg-muted/20">
            <span className="flex items-center gap-2 text-muted-foreground">
              <Fuel className="h-3.5 w-3.5" />
              {generators.length} generator{generators.length === 1 ? "" : "s"}
            </span>
            <span className={`font-mono ${fuelTone(data.minFuelDaysRemaining)}`}>
              min fuel {formatDays(data.minFuelDaysRemaining)}
            </span>
          </div>
        )}

        {/* Asset list */}
        {data.assets.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            No cold-chain assets registered for this site
          </div>
        ) : (
          <div className="space-y-1.5">
            {storage.map((a) => {
              const tone = statusTone(a.status);
              const inRange = tempInRange(a.currentTempC, a.targetTempMinC, a.targetTempMaxC);
              return (
                <div
                  key={a.id}
                  className={`flex items-center justify-between gap-3 px-3 py-2 rounded-md border ${tone.border} ${tone.bg}`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{a.name}</div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                      <span>{assetTypeLabel(a.assetType)}</span>
                      {a.capacityUnits != null && (
                        <span>· {formatNumber(a.capacityUnits)}u capacity</span>
                      )}
                      {a.hasGenerator && (
                        <span className="flex items-center gap-1">
                          · <Fuel className="h-3 w-3" /> backup
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge variant="outline" className={`${tone.border} ${tone.text} ${tone.bg} text-[10px]`}>
                      {a.status}
                    </Badge>
                    <div className="flex items-center gap-1 text-xs font-mono">
                      <ThermometerSun className={`h-3 w-3 ${inRange ? "text-muted-foreground" : "text-amber-500"}`} />
                      <span className={inRange ? "text-foreground" : "text-amber-500 font-bold"}>
                        {a.currentTempC.toFixed(1)}°C
                      </span>
                      {a.targetTempMinC != null && a.targetTempMaxC != null && (
                        <span className="text-muted-foreground/70">
                          ({a.targetTempMinC.toFixed(0)}–{a.targetTempMaxC.toFixed(0)})
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {generators.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-border/50 bg-muted/10"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{g.name}</div>
                  <div className="text-[11px] text-muted-foreground">{assetTypeLabel(g.assetType)}</div>
                </div>
                <div className="flex items-center gap-1 text-xs">
                  <Fuel className={`h-3.5 w-3.5 ${fuelTone(g.fuelDaysRemaining)}`} />
                  <span className={`font-mono ${fuelTone(g.fuelDaysRemaining)}`}>
                    {formatDays(g.fuelDaysRemaining)} fuel
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
