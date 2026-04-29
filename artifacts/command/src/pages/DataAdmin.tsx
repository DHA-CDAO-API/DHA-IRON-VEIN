import React, { useMemo, useState } from 'react';
import {
  useGetSeedStatus,
  useReseedDatabase,
  useListCatalogItems,
  useGetDatabaseHealth,
  useGetTableHealth,
  getGetDatabaseHealthQueryKey,
  getGetSeedStatusQueryKey,
  getGetTableHealthQueryKey,
  type DatabaseHealth,
  type TableHealth,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Database,
  RefreshCw,
  FileSpreadsheet,
  FileText,
  Box,
  HardDrive,
  Table as TableIcon,
  Search,
  ArrowDown,
  ArrowUp,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { SupplyImportPanel } from '@/components/admin/SupplyImportPanel';

const DB_REFRESH_INTERVAL_MS = 15_000;
const TABLES_REFRESH_INTERVAL_MS = 30_000;

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

function TableStatusBadge({ status }: { status: TableHealth['status'] }) {
  if (status === 'healthy') {
    return (
      <Badge
        variant="outline"
        className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10 uppercase tracking-wider text-[10px]"
        data-testid="table-status-healthy"
      >
        Healthy
      </Badge>
    );
  }
  if (status === 'degraded') {
    return (
      <Badge
        variant="outline"
        className="text-amber-500 border-amber-500/30 bg-amber-500/10 uppercase tracking-wider text-[10px]"
        data-testid="table-status-degraded"
      >
        Degraded
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="text-muted-foreground border-border bg-muted/20 uppercase tracking-wider text-[10px]"
      data-testid="table-status-empty"
    >
      Empty
    </Badge>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const v = bytes / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

function formatRows(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n === 0) return '0';
  if (n < 1000) return n.toLocaleString();
  if (n < 10_000) return `${(n / 1000).toFixed(1)}K`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return 'never';
  const delta = Date.now() - ts;
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return `${Math.round(delta / 86_400_000)}d ago`;
}

function lastMaintenance(t: TableHealth): string | null {
  const candidates = [t.lastVacuum, t.lastAutovacuum, t.lastAnalyze, t.lastAutoanalyze]
    .filter((v): v is string => !!v)
    .map((v) => new Date(v).getTime())
    .filter((ts) => !Number.isNaN(ts));
  if (candidates.length === 0) return null;
  return new Date(Math.max(...candidates)).toISOString();
}

type SortKey = 'name' | 'rowCount' | 'sizeBytes' | 'indexCount' | 'status' | 'lastMaintenance';

const STATUS_ORDER: Record<TableHealth['status'], number> = {
  degraded: 0,
  empty: 1,
  healthy: 2,
};

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

  const {
    data: tableHealth,
    isLoading: tablesLoading,
    isFetching: tablesFetching,
    refetch: refetchTables,
  } = useGetTableHealth({
    query: {
      queryKey: getGetTableHealthQueryKey(),
      refetchInterval: TABLES_REFRESH_INTERVAL_MS,
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

  const tablesCheckedAt = tableHealth?.checkedAt
    ? new Date(tableHealth.checkedAt).toLocaleTimeString()
    : null;

  // ---- Tables panel local UI state: search + sort
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('sizeBytes');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const tableRows = tableHealth?.tables ?? [];

  const tableSummary = useMemo(() => {
    const total = tableRows.length;
    const healthy = tableRows.filter((t) => t.status === 'healthy').length;
    const degraded = tableRows.filter((t) => t.status === 'degraded').length;
    const empty = tableRows.filter((t) => t.status === 'empty').length;
    const totalRows = tableRows.reduce((s, t) => s + (t.rowCount ?? 0), 0);
    const totalBytes = tableRows.reduce((s, t) => s + (t.sizeBytes ?? 0), 0);
    return { total, healthy, degraded, empty, totalRows, totalBytes };
  }, [tableRows]);

  const visibleTables = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? tableRows.filter(
          (t) =>
            t.name.toLowerCase().includes(q) || t.schema.toLowerCase().includes(q),
        )
      : tableRows;
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'rowCount':
          cmp = a.rowCount - b.rowCount;
          break;
        case 'sizeBytes':
          cmp = a.sizeBytes - b.sizeBytes;
          break;
        case 'indexCount':
          cmp = a.indexCount - b.indexCount;
          break;
        case 'status':
          cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
          break;
        case 'lastMaintenance': {
          const ma = lastMaintenance(a);
          const mb = lastMaintenance(b);
          const ta = ma ? new Date(ma).getTime() : 0;
          const tb = mb ? new Date(mb).getTime() : 0;
          cmp = ta - tb;
          break;
        }
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [tableRows, search, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Sensible default direction per column: text asc, numeric desc.
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return null;
    return sortDir === 'asc' ? (
      <ArrowUp className="inline h-3 w-3 ml-1" />
    ) : (
      <ArrowDown className="inline h-3 w-3 ml-1" />
    );
  };

  const ariaSortFor = (key: SortKey): React.AriaAttributes['aria-sort'] => {
    if (sortKey !== key) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  };

  const sortHeaderClass = (extra = '') =>
    `p-3 font-medium text-muted-foreground ${extra}`.trim();

  const sortButtonClass = (alignRight = false) =>
    `inline-flex items-center gap-0 hover:text-foreground focus-visible:outline-none focus-visible:text-foreground rounded-sm ${alignRight ? 'justify-end w-full' : ''}`;

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
                {dbHealth.databases.map((dbInfo: DatabaseHealth) => (
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

      <Card className="bg-card/50 border-border" data-testid="card-tables">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle className="text-sm flex items-center gap-2">
              <TableIcon className="h-4 w-4 text-primary" />
              Tables
              {tablesCheckedAt && (
                <span className="text-xs font-normal text-muted-foreground tracking-normal normal-case ml-2">
                  Last checked {tablesCheckedAt}
                </span>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter tables..."
                  className="h-8 w-[200px] pl-7 text-xs bg-background/50"
                  data-testid="input-table-search"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="border-border hover:bg-secondary"
                onClick={() => refetchTables()}
                disabled={tablesFetching}
                data-testid="button-refresh-tables"
              >
                <RefreshCw
                  className={`h-4 w-4 mr-2 ${tablesFetching ? 'animate-spin' : ''}`}
                />
                Refresh
              </Button>
            </div>
          </div>
          {!tablesLoading && tableSummary.total > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs text-muted-foreground">
              <span data-testid="tables-summary-total">
                <span className="text-foreground font-mono">{tableSummary.total}</span> tables
              </span>
              <span className="text-emerald-500/80" data-testid="tables-summary-healthy">
                <span className="font-mono">{tableSummary.healthy}</span> healthy
              </span>
              <span className="text-amber-500/80" data-testid="tables-summary-degraded">
                <span className="font-mono">{tableSummary.degraded}</span> degraded
              </span>
              <span data-testid="tables-summary-empty">
                <span className="font-mono">{tableSummary.empty}</span> empty
              </span>
              <span className="text-muted-foreground/60">·</span>
              <span data-testid="tables-summary-rows">
                <span className="text-foreground font-mono">
                  {formatRows(tableSummary.totalRows)}
                </span>{' '}
                rows
              </span>
              <span data-testid="tables-summary-bytes">
                <span className="text-foreground font-mono">
                  {formatBytes(tableSummary.totalBytes)}
                </span>{' '}
                on disk
              </span>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {tablesLoading ? (
            <div className="p-4 text-sm">Loading tables...</div>
          ) : tableRows.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              No user tables reported by the database.
            </div>
          ) : visibleTables.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              No tables match "{search}".
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/30">
                  <tr>
                    <th scope="col" aria-sort={ariaSortFor('name')} className={sortHeaderClass()}>
                      <button
                        type="button"
                        onClick={() => toggleSort('name')}
                        className={sortButtonClass()}
                        data-testid="th-table-name"
                      >
                        Table {sortIndicator('name')}
                      </button>
                    </th>
                    <th scope="col" aria-sort={ariaSortFor('rowCount')} className={sortHeaderClass('text-right')}>
                      <button
                        type="button"
                        onClick={() => toggleSort('rowCount')}
                        className={sortButtonClass(true)}
                        data-testid="th-table-rows"
                      >
                        Rows {sortIndicator('rowCount')}
                      </button>
                    </th>
                    <th scope="col" aria-sort={ariaSortFor('sizeBytes')} className={sortHeaderClass('text-right')}>
                      <button
                        type="button"
                        onClick={() => toggleSort('sizeBytes')}
                        className={sortButtonClass(true)}
                        data-testid="th-table-size"
                      >
                        Size {sortIndicator('sizeBytes')}
                      </button>
                    </th>
                    <th scope="col" aria-sort={ariaSortFor('indexCount')} className={sortHeaderClass('text-right')}>
                      <button
                        type="button"
                        onClick={() => toggleSort('indexCount')}
                        className={sortButtonClass(true)}
                        data-testid="th-table-indexes"
                      >
                        Idx {sortIndicator('indexCount')}
                      </button>
                    </th>
                    <th scope="col" className={sortHeaderClass('text-right')}>
                      Scan ratio
                    </th>
                    <th scope="col" aria-sort={ariaSortFor('lastMaintenance')} className={sortHeaderClass()}>
                      <button
                        type="button"
                        onClick={() => toggleSort('lastMaintenance')}
                        className={sortButtonClass()}
                        data-testid="th-table-maint"
                      >
                        Last maint. {sortIndicator('lastMaintenance')}
                      </button>
                    </th>
                    <th scope="col" aria-sort={ariaSortFor('status')} className={sortHeaderClass()}>
                      <button
                        type="button"
                        onClick={() => toggleSort('status')}
                        className={sortButtonClass()}
                        data-testid="th-table-status"
                      >
                        Health {sortIndicator('status')}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {visibleTables.map((t) => {
                    const totalScans = t.sequentialScans + t.indexScans;
                    const idxRatio =
                      totalScans > 0 ? t.indexScans / totalScans : null;
                    return (
                      <tr
                        key={`${t.schema}.${t.name}`}
                        className="hover:bg-muted/10"
                        data-testid={`row-table-${t.schema}-${t.name}`}
                      >
                        <td className="p-3">
                          <div className="font-mono text-xs text-foreground">
                            {t.name}
                          </div>
                          {t.schema !== 'public' && (
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">
                              {t.schema}
                            </div>
                          )}
                        </td>
                        <td className="p-3 text-right font-mono text-xs">
                          {formatRows(t.rowCount)}
                        </td>
                        <td className="p-3 text-right font-mono text-xs">
                          <div>{formatBytes(t.sizeBytes)}</div>
                          {t.indexBytes > 0 && (
                            <div className="text-[10px] text-muted-foreground">
                              {formatBytes(t.indexBytes)} idx
                            </div>
                          )}
                        </td>
                        <td className="p-3 text-right font-mono text-xs text-muted-foreground">
                          {t.indexCount}
                        </td>
                        <td className="p-3 text-right font-mono text-xs text-muted-foreground">
                          {idxRatio === null ? (
                            '—'
                          ) : (
                            <>
                              {Math.round(idxRatio * 100)}%
                              <span className="text-[10px] text-muted-foreground/60 ml-1">
                                idx
                              </span>
                            </>
                          )}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {formatRelativeTime(lastMaintenance(t))}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-col gap-1">
                            <TableStatusBadge status={t.status} />
                            {t.detail && (
                              <span className="text-[10px] text-muted-foreground leading-tight max-w-[260px]">
                                {t.detail}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <SupplyImportPanel />
    </div>
  );
}
