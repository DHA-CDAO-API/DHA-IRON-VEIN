import React, { useEffect, useMemo, useState } from "react";
import {
  useCreateOrder,
  useListItems,
  useListNodes,
  useListSuppliers,
  useListInventoryBalances,
  useListItemProcedures,
  getListItemProceduresQueryKey,
  getListItemsQueryKey,
  getListNodesQueryKey,
  getListSuppliersQueryKey,
  getListInventoryBalancesQueryKey,
  getListOrdersQueryKey,
  type Item,
  type Node as NetworkNode,
  type Supplier,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/format";
import { AlertTriangle, Check, ChevronsUpDown, Loader2 } from "lucide-react";

const CATEGORY_LABELS: Record<string, string> = {
  blood_products: "Blood Products",
  supplies: "Supplies",
  other: "Other",
};

function formatCategory(category?: string): string | null {
  if (!category) return null;
  return CATEGORY_LABELS[category] ?? category;
}

const PRIORITIES = ["ROUTINE", "PRIORITY", "URGENT", "FLASH"] as const;

const DEMAND_NODE_TYPES = new Set([
  "field_hospital",
  "forward_node",
  "forward_clinic",
  "clinic",
  "hospital",
  "ship",
  "treatment_node",
  "demand",
]);

function defaultDeliveryDate(): string {
  const d = new Date(Date.now() + 7 * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function formatSupplierMeta(s: Supplier): string {
  const lt = `${Math.round(s.leadTimeDays)}d lead`;
  const rel = `${Math.round((s.reliability ?? 0) * 100)}% reliable`;
  return `${lt} · ${rel}`;
}

function formatNodeType(type?: string): string | null {
  if (!type) return null;
  return type
    .split("_")
    .map((s) => (s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)))
    .join(" ");
}

interface NewOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Optional pre-fill values applied each time the dialog opens. Useful when
   * launching the dialog from a row in an inventory table — the operator
   * shouldn't have to re-pick the item / destination they were already
   * looking at. When omitted the dialog falls back to its empty defaults.
   */
  prefill?: {
    itemId?: string;
    toNodeId?: string;
    /** Suggested integer quantity. If omitted, the dialog's default is used. */
    quantity?: number;
  } | null;
}

const DEFAULT_QUANTITY = "100";

export function NewOrderDialog({ open, onOpenChange, prefill }: NewOrderDialogProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createOrder = useCreateOrder();

  const { data: items } = useListItems({
    query: { queryKey: getListItemsQueryKey(), enabled: open },
  });
  const { data: nodes } = useListNodes({
    query: { queryKey: getListNodesQueryKey(), enabled: open },
  });
  const { data: suppliers } = useListSuppliers({
    query: { queryKey: getListSuppliersQueryKey(), enabled: open },
  });
  const { data: inventoryBalances } = useListInventoryBalances(undefined, {
    query: { queryKey: getListInventoryBalancesQueryKey(), enabled: open },
  });

  const sortedItems = useMemo(
    () =>
      [...(items ?? [])].sort((a, b) => a.name.localeCompare(b.name)) as Item[],
    [items],
  );
  const destinationNodes = useMemo(() => {
    const list = (nodes ?? []) as NetworkNode[];
    const filtered = list.filter((n) => DEMAND_NODE_TYPES.has(n.type));
    const usable = filtered.length > 0 ? filtered : list;
    return [...usable].sort((a, b) => a.name.localeCompare(b.name));
  }, [nodes]);
  const allSuppliers = useMemo(
    () => (suppliers ?? []) as Supplier[],
    [suppliers],
  );

  // Aggregate network on-hand per item across all nodes. The API can emit
  // either `onHand` or `quantityOnHand` depending on contract version, so
  // accept either.
  const onHandByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of inventoryBalances ?? []) {
      const raw = b as { onHand?: number; quantityOnHand?: number };
      const qty = raw.quantityOnHand ?? raw.onHand ?? 0;
      map.set(b.itemId, (map.get(b.itemId) ?? 0) + qty);
    }
    return map;
  }, [inventoryBalances]);

  // Per-category low-stock threshold = 20% of the median total on-hand for
  // that category. Auto-scales between blood products (units) and bulk
  // supplies (pads/tubes/sets) without hard-coded magic numbers.
  const lowStockThresholdByCategory = useMemo(() => {
    const buckets = new Map<string, number[]>();
    for (const it of sortedItems) {
      const cat = it.category ?? "other";
      const total = onHandByItem.get(it.id) ?? 0;
      if (!buckets.has(cat)) buckets.set(cat, []);
      buckets.get(cat)!.push(total);
    }
    const thresholds = new Map<string, number>();
    for (const [cat, values] of buckets) {
      const sorted = [...values].sort((a, b) => a - b);
      const median =
        sorted.length === 0
          ? 0
          : sorted.length % 2 === 1
            ? sorted[(sorted.length - 1) / 2]
            : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
      thresholds.set(cat, Math.max(0, median * 0.2));
    }
    return thresholds;
  }, [sortedItems, onHandByItem]);

  function stockLevelFor(it: Item): "out" | "low" | "ok" {
    const total = onHandByItem.get(it.id) ?? 0;
    if (total <= 0) return "out";
    const threshold = lowStockThresholdByCategory.get(it.category ?? "other") ?? 0;
    if (threshold > 0 && total < threshold) return "low";
    return "ok";
  }

  const [itemId, setItemId] = useState("");
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [toNodeId, setToNodeId] = useState("");
  const [destinationPickerOpen, setDestinationPickerOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);
  const [showAllSuppliers, setShowAllSuppliers] = useState(false);
  const [quantity, setQuantity] = useState(DEFAULT_QUANTITY);
  const [priority, setPriority] = useState<string>("ROUTINE");
  const [requestedDeliveryAt, setRequestedDeliveryAt] = useState<string>(
    defaultDeliveryDate(),
  );
  const [acknowledgeNoCoverage, setAcknowledgeNoCoverage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when dialog opens. When the caller provided pre-fill values
  // (e.g. opened from an inventory row), seed the corresponding fields so
  // the operator doesn't have to re-pick something they were already looking
  // at. The supplier picker stays empty here; the existing
  // "default to highest-reliability supplier that carries the item" effect
  // below takes care of selecting one once `items` data is loaded.
  useEffect(() => {
    if (open) {
      setItemId(prefill?.itemId ?? "");
      setItemPickerOpen(false);
      setToNodeId(prefill?.toNodeId ?? "");
      setDestinationPickerOpen(false);
      setSupplierId("");
      setSupplierPickerOpen(false);
      setShowAllSuppliers(false);
      setQuantity(
        prefill?.quantity != null && Number.isFinite(prefill.quantity) && prefill.quantity > 0
          ? String(Math.round(prefill.quantity))
          : DEFAULT_QUANTITY,
      );
      setPriority("ROUTINE");
      setRequestedDeliveryAt(defaultDeliveryDate());
      setAcknowledgeNoCoverage(false);
      setError(null);
    }
  }, [open, prefill?.itemId, prefill?.toNodeId, prefill?.quantity]);

  const selectedItem = useMemo(
    () => sortedItems.find((it) => it.id === itemId) ?? null,
    [sortedItems, itemId],
  );
  const selectedNode = useMemo(
    () => destinationNodes.find((n) => n.id === toNodeId) ?? null,
    [destinationNodes, toNodeId],
  );

  // Suppliers that actually carry the selected item, sorted by reliability desc.
  const matchingSuppliers = useMemo(() => {
    if (!itemId) return [] as Supplier[];
    return allSuppliers
      .filter((s) => Array.isArray(s.items) && s.items.includes(itemId))
      .sort((a, b) => (b.reliability ?? 0) - (a.reliability ?? 0));
  }, [allSuppliers, itemId]);

  const sortedAllSuppliers = useMemo(
    () =>
      [...allSuppliers].sort((a, b) => a.name.localeCompare(b.name)),
    [allSuppliers],
  );

  const supplierOptions = useMemo(() => {
    if (!itemId) return [] as Supplier[];
    if (showAllSuppliers || matchingSuppliers.length === 0) {
      // Put matching ones first, then the rest, when showing all.
      const matchIds = new Set(matchingSuppliers.map((s) => s.id));
      return [
        ...matchingSuppliers,
        ...sortedAllSuppliers.filter((s) => !matchIds.has(s.id)),
      ];
    }
    return matchingSuppliers;
  }, [itemId, showAllSuppliers, matchingSuppliers, sortedAllSuppliers]);

  const selectedSupplier = useMemo(
    () => supplierOptions.find((s) => s.id === supplierId) ?? null,
    [supplierOptions, supplierId],
  );

  // When the item changes, default to the highest-reliability supplier
  // that carries it. Clear selection if no supplier covers it.
  useEffect(() => {
    if (!itemId) {
      setSupplierId("");
      return;
    }
    if (matchingSuppliers.length > 0) {
      setSupplierId(matchingSuppliers[0].id);
      setShowAllSuppliers(false);
    } else {
      setSupplierId("");
    }
  }, [itemId, matchingSuppliers]);

  const supplierCarriesItem = useMemo(() => {
    if (!itemId || !selectedSupplier) return true;
    return (
      Array.isArray(selectedSupplier.items) &&
      selectedSupplier.items.includes(itemId)
    );
  }, [itemId, selectedSupplier]);

  // Reset the acknowledgement whenever we no longer need it (item or supplier
  // changed to a covering combination).
  useEffect(() => {
    if (supplierCarriesItem && acknowledgeNoCoverage) {
      setAcknowledgeNoCoverage(false);
    }
  }, [supplierCarriesItem, acknowledgeNoCoverage]);

  const qtyNum = Number(quantity);
  // Pull the catalog price for the chosen item so we can preview the line
  // total before submission and refuse to submit when no catalog price is
  // set (the server enforces the same rule by returning a 400 — see
  // POST /orders in the API; task #222). Treating non-numeric values as 0
  // keeps the disabled-submit guard correct even if the API client emits
  // null/undefined for legacy rows.
  const unitPriceUsd =
    selectedItem && Number.isFinite(Number((selectedItem as { unitPriceUsd?: number }).unitPriceUsd))
      ? Number((selectedItem as { unitPriceUsd?: number }).unitPriceUsd)
      : 0;
  const estimatedTotalUsd =
    Number.isFinite(qtyNum) && qtyNum > 0 ? unitPriceUsd * qtyNum : 0;
  const hasCatalogPrice = unitPriceUsd > 0;
  const baseValid =
    !!itemId &&
    !!toNodeId &&
    !!supplierId &&
    Number.isFinite(qtyNum) &&
    qtyNum > 0 &&
    !!priority &&
    !!requestedDeliveryAt;
  const isValid =
    baseValid &&
    hasCatalogPrice &&
    (supplierCarriesItem || acknowledgeNoCoverage);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!baseValid) {
      setError("Please fill out every field with a valid value.");
      return;
    }
    if (!supplierCarriesItem && !acknowledgeNoCoverage) {
      setError(
        "This supplier doesn't normally carry the chosen item. Confirm to continue.",
      );
      return;
    }
    setError(null);
    try {
      await createOrder.mutateAsync({
        data: {
          toNodeId,
          supplierId,
          itemId,
          quantity: qtyNum,
          priority,
          rationale: "Manual order created from Orders Board",
          requestedDeliveryAt: new Date(
            `${requestedDeliveryAt}T12:00:00Z`,
          ).toISOString(),
        },
      });
      await queryClient.invalidateQueries({
        queryKey: getListOrdersQueryKey(),
      });
      toast({
        title: "Order submitted",
        description: "The new order is now in the SUBMITTED column.",
      });
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create order";
      setError(message);
    }
  };

  const supplierPlaceholder = !itemId
    ? "Select an item first"
    : matchingSuppliers.length === 0 && !showAllSuppliers
      ? "No suppliers carry this item"
      : "Select a supplier";

  const noMatches = !!itemId && matchingSuppliers.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New Order</DialogTitle>
          <DialogDescription>
            Create an ad-hoc order. It will appear in the Submitted column.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-order-item">Item</Label>
            <Popover open={itemPickerOpen} onOpenChange={setItemPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="new-order-item"
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={itemPickerOpen}
                  aria-haspopup="listbox"
                  className={cn(
                    "w-full justify-between font-normal",
                    !selectedItem && "text-muted-foreground",
                  )}
                >
                  {selectedItem ? (
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="truncate">{selectedItem.name}</span>
                      {formatCategory(selectedItem.category) && (
                        <Badge
                          variant="secondary"
                          className="shrink-0 text-[10px] uppercase tracking-wide"
                        >
                          {formatCategory(selectedItem.category)}
                        </Badge>
                      )}
                    </span>
                  ) : (
                    "Select an item"
                  )}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[--radix-popover-trigger-width] p-0"
                align="start"
              >
                <Command
                  filter={(value, search) => {
                    if (!search) return 1;
                    return value
                      .toLowerCase()
                      .includes(search.toLowerCase())
                      ? 1
                      : 0;
                  }}
                >
                  <CommandInput
                    placeholder="Search by name, NIIN/SKU, or class..."
                  />
                  <CommandList>
                    <CommandEmpty>No items match your search.</CommandEmpty>
                    <CommandGroup>
                      {sortedItems.map((it) => {
                        const categoryLabel = formatCategory(it.category);
                        const classOfSupply = it.classOfSupply;
                        const niinOrSku = it.niinOrSku;
                        const onHand = onHandByItem.get(it.id) ?? 0;
                        const leadTime = it.leadTimeDays;
                        const stockLevel = stockLevelFor(it);
                        const searchValue = [
                          it.name,
                          categoryLabel ?? "",
                          classOfSupply ?? "",
                          niinOrSku ?? "",
                          it.id,
                        ]
                          .filter(Boolean)
                          .join(" ");
                        return (
                          <CommandItem
                            key={it.id}
                            value={searchValue}
                            onSelect={() => {
                              setItemId(it.id);
                              setItemPickerOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                itemId === it.id
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="truncate font-medium">
                                  {it.name}
                                </span>
                                {categoryLabel && (
                                  <Badge
                                    variant="secondary"
                                    className="shrink-0 text-[10px] uppercase tracking-wide"
                                  >
                                    {categoryLabel}
                                  </Badge>
                                )}
                                {stockLevel === "out" && (
                                  <Badge
                                    variant="outline"
                                    data-testid={`item-stock-pill-${it.id}`}
                                    className="shrink-0 text-[10px] uppercase tracking-wide border-red-500/40 text-red-600 dark:text-red-400 bg-red-500/10"
                                  >
                                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500 mr-1" />
                                    Out of stock
                                  </Badge>
                                )}
                                {stockLevel === "low" && (
                                  <Badge
                                    variant="outline"
                                    data-testid={`item-stock-pill-${it.id}`}
                                    className="shrink-0 text-[10px] uppercase tracking-wide border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10"
                                  >
                                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 mr-1" />
                                    Low stock
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                <div className="truncate">
                                  {classOfSupply && (
                                    <span>Class {classOfSupply}</span>
                                  )}
                                  {classOfSupply && niinOrSku && (
                                    <span> · </span>
                                  )}
                                  {niinOrSku && <span>{niinOrSku}</span>}
                                </div>
                                <div
                                  className="shrink-0 tabular-nums"
                                  data-testid={`item-stock-meta-${it.id}`}
                                >
                                  <span
                                    className={cn(
                                      stockLevel === "out" &&
                                        "text-red-600 dark:text-red-400 font-medium",
                                      stockLevel === "low" &&
                                        "text-amber-600 dark:text-amber-400 font-medium",
                                    )}
                                  >
                                    On-hand {onHand.toLocaleString()}{" "}
                                    {it.unitOfIssue ?? it.unit}
                                  </span>
                                  {typeof leadTime === "number" && (
                                    <span> · {Math.round(leadTime)}d lead</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="new-order-destination">Destination</Label>
              <Popover
                open={destinationPickerOpen}
                onOpenChange={setDestinationPickerOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    id="new-order-destination"
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={destinationPickerOpen}
                    aria-haspopup="listbox"
                    className={cn(
                      "w-full justify-between font-normal",
                      !selectedNode && "text-muted-foreground",
                    )}
                  >
                    {selectedNode ? (
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="truncate">{selectedNode.name}</span>
                        {formatNodeType(selectedNode.type) && (
                          <Badge
                            variant="secondary"
                            className="shrink-0 text-[10px] uppercase tracking-wide"
                          >
                            {formatNodeType(selectedNode.type)}
                          </Badge>
                        )}
                      </span>
                    ) : (
                      "Select a node"
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[--radix-popover-trigger-width] p-0"
                  align="start"
                >
                  <Command
                    filter={(value, search) => {
                      if (!search) return 1;
                      return value
                        .toLowerCase()
                        .includes(search.toLowerCase())
                        ? 1
                        : 0;
                    }}
                  >
                    <CommandInput
                      placeholder="Search by name, type, or region..."
                    />
                    <CommandList>
                      <CommandEmpty>
                        No destinations match your search.
                      </CommandEmpty>
                      <CommandGroup>
                        {destinationNodes.map((n) => {
                          const typeLabel = formatNodeType(n.type);
                          const region = n.regionalHub ?? "";
                          const country = n.countryCode ?? "";
                          const searchValue = [
                            n.name,
                            typeLabel ?? "",
                            n.type ?? "",
                            region,
                            country,
                            n.id,
                          ]
                            .filter(Boolean)
                            .join(" ");
                          return (
                            <CommandItem
                              key={n.id}
                              value={searchValue}
                              onSelect={() => {
                                setToNodeId(n.id);
                                setDestinationPickerOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  toNodeId === n.id
                                    ? "opacity-100"
                                    : "opacity-0",
                                )}
                              />
                              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="truncate font-medium">
                                    {n.name}
                                  </span>
                                  {typeLabel && (
                                    <Badge
                                      variant="secondary"
                                      className="shrink-0 text-[10px] uppercase tracking-wide"
                                    >
                                      {typeLabel}
                                    </Badge>
                                  )}
                                </div>
                                {(region || country) && (
                                  <div className="text-xs text-muted-foreground truncate">
                                    {region && <span>{region}</span>}
                                    {region && country && <span> · </span>}
                                    {country && <span>{country}</span>}
                                  </div>
                                )}
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="new-order-supplier">Supplier</Label>
                {itemId && matchingSuppliers.length > 0 && (
                  <button
                    type="button"
                    data-testid="supplier-show-all-toggle"
                    className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                    onClick={() => setShowAllSuppliers((v) => !v)}
                  >
                    {showAllSuppliers ? "Only matching" : "Show all"}
                  </button>
                )}
              </div>
              <Popover
                open={supplierPickerOpen}
                onOpenChange={(next) => {
                  if (!itemId || supplierOptions.length === 0) return;
                  setSupplierPickerOpen(next);
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    id="new-order-supplier"
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={supplierPickerOpen}
                    aria-haspopup="listbox"
                    disabled={!itemId || supplierOptions.length === 0}
                    className={cn(
                      "w-full justify-between font-normal",
                      !selectedSupplier && "text-muted-foreground",
                    )}
                  >
                    {selectedSupplier ? (
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="truncate">
                          {selectedSupplier.name}
                        </span>
                        {!(
                          Array.isArray(selectedSupplier.items) &&
                          selectedSupplier.items.includes(itemId)
                        ) && (
                          <Badge
                            variant="outline"
                            className="shrink-0 text-[10px] uppercase tracking-wide border-amber-500/60 text-amber-600 dark:text-amber-400"
                          >
                            no coverage
                          </Badge>
                        )}
                      </span>
                    ) : (
                      supplierPlaceholder
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[--radix-popover-trigger-width] p-0"
                  align="start"
                >
                  <Command
                    filter={(value, search) => {
                      if (!search) return 1;
                      return value
                        .toLowerCase()
                        .includes(search.toLowerCase())
                        ? 1
                        : 0;
                    }}
                  >
                    <CommandInput
                      placeholder="Search by name, region, or channel..."
                    />
                    <CommandList>
                      <CommandEmpty>
                        No suppliers match your search.
                      </CommandEmpty>
                      <CommandGroup>
                        {supplierOptions.map((s) => {
                          const carries =
                            Array.isArray(s.items) && s.items.includes(itemId);
                          const region = s.region ?? "";
                          const channel = s.channel ?? "";
                          const country = s.countryCode ?? "";
                          const searchValue = [
                            s.name,
                            region,
                            channel,
                            country,
                            s.id,
                          ]
                            .filter(Boolean)
                            .join(" ");
                          return (
                            <CommandItem
                              key={s.id}
                              value={searchValue}
                              onSelect={() => {
                                setSupplierId(s.id);
                                setSupplierPickerOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  supplierId === s.id
                                    ? "opacity-100"
                                    : "opacity-0",
                                )}
                              />
                              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="truncate font-medium">
                                    {s.name}
                                  </span>
                                  {channel && (
                                    <Badge
                                      variant="secondary"
                                      className="shrink-0 text-[10px] uppercase tracking-wide"
                                    >
                                      {channel}
                                    </Badge>
                                  )}
                                  {!carries && (
                                    <Badge
                                      variant="outline"
                                      className="shrink-0 text-[10px] uppercase tracking-wide border-amber-500/60 text-amber-600 dark:text-amber-400"
                                    >
                                      no coverage
                                    </Badge>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {region && <span>{region}</span>}
                                  {region && <span> · </span>}
                                  <span>{formatSupplierMeta(s)}</span>
                                </div>
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {noMatches && (
                <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>No supplier in the catalog carries this item.</span>
                  <button
                    type="button"
                    className="underline-offset-2 hover:underline text-foreground"
                    onClick={() => setShowAllSuppliers(true)}
                  >
                    Show all anyway
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="new-order-qty">Quantity</Label>
              <Input
                id="new-order-qty"
                type="number"
                min={1}
                step={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-order-priority">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="new-order-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-order-date">Requested delivery</Label>
              <Input
                id="new-order-date"
                type="date"
                value={requestedDeliveryAt}
                onChange={(e) => setRequestedDeliveryAt(e.target.value)}
              />
            </div>
          </div>

          {selectedItem && (
            <div
              data-testid="new-order-price-summary"
              className="rounded border border-border/60 bg-muted/30 px-3 py-2 text-xs"
            >
              {hasCatalogPrice ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">
                    Unit price (catalog)
                  </span>
                  <span
                    className="font-medium tabular-nums"
                    data-testid="new-order-unit-price"
                  >
                    {formatCurrency(unitPriceUsd)} /{" "}
                    {selectedItem.unitOfIssue ?? selectedItem.unit}
                  </span>
                </div>
              ) : (
                <div
                  className="flex items-start gap-2 text-amber-700 dark:text-amber-300"
                  data-testid="new-order-no-price"
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    No catalog price is set for this item. The server will
                    reject a $0 order — pick a different item or seed a
                    price first.
                  </span>
                </div>
              )}
              {hasCatalogPrice && Number.isFinite(qtyNum) && qtyNum > 0 && (
                <div className="flex items-center justify-between gap-2 mt-1.5 pt-1.5 border-t border-border/60">
                  <span className="text-muted-foreground">
                    Estimated total
                  </span>
                  <span
                    className="font-semibold tabular-nums"
                    data-testid="new-order-estimated-total"
                  >
                    {formatCurrency(estimatedTotalUsd)}
                  </span>
                </div>
              )}
            </div>
          )}

          {itemId && (
            <CompanionProceduresPanel itemId={itemId} />
          )}

          {!supplierCarriesItem && selectedSupplier && (
            <div
              data-testid="supplier-coverage-warning"
              className="rounded border border-amber-500/50 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 space-y-2"
            >
              <div className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium">
                    {selectedSupplier.name} doesn't normally carry
                    {selectedItem ? ` ${selectedItem.name}` : " this item"}.
                  </div>
                  <div className="text-amber-800/80 dark:text-amber-200/80">
                    Submitting may result in a refusal or significantly longer
                    lead time. Pick a covering supplier or confirm to proceed.
                  </div>
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-amber-900 dark:text-amber-200 cursor-pointer">
                <Checkbox
                  data-testid="ack-no-coverage"
                  checked={acknowledgeNoCoverage}
                  onCheckedChange={(v) =>
                    setAcknowledgeNoCoverage(v === true)
                  }
                  className="border-amber-600 data-[state=checked]:bg-amber-600 data-[state=checked]:text-white"
                />
                <span>
                  I know this supplier doesn't normally carry this item.
                </span>
              </label>
            </div>
          )}

          {error && (
            <div className="text-xs text-destructive border border-destructive/40 bg-destructive/10 rounded px-3 py-2">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={createOrder.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isValid || createOrder.isPending}
            >
              {createOrder.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Submit Order
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const TIER_LABELS: Record<string, string> = {
  primary: "Primary",
  secondary: "Secondary",
  tertiary: "Tertiary",
};

const TIER_CLASSES: Record<string, string> = {
  primary: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
  secondary: "border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10",
  tertiary: "border-sky-500/40 text-sky-600 dark:text-sky-400 bg-sky-500/10",
};

function CompanionProceduresPanel({ itemId }: { itemId: string }) {
  const { data, isLoading } = useListItemProcedures(itemId, {
    query: {
      queryKey: getListItemProceduresQueryKey(itemId),
      enabled: itemId.length > 0,
    },
  });

  if (isLoading) {
    return (
      <div
        data-testid="companion-procedures-loading"
        className="rounded border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
      >
        Loading clinical context…
      </div>
    );
  }

  const procedures = data ?? [];
  if (procedures.length === 0) return null;

  return (
    <div
      data-testid="companion-procedures-panel"
      className="rounded border border-border/60 bg-muted/30 px-3 py-2 space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Used in {procedures.length} procedure
          {procedures.length === 1 ? "" : "s"}
        </div>
        <Link
          href="/procedures"
          className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        >
          Browse library →
        </Link>
      </div>
      <ul className="space-y-1.5" data-testid="companion-procedures-list">
        {procedures.slice(0, 5).map((p) => (
          <li
            key={p.procedureId}
            className="flex items-center justify-between gap-2 text-xs"
            data-testid={`companion-procedure-${p.procedureId}`}
          >
            <Link
              href={`/procedures/${p.procedureId}`}
              className="truncate hover:text-primary hover:underline"
            >
              {p.procedureName}
            </Link>
            <Badge
              variant="outline"
              className={cn(
                "shrink-0 text-[10px] uppercase tracking-wide",
                TIER_CLASSES[p.tier] ?? "",
              )}
            >
              {TIER_LABELS[p.tier] ?? p.tier}
            </Badge>
          </li>
        ))}
        {procedures.length > 5 && (
          <li className="text-[11px] text-muted-foreground">
            + {procedures.length - 5} more
          </li>
        )}
      </ul>
    </div>
  );
}
