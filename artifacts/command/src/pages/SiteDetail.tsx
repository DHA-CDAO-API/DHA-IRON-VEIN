import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link, useSearch } from 'wouter';
import { navigate } from 'wouter/use-browser-location';
import {
  useGetSiteDetail,
  getGetSiteDetailQueryKey,
  useForecastDemand,
  useAcknowledgeAlert,
  usePromoteRecommendationToOrder,
  useListItems,
  useListSuppliers,
  getListItemsQueryKey,
  type Item,
  type DaysOfSupplyEntry,
  type Recommendation,
  type HistoryPoint,
} from '@workspace/api-client-react';
import { PromoteDialog, type PromoteOverrides } from '@/components/PromoteDialog';
import { Area, AreaChart, ResponsiveContainer, Tooltip as RechartsTooltip, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SortableTable } from '@/components/ui/sortable-table';
import { AiBadge } from '@/components/ui/ai-badge';
import { Activity, AlertTriangle, Box, MapPin, CheckCircle2, TrendingDown, Droplet, Package, Shield, Layers } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { CATEGORY_ORDER, categoryKey, categoryLabel, dosClass, formatDOS, formatNumber, type ItemCategoryKey } from '@/lib/format';
import { BloodReadinessTab } from '@/components/site/blood/BloodReadinessTab';

type DosRow = DaysOfSupplyEntry & {
  category: ItemCategoryKey;
  categoryLabelText: string;
  onHand: number;
  unit: string;
};

function readOnHand(d: DaysOfSupplyEntry): number {
  // API may emit either `onHand` or `quantityOnHand` depending on contract version
  const raw = (d as { onHand?: number; quantityOnHand?: number });
  return raw.quantityOnHand ?? raw.onHand ?? 0;
}

function formatUnit(unit: string | undefined | null, qty: number): string {
  if (!unit) return '';
  const u = unit.trim();
  if (!u) return '';
  // Pluralize simple English unit nouns; leave abbreviations (ea, kg, ml, L, etc.) alone.
  const lower = u.toLowerCase();
  const isWord = /^[a-z]+$/i.test(u) && u.length > 2;
  if (!isWord || qty === 1 || lower.endsWith('s')) return u;
  if (lower.endsWith('x') || lower.endsWith('s') || lower.endsWith('z') || lower.endsWith('ch') || lower.endsWith('sh')) {
    return `${u}es`;
  }
  return `${u}s`;
}

const CATEGORY_ICON: Record<ItemCategoryKey, React.ComponentType<{ className?: string }>> = {
  blood_products: Droplet,
  supplies: Package,
  ppe: Shield,
  other: Layers,
};

const FORECAST_HORIZON_OPTIONS = [7, 14, 30] as const;
type ForecastHorizon = (typeof FORECAST_HORIZON_OPTIONS)[number];

function parseForecastHorizon(value: string | null | undefined): ForecastHorizon {
  const n = Number(value);
  return (FORECAST_HORIZON_OPTIONS as readonly number[]).includes(n)
    ? (n as ForecastHorizon)
    : 7;
}

export default function SiteDetail() {
  const { nodeId } = useParams();
  const [activeTab, setActiveTab] = useState('blood');
  const [activeCategory, setActiveCategory] = useState<ItemCategoryKey | 'all'>('all');

  const { data: detail, isLoading } = useGetSiteDetail(nodeId || '', {
    query: {
      enabled: !!nodeId,
      queryKey: getGetSiteDetailQueryKey(nodeId || ''),
    },
  });

  const { data: items } = useListItems({
    query: { queryKey: getListItemsQueryKey() },
  });

  const ackAlert = useAcknowledgeAlert();
  const promoteRec = usePromoteRecommendationToOrder();
  const { data: suppliers } = useListSuppliers();
  const [editingRec, setEditingRec] = useState<Recommendation | null>(null);
  const [promotedById, setPromotedById] = useState<
    Record<string, { orderId: string; orderNo: string }>
  >({});
  const [promoteErrorById, setPromoteErrorById] = useState<
    Record<string, string>
  >({});

  const handlePromoteConfirm = async (
    rec: Recommendation,
    overrides: PromoteOverrides,
  ) => {
    setPromoteErrorById((prev) => ({ ...prev, [rec.id]: '' }));
    try {
      const res = await promoteRec.mutateAsync({
        recommendationId: rec.id,
        data: {
          quantity: overrides.quantity,
          supplierId: overrides.supplierId,
          etaDays: overrides.etaDays,
          priority: overrides.priority,
        },
      });
      const order = res as { id?: string; orderNo?: string } | undefined;
      setPromotedById((prev) => ({
        ...prev,
        [rec.id]: {
          orderId: order?.id ?? 'promoted',
          orderNo: order?.orderNo ?? order?.id ?? 'PROMOTED',
        },
      }));
      setEditingRec(null);
    } catch (e) {
      setPromoteErrorById((prev) => ({
        ...prev,
        [rec.id]: (e as Error)?.message ?? 'Promote failed',
      }));
    }
  };

  const itemMap = useMemo(() => {
    const m = new Map<string, Item>();
    for (const it of items ?? []) m.set(it.id, it);
    return m;
  }, [items]);

  const categorizedDos = useMemo<DosRow[]>(() => {
    if (!detail) return [];
    return detail.dosByItem.map((d) => {
      const it = itemMap.get(d.itemId);
      const key = categoryKey((it?.category ?? null) as string | null);
      return {
        ...d,
        category: key,
        categoryLabelText: categoryLabel(key),
        onHand: readOnHand(d),
        unit: (d.unit ?? it?.unitOfIssue ?? it?.unit ?? '').trim(),
      };
    });
  }, [detail, itemMap]);

  const groupedDos = useMemo(() => {
    const m = new Map<ItemCategoryKey, DosRow[]>();
    for (const k of CATEGORY_ORDER) m.set(k, []);
    for (const row of categorizedDos) {
      const arr = m.get(row.category) ?? [];
      arr.push(row);
      m.set(row.category, arr);
    }
    return m;
  }, [categorizedDos]);

  // Forecast horizon: read from `?fcst=7|14|30` so the choice survives refresh.
  const search = useSearch();
  const forecastHorizon = useMemo<ForecastHorizon>(() => {
    const params = new URLSearchParams(search);
    return parseForecastHorizon(params.get('fcst'));
  }, [search]);
  const setForecastHorizon = useCallback((next: ForecastHorizon) => {
    const params = new URLSearchParams(window.location.search);
    if (next === 7) {
      params.delete('fcst');
    } else {
      params.set('fcst', String(next));
    }
    const qs = params.toString();
    navigate(`${window.location.pathname}${qs ? `?${qs}` : ''}`, { replace: true });
  }, []);

  const forecast = useForecastDemand();
  const forecastSeries = forecast.data?.series ?? [];

  useEffect(() => {
    if (!detail || !nodeId) return;
    const itemIds = detail.dosByItem.map((d) => d.itemId).slice(0, 50);
    if (itemIds.length === 0) return;
    forecast.mutate({
      data: {
        nodeIds: [nodeId],
        itemIds,
        horizonDays: forecastHorizon,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, detail?.node?.id, forecastHorizon]);

  const forecastShortages = useMemo(() => {
    if (forecastSeries.length === 0) {
      // Fallback: use static dosByItem to surface items at risk in the next 7 days.
      // Synthesize a simple linear burn-down from current on-hand to zero so the chart
      // still renders something useful when the live forecast hasn't returned yet.
      return categorizedDos
        .filter((d) => Number.isFinite(d.daysOfSupply) && d.daysOfSupply <= forecastHorizon)
        .map((d) => {
          const stockoutDay = Math.max(0, Math.floor(d.daysOfSupply));
          const onHand = d.onHand ?? 0;
          const points: HistoryPoint[] = Array.from({ length: forecastHorizon + 1 }, (_, day) => {
            const remaining = stockoutDay > 0 ? Math.max(0, onHand * (1 - day / stockoutDay)) : 0;
            return { day, value: Number(remaining.toFixed(2)) };
          });
          return {
            itemId: d.itemId,
            itemName: d.itemName,
            category: d.category,
            categoryLabelText: d.categoryLabelText,
            stockoutDay,
            daysOfSupply: d.daysOfSupply,
            status: d.status,
            unit: d.unit,
            points,
          };
        })
        .sort((a, b) => a.stockoutDay - b.stockoutDay);
    }
    const itemNameById = new Map(categorizedDos.map((d) => [d.itemId, d]));
    const result: Array<{
      itemId: string;
      itemName: string;
      category: ItemCategoryKey;
      categoryLabelText: string;
      stockoutDay: number;
      daysOfSupply: number;
      status: string;
      unit: string;
      points: HistoryPoint[];
    }> = [];
    for (const s of forecastSeries) {
      const stockoutPoint = s.points.find((p) => p.value <= 0);
      if (!stockoutPoint) continue;
      const day = stockoutPoint.day;
      if (day > forecastHorizon) continue;
      const meta = itemNameById.get(s.itemId);
      result.push({
        itemId: s.itemId,
        itemName: s.itemName ?? meta?.itemName ?? s.itemId,
        category: meta?.category ?? 'other',
        categoryLabelText: meta?.categoryLabelText ?? 'Other',
        stockoutDay: day,
        daysOfSupply: meta?.daysOfSupply ?? day,
        status: meta?.status ?? 'critical',
        unit: meta?.unit ?? '',
        points: s.points,
      });
    }
    return result.sort((a, b) => a.stockoutDay - b.stockoutDay);
  }, [forecastSeries, categorizedDos, forecastHorizon]);

  if (isLoading || !detail) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-12 w-1/3" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const { node, alerts, recentOrders, recommendations } = detail;
  const validDos = detail.balances.map((b) => b.daysOfSupply ?? 0).filter((v) => Number.isFinite(v) && v < 999);
  const aggregateDOS = validDos.length > 0 ? validDos.reduce((a, b) => a + b, 0) / validDos.length : null;
  const minDos = validDos.length > 0 ? Math.min(...validDos) : null;

  const visibleCategories = CATEGORY_ORDER.filter((k) => (groupedDos.get(k)?.length ?? 0) > 0);

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-y-auto bg-background text-foreground">
      {/* Header */}
      <div className="flex items-start justify-between shrink-0 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <Link href="/locations" className="text-xs uppercase tracking-wider text-muted-foreground hover:text-primary">
              ← Locations
            </Link>
          </div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="text-2xl font-bold uppercase tracking-wider">{node.name}</h1>
            <Badge variant="outline" className="text-primary border-primary">{node.type}</Badge>
            <Badge variant={node.optempo === 'HEIGHTENED' ? 'destructive' : 'secondary'}>{node.optempo}</Badge>
          </div>
          <div className="flex items-center text-sm text-muted-foreground gap-2">
            <MapPin className="h-4 w-4" />
            <span>{node.latitude.toFixed(4)}, {node.longitude.toFixed(4)}</span>
            {node.countryCode && <span>• {node.countryCode}</span>}
          </div>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 shrink-0">
        <Card className="bg-card/50 backdrop-blur border-border">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Site DOS (avg)</p>
              <h3 className={`text-2xl font-bold mt-1 ${aggregateDOS != null ? dosClass(aggregateDOS) : 'text-muted-foreground'}`}>
                {aggregateDOS != null ? aggregateDOS.toFixed(1) : '—'}
              </h3>
            </div>
            <Box className="h-8 w-8 text-primary/50" />
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur border-border">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Lowest item DOS</p>
              <h3 className={`text-2xl font-bold mt-1 ${minDos != null ? dosClass(minDos) : 'text-muted-foreground'}`}>
                {minDos != null ? minDos.toFixed(1) : '—'}
              </h3>
            </div>
            <TrendingDown className="h-8 w-8 text-destructive/50" />
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur border-border">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Open Alerts</p>
              <h3 className={`text-2xl font-bold mt-1 ${alerts.length > 0 ? 'text-destructive' : 'text-emerald-500'}`}>{alerts.length}</h3>
            </div>
            <AlertTriangle className="h-8 w-8 text-destructive/50" />
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur border-border">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Recent Orders</p>
              <h3 className="text-2xl font-bold mt-1">{recentOrders.length}</h3>
            </div>
            <Activity className="h-8 w-8 text-primary/50" />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
        {/* Main Tabs */}
        <div className="lg:col-span-2 flex flex-col min-h-[400px]">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
            <TabsList className="w-full justify-start border-b border-border bg-transparent rounded-none p-0 h-auto">
              <TabsTrigger value="blood" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2 flex gap-2">
                <Droplet className="h-4 w-4" />
                Blood Readiness
              </TabsTrigger>
              <TabsTrigger value="inventory" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2">
                Inventory
              </TabsTrigger>
              <TabsTrigger value="alerts" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2 flex gap-2">
                Alerts
                {alerts.length > 0 && <Badge variant="destructive" className="ml-1 px-1.5 py-0 min-w-[20px] h-5">{alerts.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="activity" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2">
                Activity
              </TabsTrigger>
              <TabsTrigger value="forecast" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2 flex gap-2">
                Forecast
                {forecastShortages.length > 0 && (
                  <Badge variant="destructive" className="ml-1 px-1.5 py-0 min-w-[20px] h-5">
                    {forecastShortages.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-y-auto mt-4 bg-card/30 rounded-md border border-border min-h-[300px]">
              <TabsContent value="blood" className="m-0 h-full p-0">
                <BloodReadinessTab data={detail.bloodReadiness} isLoading={isLoading} />
              </TabsContent>

              <TabsContent value="inventory" className="m-0 h-full p-0 flex flex-col">
                {/* Category sub-tabs */}
                <div className="border-b border-border/50 bg-muted/10 px-2 py-1.5 flex flex-wrap gap-1 sticky top-0 z-20 backdrop-blur">
                  <CategoryChip
                    label="All"
                    icon={Layers}
                    active={activeCategory === 'all'}
                    count={categorizedDos.length}
                    onClick={() => setActiveCategory('all')}
                  />
                  {visibleCategories.map((k) => {
                    const list = groupedDos.get(k) ?? [];
                    const subMin = list
                      .map((r) => r.daysOfSupply)
                      .filter((v) => Number.isFinite(v))
                      .reduce<number | null>((acc, v) => (acc == null ? v : Math.min(acc, v)), null);
                    return (
                      <CategoryChip
                        key={k}
                        label={categoryLabel(k)}
                        icon={CATEGORY_ICON[k]}
                        active={activeCategory === k}
                        count={list.length}
                        subDos={subMin}
                        onClick={() => setActiveCategory(k)}
                      />
                    );
                  })}
                </div>

                <div className="flex-1 overflow-y-auto">
                  {categorizedDos.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">No inventory tracked at this site</div>
                  ) : activeCategory === 'all' ? (
                    <div className="divide-y divide-border/40">
                      {visibleCategories.map((k) => {
                        const list = groupedDos.get(k) ?? [];
                        if (list.length === 0) return null;
                        return (
                          <CategorySection
                            key={k}
                            categoryKey={k}
                            label={categoryLabel(k)}
                            rows={list}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <CategorySection
                      categoryKey={activeCategory}
                      label={categoryLabel(activeCategory)}
                      rows={groupedDos.get(activeCategory) ?? []}
                      hideHeader
                    />
                  )}
                </div>
              </TabsContent>

              <TabsContent value="alerts" className="m-0 p-4 space-y-4">
                {alerts.map((alert) => (
                  <div key={alert.id} className="flex items-start justify-between p-4 rounded-lg border border-destructive/20 bg-destructive/5">
                    <div className="flex gap-3">
                      <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                      <div>
                        <h4 className="font-bold text-sm text-destructive">{alert.title}</h4>
                        <p className="text-sm text-foreground/80 mt-1">{alert.body}</p>
                        <div className="text-xs text-muted-foreground mt-2">
                          {new Date(alert.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    {alert.status === 'open' && (
                      <Button size="sm" variant="outline" onClick={() => ackAlert.mutate({ alertId: alert.id, data: { acknowledgedBy: 'Current User' } })}>
                        <CheckCircle2 className="h-4 w-4 mr-2" /> Ack
                      </Button>
                    )}
                  </div>
                ))}
                {alerts.length === 0 && (
                  <div className="text-center py-12 text-sm text-muted-foreground flex flex-col items-center gap-2">
                    <CheckCircle2 className="h-8 w-8 text-emerald-500/60" />
                    No open alerts on this site
                  </div>
                )}
              </TabsContent>

              <TabsContent value="activity" className="m-0 p-4">
                <div className="space-y-2">
                  {recentOrders.map((order) => (
                    <Link
                      key={order.id}
                      href={`/orders/${order.id}`}
                      className="flex justify-between items-center p-3 border border-border/40 rounded-md hover:bg-muted/20 transition-colors"
                    >
                      <div>
                        <div className="font-medium text-sm">
                          {order.orderNumber} · {order.itemName ?? order.itemId}
                        </div>
                        <div className="text-xs text-muted-foreground">Status: {order.status} · Priority: {order.priority}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm">Qty: {formatNumber(order.quantity)}</div>
                        <div className="text-xs text-muted-foreground">{new Date(order.createdAt).toLocaleDateString()}</div>
                      </div>
                    </Link>
                  ))}
                  {recentOrders.length === 0 && (
                    <div className="text-center py-12 text-sm text-muted-foreground">No recent orders for this site</div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="forecast" className="m-0 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-sm font-medium">Projected shortages — next {forecastHorizon} days</div>
                    <div className="text-xs text-muted-foreground">
                      Items expected to hit zero on-hand within the forecast window at current burn.
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {forecast.isPending && <Skeleton className="h-6 w-16" />}
                    <ToggleGroup
                      type="single"
                      size="sm"
                      variant="outline"
                      value={String(forecastHorizon)}
                      onValueChange={(v) => {
                        if (!v) return;
                        setForecastHorizon(parseForecastHorizon(v));
                      }}
                      aria-label="Forecast window"
                      className="gap-0 rounded-md"
                    >
                      {FORECAST_HORIZON_OPTIONS.map((d) => (
                        <ToggleGroupItem
                          key={d}
                          value={String(d)}
                          aria-label={`${d} day forecast`}
                          className="h-7 px-2.5 text-xs first:rounded-r-none last:rounded-l-none [&:not(:first-child):not(:last-child)]:rounded-none -ml-px first:ml-0 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                        >
                          {d}d
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>
                </div>
                {forecast.isPending && forecastShortages.length === 0 ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : forecastShortages.length === 0 ? (
                  <div className="text-center py-10 text-sm text-muted-foreground flex flex-col items-center gap-2">
                    <CheckCircle2 className="h-8 w-8 text-emerald-500/60" />
                    No projected shortages in the next {forecastHorizon} days
                  </div>
                ) : (
                  <div className="space-y-2">
                    {forecastShortages.map((s) => {
                      const Icon = CATEGORY_ICON[s.category] ?? Layers;
                      const critical = s.stockoutDay <= 3;
                      return (
                        <Link
                          key={s.itemId}
                          href={`/items/${s.itemId}`}
                          className="flex items-center justify-between gap-3 p-3 rounded-md border border-amber-500/20 bg-amber-500/5 hover:border-amber-500/40 transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <Icon className="h-5 w-5 text-amber-500 shrink-0" />
                            <div className="min-w-0">
                              <div className="font-medium text-sm truncate">{s.itemName}</div>
                              <div className="text-xs text-muted-foreground">{s.categoryLabelText}</div>
                            </div>
                          </div>
                          <BurnDownSparkline
                            points={s.points}
                            unit={s.unit}
                            critical={critical}
                          />
                          <div className="text-right shrink-0">
                            <div className={`text-sm font-bold ${critical ? 'text-destructive' : 'text-amber-500'}`}>
                              Stockout in {s.stockoutDay}d
                            </div>
                            <div className="text-xs text-muted-foreground">DOS {formatDOS(s.daysOfSupply)}</div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
        </div>

        {/* Right Rail - Recommendations */}
        <div className="flex flex-col gap-4">
          <Card className="bg-card/50 backdrop-blur border-border flex-1 flex flex-col overflow-hidden">
            <CardHeader className="pb-2 border-b border-border/50 shrink-0">
              <CardTitle className="text-sm font-medium flex items-center justify-between gap-2 text-primary">
                <span className="flex items-center gap-2">
                  <Activity className="h-4 w-4" />
                  Recommended Actions
                </span>
                <AiBadge />
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-y-auto">
              <div className="divide-y divide-border/50">
                {recommendations.slice(0, 5).map((rec) => {
                  const localPromote = promotedById[rec.id];
                  const isPromoted = !!rec.promotedOrderId || !!localPromote;
                  const promotedRef =
                    localPromote?.orderNo ?? rec.promotedOrderId ?? null;
                  const isPending =
                    promoteRec.isPending &&
                    promoteRec.variables?.recommendationId === rec.id;
                  const err = promoteErrorById[rec.id];
                  return (
                    <div key={rec.id} className="p-4 space-y-3 hover:bg-muted/20 transition-colors">
                      <div className="flex justify-between items-start">
                        <Badge variant="outline" className="text-primary border-primary bg-primary/10">{rec.kind}</Badge>
                        <span className="text-xs font-mono text-muted-foreground">ETA: {rec.etaDays}d</span>
                      </div>
                      <div>
                        <div className="font-bold text-sm">{rec.itemName}</div>
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{rec.rationale}</div>
                      </div>
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
                        <div className="text-sm font-mono">Qty: {rec.quantity}</div>
                        <Button
                          size="sm"
                          onClick={() => setEditingRec(rec)}
                          disabled={isPromoted || isPending}
                          data-testid={`rec-promote-${rec.id}`}
                        >
                          {isPromoted
                            ? promotedRef
                              ? `Promoted · ${promotedRef}`
                              : 'Promoted'
                            : isPending
                              ? 'Promoting…'
                              : 'Promote to Order'}
                        </Button>
                      </div>
                      {err ? (
                        <div className="text-[11px] text-destructive">{err}</div>
                      ) : null}
                    </div>
                  );
                })}
                {recommendations.length === 0 && (
                  <div className="p-6 text-center text-sm text-muted-foreground">No pending recommendations</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      <PromoteDialog
        rec={editingRec}
        suppliers={suppliers ?? []}
        isSubmitting={
          promoteRec.isPending &&
          editingRec != null &&
          promoteRec.variables?.recommendationId === editingRec.id
        }
        onCancel={() => setEditingRec(null)}
        onConfirm={(overrides) => {
          if (editingRec) handlePromoteConfirm(editingRec, overrides);
        }}
      />
    </div>
  );
}

function CategoryChip({
  label,
  icon: Icon,
  active,
  count,
  subDos,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  count: number;
  subDos?: number | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors border ${
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted/30 hover:text-foreground'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="font-medium">{label}</span>
      <span className="font-mono text-[10px] opacity-70">({count})</span>
      {subDos != null && (
        <span className={`font-mono text-[10px] ${dosClass(subDos)}`}>· {formatDOS(subDos)}</span>
      )}
    </button>
  );
}

function CategorySection({
  categoryKey: key,
  label,
  rows,
  hideHeader,
}: {
  categoryKey: ItemCategoryKey;
  label: string;
  rows: DosRow[];
  hideHeader?: boolean;
}) {
  const Icon = CATEGORY_ICON[key];
  const onHandTotal = rows.reduce((s, r) => s + (r.onHand ?? 0), 0);
  const validDos = rows.map((r) => r.daysOfSupply).filter((v) => Number.isFinite(v) && v < 999);
  const minDos = validDos.length > 0 ? Math.min(...validDos) : null;
  const avgDos = validDos.length > 0 ? validDos.reduce((a, b) => a + b, 0) / validDos.length : null;

  // Show a unit suffix on the subtotal only when every row in the category shares the same unit.
  const unitSet = new Set(rows.map((r) => r.unit).filter((u) => !!u));
  const sharedUnit = unitSet.size === 1 ? rows.find((r) => !!r.unit)?.unit ?? '' : '';
  const subtotalUnit = sharedUnit ? formatUnit(sharedUnit, onHandTotal) : '';

  return (
    <div>
      {!hideHeader && (
        <div className="px-4 py-2 bg-muted/30 border-y border-border/40 flex items-center justify-between sticky top-0 z-10 backdrop-blur">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            <span className="text-xs uppercase tracking-wider font-medium">{label}</span>
            <span className="text-xs font-mono text-muted-foreground">({rows.length})</span>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-muted-foreground">
              On hand:{' '}
              <span className="font-mono text-foreground">{formatNumber(onHandTotal)}</span>
              {subtotalUnit && <span className="ml-1 text-muted-foreground">{subtotalUnit}</span>}
              {!sharedUnit && unitSet.size > 1 && (
                <span className="ml-1 text-muted-foreground" title="Items in this category use different units">
                  (mixed units)
                </span>
              )}
            </span>
            <span className="text-muted-foreground">
              min DOS: <span className={`font-mono ${minDos != null ? dosClass(minDos) : ''}`}>{formatDOS(minDos)}</span>
            </span>
            <span className="text-muted-foreground">
              avg DOS: <span className={`font-mono ${avgDos != null ? dosClass(avgDos) : ''}`}>{formatDOS(avgDos)}</span>
            </span>
          </div>
        </div>
      )}
      <SortableTable
        initialSort={{ key: 'dos', direction: 'asc' }}
        data={rows}
        rowKey={(item) => item.itemId}
        emptyMessage="No items in this category"
        columns={[
          {
            key: 'item',
            label: 'Item',
            sortAccessor: (item) => item.itemName,
            render: (item) => (
              <Link href={`/items/${item.itemId}`} className="font-medium hover:text-primary hover:underline">
                {item.itemName}
              </Link>
            ),
          },
          {
            key: 'onHand',
            label: 'On Hand',
            align: 'right',
            sortAccessor: (item) => item.onHand ?? 0,
            render: (item) => {
              const unitText = formatUnit(item.unit, item.onHand);
              return (
                <span className="font-mono">
                  {formatNumber(item.onHand)}
                  {unitText && <span className="ml-1 text-muted-foreground">{unitText}</span>}
                </span>
              );
            },
          },
          {
            key: 'burn',
            label: 'Burn/day',
            align: 'right',
            sortAccessor: (item) => item.dailyBurn ?? 0,
            render: (item) => (
              <span className="font-mono text-xs text-muted-foreground">
                {item.dailyBurn != null ? item.dailyBurn.toFixed(1) : '—'}
              </span>
            ),
          },
          {
            key: 'dos',
            label: 'DOS',
            align: 'right',
            sortAccessor: (item) => item.daysOfSupply,
            render: (item) => (
              <span className={`font-mono ${dosClass(item.daysOfSupply)}`}>{formatDOS(item.daysOfSupply)}</span>
            ),
          },
          {
            key: 'status',
            label: 'Status',
            sortAccessor: (item) => item.status,
            render: (item) => (
              <Badge
                variant="outline"
                className={
                  item.status === 'critical'
                    ? 'border-destructive text-destructive'
                    : item.status === 'warn'
                    ? 'border-amber-500 text-amber-500'
                    : 'border-emerald-500 text-emerald-500'
                }
              >
                {String(item.status).toUpperCase()}
              </Badge>
            ),
          },
        ]}
      />
    </div>
  );
}

function BurnDownSparkline({
  points,
  unit,
  critical,
}: {
  points: HistoryPoint[];
  unit: string;
  critical: boolean;
}) {
  const reactId = React.useId();
  if (!points || points.length === 0) return null;

  const stroke = critical ? 'hsl(var(--destructive))' : 'rgb(245 158 11)'; // amber-500
  const gradientId = `burndown-${critical ? 'crit' : 'warn'}-${reactId.replace(/:/g, '')}`;
  const maxValue = points.reduce((m, p) => (p.value > m ? p.value : m), 0);

  return (
    <div
      className="hidden sm:block w-[120px] h-10 shrink-0"
      // Stop the surrounding <Link> from intercepting hover/scroll while the user
      // is exploring tooltip points; clicks still bubble so navigation works.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.45} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[0, maxValue > 0 ? maxValue : 1]} />
          <RechartsTooltip
            cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeDasharray: '3 3', strokeOpacity: 0.5 }}
            content={<BurnDownTooltipContent unit={unit} />}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 3, stroke, fill: 'hsl(var(--background))', strokeWidth: 1.5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function BurnDownTooltipContent({
  active,
  payload,
  unit,
}: {
  active?: boolean;
  payload?: Array<{ payload: HistoryPoint }>;
  unit?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  const unitText = unit ? formatUnit(unit, point.value) : '';
  return (
    <div className="rounded-md border border-border bg-background/95 px-2 py-1.5 text-[11px] shadow-md">
      <div className="font-medium">Day {point.day}</div>
      <div className="font-mono text-foreground">
        On hand: {formatNumber(point.value)}
        {unitText && <span className="ml-1 text-muted-foreground">{unitText}</span>}
      </div>
      {point.label && (
        <div className="text-muted-foreground">{point.label}</div>
      )}
    </div>
  );
}
