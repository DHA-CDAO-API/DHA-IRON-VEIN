import React from "react";
import { useLocation } from "wouter";
import {
  useListPatientTypes,
  useListEventTypes,
  useEvaluateCasualtyDemand,
  useListSites,
  useListItems,
  useCreateOrder,
  getListItemsQueryKey,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { CategoryFilterToggle } from "@/components/CategoryFilterToggle";
import { SortableTable } from "@/components/ui/sortable-table";
import { categoryMatches, formatNumber, type CategoryFilter } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useCanWrite } from "@/components/auth/useCanWrite";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Loader2,
  ShoppingBag,
  Users,
  ShieldAlert,
  ExternalLink,
  X,
} from "lucide-react";
import type {
  CasualtyRequirementRow,
  SufficiencyRow,
  PatientRerouteCandidate,
  SufficiencyRowVerdict,
  PatientRerouteCandidatePosture,
  CasualtyEvaluateInput,
  SiteSufficiencyEntry,
} from "@workspace/api-client-react";
import {
  BulkOrderConfirmDialog,
  type BulkOrderGroup,
} from "@/components/orders/BulkOrderConfirmDialog";

type MultiSiteMode = NonNullable<CasualtyEvaluateInput["multiSiteMode"]>;

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
  // Pull the catalog so the bulk-order confirm dialog can render real
  // currency subtotals — we look up `unitPriceUsd` per shortfall row so
  // operators see the cost implication of the consolidated batch before
  // sending. Backed by the same /items endpoint the rest of the app uses.
  const { data: catalogItems = [] } = useListItems(undefined, {
    query: { queryKey: getListItemsQueryKey() },
  });
  const unitPriceById = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const it of catalogItems) {
      const raw = (it as { unitPriceUsd?: number }).unitPriceUsd;
      const num = Number(raw);
      if (Number.isFinite(num)) map.set(it.id, num);
    }
    return map;
  }, [catalogItems]);

  const [eventTypeId, setEventTypeId] = React.useState<string | null>(null);
  const initialSiteId = React.useMemo(() => {
    if (typeof window === "undefined") return null;
    const sp = new URLSearchParams(window.location.search);
    return sp.get("siteId");
  }, []);
  // Multi-site selection. We keep the deep-link `?siteId=` behaviour by
  // pre-selecting that one site, and the rest of the page derives the
  // single-site shape (`siteId`) from the first entry when only one is
  // selected.
  const [siteIds, setSiteIds] = React.useState<string[]>(
    initialSiteId ? [initialSiteId] : [],
  );
  const [multiSiteMode, setMultiSiteMode] =
    React.useState<MultiSiteMode>("combined");
  const [primarySiteId, setPrimarySiteId] = React.useState<string | null>(null);
  const [sitePickerOpen, setSitePickerOpen] = React.useState<boolean>(false);
  const [arrivalWindowHours, setArrivalWindowHours] = React.useState<number>(48);
  const [resupplyEtaHours, setResupplyEtaHours] = React.useState<string>("");
  const [totalCasualties, setTotalCasualties] = React.useState<number>(40);
  const [counts, setCounts] = React.useState<PatientCounts>({});
  const [filter, setFilter] = React.useState<CategoryFilter>("both");
  const [restrictReroutes, setRestrictReroutes] = React.useState<boolean>(false);

  const siteId = siteIds.length === 1 ? siteIds[0] : null;
  const isMultiSite = siteIds.length >= 2;

  // Keep `primarySiteId` in sync with the current selection: clear it when
  // the user drops below 2 sites; reset to the first selected site when
  // the previously-chosen primary is no longer in the selection.
  React.useEffect(() => {
    if (!isMultiSite) {
      if (primarySiteId !== null) setPrimarySiteId(null);
      return;
    }
    if (!primarySiteId || !siteIds.includes(primarySiteId)) {
      setPrimarySiteId(siteIds[0]);
    }
  }, [siteIds, isMultiSite, primarySiteId]);

  // Default the Event Template to the first available option on first load
  // so the page is immediately useful — operators can still clear/change
  // the selection. We only do this if the operator hasn't already picked
  // something themselves.
  React.useEffect(() => {
    if (eventTypeId) return;
    if (eventTypes.length === 0) return;
    setEventTypeId(eventTypes[0].id);
    // We intentionally only auto-select once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventTypes.length]);

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

  // Build the request payload from current state. Centralised so the
  // auto-evaluate effect and the post-bulk-order refresh stay in sync.
  const buildEvaluatePayload = React.useCallback((): CasualtyEvaluateInput => {
    return {
      siteId: siteIds.length === 1 ? siteIds[0] : null,
      siteIds: siteIds.length > 0 ? siteIds : undefined,
      multiSiteMode: isMultiSite ? multiSiteMode : undefined,
      primarySiteId:
        isMultiSite && multiSiteMode === "primary"
          ? primarySiteId ?? siteIds[0]
          : null,
      patientCounts: counts,
      arrivalWindowHours,
      resupplyEtaHours: resupplyEtaHours ? Number(resupplyEtaHours) : null,
      restrictReroutesToHub: restrictReroutes,
    };
  }, [
    siteIds,
    isMultiSite,
    multiSiteMode,
    primarySiteId,
    counts,
    arrivalWindowHours,
    resupplyEtaHours,
    restrictReroutes,
  ]);

  React.useEffect(() => {
    // Auto-evaluate when inputs change.
    const sumCounts = Object.values(counts).reduce((a, b) => a + b, 0);
    if (sumCounts <= 0) return;
    evaluate.mutate({ data: buildEvaluatePayload() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    counts,
    arrivalWindowHours,
    siteIds,
    multiSiteMode,
    primarySiteId,
    resupplyEtaHours,
    restrictReroutes,
  ]);

  const createOrder = useCreateOrder();
  const { canWrite, reason: writeReason } = useCanWrite();

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

  // The destination node bulk-ordered shortfalls should be routed to.
  // - single & primary: the (primary) selected site
  // - combined: route to the first selected site (the network "anchor")
  // - compare: there is no single destination, so bulk-order is disabled.
  const bulkOrderDestinationSiteId: string | null = (() => {
    if (!isMultiSite) return siteId;
    if (multiSiteMode === "primary") return primarySiteId ?? siteIds[0] ?? null;
    if (multiSiteMode === "combined") return siteIds[0] ?? null;
    return null;
  })();

  const handleOpenBulkOrder = () => {
    if (!result?.sufficiency || !bulkOrderDestinationSiteId) {
      toast({
        title:
          isMultiSite && multiSiteMode === "compare"
            ? "Bulk ordering is disabled in compare mode"
            : "Pick a treatment site first",
        description:
          isMultiSite && multiSiteMode === "compare"
            ? "Switch to Combined or Primary mode to bulk-order shortfalls — compare mode evaluates each site independently and has no single destination."
            : "Bulk ordering needs a destination site so the orders can be routed.",
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
        // Catalog price feeds the dialog's currency subtotal column. Falls
        // back to 0 if the catalog has no price set — the bulk dialog
        // surfaces a "no catalog price" warning, and the server enforces
        // the same rule by rejecting $0 POs (task #222).
        unitPriceUsd: unitPriceById.get(row.itemId) ?? 0,
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
    const destinationSiteId = bulkOrderDestinationSiteId;
    if (!destinationSiteId || selected.length === 0) return;
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
              toNodeId: destinationSiteId,
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
      evaluate.mutate({ data: buildEvaluatePayload() });
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

  const isCompareMode =
    isMultiSite && multiSiteMode === "compare" && (result?.comparison?.length ?? 0) > 0;
  const compareEntries: SiteSufficiencyEntry[] = isCompareMode
    ? (result?.comparison ?? [])
    : [];

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
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="default"
                    size="sm"
                    className="gap-2"
                    onClick={handleOpenBulkOrder}
                    disabled={
                      !result?.sufficiency ||
                      !bulkOrderDestinationSiteId ||
                      createOrder.isPending ||
                      bulkSubmitting ||
                      shortageCount === 0 ||
                      !canWrite
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
                </span>
              </TooltipTrigger>
              {!canWrite && (
                <TooltipContent>
                  Read-only role
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
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
              <p className="text-[10px] leading-snug text-muted-foreground">
                Picking a template auto-fills the patient mix and arrival
                window from the seeded shares — adjust the counts below to
                refine.
              </p>
            </div>
            <div className="space-y-1.5 min-w-0">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                Treatment site{siteIds.length > 0 && (
                  <span className="ml-1 text-muted-foreground/70 normal-case font-normal">
                    · {siteIds.length} selected
                  </span>
                )}
              </Label>
              <Popover open={sitePickerOpen} onOpenChange={setSitePickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={sitePickerOpen}
                    aria-haspopup="listbox"
                    className={cn(
                      "w-full justify-between font-normal h-auto min-h-9 py-1.5",
                      siteIds.length === 0 && "text-muted-foreground",
                    )}
                    data-testid="select-site"
                  >
                    {siteIds.length === 0 ? (
                      <span>Optional — pick one or more sites…</span>
                    ) : (
                      <span className="flex flex-wrap gap-1 items-center min-w-0 text-left">
                        {siteIds.map((id) => {
                          const s = sites.find((x) => x.nodeId === id);
                          return (
                            <span
                              key={id}
                              className="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-xs max-w-[14rem]"
                              data-testid={`site-chip-${id}`}
                            >
                              <span className="truncate">
                                {s?.name ?? id}
                              </span>
                              <button
                                type="button"
                                aria-label={`Remove ${s?.name ?? id}`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setSiteIds((prev) =>
                                    prev.filter((x) => x !== id),
                                  );
                                }}
                                className="opacity-60 hover:opacity-100"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          );
                        })}
                      </span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[--radix-popover-trigger-width] p-0"
                  align="start"
                  collisionPadding={16}
                >
                  <Command>
                    <CommandInput placeholder="Search sites…" />
                    <CommandList className="max-h-[min(50vh,18rem)]">
                      <CommandEmpty>No sites match your search.</CommandEmpty>
                      <CommandGroup>
                        {sites.map((s) => {
                          const checked = siteIds.includes(s.nodeId);
                          return (
                            <CommandItem
                              key={s.nodeId}
                              value={`${s.name} ${s.nodeId}`}
                              onSelect={() => {
                                setSiteIds((prev) =>
                                  prev.includes(s.nodeId)
                                    ? prev.filter((x) => x !== s.nodeId)
                                    : [...prev, s.nodeId],
                                );
                              }}
                              data-testid={`site-option-${s.nodeId}`}
                            >
                              <Checkbox
                                checked={checked}
                                className="mr-2 pointer-events-none"
                                tabIndex={-1}
                              />
                              <span className="truncate">{s.name}</span>
                              {checked && (
                                <Check className="ml-auto h-4 w-4 opacity-70" />
                              )}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
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
                Resupply ETA (hours)
              </Label>
              <div className="relative">
                <Input
                  id="input-resupply-eta"
                  type="number"
                  placeholder="Optional · e.g. 36"
                  value={resupplyEtaHours}
                  min={0}
                  onChange={(e) => setResupplyEtaHours(e.target.value)}
                  className="font-mono pr-12"
                  data-testid="input-resupply-eta"
                />
                <span
                  className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground font-mono"
                  aria-hidden="true"
                >
                  hrs
                </span>
              </div>
              <p className="text-[10px] leading-snug text-muted-foreground">
                Hours until the next major resupply arrives — leave blank to
                use the full arrival window.
              </p>
            </div>
          </div>

          {isMultiSite && (
            <div
              className="rounded-md border border-border/40 bg-muted/10 p-3 space-y-2"
              data-testid="multi-site-mode-row"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                    Multi-site evaluation
                  </Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {multiSiteMode === "combined" &&
                      "Pool on-hand and inbound across all selected sites; reroute candidates come from sites outside the selection."}
                    {multiSiteMode === "compare" &&
                      "Evaluate each selected site independently and compare side-by-side."}
                    {multiSiteMode === "primary" &&
                      "Score sufficiency for the primary site; reroute candidates are constrained to the other selected sites."}
                  </p>
                </div>
                <ToggleGroup
                  type="single"
                  value={multiSiteMode}
                  onValueChange={(v) => {
                    if (v) setMultiSiteMode(v as MultiSiteMode);
                  }}
                  className="shrink-0"
                  data-testid="multi-site-mode-toggle"
                >
                  <ToggleGroupItem
                    value="combined"
                    className="text-xs h-8"
                    data-testid="multi-site-mode-combined"
                  >
                    Combined network
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="compare"
                    className="text-xs h-8"
                    data-testid="multi-site-mode-compare"
                  >
                    Compare side-by-side
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="primary"
                    className="text-xs h-8"
                    data-testid="multi-site-mode-primary"
                  >
                    Primary + reroute
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              {multiSiteMode === "primary" && (
                <div className="flex items-center gap-2 pt-1">
                  <Label className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium shrink-0">
                    Primary site
                  </Label>
                  <Select
                    value={primarySiteId ?? ""}
                    onValueChange={(v) => setPrimarySiteId(v)}
                  >
                    <SelectTrigger
                      className="h-8 text-xs max-w-xs"
                      data-testid="select-primary-site"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {siteIds.map((id) => {
                        const s = sites.find((x) => x.nodeId === id);
                        return (
                          <SelectItem key={id} value={id}>
                            {s?.name ?? id}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

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

      {isCompareMode && (
        <Card className="bg-card/50 border-border shrink-0">
          <SectionHeader
            title="Sufficiency by Site (Compare)"
            meta={`${compareEntries.length} sites`}
          />
          <CardContent className="p-4">
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: `repeat(auto-fit, minmax(min(20rem, 100%), 1fr))`,
              }}
              data-testid="compare-grid"
            >
              {compareEntries.map((entry) => {
                const sum = entry.sufficiency.summary;
                const tone =
                  sum.redCount > 0
                    ? "border-destructive/40 bg-destructive/5"
                    : sum.amberCount > 0
                      ? "border-amber-500/40 bg-amber-500/5"
                      : "border-emerald-500/40 bg-emerald-500/5";
                const reds = entry.sufficiency.rows
                  .filter(
                    (r) =>
                      r.verdict === "red" && categoryMatches(filter, r.category),
                  )
                  .sort((a, b) => b.shortfallQty - a.shortfallQty)
                  .slice(0, 6);
                const ambers = entry.sufficiency.rows
                  .filter(
                    (r) =>
                      r.verdict === "amber" &&
                      categoryMatches(filter, r.category),
                  )
                  .sort((a, b) => b.shortfallQty - a.shortfallQty)
                  .slice(0, 4);
                return (
                  <div
                    key={entry.siteId}
                    className={`rounded-md border p-3 space-y-3 ${tone}`}
                    data-testid={`compare-card-${entry.siteId}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">
                          {entry.siteName}
                        </div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                          {sum.verdict}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] font-mono shrink-0">
                        <span className="text-emerald-400">
                          {sum.greenCount}
                        </span>
                        <span className="text-amber-400">{sum.amberCount}</span>
                        <span className="text-destructive">{sum.redCount}</span>
                      </div>
                    </div>
                    {reds.length === 0 && ambers.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No shortfalls in this category.
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {reds.map((r) => (
                          <li
                            key={`r-${r.itemId}`}
                            className="flex items-center justify-between gap-2 text-xs"
                          >
                            <span className="truncate min-w-0">
                              {r.itemName}
                            </span>
                            <span className="font-mono text-destructive shrink-0">
                              -{formatNumber(r.shortfallQty)}
                            </span>
                          </li>
                        ))}
                        {ambers.map((r) => (
                          <li
                            key={`a-${r.itemId}`}
                            className="flex items-center justify-between gap-2 text-xs"
                          >
                            <span className="truncate min-w-0 text-muted-foreground">
                              {r.itemName}
                            </span>
                            <span className="font-mono text-amber-400 shrink-0">
                              ~{formatNumber(r.shortfallQty)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Each site is evaluated independently. Bulk Order Shortfalls is
              disabled in this mode — switch to Combined or Primary to dispatch
              orders.
            </p>
          </CardContent>
        </Card>
      )}

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
