import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { AlertTriangle, Loader2, ShoppingBag } from "lucide-react";

export interface BulkOrderLine {
  itemId: string;
  itemName: string;
  quantity: number;
  unitOfIssue: string;
}

export interface BulkOrderGroup {
  supplierId: string;
  supplierName: string;
  lines: BulkOrderLine[];
}

interface BulkOrderConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: BulkOrderGroup[];
  /**
   * Number of shortfall items that had no supplier alternative and were
   * dropped from the consolidated PO list. Surfaced as a warning so the
   * operator knows what they will *not* be ordering.
   */
  skippedItemsCount: number;
  isSubmitting: boolean;
  onConfirm: (selected: BulkOrderGroup[]) => void | Promise<void>;
}

export function BulkOrderConfirmDialog({
  open,
  onOpenChange,
  groups,
  skippedItemsCount,
  isSubmitting,
  onConfirm,
}: BulkOrderConfirmDialogProps) {
  // Selection map keyed by `${supplierId}:${itemId}` so the same item bound
  // to two suppliers (rare, but possible if grouping ever changes) doesn't
  // collide. Default = all selected.
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});

  const lineKey = React.useCallback(
    (supplierId: string, itemId: string) => `${supplierId}:${itemId}`,
    [],
  );

  React.useEffect(() => {
    if (!open) return;
    const next: Record<string, boolean> = {};
    for (const g of groups) {
      for (const l of g.lines) {
        next[lineKey(g.supplierId, l.itemId)] = true;
      }
    }
    setSelected(next);
  }, [open, groups, lineKey]);

  const toggleLine = (supplierId: string, itemId: string, value: boolean) => {
    setSelected((prev) => ({
      ...prev,
      [lineKey(supplierId, itemId)]: value,
    }));
  };

  const toggleSupplier = (group: BulkOrderGroup, value: boolean) => {
    setSelected((prev) => {
      const next = { ...prev };
      for (const l of group.lines) {
        next[lineKey(group.supplierId, l.itemId)] = value;
      }
      return next;
    });
  };

  const supplierState = (group: BulkOrderGroup) => {
    const flags = group.lines.map(
      (l) => selected[lineKey(group.supplierId, l.itemId)] ?? false,
    );
    const on = flags.filter(Boolean).length;
    if (on === 0) return { checked: false, indeterminate: false };
    if (on === flags.length) return { checked: true, indeterminate: false };
    return { checked: true, indeterminate: true };
  };

  // Build the trimmed list of groups that will actually be submitted: drop
  // any line the operator unchecked, then drop any supplier that has no
  // remaining lines.
  const trimmedGroups = React.useMemo<BulkOrderGroup[]>(() => {
    const out: BulkOrderGroup[] = [];
    for (const g of groups) {
      const keptLines = g.lines.filter(
        (l) => selected[lineKey(g.supplierId, l.itemId)],
      );
      if (keptLines.length === 0) continue;
      out.push({
        supplierId: g.supplierId,
        supplierName: g.supplierName,
        lines: keptLines,
      });
    }
    return out;
  }, [groups, selected, lineKey]);

  const totalSelectedLines = trimmedGroups.reduce(
    (sum, g) => sum + g.lines.length,
    0,
  );
  const totalSelectedUnits = trimmedGroups.reduce(
    (sum, g) => sum + g.lines.reduce((s, l) => s + l.quantity, 0),
    0,
  );

  const handleConfirm = async () => {
    if (trimmedGroups.length === 0) return;
    await onConfirm(trimmedGroups);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (isSubmitting && !o) return;
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Review consolidated supplier orders</DialogTitle>
          <DialogDescription>
            Each card below becomes one purchase order to that supplier.
            Uncheck individual lines or whole suppliers to trim the batch
            before sending.
          </DialogDescription>
        </DialogHeader>

        {skippedItemsCount > 0 && (
          <div
            className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-600 dark:text-amber-300"
            data-testid="bulk-order-skipped-warning"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              {skippedItemsCount} shortfall{skippedItemsCount === 1 ? "" : "s"}{" "}
              {skippedItemsCount === 1 ? "has" : "have"} no supplier alternative
              and won't be ordered. Pick a supplier manually for those items if
              they're still needed.
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 max-h-[55vh] overflow-y-auto pr-1">
          {groups.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No supplier-backed shortfalls to order.
            </div>
          ) : (
            groups.map((group) => {
              const sState = supplierState(group);
              const supplierLines = group.lines.length;
              const supplierUnits = group.lines.reduce(
                (s, l) => s + l.quantity,
                0,
              );
              const selectedSupplierLines = group.lines.filter(
                (l) => selected[lineKey(group.supplierId, l.itemId)],
              ).length;
              const selectedSupplierUnits = group.lines
                .filter((l) => selected[lineKey(group.supplierId, l.itemId)])
                .reduce((s, l) => s + l.quantity, 0);
              const supplierToggleId = `bulk-order-supplier-${group.supplierId}`;
              return (
                <Card
                  key={group.supplierId}
                  data-testid={`bulk-order-group-${group.supplierId}`}
                  className={
                    sState.checked
                      ? ""
                      : "opacity-60 border-dashed"
                  }
                >
                  <CardHeader className="p-3 pb-2 space-y-0">
                    <label
                      htmlFor={supplierToggleId}
                      className="flex flex-row items-start gap-3 cursor-pointer"
                    >
                      <Checkbox
                        id={supplierToggleId}
                        checked={
                          sState.indeterminate
                            ? "indeterminate"
                            : sState.checked
                        }
                        onCheckedChange={(v) =>
                          toggleSupplier(group, v === true)
                        }
                        data-testid={`bulk-order-supplier-toggle-${group.supplierId}`}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium truncate">
                            {group.supplierName}
                          </div>
                          <Badge
                            variant="secondary"
                            className="shrink-0 text-[10px] uppercase tracking-wide"
                          >
                            1 PO
                          </Badge>
                        </div>
                        <div
                          className="text-[11px] text-muted-foreground tabular-nums"
                          data-testid={`bulk-order-supplier-subtotal-${group.supplierId}`}
                        >
                          {selectedSupplierLines === supplierLines ? (
                            <>
                              {supplierLines} line
                              {supplierLines === 1 ? "" : "s"} ·{" "}
                              {supplierUnits.toLocaleString()} unit
                              {supplierUnits === 1 ? "" : "s"} total
                            </>
                          ) : (
                            <>
                              {selectedSupplierLines} of {supplierLines} line
                              {supplierLines === 1 ? "" : "s"} ·{" "}
                              {selectedSupplierUnits.toLocaleString()} unit
                              {selectedSupplierUnits === 1 ? "" : "s"} selected
                            </>
                          )}
                        </div>
                      </div>
                    </label>
                  </CardHeader>
                  <CardContent className="p-3 pt-0">
                    <ul className="divide-y divide-border/60">
                      {group.lines.map((line) => {
                        const key = lineKey(group.supplierId, line.itemId);
                        const isSelected = !!selected[key];
                        const lineToggleId = `bulk-order-line-${group.supplierId}-${line.itemId}`;
                        return (
                          <li
                            key={line.itemId}
                            data-testid={`bulk-order-line-${group.supplierId}-${line.itemId}`}
                          >
                            <label
                              htmlFor={lineToggleId}
                              className="flex items-center gap-3 py-1.5 cursor-pointer"
                            >
                              <Checkbox
                                id={lineToggleId}
                                checked={isSelected}
                                onCheckedChange={(v) =>
                                  toggleLine(
                                    group.supplierId,
                                    line.itemId,
                                    v === true,
                                  )
                                }
                                data-testid={`bulk-order-line-toggle-${group.supplierId}-${line.itemId}`}
                              />
                              <div
                                className={
                                  "flex-1 min-w-0 text-sm" +
                                  (isSelected ? "" : " line-through opacity-60")
                                }
                              >
                                <div className="truncate">{line.itemName}</div>
                              </div>
                              <div
                                className={
                                  "text-xs tabular-nums shrink-0" +
                                  (isSelected ? "" : " line-through opacity-60")
                                }
                              >
                                {line.quantity.toLocaleString()}{" "}
                                {line.unitOfIssue}
                              </div>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        <DialogFooter className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div
            className="text-xs text-muted-foreground tabular-nums"
            data-testid="bulk-order-grand-subtotal"
          >
            {trimmedGroups.length === 0 ? (
              <>Nothing selected</>
            ) : (
              <>
                Sending {trimmedGroups.length} order
                {trimmedGroups.length === 1 ? "" : "s"} ·{" "}
                {totalSelectedLines} line
                {totalSelectedLines === 1 ? "" : "s"} ·{" "}
                {totalSelectedUnits.toLocaleString()} unit
                {totalSelectedUnits === 1 ? "" : "s"}
              </>
            )}
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              data-testid="bulk-order-cancel"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={isSubmitting || trimmedGroups.length === 0}
              data-testid="bulk-order-confirm"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ShoppingBag className="h-4 w-4 mr-2" />
              )}
              Send {trimmedGroups.length || ""} order
              {trimmedGroups.length === 1 ? "" : "s"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
