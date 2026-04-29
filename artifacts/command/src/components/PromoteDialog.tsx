import React from "react";
import {
  type Recommendation,
  type Supplier,
} from "@workspace/api-client-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Package } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { useCanWrite } from "@/components/auth/useCanWrite";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type PromoteOverrides = {
  quantity: number;
  supplierId: string;
  etaDays: number;
  priority: "ROUTINE" | "URGENT" | "FLASH";
  includeCompanionSupplies: boolean;
};

export function defaultPriorityForKind(
  kind: string | undefined,
): PromoteOverrides["priority"] {
  const k = (kind ?? "").toUpperCase();
  if (k === "ESCALATE") return "FLASH";
  if (k === "REROUTE") return "URGENT";
  return "ROUTINE";
}

export function PromoteDialog({
  rec,
  suppliers,
  isSubmitting,
  onCancel,
  onConfirm,
}: {
  rec: Recommendation | null;
  suppliers: Supplier[];
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: (overrides: PromoteOverrides) => void;
}) {
  const { canWrite, reason: writeReason } = useCanWrite();
  const [draft, setDraft] = React.useState<PromoteOverrides | null>(null);
  const [qtyText, setQtyText] = React.useState<string>("");
  const [etaText, setEtaText] = React.useState<string>("");
  const [validationError, setValidationError] = React.useState<string | null>(
    null,
  );

  React.useEffect(() => {
    if (rec) {
      const initial: PromoteOverrides = {
        quantity: Math.max(1, Math.round(rec.quantity)),
        supplierId:
          rec.suggestedSupplierId ?? suppliers[0]?.id ?? "supplier",
        etaDays: Math.max(0, Number(rec.etaDays.toFixed(1))),
        priority:
          (rec.priority?.toUpperCase() as PromoteOverrides["priority"]) ??
          defaultPriorityForKind(rec.kind),
        includeCompanionSupplies: false,
      };
      setDraft(initial);
      setQtyText(String(initial.quantity));
      setEtaText(String(initial.etaDays));
      setValidationError(null);
    }
  }, [rec, suppliers]);

  const open = rec != null && draft != null;

  const handleSubmit = () => {
    if (!draft) return;
    const qty = Number(qtyText);
    const eta = Number(etaText);
    if (!Number.isFinite(qty) || qty <= 0) {
      setValidationError("Quantity must be greater than 0.");
      return;
    }
    if (!Number.isFinite(eta) || eta < 0) {
      setValidationError("ETA must be 0 or greater.");
      return;
    }
    if (!draft.supplierId) {
      setValidationError("Pick a supplier.");
      return;
    }
    setValidationError(null);
    onConfirm({
      ...draft,
      quantity: Math.round(qty),
      etaDays: eta,
    });
  };

  const orderedSuppliers = React.useMemo(() => {
    if (!rec) return suppliers;
    const preferredId = rec.suggestedSupplierId;
    if (!preferredId) return suppliers;
    const preferred = suppliers.find((s) => s.id === preferredId);
    if (!preferred) return suppliers;
    return [preferred, ...suppliers.filter((s) => s.id !== preferredId)];
  }, [rec, suppliers]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isSubmitting) onCancel();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        data-testid="promote-dialog"
      >
        <DialogHeader>
          <DialogTitle>Promote to Purchase Order</DialogTitle>
          <DialogDescription>
            Review and adjust the recommended order before submitting.
          </DialogDescription>
        </DialogHeader>
        {rec && draft ? (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">
                  {rec.itemName ?? rec.itemId}
                </span>
                <span className="text-muted-foreground">
                  → {rec.nodeName ?? rec.nodeId}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Suggested {Math.round(rec.quantity).toLocaleString()} units · ETA{" "}
                {rec.etaDays.toFixed(0)}d
              </div>
              {(() => {
                // Recompute the estimate from the live quantity field so
                // the operator sees the price update as they edit, and so
                // the number on this row matches whatever the server will
                // bill the PO at (server uses the same catalog unit price).
                const unitPrice =
                  typeof rec.estimatedUnitCostUsd === "number" &&
                  rec.estimatedUnitCostUsd > 0
                    ? rec.estimatedUnitCostUsd
                    : rec.quantity > 0 &&
                        typeof rec.estimatedCost === "number"
                      ? rec.estimatedCost / rec.quantity
                      : 0;
                const liveQty = Number(qtyText);
                const previewQty =
                  Number.isFinite(liveQty) && liveQty > 0
                    ? Math.round(liveQty)
                    : Math.round(rec.quantity);
                const estimate = unitPrice * previewQty;
                if (!(unitPrice > 0)) return null;
                return (
                  <div
                    className="text-[11px] mt-1 flex items-center justify-between gap-2"
                    data-testid="promote-estimated-cost"
                  >
                    <span className="text-muted-foreground">
                      Est. cost {formatCurrency(unitPrice)}/unit ×{" "}
                      {previewQty.toLocaleString()}
                    </span>
                    <span className="font-mono font-semibold text-emerald-400">
                      {formatCurrency(estimate)}
                    </span>
                  </div>
                );
              })()}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="promote-qty" className="text-xs">
                  Quantity
                </Label>
                <Input
                  id="promote-qty"
                  type="number"
                  min={1}
                  step={1}
                  value={qtyText}
                  onChange={(e) => setQtyText(e.target.value)}
                  data-testid="promote-quantity"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promote-eta" className="text-xs">
                  ETA (days)
                </Label>
                <Input
                  id="promote-eta"
                  type="number"
                  min={0}
                  step={0.5}
                  value={etaText}
                  onChange={(e) => setEtaText(e.target.value)}
                  data-testid="promote-eta"
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Supplier</Label>
              <Select
                value={draft.supplierId}
                onValueChange={(v) =>
                  setDraft({ ...draft, supplierId: v })
                }
              >
                <SelectTrigger className="h-8 text-sm" data-testid="promote-supplier">
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
                <SelectContent>
                  {orderedSuppliers.length === 0 ? (
                    <SelectItem value={draft.supplierId} disabled>
                      No suppliers available
                    </SelectItem>
                  ) : (
                    orderedSuppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="flex items-center gap-2">
                          <span>{s.name}</span>
                          <span className="text-[10px] uppercase text-muted-foreground">
                            {s.channel}
                          </span>
                          {s.id === rec.suggestedSupplierId ? (
                            <span className="text-[10px] text-primary">
                              · suggested
                            </span>
                          ) : null}
                        </span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Priority</Label>
              <Select
                value={draft.priority}
                onValueChange={(v) =>
                  setDraft({
                    ...draft,
                    priority: v as PromoteOverrides["priority"],
                  })
                }
              >
                <SelectTrigger className="h-8 text-sm" data-testid="promote-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ROUTINE">Routine</SelectItem>
                  <SelectItem value="URGENT">Urgent</SelectItem>
                  <SelectItem value="FLASH">Flash</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {Array.isArray(rec.companionItems) &&
            rec.companionItems.length > 0 ? (
              <label
                className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs cursor-pointer"
                data-testid="promote-bundle-companion-label"
              >
                <Checkbox
                  data-testid="promote-bundle-companion"
                  checked={draft.includeCompanionSupplies}
                  onCheckedChange={(v) =>
                    setDraft({
                      ...draft,
                      includeCompanionSupplies: v === true,
                    })
                  }
                  className="mt-0.5"
                />
                <span className="space-y-0.5">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Package className="h-3.5 w-3.5 text-primary" />
                    Bundle {rec.companionItems.length} companion suppl
                    {rec.companionItems.length === 1 ? "y" : "ies"}
                  </span>
                  <span className="text-muted-foreground block">
                    Add the items clinicians use alongside this one (same
                    procedure tier) to the same purchase order.
                  </span>
                </span>
              </label>
            ) : null}

            {validationError ? (
              <div className="text-xs text-destructive">{validationError}</div>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isSubmitting}
            data-testid="promote-cancel"
          >
            Cancel
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    onClick={handleSubmit}
                    disabled={isSubmitting || !draft || !canWrite}
                    data-testid="promote-confirm"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        Submitting…
                      </>
                    ) : (
                      "Confirm & Submit"
                    )}
                  </Button>
                </span>
              </TooltipTrigger>
              {!canWrite && (
                <TooltipContent>
                  Requires Logistician or Commander role
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
