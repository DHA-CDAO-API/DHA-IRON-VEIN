import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Link } from "wouter";
import { Users } from "lucide-react";
import {
  useGetDashboardOverview,
  getGetDashboardOverviewQueryKey,
  useGetNetworkSnapshot,
  getGetNetworkSnapshotQueryKey,
} from "@workspace/api-client-react";
import {
  type Tier,
  TIER_TEXT,
  TIER_BORDER,
  TIER_BG,
  TIER_DOT,
} from "./tier";
import { formatNumber } from "@/lib/format";

type WBBKey =
  | "oPos"
  | "oNeg"
  | "aPos"
  | "aNeg"
  | "bPos"
  | "bNeg"
  | "abPos"
  | "abNeg";

const ABO_CHIPS: Array<{ key: WBBKey; label: string }> = [
  { key: "oPos", label: "O+" },
  { key: "oNeg", label: "O−" },
  { key: "aPos", label: "A+" },
  { key: "aNeg", label: "A−" },
  { key: "bPos", label: "B+" },
  { key: "bNeg", label: "B−" },
  { key: "abPos", label: "AB+" },
  { key: "abNeg", label: "AB−" },
];

// Approximate share of theater-wide WBB readiness by ABO type, calibrated to
// the seeded distribution that the per-site donor pool panel surfaces. Used
// to split the single theater-wide WBB headcount into chip values when the
// backend rolls them up. Per-site accurate breakdowns live on Site Detail.
const DEMAND_SHARE: Record<WBBKey, number> = {
  oPos: 0.36,
  oNeg: 0.07,
  aPos: 0.32,
  aNeg: 0.06,
  bPos: 0.1,
  bNeg: 0.02,
  abPos: 0.06,
  abNeg: 0.01,
};

// Forecasted weekly transfusion demand per donor unit. Used only to color the
// chip by adequacy; a ratio < 1 means current ready-donor count is below the
// estimated weekly demand for that ABO type.
function tierFromAdequacy(ratio: number): Tier {
  if (!Number.isFinite(ratio)) return "nominal";
  if (ratio < 0.5) return "critical";
  if (ratio < 1) return "watch";
  return "nominal";
}

export function WalkingBloodBank() {
  const overviewKey = getGetDashboardOverviewQueryKey();
  const snapshotKey = getGetNetworkSnapshotQueryKey();
  const { data: overview, isLoading } = useGetDashboardOverview({
    query: { queryKey: overviewKey },
  });
  const { data: snapshot } = useGetNetworkSnapshot({
    query: { queryKey: snapshotKey },
  });

  const [openType, setOpenType] = useState<WBBKey | null>(null);

  const totalWbb = overview?.bloodReadiness?.walkingBloodBankReadyDonors ?? 0;

  const totals = useMemo(() => {
    const out = {} as Record<WBBKey, number>;
    for (const c of ABO_CHIPS) {
      out[c.key] = Math.round(totalWbb * DEMAND_SHARE[c.key]);
    }
    return out;
  }, [totalWbb]);

  // Estimated forecast demand by type — same share applied to theater demand.
  const demandFor = (k: WBBKey): number =>
    Math.max(1, Math.round(totalWbb * DEMAND_SHARE[k] * 1.0));

  const tierFor = (k: WBBKey): Tier =>
    tierFromAdequacy(totals[k] / demandFor(k));

  // Size each chip by share of total donors (largest grows ~1.4×).
  const maxCount = Math.max(...Object.values(totals), 1);
  const sizeFor = (k: WBBKey): number => 1 + (totals[k] / maxCount) * 0.4;

  const sitesWithBlood = useMemo(() => {
    const list = (snapshot?.bloodReadinessByNode ?? [])
      .map((b) => {
        const node = (snapshot?.nodes ?? []).find((n) => n.id === b.nodeId);
        return {
          nodeId: b.nodeId,
          nodeName: node?.name ?? b.nodeId,
          totalViableUnits: b.totalViableUnits,
          viableDaysOfSupply: b.viableDaysOfSupply,
        };
      })
      .sort((a, b) => b.totalViableUnits - a.totalViableUnits);
    return list;
  }, [snapshot]);

  const openTypeLabel = openType
    ? ABO_CHIPS.find((c) => c.key === openType)?.label ?? openType
    : "";

  return (
    <Card
      className="bg-card/50 backdrop-blur border-border h-full flex flex-col"
      data-testid="wbb-card"
    >
      <CardHeader className="pb-2 border-b border-border/50">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-primary">
            <Users className="h-4 w-4" />
            Walking Blood Bank · by ABO
          </CardTitle>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            {formatNumber(totalWbb)} ready theater-wide
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-3 flex-1">
        {isLoading && !overview ? (
          <Skeleton className="h-32" />
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {ABO_CHIPS.map((c) => {
              const tier = tierFor(c.key);
              const size = sizeFor(c.key);
              const value = totals[c.key];
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setOpenType(c.key)}
                  data-testid={`wbb-chip-${c.key}`}
                  className={`relative flex flex-col items-center justify-center rounded-md border ${TIER_BORDER[tier]} ${TIER_BG[tier]} py-2 px-1 hover:scale-[1.02] transition-transform`}
                  style={{
                    minHeight: `${Math.round(60 * size)}px`,
                  }}
                  title={`${c.label} · ~${value} ready donors (estimated theater mix)`}
                >
                  <span
                    className={`absolute top-1 right-1 inline-block w-1.5 h-1.5 rounded-full ${TIER_DOT[tier]}`}
                    aria-hidden
                  />
                  <span
                    className={`font-bold ${TIER_TEXT[tier]}`}
                    style={{ fontSize: `${Math.round(14 * size)}px` }}
                  >
                    {c.label}
                  </span>
                  <span className="text-[11px] font-mono text-foreground/70 mt-0.5">
                    {formatNumber(value)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog
        open={openType != null}
        onOpenChange={(o) => !o && setOpenType(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Badge variant="outline" className="text-base font-bold">
                {openTypeLabel}
              </Badge>
              Per-site detail
            </DialogTitle>
            <DialogDescription className="text-xs">
              Theater chip values are an estimated mix of{" "}
              <span className="font-mono">{formatNumber(totalWbb)}</span> ready
              donors. Click a site for its actual donor pool by ABO.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto">
            {sitesWithBlood.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                No blood-storing sites in the current snapshot.
              </div>
            ) : (
              <ul className="divide-y divide-border/40">
                {sitesWithBlood.map((b) => (
                  <li key={b.nodeId}>
                    <Link href={`/sites/${b.nodeId}?tab=blood`}>
                      <div className="flex items-center justify-between px-3 py-2 hover:bg-muted/40 cursor-pointer">
                        <div>
                          <div className="text-sm">{b.nodeName}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {b.totalViableUnits} units ·{" "}
                            {b.viableDaysOfSupply.toFixed(1)} d DOS
                          </div>
                        </div>
                        <span className="text-[10px] text-primary uppercase tracking-wider">
                          View →
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
