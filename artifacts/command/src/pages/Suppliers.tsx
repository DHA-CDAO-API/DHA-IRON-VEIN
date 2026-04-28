import React, { useMemo, useState } from "react";
import {
  useListSuppliers,
  getListSuppliersQueryKey,
  useListOrders,
  getListOrdersQueryKey,
  useListItems,
  getListItemsQueryKey,
  type Supplier,
  type Order,
  type Item,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SortableTable } from "@/components/ui/sortable-table";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Truck, Package, Activity, Globe2 } from "lucide-react";
import { formatPercent, formatNumber, formatDays, categoryLabel } from "@/lib/format";

type SupplierAggregate = {
  itemsCovered: number;
  inFlightUnits: number;
  inFlightOrders: number;
  totalOrders: number;
  itemIds: string[];
};

const IN_FLIGHT_STATUSES = new Set([
  "SUBMITTED",
  "APPROVED",
  "EN_ROUTE",
  "IN_TRANSIT",
  "PICKED",
  "PARTIAL",
  "submitted",
  "approved",
  "en_route",
  "in_transit",
  "picked",
  "partial",
]);

function reliabilityColor(rel: number | null | undefined): string {
  if (rel == null || !Number.isFinite(rel)) return "text-muted-foreground";
  const pct = rel <= 1 ? rel * 100 : rel;
  if (pct >= 95) return "text-emerald-500 font-bold";
  if (pct >= 85) return "text-amber-500 font-bold";
  return "text-destructive font-bold";
}

function leadTimeColor(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return "text-muted-foreground";
  if (days <= 5) return "text-emerald-500";
  if (days <= 14) return "text-amber-500";
  return "text-destructive";
}

export default function Suppliers() {
  const { data: suppliers, isLoading: supLoading } = useListSuppliers({
    query: { queryKey: getListSuppliersQueryKey() },
  });

  const orderParams = { limit: 500 } as const;
  const { data: orders, isLoading: ordersLoading } = useListOrders(orderParams, {
    query: { queryKey: getListOrdersQueryKey(orderParams) },
  });

  const { data: items } = useListItems({
    query: { queryKey: getListItemsQueryKey() },
  });

  const itemMap = useMemo(() => {
    const m = new Map<string, Item>();
    for (const it of items ?? []) m.set(it.id, it);
    return m;
  }, [items]);

  const aggregatesBySupplier = useMemo(() => {
    const m = new Map<string, SupplierAggregate>();
    for (const o of orders ?? []) {
      if (!o.supplierId) continue;
      const cur = m.get(o.supplierId) ?? {
        itemsCovered: 0,
        inFlightUnits: 0,
        inFlightOrders: 0,
        totalOrders: 0,
        itemIds: [] as string[],
      };
      cur.totalOrders += 1;
      const isInFlight = IN_FLIGHT_STATUSES.has(o.status);
      if (isInFlight) {
        cur.inFlightOrders += 1;
        cur.inFlightUnits += o.quantity ?? 0;
      }
      if (!cur.itemIds.includes(o.itemId)) {
        cur.itemIds.push(o.itemId);
        cur.itemsCovered = cur.itemIds.length;
      }
      m.set(o.supplierId, cur);
    }
    return m;
  }, [orders]);

  const rows = useMemo(() => {
    return (suppliers ?? []).map((s) => {
      const agg = aggregatesBySupplier.get(s.id) ?? {
        itemsCovered: 0,
        inFlightUnits: 0,
        inFlightOrders: 0,
        totalOrders: 0,
        itemIds: [] as string[],
      };
      return { supplier: s, agg };
    });
  }, [suppliers, aggregatesBySupplier]);

  const totals = useMemo(() => {
    const count = rows.length;
    const totalInFlightUnits = rows.reduce((s, r) => s + r.agg.inFlightUnits, 0);
    const reliabilities = rows
      .map((r) => (r.supplier.reliability <= 1 ? r.supplier.reliability * 100 : r.supplier.reliability))
      .filter((v) => Number.isFinite(v));
    const avgReliability = reliabilities.length
      ? reliabilities.reduce((s, v) => s + v, 0) / reliabilities.length
      : null;
    const leadTimes = rows.map((r) => r.supplier.leadTimeDays).filter((v) => Number.isFinite(v));
    const avgLeadTime = leadTimes.length ? leadTimes.reduce((s, v) => s + v, 0) / leadTimes.length : null;
    return { count, totalInFlightUnits, avgReliability, avgLeadTime };
  }, [rows]);

  const [activeSupplier, setActiveSupplier] = useState<{
    supplier: Supplier;
    agg: SupplierAggregate;
  } | null>(null);

  const isLoading = supLoading || ordersLoading;

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-y-auto bg-background text-foreground">
      <div className="flex items-start justify-between shrink-0 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Truck className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold uppercase tracking-wider">Suppliers</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Vendor and channel performance across the AOR. Real lead time and reliability from the catalog; live in-flight contribution from the orders board.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 shrink-0">
        <SummaryCard label="Suppliers" value={totals.count} icon={<Globe2 className="h-5 w-5 text-primary/60" />} />
        <SummaryCard
          label="Avg Lead Time"
          value={totals.avgLeadTime != null ? `${totals.avgLeadTime.toFixed(1)}d` : "—"}
          icon={<Activity className="h-5 w-5 text-primary/60" />}
        />
        <SummaryCard
          label="Avg Reliability"
          value={formatPercent(totals.avgReliability)}
          icon={<Activity className="h-5 w-5 text-primary/60" />}
        />
        <SummaryCard
          label="In-Flight Units"
          value={formatNumber(totals.totalInFlightUnits)}
          icon={<Package className="h-5 w-5 text-primary/60" />}
        />
      </div>

      <Card className="bg-card/50 border-border flex-1 flex flex-col overflow-hidden min-h-0">
        <div className="px-4 py-3 border-b border-border/50 bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground font-medium flex items-center justify-between">
          <span>Supplier Roster</span>
          <span>{rows.length} suppliers</span>
        </div>
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <SortableTable
              stickyHeader
              initialSort={{ key: "leadTime", direction: "asc" }}
              data={rows}
              rowKey={(r) => r.supplier.id}
              onRowClick={(r) => setActiveSupplier(r)}
              emptyMessage="No suppliers configured"
              columns={[
                {
                  key: "name",
                  label: "Name",
                  sortAccessor: (r) => r.supplier.name,
                  render: (r) => (
                    <button
                      type="button"
                      className="font-medium hover:text-primary hover:underline text-left"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveSupplier(r);
                      }}
                    >
                      {r.supplier.name}
                    </button>
                  ),
                },
                {
                  key: "region",
                  label: "Region",
                  sortAccessor: (r) => r.supplier.region,
                  render: (r) => <span className="font-mono text-xs text-muted-foreground">{r.supplier.region || "—"}</span>,
                },
                {
                  key: "channel",
                  label: "Channel",
                  sortAccessor: (r) => r.supplier.channel,
                  render: (r) => (
                    <Badge variant="outline" className="text-xs font-mono uppercase">
                      {r.supplier.channel}
                    </Badge>
                  ),
                },
                {
                  key: "leadTime",
                  label: "Lead Time",
                  align: "right",
                  sortAccessor: (r) => r.supplier.leadTimeDays,
                  render: (r) => (
                    <span className={`font-mono ${leadTimeColor(r.supplier.leadTimeDays)}`}>
                      {formatDays(r.supplier.leadTimeDays)}
                    </span>
                  ),
                },
                {
                  key: "reliability",
                  label: "Reliability",
                  align: "right",
                  sortAccessor: (r) => r.supplier.reliability,
                  render: (r) => (
                    <span className={`font-mono ${reliabilityColor(r.supplier.reliability)}`}>
                      {formatPercent(r.supplier.reliability, { fractionDigits: 1 })}
                    </span>
                  ),
                },
                {
                  key: "items",
                  label: "Items Covered",
                  align: "right",
                  sortAccessor: (r) => r.agg.itemsCovered,
                  render: (r) => (
                    <span className="font-mono">{r.agg.itemsCovered}</span>
                  ),
                },
                {
                  key: "inFlight",
                  label: "In-Flight Units",
                  align: "right",
                  sortAccessor: (r) => r.agg.inFlightUnits,
                  render: (r) => (
                    <span className={`font-mono ${r.agg.inFlightUnits > 0 ? "text-primary" : "text-muted-foreground"}`}>
                      {formatNumber(r.agg.inFlightUnits)}
                    </span>
                  ),
                },
                {
                  key: "totalOrders",
                  label: "Orders",
                  align: "right",
                  sortAccessor: (r) => r.agg.totalOrders,
                  render: (r) => (
                    <span className="font-mono text-xs text-muted-foreground">{r.agg.totalOrders}</span>
                  ),
                },
              ]}
            />
          )}
        </div>
      </Card>

      <SupplierDetailSheet
        record={activeSupplier}
        onClose={() => setActiveSupplier(null)}
        orders={orders ?? []}
        itemMap={itemMap}
      />
    </div>
  );
}

function SupplierDetailSheet({
  record,
  onClose,
  orders,
  itemMap,
}: {
  record: { supplier: Supplier; agg: SupplierAggregate } | null;
  onClose: () => void;
  orders: Order[];
  itemMap: Map<string, Item>;
}) {
  const supplierOrders = useMemo(() => {
    if (!record) return [] as Order[];
    return orders
      .filter((o) => o.supplierId === record.supplier.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 30);
  }, [record, orders]);

  const itemBreakdown = useMemo(() => {
    if (!record) return [] as Array<{ itemId: string; itemName: string; category: string; units: number; orders: number }>;
    const m = new Map<string, { itemId: string; itemName: string; category: string; units: number; orders: number }>();
    for (const o of orders) {
      if (o.supplierId !== record.supplier.id) continue;
      const it = itemMap.get(o.itemId);
      const cur = m.get(o.itemId) ?? {
        itemId: o.itemId,
        itemName: it?.name ?? o.itemName ?? o.itemId,
        category: categoryLabel((it?.category ?? null) as string | null),
        units: 0,
        orders: 0,
      };
      cur.units += o.quantity ?? 0;
      cur.orders += 1;
      m.set(o.itemId, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.units - a.units);
  }, [record, orders, itemMap]);

  return (
    <Sheet open={!!record} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
        {record && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5 text-primary" />
                {record.supplier.name}
              </SheetTitle>
              <SheetDescription>
                {record.supplier.channel.toUpperCase()} channel
                {record.supplier.region ? ` · ${record.supplier.region}` : ""}
                {" · "}
                {formatNumber(record.agg.itemsCovered)} items covered
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Channel" value={record.supplier.channel.toUpperCase()} />
                <Stat label="Region" value={record.supplier.region || "—"} />
                <Stat label="Lead Time" value={formatDays(record.supplier.leadTimeDays)} />
                <Stat label="Reliability" value={formatPercent(record.supplier.reliability, { fractionDigits: 1 })} />
                <Stat label="In-Flight Units" value={formatNumber(record.agg.inFlightUnits)} />
                <Stat label="Items Covered" value={record.agg.itemsCovered.toString()} />
              </div>

              {record.supplier.notes && (
                <div className="p-3 rounded-md border border-border/50 bg-muted/20 text-xs text-muted-foreground">
                  {record.supplier.notes}
                </div>
              )}

              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Items Supplied</div>
                <div className="border border-border/50 rounded-md overflow-hidden">
                  {itemBreakdown.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      No order history with this supplier
                    </div>
                  ) : (
                    <div className="divide-y divide-border/40 max-h-56 overflow-y-auto">
                      {itemBreakdown.map((b) => (
                        <div key={b.itemId} className="flex items-center justify-between px-3 py-2 text-xs">
                          <div className="flex flex-col min-w-0">
                            <span className="font-medium truncate">{b.itemName}</span>
                            <span className="text-muted-foreground">{b.category}</span>
                          </div>
                          <div className="text-right shrink-0 ml-2">
                            <div className="font-mono">{formatNumber(b.units)} units</div>
                            <div className="text-muted-foreground">{b.orders} orders</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Recent Orders</div>
                <div className="border border-border/50 rounded-md overflow-hidden">
                  {supplierOrders.length === 0 ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">No recent orders</div>
                  ) : (
                    <div className="divide-y divide-border/40 max-h-56 overflow-y-auto">
                      {supplierOrders.map((o) => (
                        <div key={o.id} className="flex items-center justify-between px-3 py-2 text-xs">
                          <div className="flex flex-col min-w-0">
                            <span className="font-medium font-mono">{o.orderNumber}</span>
                            <span className="text-muted-foreground truncate">{o.itemName ?? o.itemId}</span>
                          </div>
                          <div className="text-right shrink-0 ml-2">
                            <div className="font-mono">{formatNumber(o.quantity)} ea</div>
                            <Badge variant="outline" className="text-[10px] font-mono mt-1">
                              {o.status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/50 bg-muted/10 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono text-sm mt-1">{value}</div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number | string;
  icon?: React.ReactNode;
}) {
  return (
    <Card className="bg-card/50 border-border">
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
          <h3 className="text-2xl font-bold mt-1">{value}</h3>
        </div>
        {icon}
      </CardContent>
    </Card>
  );
}
