import { useMemo } from 'react';
import {
  useGetSupplyImportStatus,
  getGetSupplyImportStatusQueryKey,
  type SupplyImportRun,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PackageSearch, MapPinOff, Database, Layers } from 'lucide-react';

const REFRESH_INTERVAL_MS = 30_000;

function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('en-US');
}

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return '—';
  }
}

interface ChipProps {
  label: string;
  value: number;
  hint?: string;
  testId: string;
}

function Chip({ label, value, hint, testId }: ChipProps) {
  return (
    <div
      className="flex flex-col gap-0.5 rounded border border-border bg-card/40 px-3 py-2"
      data-testid={testId}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-sm font-medium text-foreground">
        {formatNumber(value)}
      </div>
      {hint && (
        <div className="text-[10px] text-muted-foreground/80">{hint}</div>
      )}
    </div>
  );
}

export function SupplyImportPanel() {
  const { data, isLoading, isError } = useGetSupplyImportStatus({
    query: {
      queryKey: getGetSupplyImportStatusQueryKey(),
      refetchInterval: REFRESH_INTERVAL_MS,
      refetchIntervalInBackground: false,
    },
  });

  const recentImports = useMemo<SupplyImportRun[]>(
    () => data?.recentImports ?? [],
    [data?.recentImports],
  );

  const checkedAt = data?.checkedAt
    ? new Date(data.checkedAt).toLocaleTimeString()
    : null;

  return (
    <Card
      className="bg-card/50 border-border"
      data-testid="card-supply-import"
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-2">
            <PackageSearch className="h-4 w-4 text-primary" />
            Supply Demo Import
            {checkedAt && (
              <span className="text-xs font-normal text-muted-foreground tracking-normal normal-case ml-2">
                Last checked {checkedAt}
              </span>
            )}
          </CardTitle>
          <Badge
            variant="outline"
            className="text-muted-foreground border-border bg-muted/20 uppercase tracking-wider text-[10px]"
            data-testid="supply-import-readonly-tag"
          >
            Read-only
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isError ? (
          <div className="text-sm text-destructive" data-testid="supply-import-error">
            Failed to load supply import status.
          </div>
        ) : isLoading || !data ? (
          <div
            className="text-sm text-muted-foreground"
            data-testid="supply-import-loading"
          >
            Loading…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Chip
                testId="chip-staging-catalog"
                label="Staging catalog"
                value={data.tableCounts.supply_demo_v2_catalog}
                hint="supply_demo_v2_catalog"
              />
              <Chip
                testId="chip-staging-facilities"
                label="Staging facilities"
                value={data.tableCounts.supply_demo_v2_facilities}
                hint="supply_demo_v2_facilities"
              />
              <Chip
                testId="chip-staging-issues"
                label="Staging issues"
                value={data.tableCounts.supply_demo_v2_issues}
                hint="supply_demo_v2_issues"
              />
              <Chip
                testId="chip-staging-imports"
                label="Import runs"
                value={data.tableCounts.supply_demo_v2_imports}
                hint="supply_demo_v2_imports"
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div
                className="flex items-center gap-3 rounded border border-border bg-card/40 px-3 py-2"
                data-testid="chip-reconciled-catalog"
              >
                <Layers className="h-4 w-4 text-primary/80" />
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Reconciled catalog rows
                  </span>
                  <span className="font-mono text-sm font-medium text-foreground">
                    {formatNumber(data.reconciledCatalogCount)}
                  </span>
                  <span className="text-[10px] text-muted-foreground/80">
                    catalog_entries.source = supply_demo_v2
                  </span>
                </div>
              </div>
              <div
                className="flex items-center gap-3 rounded border border-border bg-card/40 px-3 py-2"
                data-testid="chip-mapped-facilities"
              >
                <Database className="h-4 w-4 text-primary/80" />
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Mapped facilities
                  </span>
                  <span className="font-mono text-sm font-medium text-foreground">
                    {formatNumber(data.mappedFacilitiesCount)}
                  </span>
                  <span className="text-[10px] text-muted-foreground/80">
                    facilities.node_id IS NOT NULL
                  </span>
                </div>
              </div>
              <div
                className="flex items-center gap-3 rounded border border-border bg-card/40 px-3 py-2"
                data-testid="chip-hidden-nodes"
              >
                <MapPinOff className="h-4 w-4 text-primary/80" />
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Hidden map nodes
                  </span>
                  <span className="font-mono text-sm font-medium text-foreground">
                    {formatNumber(data.hiddenNodeCount)}
                  </span>
                  <span className="text-[10px] text-muted-foreground/80">
                    nodes.hidden_from_map = true
                  </span>
                </div>
              </div>
            </div>

            {recentImports.length === 0 ? (
              <div
                className="text-xs text-muted-foreground italic"
                data-testid="supply-import-empty"
              >
                No import runs recorded yet.
              </div>
            ) : (
              <div
                className="overflow-x-auto rounded border border-border"
                data-testid="supply-import-history"
              >
                <table className="w-full text-xs">
                  <thead className="bg-muted/20">
                    <tr className="text-left">
                      <th className="p-2 font-medium text-muted-foreground">Started</th>
                      <th className="p-2 font-medium text-muted-foreground">Duration</th>
                      <th className="p-2 font-medium text-muted-foreground">Source</th>
                      <th className="p-2 font-medium text-muted-foreground text-right">Rows read</th>
                      <th className="p-2 font-medium text-muted-foreground text-right">Catalog</th>
                      <th className="p-2 font-medium text-muted-foreground text-right">Facilities</th>
                      <th className="p-2 font-medium text-muted-foreground text-right">Issues</th>
                      <th className="p-2 font-medium text-muted-foreground">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {recentImports.map((run) => (
                      <tr
                        key={run.id}
                        className="hover:bg-muted/10"
                        data-testid={`supply-import-row-${run.id}`}
                      >
                        <td className="p-2 font-mono text-[11px]">
                          {formatTimestamp(run.startedAt)}
                        </td>
                        <td className="p-2 font-mono text-[11px]">
                          {formatDuration(run.durationMs)}
                        </td>
                        <td className="p-2 font-mono text-[11px] text-muted-foreground max-w-[260px] truncate">
                          {run.sourceFile ?? '—'}
                        </td>
                        <td className="p-2 font-mono text-[11px] text-right">
                          {formatNumber(run.sourceRowsRead)}
                        </td>
                        <td className="p-2 font-mono text-[11px] text-right">
                          {formatNumber(run.catalogUpserts)}
                        </td>
                        <td className="p-2 font-mono text-[11px] text-right">
                          {formatNumber(run.facilityUpserts)}
                        </td>
                        <td className="p-2 font-mono text-[11px] text-right">
                          {formatNumber(run.issueRowsInserted)}
                        </td>
                        <td className="p-2 text-[11px] text-muted-foreground max-w-[260px] truncate">
                          {run.notes ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default SupplyImportPanel;
