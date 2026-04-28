import React from 'react';
import {
  useGetSeedStatus,
  useReseedDatabase,
  useListCatalogItems,
  useGetDatabaseHealth,
  getGetDatabaseHealthQueryKey,
  getGetSeedStatusQueryKey,
  type DatabaseHealth,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Database,
  RefreshCw,
  FileSpreadsheet,
  FileText,
  Box,
  HardDrive,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const DB_REFRESH_INTERVAL_MS = 15_000;

function StatusBadge({ status }: { status: DatabaseHealth['status'] }) {
  if (status === 'healthy') {
    return (
      <Badge
        variant="outline"
        className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10 uppercase tracking-wider"
        data-testid={`db-status-healthy`}
      >
        Healthy
      </Badge>
    );
  }
  if (status === 'degraded') {
    return (
      <Badge
        variant="outline"
        className="text-amber-500 border-amber-500/30 bg-amber-500/10 uppercase tracking-wider"
        data-testid={`db-status-degraded`}
      >
        Degraded
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-destructive border-destructive/30 bg-destructive/10 uppercase tracking-wider"
      data-testid={`db-status-offline`}
    >
      Offline
    </Badge>
  );
}

export default function DataAdmin() {
  const { data: status, isLoading: statusLoading } = useGetSeedStatus({
    query: { queryKey: getGetSeedStatusQueryKey() },
  });

  const { data: catalog, isLoading: catalogLoading } = useListCatalogItems({ limit: 10 });
  const reseed = useReseedDatabase();
  const { toast } = useToast();

  const {
    data: dbHealth,
    isLoading: dbLoading,
    isFetching: dbFetching,
    refetch: refetchDbHealth,
  } = useGetDatabaseHealth({
    query: {
      queryKey: getGetDatabaseHealthQueryKey(),
      refetchInterval: DB_REFRESH_INTERVAL_MS,
      refetchIntervalInBackground: false,
    },
  });

  const handleReseed = () => {
    reseed.mutate(undefined, {
      onSuccess: () => {
        toast({ title: 'Reseed Started', description: 'Database is being re-seeded.' });
      },
      onError: () => {
        toast({ title: 'Error', description: 'Failed to start reseed.', variant: 'destructive' });
      }
    });
  };

  const lastChecked = dbHealth?.checkedAt
    ? new Date(dbHealth.checkedAt).toLocaleTimeString()
    : null;

  return (
    <div className="h-full flex flex-col p-6 gap-6 bg-background overflow-y-auto">
      <div className="flex justify-between items-center shrink-0">
        <h1 className="text-2xl font-bold uppercase tracking-wider">Data Administration</h1>
        <div className="flex gap-2">
          <Button variant="outline" className="border-border hover:bg-secondary">
            <FileText className="h-4 w-4 mr-2" /> Export Orders (CSV)
          </Button>
          <Button variant="outline" className="border-border hover:bg-secondary">
            <FileSpreadsheet className="h-4 w-4 mr-2" /> Export Balances (XLSX)
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              Seed Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statusLoading ? <div className="text-sm">Loading...</div> : (
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Nodes</span>
                  <span className="font-mono">{status?.nodes.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Items</span>
                  <span className="font-mono">{status?.items.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Balances</span>
                  <span className="font-mono">{status?.balances.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Routes</span>
                  <span className="font-mono">{status?.routes.toLocaleString()}</span>
                </div>
                <div className="pt-4 mt-2 border-t border-border/50">
                  <Button onClick={handleReseed} disabled={reseed.isPending} className="w-full bg-destructive/20 text-destructive hover:bg-destructive/30 border border-destructive/50">
                    {reseed.isPending ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Wipe & Reseed Database
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border md:col-span-2 flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Box className="h-4 w-4 text-primary" />
              Catalog Preview ({catalog?.total.toLocaleString()} total)
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto p-0">
            {catalogLoading ? <div className="p-4 text-sm">Loading...</div> : (
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/30 sticky top-0">
                  <tr>
                    <th className="p-3 font-medium text-muted-foreground">Noun</th>
                    <th className="p-3 font-medium text-muted-foreground">Mfr</th>
                    <th className="p-3 font-medium text-muted-foreground">Type</th>
                    <th className="p-3 font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {catalog?.items.map((item, i) => (
                    <tr key={i} className="hover:bg-muted/10">
                      <td className="p-3">{item.productNoun}</td>
                      <td className="p-3 text-muted-foreground">{item.manufacturer}</td>
                      <td className="p-3 text-muted-foreground">{item.productType}</td>
                      <td className="p-3">
                        {item.mapped ? <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10">MAPPED</Badge> : <Badge variant="outline" className="text-muted-foreground">UNMAPPED</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 border-border" data-testid="card-databases">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-primary" />
              Databases
              {lastChecked && (
                <span className="text-xs font-normal text-muted-foreground tracking-normal normal-case ml-2">
                  Last checked {lastChecked}
                </span>
              )}
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              className="border-border hover:bg-secondary"
              onClick={() => refetchDbHealth()}
              disabled={dbFetching}
              data-testid="button-refresh-databases"
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${dbFetching ? 'animate-spin' : ''}`}
              />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {dbLoading ? (
            <div className="p-4 text-sm">Loading...</div>
          ) : !dbHealth || dbHealth.databases.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              No databases reported.
            </div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/30">
                <tr>
                  <th className="p-3 font-medium text-muted-foreground">Name</th>
                  <th className="p-3 font-medium text-muted-foreground">Endpoint</th>
                  <th className="p-3 font-medium text-muted-foreground">Status</th>
                  <th className="p-3 font-medium text-muted-foreground">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {dbHealth.databases.map((dbInfo) => (
                  <tr
                    key={`${dbInfo.kind}-${dbInfo.name}`}
                    className="hover:bg-muted/10"
                    data-testid={`row-db-${dbInfo.kind}`}
                  >
                    <td className="p-3">
                      <div className="font-medium">{dbInfo.name}</div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wider">
                        {dbInfo.kind}
                      </div>
                    </td>
                    <td className="p-3">
                      <code className="text-xs font-mono text-muted-foreground break-all">
                        {dbInfo.endpoint}
                      </code>
                    </td>
                    <td className="p-3">
                      <StatusBadge status={dbInfo.status} />
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {dbInfo.detail ?? '—'}
                      {dbInfo.status !== 'offline' &&
                        typeof dbInfo.latencyMs === 'number' &&
                        !dbInfo.detail?.includes(`${dbInfo.latencyMs}`) && (
                          <span className="ml-2 font-mono">
                            {dbInfo.latencyMs} ms
                          </span>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
