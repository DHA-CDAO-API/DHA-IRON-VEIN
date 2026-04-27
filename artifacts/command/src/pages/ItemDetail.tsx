import React from 'react';
import { useParams, Link } from 'wouter';
import { useGetItemDetail, getGetItemDetailQueryKey } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Box, Network, AlertTriangle } from 'lucide-react';

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
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold tracking-wide">{item.name}</h1>
            <Badge variant="outline" className={item.criticality === 'LIFE_SAVING' ? 'border-destructive text-destructive' : 'border-primary text-primary'}>
              {item.criticality}
            </Badge>
          </div>
          <div className="flex items-center text-sm text-muted-foreground gap-4">
            <span className="font-mono">ID: {item.id}</span>
            <span>UoM: {item.unit}</span>
            <span>Usage Rate: {item.usageRate}/day</span>
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
              <Table>
                <TableHeader className="bg-muted/50 sticky top-0">
                  <TableRow>
                    <TableHead>Site</TableHead>
                    <TableHead className="text-right">On Hand</TableHead>
                    <TableHead className="text-right">DOS</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {perNode.sort((a, b) => (a.daysOfSupply || 0) - (b.daysOfSupply || 0)).map(node => (
                    <TableRow key={node.nodeId}>
                      <TableCell className="font-medium">
                        <Link href={`/sites/${node.nodeId}`} className="hover:text-primary hover:underline">{node.nodeName || node.nodeId}</Link>
                      </TableCell>
                      <TableCell className="text-right font-mono">{node.quantityOnHand}</TableCell>
                      <TableCell className={`text-right font-mono ${riskClass(node.daysOfSupply || 0)}`}>{(node.daysOfSupply || 0).toFixed(1)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={!node.daysOfSupply || node.daysOfSupply <= 3 ? 'border-destructive text-destructive' : node.daysOfSupply <= 7 ? 'border-amber-500 text-amber-500' : 'border-emerald-500 text-emerald-500'}>
                          {!node.daysOfSupply || node.daysOfSupply <= 3 ? 'CRITICAL' : node.daysOfSupply <= 7 ? 'WATCH' : 'HEALTHY'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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

// Need to import MapPin since I forgot it
import { MapPin } from 'lucide-react';
