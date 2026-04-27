import React, { useState } from 'react';
import { useParams, Link } from 'wouter';
import { useGetSiteDetail, getGetSiteDetailQueryKey, useForecastDemand, useAcknowledgeAlert, usePromoteRecommendationToOrder } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Activity, AlertTriangle, Box, MapPin, CheckCircle2, TrendingUp } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';

function riskClass(dos: number) {
  if (dos <= 3) return 'text-destructive font-bold';
  if (dos <= 7) return 'text-amber-500 font-bold';
  return 'text-emerald-500 font-bold';
}

export default function SiteDetail() {
  const { nodeId } = useParams();
  const [activeTab, setActiveTab] = useState('inventory');
  
  const { data: detail, isLoading } = useGetSiteDetail(nodeId || '', {
    query: {
      enabled: !!nodeId,
      queryKey: getGetSiteDetailQueryKey(nodeId || ''),
      refetchInterval: 15000
    }
  });

  const ackAlert = useAcknowledgeAlert();
  const promoteRec = usePromoteRecommendationToOrder();

  if (isLoading || !detail) {
    return <div className="p-6 space-y-4">
      <Skeleton className="h-12 w-1/3" />
      <div className="grid grid-cols-3 gap-4">
        <Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64" />
    </div>;
  }

  const { node, dosByItem, alerts, recentOrders, recommendations } = detail;
  const aggregateDOS = detail.balances.reduce((acc, b) => acc + (b.daysOfSupply || 0), 0) / (detail.balances.length || 1);

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-y-auto bg-background text-foreground">
      {/* Header */}
      <div className="flex items-start justify-between shrink-0 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">
        <Card className="bg-card/50 backdrop-blur border-border">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Aggregate DOS</p>
              <h3 className={`text-2xl font-bold mt-1 ${riskClass(aggregateDOS)}`}>{aggregateDOS.toFixed(1)}</h3>
            </div>
            <Box className="h-8 w-8 text-primary/50" />
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
              <TabsTrigger value="inventory" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2">Inventory</TabsTrigger>
              <TabsTrigger value="alerts" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2 flex gap-2">
                Alerts
                {alerts.length > 0 && <Badge variant="destructive" className="ml-1 px-1.5 py-0 min-w-[20px] h-5">{alerts.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="activity" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2">Activity</TabsTrigger>
              <TabsTrigger value="forecast" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-4 py-2">Forecast</TabsTrigger>
            </TabsList>
            
            <div className="flex-1 overflow-y-auto mt-4 bg-card/30 rounded-md border border-border">
              <TabsContent value="inventory" className="m-0 h-full p-0">
                <Table>
                  <TableHeader className="bg-muted/50 sticky top-0">
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">On Hand</TableHead>
                      <TableHead className="text-right">DOS</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dosByItem.map(item => (
                      <TableRow key={item.itemId}>
                        <TableCell className="font-medium">
                          <Link href={`/items/${item.itemId}`} className="hover:text-primary hover:underline">{item.itemName}</Link>
                        </TableCell>
                        <TableCell className="text-right font-mono">{item.quantityOnHand}</TableCell>
                        <TableCell className={`text-right font-mono ${riskClass(item.daysOfSupply)}`}>{item.daysOfSupply.toFixed(1)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={item.status === 'critical' ? 'border-destructive text-destructive' : item.status === 'warn' ? 'border-amber-500 text-amber-500' : 'border-emerald-500 text-emerald-500'}>
                            {item.status.toUpperCase()}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {dosByItem.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No inventory data available</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </TabsContent>
              
              <TabsContent value="alerts" className="m-0 p-4 space-y-4">
                {alerts.map(alert => (
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
                {alerts.length === 0 && <div className="text-center py-8 text-muted-foreground">No open alerts</div>}
              </TabsContent>

              <TabsContent value="activity" className="m-0 p-4">
                <div className="space-y-4">
                  {recentOrders.map(order => (
                    <div key={order.id} className="flex justify-between items-center p-3 border-b border-border/50">
                      <div>
                        <div className="font-medium text-sm">Order {order.orderNumber} - {order.itemName}</div>
                        <div className="text-xs text-muted-foreground">Status: {order.status}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm">Qty: {order.quantity}</div>
                        <div className="text-xs text-muted-foreground">{new Date(order.createdAt).toLocaleDateString()}</div>
                      </div>
                    </div>
                  ))}
                  {recentOrders.length === 0 && <div className="text-center py-8 text-muted-foreground">No recent activity</div>}
                </div>
              </TabsContent>
              
              <TabsContent value="forecast" className="m-0 p-4 h-full min-h-[300px]">
                {/* Forecast chart stub */}
                <div className="h-full flex items-center justify-center text-muted-foreground flex-col gap-2">
                  <TrendingUp className="h-8 w-8 text-primary/50" />
                  <span>Select an item to view forecast</span>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>

        {/* Right Rail - Recommendations */}
        <div className="flex flex-col gap-4">
          <Card className="bg-card/50 backdrop-blur border-border flex-1 flex flex-col overflow-hidden">
            <CardHeader className="pb-2 border-b border-border/50 shrink-0">
              <CardTitle className="text-sm font-medium flex items-center gap-2 text-primary">
                <Activity className="h-4 w-4" />
                Recommended Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-y-auto">
              <div className="divide-y divide-border/50">
                {recommendations.slice(0, 5).map(rec => (
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
                      <Button size="sm" onClick={() => promoteRec.mutate({ recommendationId: rec.id })} disabled={!!rec.promotedOrderId}>
                        {rec.promotedOrderId ? 'Promoted' : 'Promote to Order'}
                      </Button>
                    </div>
                  </div>
                ))}
                {recommendations.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No pending recommendations</div>}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
