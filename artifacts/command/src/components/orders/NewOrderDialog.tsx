import React, { useEffect, useMemo, useState } from "react";
import {
  useCreateOrder,
  useListItems,
  useListNodes,
  useListSuppliers,
  getListItemsQueryKey,
  getListNodesQueryKey,
  getListSuppliersQueryKey,
  getListOrdersQueryKey,
  type Item,
  type Node as NetworkNode,
  type Supplier,
} from "@workspace/api-client-react";
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

interface NewOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewOrderDialog({ open, onOpenChange }: NewOrderDialogProps) {
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

  const [itemId, setItemId] = useState("");
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [toNodeId, setToNodeId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [showAllSuppliers, setShowAllSuppliers] = useState(false);
  const [quantity, setQuantity] = useState("100");
  const [priority, setPriority] = useState<string>("ROUTINE");
  const [requestedDeliveryAt, setRequestedDeliveryAt] = useState<string>(
    defaultDeliveryDate(),
  );
  const [acknowledgeNoCoverage, setAcknowledgeNoCoverage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setItemId("");
      setItemPickerOpen(false);
      setToNodeId("");
      setSupplierId("");
      setShowAllSuppliers(false);
      setQuantity("100");
      setPriority("ROUTINE");
      setRequestedDeliveryAt(defaultDeliveryDate());
      setAcknowledgeNoCoverage(false);
      setError(null);
    }
  }, [open]);

  const selectedItem = useMemo(
    () => sortedItems.find((it) => it.id === itemId) ?? null,
    [sortedItems, itemId],
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


  const selectedSupplier = useMemo(
    () => allSuppliers.find((s) => s.id === supplierId) ?? null,
    [allSuppliers, supplierId],
  );

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
  const baseValid =
    !!itemId &&
    !!toNodeId &&
    !!supplierId &&
    Number.isFinite(qtyNum) &&
    qtyNum > 0 &&
    !!priority &&
    !!requestedDeliveryAt;
  const isValid =
    baseValid && (supplierCarriesItem || acknowledgeNoCoverage);

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
                              </div>
                              {(classOfSupply || niinOrSku) && (
                                <div className="text-xs text-muted-foreground truncate">
                                  {classOfSupply && (
                                    <span>Class {classOfSupply}</span>
                                  )}
                                  {classOfSupply && niinOrSku && (
                                    <span> · </span>
                                  )}
                                  {niinOrSku && <span>{niinOrSku}</span>}
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="new-order-destination">Destination</Label>
              <Select value={toNodeId} onValueChange={setToNodeId}>
                <SelectTrigger id="new-order-destination">
                  <SelectValue placeholder="Select a node" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {destinationNodes.map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      {n.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <Select
                value={supplierId}
                onValueChange={setSupplierId}
                disabled={!itemId || supplierOptions.length === 0}
              >
                <SelectTrigger id="new-order-supplier">
                  <SelectValue placeholder={supplierPlaceholder} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {supplierOptions.map((s) => {
                    const carries =
                      Array.isArray(s.items) && s.items.includes(itemId);
                    return (
                      <SelectItem key={s.id} value={s.id}>
                        <div className="flex flex-col leading-tight py-0.5">
                          <span className="text-sm">
                            {s.name}
                            {!carries && (
                              <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                                no coverage
                              </span>
                            )}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {formatSupplierMeta(s)}
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
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
