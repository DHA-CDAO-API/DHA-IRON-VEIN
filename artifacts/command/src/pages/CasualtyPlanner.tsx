import React from "react";
import { useLocation } from "wouter";
import {
  useListPatientTypes,
  useListEventTypes,
  useEvaluateCasualtyDemand,
  useListSites,
  useCreateOrder,
  getListOrdersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategoryFilterToggle } from "@/components/CategoryFilterToggle";
import { categoryMatches, type CategoryFilter } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  ShoppingBag,
} from "lucide-react";
import type {
  CasualtyRequirementRow,
  SufficiencyRow,
} from "@workspace/api-client-react";

type PatientCounts = Record<string, number>;

export default function CasualtyPlanner() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data: patientTypes = [], isLoading: loadingPT } =
    useListPatientTypes();
  const { data: eventTypes = [], isLoading: loadingEvt } =
    useListEventTypes();
  const { data: sites = [] } = useListSites();

  const [eventTypeId, setEventTypeId] = React.useState<string | null>(null);
  const initialSiteId = React.useMemo(() => {
    if (typeof window === "undefined") return null;
    const sp = new URLSearchParams(window.location.search);
    return sp.get("siteId");
  }, []);
  const [siteId, setSiteId] = React.useState<string | null>(initialSiteId);
  const [arrivalWindowHours, setArrivalWindowHours] = React.useState<number>(48);
  const [resupplyEtaHours, setResupplyEtaHours] = React.useState<string>("");
  const [totalCasualties, setTotalCasualties] = React.useState<number>(40);
  const [counts, setCounts] = React.useState<PatientCounts>({});
  const [filter, setFilter] = React.useState<CategoryFilter>("both");
  const [restrictReroutes, setRestrictReroutes] = React.useState<boolean>(false);

  // When the operator picks an event template, derive a default patient
  // mix from the seeded shares × total-casualty count.
  React.useEffect(() => {
    if (!eventTypeId) return;
    const evt = eventTypes.find((e) => e.id === eventTypeId);
    if (!evt) return;
    setArrivalWindowHours(evt.defaultArrivalWindowHours);
    const next: PatientCounts = {};
    let assigned = 0;
    for (const m of evt.defaultPatientMix) {
      const n = Math.round(totalCasualties * m.defaultShare);
      if (n > 0) next[m.patientTypeId] = n;
      assigned += n;
    }
    // Apply rounding remainder to the largest-share row so totals match.
    if (assigned !== totalCasualties && evt.defaultPatientMix.length > 0) {
      const top = [...evt.defaultPatientMix].sort(
        (a, b) => b.defaultShare - a.defaultShare,
      )[0];
      next[top.patientTypeId] =
        (next[top.patientTypeId] ?? 0) + (totalCasualties - assigned);
    }
    setCounts(next);
  }, [eventTypeId, totalCasualties, eventTypes]);

  const evaluate = useEvaluateCasualtyDemand();
  const result = evaluate.data;

  React.useEffect(() => {
    // Auto-evaluate when inputs change.
    const sumCounts = Object.values(counts).reduce((a, b) => a + b, 0);
    if (sumCounts <= 0) return;
    evaluate.mutate({
      data: {
        siteId: siteId ?? null,
        patientCounts: counts,
        arrivalWindowHours,
        resupplyEtaHours: resupplyEtaHours
          ? Number(resupplyEtaHours)
          : null,
        restrictReroutesToHub: restrictReroutes,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts, arrivalWindowHours, siteId, resupplyEtaHours, restrictReroutes]);

  const createOrder = useCreateOrder();

  const handleBulkOrder = async () => {
    if (!result?.sufficiency || !siteId) {
      toast({
        title: "Pick a treatment site first",
        description:
          "Bulk ordering needs a destination site so the orders can be routed.",
      });
      return;
    }
    const shortRows = result.sufficiency.rows.filter(
      (r) =>
        r.verdict === "red" &&
        r.shortfallQty > 0 &&
        categoryMatches(filter, r.category),
    );
    if (shortRows.length === 0) {
      toast({
        title: "Nothing to order",
        description: "There are no remaining shortfalls to fill.",
      });
      return;
    }
    // Group shortfalls by their top-ranked supplier so each supplier gets
    // exactly one purchase order with one line per shortfall item, instead of
    // one PO per item. If the top-ranked supplier isn't available (e.g. the
    // alternatives list has no entry at that slot, or upstream filtering has
    // dropped it), fall back to the next-best alternative before giving up,
    // so operators don't have to chase those items by hand.
    type Grouped = {
      supplierId: string;
      supplierName: string;
      lines: { itemId: string; quantity: number; itemName: string }[];
    };
    const groups = new Map<string, Grouped>();
    const unfillableItems: string[] = [];
    for (const row of shortRows) {
      const supplier = row.supplierAlternatives?.find((alt) => alt != null);
      if (!supplier) {
        unfillableItems.push(row.itemName);
        continue;
      }
      const existing = groups.get(supplier.supplierId);
      const line = {
        itemId: row.itemId,
        quantity: row.shortfallQty,
        itemName: row.itemName,
      };
      if (existing) {
        existing.lines.push(line);
      } else {
        groups.set(supplier.supplierId, {
          supplierId: supplier.supplierId,
          supplierName: supplier.supplierName,
          lines: [line],
        });
      }
    }

    const requestedDeliveryAt = new Date(
      Date.now() + arrivalWindowHours * 3_600_000,
    ).toISOString();
    let createdOrders = 0;
    let skippedOrders = 0;
    for (const group of groups.values()) {
      try {
        await createOrder.mutateAsync({
          data: {
            toNodeId: siteId,
            supplierId: group.supplierId,
            priority: "URGENT",
            rationale: `Casualty Planner — sufficiency shortfall (${group.lines
              .map((l) => l.itemName)
              .join(", ")})`,
            requestedDeliveryAt,
            lines: group.lines.map((l) => ({
              itemId: l.itemId,
              quantity: l.quantity,
            })),
          },
        });
        createdOrders += 1;
      } catch {
        skippedOrders += 1;
      }
    }
    await queryClient.invalidateQueries({
      queryKey: getListOrdersQueryKey(),
    });
    // Re-run evaluation so the table refreshes inbound counts.
    evaluate.mutate({
      data: {
        siteId,
        patientCounts: counts,
        arrivalWindowHours,
        resupplyEtaHours: resupplyEtaHours ? Number(resupplyEtaHours) : null,
        restrictReroutesToHub: restrictReroutes,
      },
    });
    const supplierCount = groups.size - skippedOrders;
    const descriptionParts: string[] = [];
    if (unfillableItems.length > 0) {
      const preview = unfillableItems.slice(0, 3).join(", ");
      const more = unfillableItems.length > 3
        ? ` +${unfillableItems.length - 3} more`
        : "";
      descriptionParts.push(
        `Couldn't fill ${unfillableItems.length} item${unfillableItems.length === 1 ? "" : "s"} (no supplier carries it): ${preview}${more}`,
      );
    }
    if (skippedOrders > 0) {
      descriptionParts.push(
        `${skippedOrders} supplier order${skippedOrders === 1 ? "" : "s"} failed to submit`,
      );
    }
    toast({
      title: `Sent ${createdOrders} order${createdOrders === 1 ? "" : "s"} to ${supplierCount} supplier${supplierCount === 1 ? "" : "s"}`,
      description:
        descriptionParts.length > 0
          ? descriptionParts.join(" · ")
          : "All shortfalls dispatched.",
    });
  };

  const isLoading = loadingPT || loadingEvt;
  const totalPatients = Object.values(counts).reduce((a, b) => a + b, 0);

  const verdict = result?.sufficiency?.summary;

  const filteredRequired =
    result?.requiredItems.filter((r) => categoryMatches(filter, r.category)) ??
    [];
  const filteredSufficiency =
    result?.sufficiency?.rows.filter((r) =>
      categoryMatches(filter, r.category),
    ) ?? [];

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-6 w-6 text-red-300" />
            Casualty Planner
          </h1>
          <p className="text-sm text-muted-foreground">
            Translate a casualty load into a sufficiency check, supplier
            shortfall ranking, and patient reroute candidates.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <CategoryFilterToggle value={filter} onChange={setFilter} />
          <Button
            variant="default"
            onClick={handleBulkOrder}
            disabled={
              !result?.sufficiency ||
              !siteId ||
              createOrder.isPending ||
              filteredSufficiency.filter((r) => r.verdict === "red").length ===
                0
            }
            data-testid="button-bulk-order"
          >
            {createOrder.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ShoppingBag className="h-4 w-4 mr-2" />
            )}
            Order everything still short
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Scenario inputs</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <Label>Event template</Label>
            <Select
              value={eventTypeId ?? ""}
              onValueChange={(v) => setEventTypeId(v)}
            >
              <SelectTrigger data-testid="select-event-type">
                <SelectValue placeholder="Pick an event…" />
              </SelectTrigger>
              <SelectContent>
                {eventTypes.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Treatment site</Label>
            <Select
              value={siteId ?? ""}
              onValueChange={(v) => setSiteId(v)}
            >
              <SelectTrigger data-testid="select-site">
                <SelectValue placeholder="Optional — pick a site…" />
              </SelectTrigger>
              <SelectContent>
                {sites.map((s) => (
                  <SelectItem key={s.nodeId} value={s.nodeId}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Total casualties</Label>
            <Input
              type="number"
              value={totalCasualties}
              min={0}
              onChange={(e) => setTotalCasualties(Number(e.target.value) || 0)}
              data-testid="input-total-casualties"
            />
          </div>
          <div className="space-y-1">
            <Label>Resupply ETA (h, optional)</Label>
            <Input
              type="number"
              placeholder="e.g. 36"
              value={resupplyEtaHours}
              min={0}
              onChange={(e) => setResupplyEtaHours(e.target.value)}
              data-testid="input-resupply-eta"
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>
              Arrival window: <span className="font-mono">{arrivalWindowHours}h</span>
            </Label>
            <Slider
              value={[arrivalWindowHours]}
              min={6}
              max={120}
              step={6}
              onValueChange={(v) => setArrivalWindowHours(v[0])}
              data-testid="slider-arrival-window"
            />
          </div>
          <div className="md:col-span-2 flex items-center gap-3">
            <Switch
              checked={restrictReroutes}
              onCheckedChange={setRestrictReroutes}
              id="restrict-reroutes"
              data-testid="switch-restrict-reroutes"
            />
            <Label htmlFor="restrict-reroutes">
              Restrict reroute candidates to same regional hub
            </Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Patient counts ({totalPatients} total)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {patientTypes.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 p-2 rounded-md bg-secondary/30 border border-border"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {p.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {p.severity} · {p.avgClinicianMinutes} min/clinician
                    </div>
                  </div>
                  <Input
                    type="number"
                    className="w-20 text-right"
                    min={0}
                    value={counts[p.id] ?? 0}
                    onChange={(e) =>
                      setCounts((c) => ({
                        ...c,
                        [p.id]: Number(e.target.value) || 0,
                      }))
                    }
                    data-testid={`input-patient-${p.id}`}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {verdict && (
        <Card
          className={
            verdict.redCount > 0
              ? "border-red-500/40 bg-red-500/5"
              : verdict.amberCount > 0
                ? "border-amber-500/40 bg-amber-500/5"
                : "border-emerald-500/40 bg-emerald-500/5"
          }
        >
          <CardContent className="p-4 flex items-center gap-3">
            {verdict.redCount > 0 ? (
              <AlertTriangle className="h-6 w-6 text-red-400" />
            ) : (
              <CheckCircle2 className="h-6 w-6 text-emerald-400" />
            )}
            <div className="flex-1">
              <div className="text-sm font-semibold" data-testid="text-sufficiency-verdict">
                {verdict.verdict}
              </div>
              <div className="text-xs text-muted-foreground">
                {verdict.greenCount} on-hand · {verdict.amberCount} reliant on
                inbound · {verdict.redCount} short
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {siteId ? "Sufficiency at site" : "Required materiel"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Commodity</TableHead>
                <TableHead className="text-right">Required</TableHead>
                {siteId && (
                  <>
                    <TableHead className="text-right">On hand</TableHead>
                    <TableHead className="text-right">Inbound</TableHead>
                    <TableHead className="text-right">Short</TableHead>
                    <TableHead>Verdict</TableHead>
                    <TableHead>Best supplier</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(siteId
                ? (filteredSufficiency as SufficiencyRow[])
                : (filteredRequired as CasualtyRequirementRow[])
              ).map((r) => {
                const sr =
                  "verdict" in r ? (r as SufficiencyRow) : null;
                return (
                  <TableRow key={r.itemId} data-testid={`row-item-${r.itemId}`}>
                    <TableCell>
                      <div className="font-medium">{r.itemName}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {r.size} · {r.unitOfIssue}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>{r.commodityType}</div>
                      <div className="text-muted-foreground">
                        {r.unspscCommodity}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {r.requiredQty}
                    </TableCell>
                    {siteId && sr && (
                      <>
                        <TableCell className="text-right font-mono">
                          {sr.onHand}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {sr.inboundBeforeWindow}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {sr.shortfallQty || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              sr.verdict === "green"
                                ? "default"
                                : sr.verdict === "amber"
                                  ? "secondary"
                                  : "destructive"
                            }
                          >
                            {sr.verdict.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {sr.supplierAlternatives?.[0] ? (
                            <div>
                              <div>{sr.supplierAlternatives[0].supplierName}</div>
                              <div className="text-muted-foreground">
                                ETA{" "}
                                {sr.supplierAlternatives[0].projectedEta.toFixed(
                                  1,
                                )}
                                d
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                );
              })}
              {(siteId ? filteredSufficiency : filteredRequired).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={siteId ? 8 : 3}
                    className="text-center text-sm text-muted-foreground py-6"
                  >
                    Add patient counts to see required materiel.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {result?.reroutes && result.reroutes.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowRight className="h-4 w-4 text-violet-300" />
              Patient reroute candidates
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Site</TableHead>
                  <TableHead>Posture</TableHead>
                  <TableHead className="text-right">Distance</TableHead>
                  <TableHead className="text-right">Transit</TableHead>
                  <TableHead className="text-right">Coverage</TableHead>
                  <TableHead className="text-right">Surge slots</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.reroutes.map((c) => (
                  <TableRow key={c.nodeId} data-testid={`row-reroute-${c.nodeId}`}>
                    <TableCell>
                      <div className="font-medium">{c.nodeName}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {c.countryCode}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          c.posture === "viable"
                            ? "default"
                            : c.posture === "stretched"
                              ? "secondary"
                              : "destructive"
                        }
                      >
                        {c.posture}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {c.distanceKm} km
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {c.estimatedTransitDays.toFixed(1)} d
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {Math.round(c.supplyCoverage * 100)}%
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {c.residualCapacity}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => navigate(`/sites/${c.nodeId}`)}
                        data-testid={`button-view-${c.nodeId}`}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
