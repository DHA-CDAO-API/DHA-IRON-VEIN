import React from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOrder,
  useUpdateOrderStatus,
  getGetOrderQueryKey,
  type Order,
  type OrderDetail as OrderDetailEnvelope,
  type OrderLineDetail,
  type OrderShipmentProgress,
  type UpdateOrderStatusInputPriority,
  type UpdateOrderStatusInputStatus,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SortableTable } from "@/components/ui/sortable-table";
import { AiBadge } from "@/components/ui/ai-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Printer,
  Sparkles,
  Truck,
  Building2,
  MapPin,
  Calendar,
  Clock,
  AlertTriangle,
  Activity,
  Package,
  PackageCheck,
  Plane,
  Check,
} from "lucide-react";
import {
  formatNumber,
  formatShortDate,
  formatShortDateTime,
} from "@/lib/format";

type EnrichedOrder = Order & {
  toNodeName?: string | null;
  fromNodeName?: string | null;
  supplierName?: string | null;
  unit?: string | null;
  triggerNote?: string | null;
  triggerSource?: string | null;
  requestedDeliveryAt?: string | null;
};

const PRIORITY_OPTIONS = ["ROUTINE", "PRIORITY", "URGENT", "FLASH"] as const;
const STATUS_OPTIONS = [
  "SUBMITTED",
  "ACKNOWLEDGED",
  "IN_TRANSIT",
  "RECEIVED",
] as const;

function priorityClass(priority: string) {
  const p = priority?.toUpperCase();
  if (p === "FLASH") return "border-destructive bg-destructive/20 text-destructive";
  if (p === "URGENT") return "border-amber-500 bg-amber-500/20 text-amber-500";
  return "border-primary/40 bg-primary/10 text-primary";
}

function statusClass(status: string) {
  const s = status?.toUpperCase();
  if (s === "RECEIVED") return "border-emerald-500 text-emerald-500";
  if (s === "IN_TRANSIT") return "border-primary text-primary";
  if (s === "ACKNOWLEDGED") return "border-amber-500 text-amber-500";
  return "border-muted-foreground/50 text-muted-foreground";
}

type PendingChange =
  | { kind: "priority"; from: string; to: UpdateOrderStatusInputPriority }
  | { kind: "status"; from: string; to: UpdateOrderStatusInputStatus };

type StepKey = "DEPARTED" | "IN_TRANSIT" | "DELIVERED";

const SHIPMENT_STEPS: Array<{
  key: StepKey;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: "DEPARTED", label: "Departed", Icon: Truck },
  { key: "IN_TRANSIT", label: "In Transit", Icon: Plane },
  { key: "DELIVERED", label: "Delivered", Icon: PackageCheck },
];

function stepReached(status: OrderShipmentProgress["status"], step: StepKey): boolean {
  const order: StepKey[] = ["DEPARTED", "IN_TRANSIT", "DELIVERED"];
  return order.indexOf(step) <= order.indexOf(status as StepKey);
}

function stepTimestamp(
  shipment: OrderShipmentProgress,
  step: StepKey,
): string | null {
  if (step === "DEPARTED") return shipment.departedAt;
  if (step === "DELIVERED") return shipment.deliveredAt ?? null;
  // IN_TRANSIT has no dedicated timestamp; fall back to ETA so operators can
  // see "expected to arrive by ...".
  return shipment.etaAt;
}

function ShipmentProgress({ shipment }: { shipment: OrderShipmentProgress }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="text-sm font-medium truncate">
          {shipment.itemName || shipment.itemId}{" "}
          <span className="text-muted-foreground font-mono text-xs">
            · {formatNumber(shipment.quantity)} {shipment.unit || ""}
          </span>
        </div>
        <div className="text-xs text-muted-foreground font-mono shrink-0">
          {shipment.id}
        </div>
      </div>
      <div className="flex items-center" role="list" aria-label="Shipment milestones">
        {SHIPMENT_STEPS.map((step, idx) => {
          const reached = stepReached(shipment.status, step.key);
          const isCurrent = step.key === shipment.status;
          const ts = stepTimestamp(shipment, step.key);
          const Icon = step.Icon;
          const colorClass = reached
            ? step.key === "DELIVERED"
              ? "border-emerald-500 bg-emerald-500/15 text-emerald-500"
              : "border-primary bg-primary/15 text-primary"
            : "border-muted-foreground/30 bg-muted/20 text-muted-foreground/60";
          const connectorClass = stepReached(shipment.status, SHIPMENT_STEPS[idx + 1]?.key ?? "DELIVERED")
            ? step.key === "DELIVERED" || (idx === 1 && shipment.status === "DELIVERED")
              ? "bg-emerald-500"
              : "bg-primary"
            : "bg-muted-foreground/30";
          const tooltipLabel = reached
            ? ts
              ? `${step.label}${step.key === "IN_TRANSIT" ? " · ETA" : ""} ${formatShortDateTime(ts)}`
              : `${step.label} (no timestamp recorded)`
            : step.key === "IN_TRANSIT" && ts
              ? `Pending · ETA ${formatShortDateTime(ts)}`
              : `${step.label} (pending)`;
          return (
            <React.Fragment key={step.key}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className="flex flex-col items-center gap-1 min-w-0 cursor-help"
                    role="listitem"
                    aria-label={tooltipLabel}
                    aria-current={isCurrent ? "step" : undefined}
                    data-testid={`shipment-step-${shipment.id}-${step.key}`}
                  >
                    <div
                      className={`relative flex h-9 w-9 items-center justify-center rounded-full border-2 transition-colors ${colorClass}`}
                    >
                      {reached && step.key === "DELIVERED" ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Icon className="h-4 w-4" />
                      )}
                      {isCurrent && shipment.status !== "DELIVERED" && (
                        <span className="absolute inset-0 rounded-full ring-2 ring-primary/40 animate-pulse" />
                      )}
                    </div>
                    <div
                      className={`text-[10px] uppercase tracking-wider font-medium ${reached ? "text-foreground" : "text-muted-foreground/70"}`}
                    >
                      {step.label}
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent>{tooltipLabel}</TooltipContent>
              </Tooltip>
              {idx < SHIPMENT_STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 -mt-4 transition-colors ${connectorClass}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const queryKey = getGetOrderQueryKey(id || "");

  const [pendingChange, setPendingChange] = React.useState<PendingChange | null>(null);
  const [noteDraft, setNoteDraft] = React.useState("");

  const { data, isLoading, error } = useGetOrder(id || "", {
    query: {
      enabled: !!id,
      queryKey,
    },
  });

  const updateOrder = useUpdateOrderStatus({
    mutation: {
      onMutate: async (vars) => {
        await queryClient.cancelQueries({ queryKey });
        const previous = queryClient.getQueryData<OrderDetailEnvelope>(queryKey);
        if (previous) {
          queryClient.setQueryData<OrderDetailEnvelope>(queryKey, {
            ...previous,
            order: {
              ...previous.order,
              ...(vars.data.status ? { status: vars.data.status } : {}),
              ...(vars.data.priority ? { priority: vars.data.priority } : {}),
            },
          });
        }
        return { previous };
      },
      onError: (_err, _vars, ctx) => {
        if (ctx?.previous) queryClient.setQueryData(queryKey, ctx.previous);
        toast({
          title: "Update failed",
          description: "Could not update the order. Please try again.",
          variant: "destructive",
        });
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey });
      },
    },
  });

  const closeDialog = () => {
    if (updateOrder.isPending) return;
    setPendingChange(null);
    setNoteDraft("");
  };

  const confirmPendingChange = () => {
    if (!pendingChange || !id) return;
    const trimmed = noteDraft.trim();
    const data: {
      priority?: UpdateOrderStatusInputPriority;
      status?: UpdateOrderStatusInputStatus;
      note?: string;
    } = {};
    if (pendingChange.kind === "priority") data.priority = pendingChange.to;
    else data.status = pendingChange.to;
    if (trimmed.length > 0) data.note = trimmed;
    updateOrder.mutate(
      { orderId: id, data },
      {
        onSuccess: () => {
          setPendingChange(null);
          setNoteDraft("");
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 space-y-4">
        <Link
          href="/orders"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Orders Board
        </Link>
        <div className="text-destructive">Order not found.</div>
      </div>
    );
  }

  const order = data.order as EnrichedOrder;
  const fromNode = data.fromNode;
  const toNode = data.toNode;
  const supplier = data.supplier;
  const item = data.item;
  const lines = (data.lines ?? []) as OrderLineDetail[];
  const recommendation = (data as { recommendation?: Record<string, unknown> }).recommendation;
  const itemMissing = data.itemMissing === true;
  const activity = (data.activity ?? []) as Array<{
    id: string;
    kind: string;
    summary: string;
    actorRole?: string | null;
    createdAt: string;
  }>;
  const shipmentProgress = (data.shipments ?? []) as OrderShipmentProgress[];

  const aiTriggered = order.triggerSource === "ai" || !!order.sourceRecommendationId;
  const supplierLabel = order.supplierName || supplier?.name || order.supplierId || fromNode?.name || "—";
  const destinationLabel = order.toNodeName || toNode?.name || order.toNodeId;

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-y-auto bg-background text-foreground">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link
            href="/orders"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="h-4 w-4" /> Orders Board
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/orders/${order.id}/print`}>
            <Button variant="outline" size="sm" className="gap-2">
              <Printer className="h-4 w-4" /> Print PO
            </Button>
          </Link>
        </div>
      </div>

      <Card className="bg-card/60 border-border shrink-0">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3 justify-between">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold tracking-wider font-mono">
                  {order.orderNumber}
                </h1>
                <Select
                  value={order.priority}
                  disabled={updateOrder.isPending}
                  onValueChange={(value) => {
                    if (value === order.priority) return;
                    setNoteDraft("");
                    setPendingChange({
                      kind: "priority",
                      from: order.priority,
                      to: value as UpdateOrderStatusInputPriority,
                    });
                  }}
                >
                  <SelectTrigger
                    aria-label="Order priority"
                    className={`h-7 w-32 px-2 text-xs uppercase tracking-wider font-semibold ${priorityClass(order.priority)}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY_OPTIONS.map((p) => (
                      <SelectItem key={p} value={p} className="text-xs uppercase tracking-wider">
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={order.status}
                  disabled={updateOrder.isPending}
                  onValueChange={(value) => {
                    if (value === order.status) return;
                    setNoteDraft("");
                    setPendingChange({
                      kind: "status",
                      from: order.status,
                      to: value as UpdateOrderStatusInputStatus,
                    });
                  }}
                >
                  <SelectTrigger
                    aria-label="Order status"
                    className={`h-7 w-40 px-2 text-xs uppercase tracking-wider font-semibold ${statusClass(order.status)}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s} className="text-xs uppercase tracking-wider">
                        {s.replace("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {aiTriggered && <AiBadge />}
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                Created {formatShortDateTime(order.createdAt)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Total
              </div>
              <div className="text-2xl font-bold font-mono">
                ${formatNumber(order.totalCost, { fractionDigits: 2 })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 shrink-0">
        <Card className="bg-card/50 border-border">
          <CardContent className="p-4 space-y-2">
            <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5" /> Destination
            </div>
            <Link
              href={`/sites/${order.toNodeId}`}
              className="font-bold hover:text-primary hover:underline block"
            >
              {destinationLabel}
            </Link>
            <div className="text-xs text-muted-foreground">
              {toNode?.type} · {toNode?.countryCode || "—"}
            </div>
            <div className="text-xs font-mono text-muted-foreground">
              {order.toNodeId}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border">
          <CardContent className="p-4 space-y-2">
            <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Building2 className="h-3.5 w-3.5" /> Source / Supplier
            </div>
            <div className="font-bold">{supplierLabel}</div>
            <div className="text-xs text-muted-foreground">
              {supplier?.region || fromNode?.type || "—"}
            </div>
            <div className="text-xs font-mono text-muted-foreground">
              {order.supplierId || order.fromNodeId || "—"}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border">
          <CardContent className="p-4 space-y-2">
            <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Truck className="h-3.5 w-3.5" /> Route / ETA
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-primary" />
              <span className="font-bold">
                {formatNumber(order.etaDays)} d
              </span>
              <span className="text-muted-foreground">to delivery</span>
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5" /> Requested by{" "}
              {formatShortDate(order.requestedDeliveryAt)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 border-border shrink-0">
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-primary" />
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              Shipment Progress
            </div>
            {shipmentProgress.length > 0 && (
              <span className="text-xs text-muted-foreground">
                ({shipmentProgress.length})
              </span>
            )}
          </div>
          {shipmentProgress.length === 0 ? (
            <div className="text-sm text-muted-foreground italic">
              No shipments yet — progress milestones appear once this order
              moves to <span className="font-mono">IN_TRANSIT</span>.
            </div>
          ) : (
            <div className="space-y-5">
              {shipmentProgress.map((sh) => (
                <ShipmentProgress key={sh.id} shipment={sh} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {(order.triggerNote || aiTriggered || recommendation) && (
        <Card
          className={`shrink-0 ${
            aiTriggered
              ? "bg-emerald-500/10 border-emerald-500/60 ring-1 ring-emerald-500/30 shadow-[0_0_20px_-8px_rgba(16,185,129,0.55)]"
              : "bg-card/50 border-border"
          }`}
        >
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className={`h-4 w-4 ${aiTriggered ? "text-emerald-400" : "text-muted-foreground"}`} />
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
                Triggered by
              </span>
              {aiTriggered && <AiBadge />}
            </div>
            <p className="text-sm leading-relaxed">
              {order.triggerNote || (aiTriggered
                ? "Promoted from an AI recommendation."
                : "Manual order from operator.")}
            </p>
            {recommendation && (
              <div className="text-xs text-muted-foreground pt-1 border-t border-border/50 mt-2">
                Recommendation kind:{" "}
                <span className="text-foreground font-medium">
                  {String(recommendation.kind ?? "—")}
                </span>{" "}
                · suggested qty{" "}
                <span className="font-mono text-foreground">
                  {formatNumber(recommendation.quantity as number)}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 min-h-[420px]">
        <Card className="lg:col-span-2 bg-card/50 border-border flex flex-col overflow-hidden">
          <div className="p-3 border-b border-border/50 bg-muted/20 font-medium text-sm flex items-center gap-2 shrink-0">
            <Package className="h-4 w-4 text-primary" /> Line Items ({lines.length})
          </div>
          <div className="flex-1 overflow-auto">
            <SortableTable
              data={lines}
              rowKey={(ln) => String(ln.id)}
              emptyMessage="No line items returned for this order"
              initialSort={{ key: "qty", direction: "desc" }}
              columns={[
                {
                  key: "item",
                  label: "Item",
                  sortAccessor: (ln) => ln.itemName ?? ln.itemId,
                  render: (ln) =>
                    ln.itemMissing ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-muted-foreground">
                          {ln.itemId}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-500">
                          <AlertTriangle className="h-3 w-3" />
                          Not in catalog
                        </span>
                      </div>
                    ) : (
                      <Link
                        href={`/items/${ln.itemId}`}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {ln.itemName || ln.itemId}
                      </Link>
                    ),
                },
                {
                  key: "id",
                  label: "Item ID",
                  sortAccessor: (ln) => ln.itemId,
                  render: (ln) => (
                    <span className="font-mono text-xs text-muted-foreground">
                      {ln.itemId}
                    </span>
                  ),
                },
                {
                  key: "qty",
                  label: "Qty",
                  align: "right",
                  sortAccessor: (ln) => ln.quantity,
                  render: (ln) => (
                    <span className="font-mono">
                      {formatNumber(ln.quantity)} {ln.unit || ""}
                    </span>
                  ),
                },
                {
                  key: "unitPrice",
                  label: "Unit $",
                  align: "right",
                  sortAccessor: (ln) => ln.unitPriceUsd,
                  render: (ln) => (
                    <span className="font-mono">
                      ${formatNumber(ln.unitPriceUsd, { fractionDigits: 2 })}
                    </span>
                  ),
                },
                {
                  key: "lineTotal",
                  label: "Extended",
                  align: "right",
                  sortAccessor: (ln) => ln.lineTotalUsd,
                  render: (ln) => (
                    <span className="font-mono font-bold">
                      ${formatNumber(ln.lineTotalUsd, { fractionDigits: 2 })}
                    </span>
                  ),
                },
              ]}
            />
          </div>
        </Card>

        <Card className="bg-card/50 border-border flex flex-col overflow-hidden">
          <div className="p-3 border-b border-border/50 bg-muted/20 font-medium text-sm flex items-center gap-2 shrink-0">
            <Activity className="h-4 w-4 text-primary" /> Activity History
          </div>
          <div className="flex-1 overflow-auto">
            {activity.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground italic">
                No activity recorded for this order yet.
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {activity.map((a) => {
                  const isShipment = a.kind.startsWith("SHIPMENT_");
                  const Icon = isShipment ? Truck : AlertTriangle;
                  const iconClass = isShipment
                    ? a.kind === "SHIPMENT_DELIVERED"
                      ? "text-emerald-500"
                      : "text-primary"
                    : "text-muted-foreground";
                  return (
                    <div key={a.id} className="p-3 text-sm">
                      <div className="flex items-start gap-2">
                        <Icon className={`h-3.5 w-3.5 mt-1 shrink-0 ${iconClass}`} />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-xs uppercase tracking-wider text-muted-foreground">
                            {a.kind.replace(/_/g, " ")}
                          </div>
                          <div className="mt-0.5">{a.summary}</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {formatShortDateTime(a.createdAt)} ·{" "}
                            {a.actorRole || "system"}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="text-xs text-muted-foreground shrink-0 px-1">
        Item:{" "}
        {itemMissing ? (
          <span className="font-mono text-foreground">
            {item.id || order.itemId || "unknown"}
          </span>
        ) : (
          <Link
            href={`/items/${item.id}`}
            className="font-medium text-foreground hover:text-primary hover:underline"
          >
            {item.name}
          </Link>
        )}
        {itemMissing && (
          <span className="ml-2 text-amber-500">
            (item not found in catalog)
          </span>
        )}
        {" · "}
        Total qty {formatNumber(order.quantity)} {order.unit || item.unit || ""}
      </div>

      <Dialog
        open={pendingChange !== null}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent className="sm:max-w-md">
          {pendingChange && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {pendingChange.kind === "priority"
                    ? "Change priority"
                    : "Change status"}
                </DialogTitle>
                <DialogDescription>
                  {pendingChange.kind === "priority" ? "Priority" : "Status"}{" "}
                  <span className="font-semibold text-foreground">
                    {pendingChange.from.replace(/_/g, " ")}
                  </span>{" "}
                  → {" "}
                  <span className="font-semibold text-foreground">
                    {pendingChange.to.replace(/_/g, " ")}
                  </span>
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="order-change-note">
                  Note <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Textarea
                  id="order-change-note"
                  placeholder='e.g. "bumped to FLASH after MEDEVAC tasking"'
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  rows={3}
                  maxLength={280}
                  autoFocus
                  disabled={updateOrder.isPending}
                />
              </div>
              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={closeDialog}
                  disabled={updateOrder.isPending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={confirmPendingChange}
                  disabled={updateOrder.isPending}
                >
                  {updateOrder.isPending ? "Saving..." : "Confirm"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
