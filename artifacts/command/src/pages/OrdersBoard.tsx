import React from 'react';
import { useListOrders, getListOrdersQueryKey } from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'wouter';
import { Clock, Printer } from 'lucide-react';

export default function OrdersBoard() {
  const { data: orders, isLoading } = useListOrders({}, {
    query: { refetchInterval: 10000, queryKey: getListOrdersQueryKey() }
  });

  if (isLoading || !orders) {
    return <div className="p-6"><Skeleton className="h-64" /></div>;
  }

  const columns = ['SUBMITTED', 'ACKNOWLEDGED', 'IN_TRANSIT', 'RECEIVED'];
  
  return (
    <div className="h-full flex flex-col p-4 bg-background text-foreground overflow-hidden">
      <div className="flex justify-between items-center mb-4 shrink-0">
        <h1 className="text-2xl font-bold uppercase tracking-wider">Orders Board</h1>
        <div className="flex gap-2">
          {/* Create Order button stub */}
          <Badge variant="outline" className="px-4 py-2 cursor-pointer hover:bg-primary/20 transition-colors border-primary text-primary">
            + New Order
          </Badge>
        </div>
      </div>

      <div className="flex-1 flex gap-4 overflow-x-auto pb-4">
        {columns.map(status => {
          const colOrders = orders.filter(o => o.status === status);
          return (
            <div key={status} className="flex-1 min-w-[300px] flex flex-col bg-muted/10 rounded-lg border border-border/50 overflow-hidden">
              <div className="p-3 border-b border-border/50 bg-muted/30 font-medium text-sm flex justify-between items-center">
                <span>{status.replace('_', ' ')}</span>
                <Badge variant="secondary" className="bg-background">{colOrders.length}</Badge>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {colOrders.map(order => (
                  <Card key={order.id} className="bg-card/80 border-border/50 shadow-sm hover:border-primary/50 transition-colors">
                    <CardContent className="p-3">
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-mono text-xs text-muted-foreground">{order.orderNumber}</div>
                        <Badge variant={order.priority === 'URGENT' || order.priority === 'FLASH' ? 'destructive' : 'outline'} className="text-[10px] px-1 py-0 h-4">
                          {order.priority}
                        </Badge>
                      </div>
                      <div className="font-medium text-sm mb-1">{order.itemName || order.itemId}</div>
                      <div className="text-xs text-muted-foreground mb-3">To: {order.toNodeId}</div>
                      
                      <div className="flex justify-between items-center text-xs mt-2 pt-2 border-t border-border/50">
                        <div className="flex items-center text-muted-foreground gap-1">
                          <Clock className="h-3 w-3" /> ETA {order.etaDays}d
                        </div>
                        <div className="flex gap-2">
                          <Link href={`/orders/${order.id}/print`} className="text-muted-foreground hover:text-primary" title="Print PO">
                            <Printer className="h-4 w-4" />
                          </Link>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {colOrders.length === 0 && <div className="text-center p-4 text-xs text-muted-foreground italic">No orders</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
