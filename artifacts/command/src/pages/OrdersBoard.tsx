import React, { useState } from "react";
import {
  useListOrders,
  getListOrdersQueryKey,
  type Order,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useLocation } from "wouter";
import { Clock, Plus, Printer, Sparkles, MapPin, Building2, Calendar } from "lucide-react";
import { AiBadge } from "@/components/ui/ai-badge";
import { formatNumber, formatShortDate } from "@/lib/format";
import { orderStatusBadgeClass, type OrderStatusKey } from "@/lib/orderStatus";
import { NewOrderDialog } from "@/components/orders/NewOrderDialog";

type EnrichedOrder = Order & {
  toNodeName?: string | null;
  fromNodeName?: string | null;
  supplierName?: string | null;
  unit?: string | null;
  triggerNote?: string | null;
  triggerSource?: string | null;
  requestedDeliveryAt?: string | null;
};

function priorityChipClass(priority: string) {
  const p = priority?.toUpperCase();
  if (p === "FLASH")
    return "border-destructive bg-destructive/20 text-destructive";
  if (p === "URGENT")
    return "border-amber-500 bg-amber-500/15 text-amber-500";
  if (p === "PRIORITY")
    return "border-primary bg-primary/15 text-primary";
  return "border-muted-foreground/40 bg-muted/30 text-muted-foreground";
}

type ColumnTheme = {
  outer: string;
  body: string;
  header: string;
  headerText: string;
  badge: string;
  empty: string;
};

const COLUMN_THEMES: Record<OrderStatusKey, Omit<ColumnTheme, "badge">> = {
  SUBMITTED: {
    outer: "border-sky-500/30",
    body: "bg-sky-500/[0.04]",
    header: "bg-sky-500/15 border-b border-sky-500/40",
    headerText: "text-sky-300",
    empty: "text-sky-300/60",
  },
  ACKNOWLEDGED: {
    outer: "border-amber-500/30",
    body: "bg-amber-500/[0.04]",
    header: "bg-amber-500/15 border-b border-amber-500/40",
    headerText: "text-amber-300",
    empty: "text-amber-300/60",
  },
  IN_TRANSIT: {
    outer: "border-indigo-500/30",
    body: "bg-indigo-500/[0.04]",
    header: "bg-indigo-500/15 border-b border-indigo-500/40",
    headerText: "text-indigo-300",
    empty: "text-indigo-300/60",
  },
  RECEIVED: {
    outer: "border-emerald-500/30",
    body: "bg-emerald-500/[0.04]",
    header: "bg-emerald-500/15 border-b border-emerald-500/40",
    headerText: "text-emerald-300",
    empty: "text-emerald-300/60",
  },
};

const COLUMNS: Array<{ status: OrderStatusKey; label: string; theme: ColumnTheme }> = (
  [
    { status: "SUBMITTED", label: "Submitted" },
    { status: "ACKNOWLEDGED", label: "Acknowledged" },
    { status: "IN_TRANSIT", label: "In Transit" },
    { status: "RECEIVED", label: "Received" },
  ] as const
).map(({ status, label }) => ({
  status,
  label,
  theme: {
    ...COLUMN_THEMES[status],
    badge: orderStatusBadgeClass(status),
  },
}));

function OrderCard({ order }: { order: EnrichedOrder }) {
  const [, setLocation] = useLocation();
  const aiTriggered =
    order.triggerSource === "ai" || !!order.sourceRecommendationId;
  const destination = order.toNodeName || order.toNodeId;
  const supplier =
    order.supplierName || order.fromNodeName || order.supplierId || "—";
  const triggerLine =
    order.triggerNote ||
    (aiTriggered
      ? "Promoted from an AI recommendation"
      : "Manual order from operator");

  const handleClick = () => {
    setLocation(`/orders/${order.id}`);
  };

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      className="bg-card/80 border-border/50 shadow-sm hover:border-primary/60 hover:shadow-md transition-all cursor-pointer h-[260px] flex flex-col focus:outline-none focus:ring-2 focus:ring-primary/50"
    >
      <CardContent className="p-3 flex-1 flex flex-col gap-2 min-h-0">
        {/* Header row: order number + priority chip */}
        <div className="flex items-start justify-between gap-2 shrink-0">
          <div className="font-mono text-[11px] text-muted-foreground truncate">
            {order.orderNumber}
          </div>
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 h-4 shrink-0 ${priorityChipClass(order.priority)}`}
          >
            {order.priority}
          </Badge>
        </div>

        {/* Item name + qty */}
        <div className="shrink-0">
          <div
            className="font-semibold text-sm leading-tight line-clamp-2"
            title={order.itemName || order.itemId}
          >
            {order.itemName || order.itemId}
          </div>
          <div className="text-xs font-mono text-muted-foreground mt-0.5">
            {formatNumber(order.quantity)} {order.unit || "ea"}
          </div>
        </div>

        {/* Destination & supplier */}
        <div className="space-y-1 text-xs shrink-0">
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground shrink-0">To:</span>
            <span className="truncate font-medium" title={destination}>
              {destination}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground shrink-0">From:</span>
            <span className="truncate" title={supplier}>
              {supplier}
            </span>
          </div>
        </div>

        {/* Triggered-by line */}
        <div
          className={`text-[11px] leading-snug px-2 py-1.5 rounded border flex items-start gap-1.5 flex-1 min-h-0 overflow-hidden ${
            aiTriggered
              ? "bg-emerald-500/10 border-emerald-500/50 ring-1 ring-emerald-500/25 text-foreground"
              : "bg-muted/30 border-border/50 text-muted-foreground"
          }`}
        >
          <Sparkles
            className={`h-3 w-3 shrink-0 mt-0.5 ${aiTriggered ? "text-emerald-400" : "text-muted-foreground/60"}`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">
                Triggered by
              </span>
              {aiTriggered && (
                <AiBadge
                  className="px-1 py-0 text-[8px] gap-0.5"
                />
              )}
            </div>
            <div className="line-clamp-2">{triggerLine}</div>
          </div>
        </div>

        {/* Footer row: ETA, requested date, actions */}
        <div className="flex items-center justify-between gap-2 text-xs pt-1.5 border-t border-border/50 shrink-0">
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>ETA {formatNumber(order.etaDays)}d</span>
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span className="truncate">{formatShortDate(order.requestedDeliveryAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/orders/${order.id}/print`}
              onClick={(e) => e.stopPropagation()}
              className="text-muted-foreground hover:text-primary p-1 rounded hover:bg-muted/50"
              title="Print PO"
            >
              <Printer className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function OrdersBoard() {
  const { data: orders, isLoading } = useListOrders(
    {},
    {
      query: { queryKey: getListOrdersQueryKey() },
    },
  );
  const [newOrderOpen, setNewOrderOpen] = useState(false);

  if (isLoading || !orders) {
    return (
      <div className="p-6">
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4 bg-background text-foreground overflow-hidden">
      <div className="flex justify-between items-center mb-4 shrink-0">
        <h1 className="text-2xl font-bold uppercase tracking-wider">
          Orders Board
        </h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setNewOrderOpen(true)}
            className="border-primary text-primary hover:bg-primary/15 hover:text-primary"
          >
            <Plus className="h-4 w-4 mr-1" />
            New Order
          </Button>
        </div>
      </div>
      <NewOrderDialog open={newOrderOpen} onOpenChange={setNewOrderOpen} />

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 overflow-y-auto pb-4 min-h-0 auto-rows-min content-start">
        {COLUMNS.map(({ status, label, theme }) => {
          const colOrders = (orders as EnrichedOrder[]).filter(
            (o) => o.status === status,
          );
          return (
            <div
              key={status}
              className={`flex flex-col rounded-lg border overflow-hidden min-w-0 max-h-full ${theme.outer} ${theme.body}`}
            >
              <div
                className={`p-3 font-medium text-sm flex justify-between items-center shrink-0 ${theme.header}`}
              >
                <span
                  className={`uppercase tracking-wider text-xs ${theme.headerText}`}
                >
                  {label}
                </span>
                <Badge
                  variant="outline"
                  className={`font-mono ${theme.badge}`}
                >
                  {colOrders.length}
                </Badge>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[200px]">
                {colOrders.map((order) => (
                  <OrderCard key={order.id} order={order} />
                ))}
                {colOrders.length === 0 && (
                  <div
                    className={`text-center p-4 text-xs italic ${theme.empty}`}
                  >
                    No orders
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
