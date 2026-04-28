import React from 'react';
import { useParams, Link } from 'wouter';
import { useGetItemDetail, getGetItemDetailQueryKey } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SortableTable } from '@/components/ui/sortable-table';
import { Skeleton } from '@/components/ui/skeleton';
import { Box, Network, AlertTriangle, MapPin } from 'lucide-react';

function riskClass(dos: number) {
  if (dos <= 3) return 'text-destructive font-bold';
  if (dos <= 7) return 'text-amber-500 font-bold';
  return 'text-emerald-500 font-bold';
}

export default function ItemDetail() {
  const { itemId } = useParams();
  
  const { data: detail, isLoading } = useGetItemDetail(itemId || '', {
    query: {
      enabled: !!itemId,
      queryKey: getGetItemDetailQueryKey(itemId || '')
    }
  });

  if (isLoading || !detail) {
    return <div className="p-6 space-y-4">
      <Skeleton className="h-12 w-1/3" />
      <Skeleton className="h-24" />
      <Skeleton className="h-64" />
    </div>;
  }

  const { item, totalOnHand, networkDaysOfSupply, perNode, suppliers } = detail;
  const criticalNodes = perNode.filter(n => (n.daysOfSupply || 0) <= 3).length;

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
              <span>Shelf life: {(item as { shelfLifeDays?: number }).shelfLifeDays}d</span>
            )}
            {(item as { leadTimeDays?: number }).leadTimeDays !== undefined && (
              <span>Lead time: {(item as { leadTimeDays?: number }).leadTimeDays}d</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 shrink-0">
        <Card className="bg-card/50 border-border">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Network DOS</p>
              <h3 className={`text-2xl font-bold mt-1 ${riskClass(networkDaysOfSupply)}`}>{networkDaysOfSupply.toFixed(1)}</h3>
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

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 min-h-0">
        <div className="lg:col-span-2 flex flex-col gap-4">
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
                    sortAccessor: (node) => node.quantityOnHand,
                    render: (node) => (
                      <span className="font-mono">{node.quantityOnHand}</span>
                    ),
                  },
                  {
                    key: 'dos',
                    label: 'DOS',
                    align: 'right',
                    sortAccessor: (node) => node.daysOfSupply ?? 0,
                    render: (node) => (
                      <span className={`font-mono ${riskClass(node.daysOfSupply || 0)}`}>
                        {(node.daysOfSupply || 0).toFixed(1)}
                      </span>
                    ),
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    sortAccessor: (node) => node.daysOfSupply ?? 0,
                    render: (node) => {
                      const dos = node.daysOfSupply;
                      const cls = !dos || dos <= 3 ? 'border-destructive text-destructive' : dos <= 7 ? 'border-amber-500 text-amber-500' : 'border-emerald-500 text-emerald-500';
                      const label = !dos || dos <= 3 ? 'CRITICAL' : dos <= 7 ? 'WATCH' : 'HEALTHY';
                      return <Badge variant="outline" className={cls}>{label}</Badge>;
                    },
                  },
                ]}
              />
            </div>
          </Card>
        </div>
        
        <div className="flex flex-col gap-4">
          <Card className="bg-card/50 border-border flex-1 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-border/50 bg-muted/20 font-medium text-sm">Available Suppliers</div>
            <div className="flex-1 overflow-auto">
              <div className="divide-y divide-border/50">
                {suppliers.map(sup => (
                  <div key={sup.id} className="p-4">
                    <div className="font-bold text-sm mb-1">{sup.name}</div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Lead Time: {sup.leadTimeDays}d</span>
                      <span>Rel: {(sup.reliability * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                ))}
                {suppliers.length === 0 && <div className="p-4 text-center text-muted-foreground text-sm">No suppliers mapped</div>}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

