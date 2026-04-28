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
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";

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
  const sortedSuppliers = useMemo(
    () =>
      [...(suppliers ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name),
      ) as Supplier[],
    [suppliers],
  );

  const [itemId, setItemId] = useState("");
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [toNodeId, setToNodeId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [quantity, setQuantity] = useState("100");
  const [priority, setPriority] = useState<string>("ROUTINE");
  const [requestedDeliveryAt, setRequestedDeliveryAt] = useState<string>(
    defaultDeliveryDate(),
  );
  const [error, setError] = useState<string | null>(null);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setItemId("");
      setItemPickerOpen(false);
      setToNodeId("");
      setSupplierId("");
      setQuantity("100");
      setPriority("ROUTINE");
      setRequestedDeliveryAt(defaultDeliveryDate());
      setError(null);
    }
  }, [open]);

  const selectedItem = useMemo(
    () => sortedItems.find((it) => it.id === itemId) ?? null,
    [sortedItems, itemId],
  );

  const qtyNum = Number(quantity);
  const isValid =
    !!itemId &&
    !!toNodeId &&
    !!supplierId &&
    Number.isFinite(qtyNum) &&
    qtyNum > 0 &&
    !!priority &&
    !!requestedDeliveryAt;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) {
      setError("Please fill out every field with a valid value.");
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
              <Label htmlFor="new-order-supplier">Supplier</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger id="new-order-supplier">
                  <SelectValue placeholder="Select a supplier" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {sortedSuppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
