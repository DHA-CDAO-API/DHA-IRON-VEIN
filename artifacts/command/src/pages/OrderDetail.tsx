import React from "react";
import { Link, useParams } from "wouter";
import {
  useGetOrder,
  getGetOrderQueryKey,
  type Order,
  type OrderLineDetail,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SortableTable } from "@/components/ui/sortable-table";
import { AiBadge } from "@/components/ui/ai-badge";
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

export default function OrderDetail() {
  const { id } = useParams();

  const { data, isLoading, error } = useGetOrder(id || "", {
    query: {
      enabled: !!id,
      queryKey: getGetOrderQueryKey(id || ""),
    },
  });

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
                <Badge variant="outline" className={priorityClass(order.priority)}>
                  {order.priority}
                </Badge>
                <Badge variant="outline" className={statusClass(order.status)}>
                  {order.status.replace("_", " ")}
                </Badge>
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

      {(order.triggerNote || aiTriggered || recommendation) && (
        <Card className={`shrink-0 ${aiTriggered ? "bg-primary/5 border-primary/30" : "bg-card/50 border-border"}`}>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Sparkles className={`h-4 w-4 ${aiTriggered ? "text-primary" : "text-muted-foreground"}`} />
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
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
                  render: (ln) => (
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
                {activity.map((a) => (
                  <div key={a.id} className="p-3 text-sm">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 mt-1 text-muted-foreground shrink-0" />
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
                ))}
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
    </div>
  );
}
