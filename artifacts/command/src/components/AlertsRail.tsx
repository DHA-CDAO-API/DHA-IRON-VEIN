import React from 'react';
import {
  useListAlerts,
  useAcknowledgeAlert,
  getListAlertsQueryKey,
  useGetNetworkSnapshot,
  getGetNetworkSnapshotQueryKey,
  type Alert,
} from '@workspace/api-client-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Bell, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Link } from 'wouter';

// A row that mixes a real persisted Alert with a synthetic alert that we
// derive in-memory from the live network snapshot. Synthetic rows can't
// be acknowledged (there's no backing record to ack), so we just hide
// the button on those.
type DisplayAlert = {
  id: string;
  title: string;
  body: string;
  severity: 'critical' | 'warn' | 'watch';
  createdAt: string;
  nodeId?: string | null;
  itemId?: string | null;
  source: 'persisted' | 'derived';
};

export default function AlertsRail() {
  const { data: alerts = [] } = useListAlerts(
    { status: 'open' },
    { query: { queryKey: getListAlertsQueryKey({ status: 'open' }) } }
  );

  // Pull the live snapshot so we can synthesize alerts for nodes that are
  // currently red/critical even when no operator has filed an explicit
  // alert against them. This was the user-visible bug: the map showed
  // five red nodes but the rail said "No active alerts" because alerts
  // and node-status are computed by different pipelines.
  const { data: snapshot } = useGetNetworkSnapshot({
    query: { queryKey: getGetNetworkSnapshotQueryKey() },
  });

  const ackAlert = useAcknowledgeAlert();

  // Build the derived list once we have a snapshot.
  const derived = React.useMemo<DisplayAlert[]>(() => {
    if (!snapshot) return [];
    const nowIso = new Date().toISOString();
    const persistedNodeIds = new Set(
      alerts.map((a) => a.nodeId).filter(Boolean) as string[],
    );
    const nodeNameById = new Map(
      (snapshot.nodes ?? []).map((n: any) => [n.id, n.name as string]),
    );
    const out: DisplayAlert[] = [];
    for (const r of snapshot.riskByNode ?? []) {
      const isCritical = (r as any).riskScore >= 70;
      const isHeightened = !isCritical && (r as any).riskScore >= 40;
      if (!isCritical && !isHeightened) continue;
      // Avoid duplicate entries for nodes that already have a persisted
      // critical/warn alert in the table.
      if (persistedNodeIds.has((r as any).nodeId)) continue;
      const dos = (r as any).daysOfSupply;
      const dosText = typeof dos === 'number' && dos < 999
        ? `${dos.toFixed(1)}d DOS`
        : 'no recorded DOS';
      const name = nodeNameById.get((r as any).nodeId) ?? (r as any).nodeId;
      out.push({
        id: `derived:${(r as any).nodeId}`,
        title: isCritical
          ? `Critical readiness: ${name}`
          : `Heightened readiness: ${name}`,
        body: `Risk score ${(r as any).riskScore?.toFixed?.(0) ?? '—'} · ${dosText}.`,
        severity: isCritical ? 'critical' : 'warn',
        createdAt: nowIso,
        nodeId: (r as any).nodeId,
        source: 'derived',
      });
    }
    // Surface the worst sites first.
    out.sort((a, b) =>
      a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1,
    );
    return out;
  }, [snapshot, alerts]);

  // Combine persisted alerts (mapped to DisplayAlert) with derived ones.
  const persisted: DisplayAlert[] = React.useMemo(
    () =>
      (alerts as Alert[]).map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        severity: a.severity as 'critical' | 'warn' | 'watch',
        createdAt: a.createdAt,
        nodeId: a.nodeId ?? null,
        itemId: a.itemId ?? null,
        source: 'persisted',
      })),
    [alerts],
  );
  const all: DisplayAlert[] = React.useMemo(
    () => [...persisted, ...derived],
    [persisted, derived],
  );

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
          <Bell className="h-5 w-5" />
          {all.length > 0 && (
            <span className="absolute top-1 right-1 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive"></span>
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[400px] sm:w-[540px] border-l border-border bg-background p-0 flex flex-col">
        <SheetHeader className="p-4 border-b border-border/50 shrink-0">
          {/* The pr-10 reserves space for the Sheet's built-in close (X)
              button so the alert-count badge no longer sits underneath
              it. The badge is also placed before the auto-margin so it
              doesn't fly all the way to the right edge. */}
          <SheetTitle className="text-lg font-bold flex items-center gap-2 pr-10">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <span>Active Alerts</span>
            <Badge variant="destructive" className="ml-2">{all.length}</Badge>
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {all.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-emerald-500/30" />
              <p>No active alerts.</p>
              <p className="text-xs mt-1">Theater network is stable.</p>
            </div>
          )}

          {all.map(alert => (
            <div key={alert.id} className={`p-4 rounded-lg border bg-card/50 ${alert.severity === 'critical' ? 'border-destructive/30' : alert.severity === 'warn' ? 'border-amber-400/30' : 'border-primary/30'}`}>
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={
                    alert.severity === 'critical' ? 'border-destructive text-destructive' :
                    alert.severity === 'warn' ? 'border-amber-400 text-amber-400' :
                    'border-primary text-primary'
                  }>
                    {alert.severity.toUpperCase()}
                  </Badge>
                  {alert.source === 'derived' && (
                    <Badge variant="outline" className="border-border text-muted-foreground text-[10px] tracking-wider uppercase">
                      Live
                    </Badge>
                  )}
                </div>
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
                {alert.source === 'persisted' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs"
                    onClick={() => ackAlert.mutate({ alertId: alert.id, data: { acknowledgedBy: 'Current User' } })}
                  >
                    Acknowledge
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
