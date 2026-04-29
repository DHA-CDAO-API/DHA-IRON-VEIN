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
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { SortableTable } from "@/components/ui/sortable-table";
import { categoryMatches, formatNumber, type CategoryFilter } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  ShoppingBag,
  Users,
  ShieldAlert,
  ExternalLink,
} from "lucide-react";
import type {
  CasualtyRequirementRow,
  SufficiencyRow,
  PatientRerouteCandidate,
  SufficiencyRowVerdict,
  PatientRerouteCandidatePosture,
} from "@workspace/api-client-react";
import {
  BulkOrderConfirmDialog,
  type BulkOrderGroup,
} from "@/components/orders/BulkOrderConfirmDialog";

type PatientCounts = Record<string, number>;

function verdictPillClass(verdict: SufficiencyRowVerdict): string {
  if (verdict === "green")
    return "border-emerald-500/40 bg-emerald-500/15 text-emerald-200";
  if (verdict === "amber")
    return "border-amber-500/40 bg-amber-500/15 text-amber-200";
  return "border-destructive/50 bg-destructive/15 text-destructive";
}

function verdictLabel(verdict: SufficiencyRowVerdict): string {
  if (verdict === "green") return "Sufficient";
  if (verdict === "amber") return "At Risk";
  return "Short";
}

function posturePillClass(posture: PatientRerouteCandidatePosture): string {
  if (posture === "viable")
    return "border-emerald-500/40 bg-emerald-500/15 text-emerald-200";
  if (posture === "stretched")
    return "border-amber-500/40 bg-amber-500/15 text-amber-200";
  return "border-destructive/50 bg-destructive/15 text-destructive";
}

function StatusPill({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${className}`}
    >
      {children}
    </span>
  );
}

function SectionHeader({
  title,
  meta,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3 border-b border-border/50 bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground font-medium flex items-center justify-between gap-3">
      <span>{title}</span>
      {meta != null && <span className="font-mono normal-case">{meta}</span>}
    </div>
  );
}

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

  // Preview dialog state. We build the supplier-grouped POs up front so the
  // operator can review (and trim) before anything is actually submitted.
  // `bulkPreviewUnfillable` captures the human-readable names of shortfall
  // items that had no supplier alternative — surfaced both in the dialog
  // (count) and in the post-submit toast (names) so operators know what they
  // still need to chase by hand.
  const [bulkPreviewOpen, setBulkPreviewOpen] = React.useState(false);
  const [bulkPreviewGroups, setBulkPreviewGroups] = React.useState<
    BulkOrderGroup[]
  >([]);
  const [bulkPreviewUnfillable, setBulkPreviewUnfillable] = React.useState<
    string[]
  >([]);
  const [bulkSubmitting, setBulkSubmitting] = React.useState(false);

  const handleOpenBulkOrder = () => {
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
    const groups = new Map<string, BulkOrderGroup>();
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
        unitOfIssue: row.unitOfIssue,
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

    const groupList = Array.from(groups.values());
    if (groupList.length === 0) {
      toast({
        title: "No supplier-backed shortfalls",
        description:
          "None of the remaining shortfalls have a recommended supplier. Pick a supplier manually.",
      });
      return;
    }
    setBulkPreviewGroups(groupList);
    setBulkPreviewUnfillable(unfillableItems);
    setBulkPreviewOpen(true);
  };

  const handleConfirmBulkOrder = async (selected: BulkOrderGroup[]) => {
    if (!siteId || selected.length === 0) return;
    const requestedDeliveryAt = new Date(
      Date.now() + arrivalWindowHours * 3_600_000,
    ).toISOString();
    setBulkSubmitting(true);
    let createdOrders = 0;
    let skippedOrders = 0;
    try {
      for (const group of selected) {
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
    } finally {
      setBulkSubmitting(false);
    }
    const supplierCount = selected.length - skippedOrders;
    const descriptionParts: string[] = [];
    if (bulkPreviewUnfillable.length > 0) {
      const preview = bulkPreviewUnfillable.slice(0, 3).join(", ");
      const more =
        bulkPreviewUnfillable.length > 3
          ? ` +${bulkPreviewUnfillable.length - 3} more`
          : "";
      descriptionParts.push(
        `Couldn't fill ${bulkPreviewUnfillable.length} item${bulkPreviewUnfillable.length === 1 ? "" : "s"} (no supplier carries it): ${preview}${more}`,
      );
    }
    if (skippedOrders > 0) {
      descriptionParts.push(
        `${skippedOrders} supplier order${skippedOrders === 1 ? "" : "s"} failed to submit`,
      );
    }
    // Fire the result toast BEFORE closing the dialog so the toast queue
    // isn't competing with the dialog's exit animation for focus / DOM updates.
    toast({
      title: `Sent ${createdOrders} order${createdOrders === 1 ? "" : "s"} to ${supplierCount} supplier${supplierCount === 1 ? "" : "s"}`,
      description:
        descriptionParts.length > 0
          ? descriptionParts.join(" · ")
          : "All selected shortfalls dispatched.",
    });
    setBulkPreviewOpen(false);
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

  const shortageCount = filteredSufficiency.filter(
    (r) => r.verdict === "red",
  ).length;
  const reroutes = result?.reroutes ?? [];

  return (
    <div
      className="h-full flex flex-col p-4 gap-4 overflow-y-auto bg-background text-foreground"
      data-testid="casualty-planner-page"
    >
      <div className="flex items-start justify-between gap-4 flex-wrap shrink-0 border-b border-border pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <Activity className="h-6 w-6 text-red-300" />
            <h1 className="text-2xl font-bold uppercase tracking-wider">
              Casualty Planner
            </h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Translate a casualty load into a sufficiency check, supplier
            shortfall ranking, and patient reroute candidates.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          <CategoryFilterToggle value={filter} onChange={setFilter} />
          <Button
            variant="default"
            size="sm"
            className="gap-2"
            onClick={handleOpenBulkOrder}
            disabled={
              !result?.sufficiency ||
              !siteId ||
              createOrder.isPending ||
              bulkSubmitting ||
              shortageCount === 0
            }
            data-testid="button-bulk-order"
          >
            {createOrder.isPending || bulkSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShoppingBag className="h-4 w-4" />
            )}
            Bulk Order Shortfalls
            {shortageCount > 0 && (
              <span className="ml-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary-foreground/20 px-1.5 text-[10px] font-mono">
                {shortageCount}
              </span>
            )}
          </Button>
        </div>
      </div>

      <Card className="bg-card/50 border-border shrink-0">
        <SectionHeader title="Scenario Inputs" />
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5 min-w-0">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                Event template
              </Label>
              <Select
                value={eventTypeId ?? ""}
                onValueChange={(v) => setEventTypeId(v)}
              >
                <SelectTrigger
                  data-testid="select-event-type"
                  className="w-full"
                >
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
            <div className="space-y-1.5 min-w-0">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                Treatment site
              </Label>
              <Select
                value={siteId ?? ""}
                onValueChange={(v) => setSiteId(v)}
              >
                <SelectTrigger data-testid="select-site" className="w-full">
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
            <div className="space-y-1.5 min-w-0">
              <Label
                htmlFor="input-total-casualties"
                className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium"
              >
                Total casualties
              </Label>
              <Input
                id="input-total-casualties"
                type="number"
                value={totalCasualties}
                min={0}
                onChange={(e) =>
                  setTotalCasualties(Number(e.target.value) || 0)
                }
                className="font-mono"
                data-testid="input-total-casualties"
              />
            </div>
            <div className="space-y-1.5 min-w-0">
              <Label
                htmlFor="input-resupply-eta"
                className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium"
              >
                Resupply ETA (h)
              </Label>
              <Input
                id="input-resupply-eta"
                type="number"
                placeholder="Optional · e.g. 36"
                value={resupplyEtaHours}
                min={0}
                onChange={(e) => setResupplyEtaHours(e.target.value)}
                className="font-mono"
                data-testid="input-resupply-eta"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
            <div className="lg:col-span-2 space-y-2 rounded-md border border-border/40 bg-muted/10 p-3 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                  Arrival window
                </Label>
                <span
                  className="font-mono text-sm tabular-nums"
                  data-testid="text-arrival-window"
                >
                  {arrivalWindowHours}h
                </span>
              </div>
              <Slider
                value={[arrivalWindowHours]}
                min={6}
                max={120}
                step={6}
                onValueChange={(v) => setArrivalWindowHours(v[0])}
                data-testid="slider-arrival-window"
              />
              <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground/70 font-mono">
                <span>6h</span>
                <span>120h</span>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-muted/10 p-3 min-w-0">
              <Label
                htmlFor="restrict-reroutes"
                className="text-xs leading-snug min-w-0 cursor-pointer"
              >
                <span className="block text-[11px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">
                  Reroute scope
                </span>
                <span className="text-foreground">
                  Restrict to same regional hub
                </span>
              </Label>
              <Switch
                checked={restrictReroutes}
                onCheckedChange={setRestrictReroutes}
                id="restrict-reroutes"
                data-testid="switch-restrict-reroutes"
                className="shrink-0"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border shrink-0">
        <SectionHeader
          title={
            <span className="inline-flex items-center gap-2">
              <Users className="h-3.5 w-3.5" />
              Patient Counts
            </span>
          }
          meta={
            <span data-testid="text-total-patients">
              {formatNumber(totalPatients)} total
            </span>
          }
        />
        <CardContent className="p-4">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {patientTypes.map((p) => (
                <div
                  key={p.id}
                  className="flex items-start justify-between gap-3 p-3 rounded-md bg-muted/10 border border-border/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium leading-snug line-clamp-2 break-words">
                      {p.name}
                    </div>
                    <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      {p.severity} · {p.avgClinicianMinutes}m / clinician
                    </div>
                  </div>
                  <Input
                    type="number"
                    className="w-20 text-right font-mono shrink-0"
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
            "shrink-0 " +
            (verdict.redCount > 0
              ? "border-destructive/40 bg-destructive/5"
              : verdict.amberCount > 0
                ? "border-amber-500/40 bg-amber-500/5"
                : "border-emerald-500/40 bg-emerald-500/5")
          }
        >
          <CardContent className="p-4 flex items-center gap-3">
            {verdict.redCount > 0 ? (
              <ShieldAlert className="h-6 w-6 text-destructive shrink-0" />
            ) : verdict.amberCount > 0 ? (
              <AlertTriangle className="h-6 w-6 text-amber-500 shrink-0" />
            ) : (
              <CheckCircle2 className="h-6 w-6 text-emerald-500 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div
                className="text-sm font-semibold"
                data-testid="text-sufficiency-verdict"
              >
                {verdict.verdict}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                <span>
                  <span className="font-mono text-emerald-500">
                    {verdict.greenCount}
                  </span>{" "}
                  on-hand
                </span>
                <span>
                  <span className="font-mono text-amber-500">
                    {verdict.amberCount}
                  </span>{" "}
                  reliant on inbound
                </span>
                <span>
                  <span className="font-mono text-destructive">
                    {verdict.redCount}
                  </span>{" "}
                  short
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-card/50 border-border shrink-0">
        <SectionHeader
          title={siteId ? "Sufficiency at Site" : "Required Materiel"}
          meta={
            siteId
              ? `${filteredSufficiency.length} item${filteredSufficiency.length === 1 ? "" : "s"}`
              : `${filteredRequired.length} item${filteredRequired.length === 1 ? "" : "s"}`
          }
        />
        <div className="overflow-auto">
          {siteId ? (
            <SortableTable
              data={filteredSufficiency as SufficiencyRow[]}
              rowKey={(r) => r.itemId}
              emptyMessage={
                totalPatients === 0
                  ? "Add patient counts to see required materiel."
                  : "No items match the current category filter."
              }
              initialSort={{ key: "shortfall", direction: "desc" }}
              columns={[
                {
                  key: "item",
                  label: "Item",
                  sortAccessor: (r) => r.itemName,
                  render: (r) => (
                    <div
                      className="min-w-0"
                      data-testid={`row-item-${r.itemId}`}
                    >
                      <div className="font-medium leading-snug">
                        {r.itemName}
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                        {r.size} · {r.unitOfIssue}
                      </div>
                    </div>
                  ),
                },
                {
                  key: "commodity",
                  label: "Commodity",
                  sortAccessor: (r) => r.commodityType,
                  render: (r) => (
                    <div className="min-w-0">
                      <div className="text-xs">{r.commodityType}</div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                        {r.unspscCommodity}
                      </div>
                    </div>
                  ),
                },
                {
                  key: "required",
                  label: "Required",
                  align: "right",
                  sortAccessor: (r) => r.requiredQty,
                  render: (r) => (
                    <span className="font-mono tabular-nums">
                      {formatNumber(r.requiredQty)}
                    </span>
                  ),
                },
                {
                  key: "onHand",
                  label: "On Hand",
                  align: "right",
                  sortAccessor: (r) => r.onHand,
                  render: (r) => (
                    <span className="font-mono tabular-nums">
                      {formatNumber(r.onHand)}
                    </span>
                  ),
                },
                {
                  key: "inbound",
                  label: "Inbound",
                  align: "right",
                  sortAccessor: (r) => r.inboundBeforeWindow,
                  render: (r) => (
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {formatNumber(r.inboundBeforeWindow)}
                    </span>
                  ),
                },
                {
                  key: "shortfall",
                  label: "Short",
                  align: "right",
                  sortAccessor: (r) => r.shortfallQty,
                  render: (r) =>
                    r.shortfallQty > 0 ? (
                      <span className="font-mono tabular-nums text-destructive font-semibold">
                        {formatNumber(r.shortfallQty)}
                      </span>
                    ) : (
                      <span className="font-mono tabular-nums text-muted-foreground">
                        —
                      </span>
                    ),
                },
                {
                  key: "verdict",
                  label: "Verdict",
                  sortAccessor: (r) => r.verdict,
                  render: (r) => (
                    <StatusPill className={verdictPillClass(r.verdict)}>
                      {verdictLabel(r.verdict)}
                    </StatusPill>
                  ),
                },
                {
                  key: "supplier",
                  label: "Best Supplier",
                  sortAccessor: (r) =>
                    r.supplierAlternatives?.[0]?.supplierName ?? "",
                  render: (r) => {
                    const alt = r.supplierAlternatives?.[0];
                    if (!alt)
                      return (
                        <span className="text-muted-foreground text-xs">—</span>
                      );
                    return (
                      <div className="min-w-0">
                        <div className="text-xs font-medium truncate">
                          {alt.supplierName}
                        </div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium font-mono">
                          ETA {alt.projectedEta.toFixed(1)}d
                        </div>
                      </div>
                    );
                  },
                },
              ]}
            />
          ) : (
            <SortableTable
              data={filteredRequired as CasualtyRequirementRow[]}
              rowKey={(r) => r.itemId}
              emptyMessage={
                totalPatients === 0
                  ? "Add patient counts to see required materiel."
                  : "No items match the current category filter."
              }
              initialSort={{ key: "required", direction: "desc" }}
              columns={[
                {
                  key: "item",
                  label: "Item",
                  sortAccessor: (r) => r.itemName,
                  render: (r) => (
                    <div
                      className="min-w-0"
                      data-testid={`row-item-${r.itemId}`}
                    >
                      <div className="font-medium leading-snug">
                        {r.itemName}
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                        {r.size} · {r.unitOfIssue}
                      </div>
                    </div>
                  ),
                },
                {
                  key: "commodity",
                  label: "Commodity",
                  sortAccessor: (r) => r.commodityType,
                  render: (r) => (
                    <div className="min-w-0">
                      <div className="text-xs">{r.commodityType}</div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                        {r.unspscCommodity}
                      </div>
                    </div>
                  ),
                },
                {
                  key: "required",
                  label: "Required",
                  align: "right",
                  sortAccessor: (r) => r.requiredQty,
                  render: (r) => (
                    <span className="font-mono tabular-nums">
                      {formatNumber(r.requiredQty)}
                    </span>
                  ),
                },
              ]}
            />
          )}
        </div>
      </Card>

      {reroutes.length > 0 && (
        <Card className="bg-card/50 border-border shrink-0">
          <SectionHeader
            title={
              <span className="inline-flex items-center gap-2">
                <ArrowRight className="h-3.5 w-3.5 text-violet-300" />
                Patient Reroute Candidates
              </span>
            }
            meta={`${reroutes.length} site${reroutes.length === 1 ? "" : "s"}`}
          />
          <div className="overflow-auto">
            <SortableTable
              data={reroutes as PatientRerouteCandidate[]}
              rowKey={(r) => r.nodeId}
              emptyMessage="No reroute candidates."
              initialSort={{ key: "transit", direction: "asc" }}
              columns={[
                {
                  key: "site",
                  label: "Site",
                  sortAccessor: (r) => r.nodeName,
                  render: (r) => (
                    <div
                      className="min-w-0"
                      data-testid={`row-reroute-${r.nodeId}`}
                    >
                      <div className="font-medium leading-snug">
                        {r.nodeName}
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                        {r.countryCode || "—"}
                      </div>
                    </div>
                  ),
                },
                {
                  key: "posture",
                  label: "Posture",
                  sortAccessor: (r) => r.posture,
                  render: (r) => (
                    <StatusPill className={posturePillClass(r.posture)}>
                      {r.posture}
                    </StatusPill>
                  ),
                },
                {
                  key: "distance",
                  label: "Distance",
                  align: "right",
                  sortAccessor: (r) => r.distanceKm,
                  render: (r) => (
                    <span className="font-mono tabular-nums">
                      {formatNumber(r.distanceKm)}{" "}
                      <span className="text-muted-foreground text-xs">km</span>
                    </span>
                  ),
                },
                {
                  key: "transit",
                  label: "Transit",
                  align: "right",
                  sortAccessor: (r) => r.estimatedTransitDays,
                  render: (r) => (
                    <span className="font-mono tabular-nums">
                      {r.estimatedTransitDays.toFixed(1)}{" "}
                      <span className="text-muted-foreground text-xs">d</span>
                    </span>
                  ),
                },
                {
                  key: "coverage",
                  label: "Coverage",
                  align: "right",
                  sortAccessor: (r) => r.supplyCoverage,
                  render: (r) => (
                    <span className="font-mono tabular-nums">
                      {Math.round(r.supplyCoverage * 100)}
                      <span className="text-muted-foreground text-xs">%</span>
                    </span>
                  ),
                },
                {
                  key: "surge",
                  label: "Surge Slots",
                  align: "right",
                  sortAccessor: (r) => r.residualCapacity,
                  render: (r) => (
                    <span className="font-mono tabular-nums">
                      {formatNumber(r.residualCapacity)}
                    </span>
                  ),
                },
                {
                  key: "action",
                  label: "",
                  sortable: false,
                  align: "right",
                  render: (r) => (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5 hover:text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/sites/${r.nodeId}`);
                      }}
                      data-testid={`button-view-${r.nodeId}`}
                    >
                      Open
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  ),
                },
              ]}
            />
          </div>
        </Card>
      )}

      <BulkOrderConfirmDialog
        open={bulkPreviewOpen}
        onOpenChange={setBulkPreviewOpen}
        groups={bulkPreviewGroups}
        skippedItemsCount={bulkPreviewUnfillable.length}
        isSubmitting={bulkSubmitting}
        onConfirm={handleConfirmBulkOrder}
      />
    </div>
  );
}
