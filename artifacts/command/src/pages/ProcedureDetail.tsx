import React from "react";
import { Link, useRoute } from "wouter";
import {
  useGetProcedureDetail,
  getGetProcedureDetailQueryKey,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Stethoscope } from "lucide-react";
import { EchelonRoleBadges } from "@/components/EchelonRoleBadge";
import { cn } from "@/lib/utils";

const TIER_META: Record<
  "primary" | "secondary" | "tertiary",
  { label: string; tone: string; help: string }
> = {
  primary: {
    label: "Primary",
    tone: "border-rose-400/40 bg-rose-400/5",
    help: "Must-have. Procedure cannot proceed without these.",
  },
  secondary: {
    label: "Secondary",
    tone: "border-amber-400/40 bg-amber-400/5",
    help: "Strongly preferred. Sub-optimal outcomes without them.",
  },
  tertiary: {
    label: "Tertiary",
    tone: "border-slate-400/40 bg-slate-400/5",
    help: "Optional / nice-to-have. Adds quality but not required.",
  },
};

/**
 * Single-procedure detail view. Shows the description, echelons, and a
 * tier-grouped supply list. Each supply links into the existing item-detail
 * page so the user can pivot to inventory and lead-time data without losing
 * context.
 */
export default function ProcedureDetail() {
  const [, params] = useRoute<{ procedureId: string }>(
    "/procedures/:procedureId",
  );
  const procedureId = params?.procedureId ?? "";
  const { data, isLoading } = useGetProcedureDetail(procedureId, {
    query: {
      queryKey: getGetProcedureDetailQueryKey(procedureId),
      enabled: procedureId.length > 0,
    },
  });

  type SupplyRow = NonNullable<typeof data>["supplies"][number];
  const grouped = React.useMemo(() => {
    const out: Record<"primary" | "secondary" | "tertiary", SupplyRow[]> = {
      primary: [],
      secondary: [],
      tertiary: [],
    };
    for (const s of data?.supplies ?? []) {
      if (
        s.tier === "primary" ||
        s.tier === "secondary" ||
        s.tier === "tertiary"
      ) {
        out[s.tier].push(s);
      }
    }
    return out;
  }, [data]);

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Loading procedure…
      </div>
    );
  }
  if (!data) {
    return (
      <div className="p-6 space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/procedures" data-testid="link-back-to-procedures">
            <ChevronLeft className="h-4 w-4 mr-1" /> Back to procedures
          </Link>
        </Button>
        <div className="text-sm text-muted-foreground">
          Procedure not found.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/procedures" data-testid="link-back-to-procedures">
          <ChevronLeft className="h-4 w-4 mr-1" /> Back to procedures
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3 flex-wrap">
            <Stethoscope className="h-6 w-6 text-pink-300 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-[260px]">
              <CardTitle
                className="text-2xl"
                data-testid="text-procedure-name"
              >
                {data.name}
              </CardTitle>
              <CardDescription className="mt-1">
                {data.description}
              </CardDescription>
            </div>
            <div className="flex flex-col items-end gap-2">
              <EchelonRoleBadges roles={data.roles} />
              <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                {data.clinicalCategory.replace(/_/g, " ")}
              </Badge>
            </div>
          </div>
        </CardHeader>
      </Card>

      {(["primary", "secondary", "tertiary"] as const).map((tier) => {
        const meta = TIER_META[tier];
        const rows = grouped[tier];
        if (rows.length === 0) return null;
        return (
          <Card
            key={tier}
            className={cn("border", meta.tone)}
            data-testid={`card-supplies-${tier}`}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <span>{meta.label} supplies</span>
                    <Badge variant="outline" className="text-xs">
                      {rows.length}
                    </Badge>
                  </CardTitle>
                  <CardDescription className="text-xs mt-1">
                    {meta.help}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-1">
              {rows.map((s) => (
                <Link
                  key={s.itemId}
                  href={`/items/${s.itemId}`}
                  data-testid={`row-supply-${s.itemId}`}
                  className="flex items-center justify-between gap-3 py-2 px-3 rounded hover-elevate cursor-pointer"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {s.itemName}
                    </div>
                    {s.notes && (
                      <div className="text-[11px] text-muted-foreground truncate">
                        {s.notes}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {s.criticality && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] uppercase tracking-wider",
                          s.criticality === "critical" &&
                            "border-rose-400/50 text-rose-100",
                          s.criticality === "high" &&
                            "border-amber-400/50 text-amber-100",
                        )}
                      >
                        {s.criticality}
                      </Badge>
                    )}
                    <div className="font-mono text-sm text-foreground">
                      {s.quantityPerEvent}
                      {s.unit ? (
                        <span className="text-muted-foreground text-xs ml-1">
                          {s.unit}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
