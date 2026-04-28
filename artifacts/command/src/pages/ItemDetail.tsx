import React from 'react';
import { useParams, Link } from 'wouter';
import { useGetItemDetail, getGetItemDetailQueryKey } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SortableTable } from '@/components/ui/sortable-table';
import { Skeleton } from '@/components/ui/skeleton';
import { Box, Network, AlertTriangle, MapPin } from 'lucide-react';
import {
  formatPercent,
  formatDays,
  formatDOS,
  dosClass as riskClass,
  inventoryStatusBadgeClasses,
  inventoryStatusLabel,
} from '@/lib/format';

function suppliersCarryingItem<T extends { items?: string[] }>(
  list: T[],
  itemId: string,
): T[] {
  return list.filter((s) => Array.isArray(s.items) && s.items.includes(itemId));
}

export default function ItemDetail() {
  const { itemId } = useParams();
  const [showAllSuppliers, setShowAllSuppliers] = React.useState(false);

  const { data: detail, isLoading } = useGetItemDetail(itemId || '', {
    query: {
      enabled: !!itemId,
      queryKey: getGetItemDetailQueryKey(itemId || '')
    }
  });

  React.useEffect(() => {
    setShowAllSuppliers(false);
  }, [itemId]);

  if (isLoading || !detail) {
    return <div className="p-6 space-y-4">
      <Skeleton className="h-12 w-1/3" />
      <Skeleton className="h-24" />
      <Skeleton className="h-64" />
    </div>;
  }

  const { item, totalOnHand, networkDaysOfSupply, perNode, suppliers } = detail;
  const criticalNodes = perNode.filter(n => (n.daysOfSupply || 0) <= 3).length;
  const matchingSuppliers = suppliersCarryingItem(suppliers, item.id);
  const noMatches = matchingSuppliers.length === 0;
  const visibleSuppliers = showAllSuppliers || noMatches ? suppliers : matchingSuppliers;
  const hiddenCount = Math.max(0, suppliers.length - matchingSuppliers.length);

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-y-auto bg-background text-foreground">
      <div className="flex items-start justify-between shrink-0 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="text-2xl font-bold tracking-wide">{item.name}</h1>
            {(() => {
              const cat = (item as { category?: string }).category;
              if (!cat) return null;
              const label = cat === 'blood_products' ? 'Blood Product' : cat === 'supplies' ? 'Supplies' : 'Other';
              const klass =
                cat === 'blood_products'
                  ? 'border-destructive/70 text-destructive bg-destructive/10'
                  : cat === 'supplies'
                  ? 'border-primary/70 text-primary bg-primary/10'
                  : 'border-muted-foreground/40 text-muted-foreground bg-muted/30';
              return <Badge variant="outline" className={klass}>{label}</Badge>;
            })()}
            <Badge variant="outline" className={item.criticality === 'critical' ? 'border-destructive text-destructive' : 'border-primary text-primary'}>
              {String(item.criticality).toUpperCase()}
            </Badge>
          </div>
          <div className="flex items-center text-sm text-muted-foreground gap-4 flex-wrap">
            <span className="font-mono">ID: {item.id}</span>
            <span>UoM: {item.unit}</span>
            <span>Usage Rate: {item.usageRate}/day</span>
            {(item as { shelfLifeDays?: number }).shelfLifeDays !== undefined && (
              <span>Shelf life: {formatDays((item as { shelfLifeDays?: number }).shelfLifeDays)}</span>
            )}
            {(item as { leadTimeDays?: number }).leadTimeDays !== undefined && (
              <span>Lead time: {formatDays((item as { leadTimeDays?: number }).leadTimeDays)}</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 shrink-0">
        <Card className="bg-card/50 border-border">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Network DOS</p>
              <h3 className={`text-2xl font-bold mt-1 ${riskClass(networkDaysOfSupply)}`}>{formatDOS(networkDaysOfSupply)}</h3>
            </div>
            <Network className="h-8 w-8 text-primary/30" />
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total On Hand</p>
              <h3 className="text-2xl font-mono font-bold mt-1">{totalOnHand.toLocaleString()}</h3>
            </div>
            <Box className="h-8 w-8 text-primary/30" />
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Stocking Sites</p>
              <h3 className="text-2xl font-bold mt-1">{perNode.length}</h3>
            </div>
            <MapPin className="h-8 w-8 text-primary/30" />
          </CardContent>
        </Card>
        <Card className={`bg-card/50 border-border ${criticalNodes > 0 ? 'border-destructive/50 bg-destructive/5' : ''}`}>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Critical Sites</p>
              <h3 className={`text-2xl font-bold mt-1 ${criticalNodes > 0 ? 'text-destructive' : 'text-emerald-500'}`}>{criticalNodes}</h3>
            </div>
            <AlertTriangle className={`h-8 w-8 ${criticalNodes > 0 ? 'text-destructive/50' : 'text-emerald-500/30'}`} />
          </CardContent>
        </Card>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-5 gap-4 min-h-0">
        <div className="lg:col-span-3 flex flex-col gap-4 min-w-0">
          <Card className="bg-card/50 border-border flex-1 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-border/50 bg-muted/20 font-medium text-sm">Site Distribution</div>
            <div className="flex-1 overflow-auto p-0">
              <SortableTable
                stickyHeader
                initialSort={{ key: 'dos', direction: 'asc' }}
                data={perNode}
                rowKey={(node) => node.nodeId}
                emptyMessage="No site distribution data"
                columns={[
                  {
                    key: 'site',
                    label: 'Site',
                    sortAccessor: (node) => node.nodeName || node.nodeId,
                    render: (node) => (
                      <Link href={`/sites/${node.nodeId}`} className="font-medium hover:text-primary hover:underline">
                        {node.nodeName || node.nodeId}
                      </Link>
                    ),
                  },
                  {
                    key: 'onHand',
                    label: 'On Hand',
                    align: 'right',
                    sortAccessor: (node) => node.quantityOnHand ?? 0,
                    render: (node) => (
                      <span className="font-mono">{node.quantityOnHand ?? 0}</span>
                    ),
                  },
                  {
                    key: 'dos',
                    label: 'DOS',
                    align: 'right',
                    sortAccessor: (node) => node.daysOfSupply ?? 0,
                    render: (node) => (
                      <span className={`font-mono ${riskClass(node.daysOfSupply ?? 0)}`}>
                        {formatDOS(node.daysOfSupply)}
                      </span>
                    ),
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    sortAccessor: (node) => node.daysOfSupply ?? 0,
                    render: (node) => {
                      // Map DOS into the same four-tier status enum the API uses
                      // for inventory rows. Reusing the shared helper guarantees
                      // colors stay aligned with Site Detail and prevents the
                      // "green CRITICAL" bug from coming back.
                      const dos = node.daysOfSupply;
                      const status =
                        !dos || dos <= 3
                          ? 'critical'
                          : dos <= 7
                            ? 'warn'
                            : 'healthy';
                      return (
                        <Badge
                          variant="outline"
                          className={inventoryStatusBadgeClasses(status)}
                        >
                          {inventoryStatusLabel(status)}
                        </Badge>
                      );
                    },
                  },
                ]}
              />
            </div>
          </Card>
        </div>
        
        <div className="lg:col-span-2 flex flex-col gap-4 min-w-0">
          <Card className="bg-card/50 border-border flex-1 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-border/50 bg-muted/20 flex items-center justify-between gap-2">
              <div className="font-medium text-sm">
                Available Suppliers
                {!noMatches && !showAllSuppliers && hiddenCount > 0 && (
                  <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                    showing {matchingSuppliers.length} of {suppliers.length} that carry this item
                  </span>
                )}
              </div>
              {hiddenCount > 0 && !noMatches && (
                <button
                  type="button"
                  data-testid="item-detail-supplier-show-all"
                  className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                  onClick={() => setShowAllSuppliers((v) => !v)}
                >
                  {showAllSuppliers ? 'Only matching' : 'Show all'}
                </button>
              )}
            </div>
            {noMatches && suppliers.length > 0 && (
              <div className="px-4 py-2 text-[11px] text-muted-foreground border-b border-border/50 bg-amber-400/5">
                No supplier in the catalog carries this item — showing all suppliers.
              </div>
            )}
            <div className="flex-1 overflow-auto">
              <SortableTable
                stickyHeader
                className="table-fixed"
                initialSort={{ key: 'reliability', direction: 'desc' }}
                data={visibleSuppliers}
                rowKey={(sup) => sup.id}
                emptyMessage="No suppliers mapped"
                columns={[
                  {
                    key: 'name',
                    label: 'Supplier',
                    sortAccessor: (sup) => sup.name,
                    className: 'w-[60%]',
                    headerClassName: 'w-[60%]',
                    render: (sup) => {
                      const carries = Array.isArray(sup.items) && sup.items.includes(item.id);
                      return (
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate flex items-center gap-2" title={sup.name}>
                            <span className="truncate">{sup.name}</span>
                            {!carries && (
                              <span className="shrink-0 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                                no coverage
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {sup.region || '—'}{sup.channel ? ` · ${sup.channel}` : ''}
                          </div>
                        </div>
                      );
                    },
                  },
                  {
                    key: 'leadTime',
                    label: 'Lead',
                    align: 'right',
                    sortAccessor: (sup) => sup.leadTimeDays,
                    className: 'w-[20%]',
                    headerClassName: 'w-[20%]',
                    render: (sup) => (
                      <span className="font-mono text-sm whitespace-nowrap">
                        {formatDays(sup.leadTimeDays)}
                      </span>
                    ),
                  },
                  {
                    key: 'reliability',
                    label: 'Reliability',
                    align: 'right',
                    sortAccessor: (sup) => sup.reliability,
                    className: 'w-[20%]',
                    headerClassName: 'w-[20%]',
                    render: (sup) => (
                      <span className="font-mono text-sm whitespace-nowrap">
                        {formatPercent(sup.reliability)}
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

