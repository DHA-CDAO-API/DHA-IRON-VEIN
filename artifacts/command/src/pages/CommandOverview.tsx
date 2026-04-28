import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useGetNetworkSnapshot, useGetDashboardOverview, useListActivity, getGetNetworkSnapshotQueryKey, getGetDashboardOverviewQueryKey, getListActivityQueryKey } from '@workspace/api-client-react';
import NetworkGLMap from '@/components/Map';
import { AlertTriangle, TrendingDown, TrendingUp, Activity, Box, Truck } from 'lucide-react';
import { Link } from 'wouter';
import { Skeleton } from '@/components/ui/skeleton';

export default function CommandOverview() {
  const { data: snapshot, isLoading: snapLoading } = useGetNetworkSnapshot({
    query: {
      queryKey: getGetNetworkSnapshotQueryKey(),
    },
  });

  const { data: overview, isLoading: overviewLoading } = useGetDashboardOverview({
    query: {
      queryKey: getGetDashboardOverviewQueryKey(),
    },
  });

  const { data: activity, isLoading: activityLoading } = useListActivity(
    { limit: 10 },
    {
      query: {
        queryKey: getListActivityQueryKey({ limit: 10 }),
      },
    }
  );

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-y-auto bg-background text-foreground">
      {/* KPI Strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
        <KPICard title="Theater DOS" value={overview?.kpis?.theaterDaysOfSupply?.toFixed(1) ?? '--'} icon={<Box className="h-4 w-4 text-primary" />} trend="-1.2" unit="days" />
        <KPICard title="Open Alerts" value={overview?.kpis?.openAlertsTotal ?? 0} icon={<AlertTriangle className="h-4 w-4 text-destructive" />} trend={`${overview?.kpis?.openCriticalAlerts ?? 0} crit`} unit="alerts" alert />
        <KPICard title="In-Transit Shipments" value={overview?.kpis?.shipmentsInFlight ?? 0} icon={<Truck className="h-4 w-4 text-primary" />} />
        <KPICard title="Pending Recs" value={overview?.kpis?.recommendationsAwaitingPromotion ?? 0} icon={<Activity className="h-4 w-4 text-primary" />} />
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 min-h-[500px]">
        {/* Map Section */}
        <div className="lg:col-span-2 rounded-xl overflow-hidden border border-border relative bg-card">
          <div className="absolute top-4 left-4 z-10">
            <Badge variant="outline" className="bg-background/80 backdrop-blur-sm border-primary text-primary shadow-lg">
              Live Theater Map
            </Badge>
          </div>
          {snapLoading ? (
            <div className="w-full h-full flex items-center justify-center bg-muted/20">
              <Skeleton className="w-full h-full" />
            </div>
          ) : (
            <NetworkGLMap 
              nodes={snapshot?.nodes}
              routes={snapshot?.routes}
              shipments={snapshot?.shipments}
              riskByNode={snapshot?.riskByNode}
              threats={snapshot?.threats}
            />
          )}
        </div>

        {/* Right Rail */}
        <div className="flex flex-col gap-4">
          <Card className="flex-1 overflow-hidden flex flex-col bg-card/50 backdrop-blur border-border">
            <CardHeader className="pb-2 border-b border-border/50">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Top Risk Hubs
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-y-auto">
              <div className="divide-y divide-border/50">
                {snapshot?.riskByNode?.slice(0, 5).map(risk => {
                  const node = snapshot.nodes.find(n => n.id === risk.nodeId);
                  return (
                    <Link key={risk.nodeId} href={`/sites/${risk.nodeId}`}>
                      <div className="p-3 hover:bg-muted/50 cursor-pointer transition-colors group">
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-medium text-sm group-hover:text-primary transition-colors">{node?.name || risk.nodeId}</span>
                          <Badge variant={risk.riskScore > 80 ? "destructive" : "secondary"}>{risk.riskScore.toFixed(0)}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground flex justify-between">
                          <span>{risk.daysOfSupply.toFixed(1)} DOS</span>
                          <span>{risk.criticalShortItems} Critical</span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="flex-1 overflow-hidden flex flex-col bg-card/50 backdrop-blur border-border">
            <CardHeader className="pb-2 border-b border-border/50">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-y-auto">
              <div className="divide-y divide-border/50">
                {activity?.map(act => {
                  const ts = act.createdAt ? new Date(act.createdAt) : null;
                  const tsLabel = ts && !isNaN(ts.getTime()) ? ts.toLocaleTimeString() : '—';
                  return (
                    <div key={act.id} className="p-3">
                      <p className="text-sm text-foreground/90">{act.summary ?? '—'}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {tsLabel} · {act.actorRole ?? 'System'}
                      </p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function KPICard({ title, value, icon, trend, unit, alert }: any) {
  return (
    <Card className={`border-border bg-card/50 backdrop-blur ${alert ? 'border-destructive/50 bg-destructive/10' : ''}`}>
      <CardContent className="p-4 flex flex-col justify-between h-full">
        <div className="flex justify-between items-start">
          <span className="text-sm font-medium text-muted-foreground">{title}</span>
          {icon}
        </div>
        <div className="mt-4 flex items-baseline gap-2">
          <span className={`text-3xl font-bold ${alert ? 'text-destructive' : 'text-foreground'}`}>{value}</span>
          {unit && <span className="text-sm text-muted-foreground font-medium">{unit}</span>}
        </div>
        {trend && (
          <div className="mt-2 flex items-center gap-1 text-xs">
            {trend.startsWith('+') ? <TrendingUp className="h-3 w-3 text-destructive" /> : <TrendingDown className="h-3 w-3 text-primary" />}
            <span className={trend.startsWith('+') ? 'text-destructive' : 'text-primary'}>{trend} vs last week</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
