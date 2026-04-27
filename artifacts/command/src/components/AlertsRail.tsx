import React from 'react';
import { useListAlerts, useAcknowledgeAlert } from '@workspace/api-client-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Bell, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Link } from 'wouter';

export default function AlertsRail() {
  const { data: alerts = [] } = useListAlerts({ status: 'open' }, {
    query: { refetchInterval: 10000 }
  });

  const ackAlert = useAcknowledgeAlert();

  const critical = alerts.filter(a => a.severity === 'critical');
  const warning = alerts.filter(a => a.severity === 'warn');
  const watch = alerts.filter(a => a.severity === 'watch');

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
          <Bell className="h-5 w-5" />
          {alerts.length > 0 && (
            <span className="absolute top-1 right-1 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive"></span>
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[400px] sm:w-[540px] border-l border-border bg-background p-0 flex flex-col">
        <SheetHeader className="p-4 border-b border-border/50 shrink-0">
          <SheetTitle className="text-lg font-bold flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Active Alerts
            <Badge variant="destructive" className="ml-auto">{alerts.length}</Badge>
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {alerts.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-emerald-500/30" />
              <p>No active alerts.</p>
              <p className="text-xs mt-1">Theater network is stable.</p>
            </div>
          )}
          
          {alerts.map(alert => (
            <div key={alert.id} className={`p-4 rounded-lg border bg-card/50 ${alert.severity === 'critical' ? 'border-destructive/30' : alert.severity === 'warn' ? 'border-amber-500/30' : 'border-primary/30'}`}>
              <div className="flex justify-between items-start mb-2">
                <Badge variant="outline" className={
                  alert.severity === 'critical' ? 'border-destructive text-destructive' :
                  alert.severity === 'warn' ? 'border-amber-500 text-amber-500' :
                  'border-primary text-primary'
                }>
                  {alert.severity.toUpperCase()}
                </Badge>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  {new Date(alert.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </span>
              </div>
              <h4 className="font-bold text-sm mb-1">{alert.title}</h4>
              <p className="text-xs text-muted-foreground mb-3">{alert.body}</p>
              
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
                <div className="flex gap-2">
                  {alert.nodeId && (
                    <Link href={`/sites/${alert.nodeId}`}>
                      <Button variant="link" size="sm" className="h-6 px-2 text-xs">View Node</Button>
                    </Link>
                  )}
                  {alert.itemId && (
                    <Link href={`/items/${alert.itemId}`}>
                      <Button variant="link" size="sm" className="h-6 px-2 text-xs">View Item</Button>
                    </Link>
                  )}
                </div>
                <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => ackAlert.mutate({ id: alert.id, data: { acknowledgedBy: 'Current User' } })}>
                  Acknowledge
                </Button>
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
