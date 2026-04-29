import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetSupplyImportStatus,
  getGetSupplyImportStatusQueryKey,
  type SupplyImportRun,
} from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  PackageSearch,
  MapPinOff,
  Database,
  Layers,
  PlayCircle,
} from 'lucide-react';

interface ActivationSummary {
  itemsPromoted: number;
  itemsAlreadyPromoted: number;
  facilitiesActivated: number;
  facilitiesAlreadyActive: number;
  rollupRowsWritten: number;
  inventoryRowsWritten: number;
  durationMs: number;
}

async function postActivate(): Promise<ActivationSummary> {
  const res = await fetch('/api/admin/supply-import/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`activate failed (${res.status}): ${text || res.statusText}`);
  }
  return (await res.json()) as ActivationSummary;
}

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
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useGetSupplyImportStatus({
    query: {
      queryKey: getGetSupplyImportStatusQueryKey(),
      refetchInterval: REFRESH_INTERVAL_MS,
      refetchIntervalInBackground: false,
    },
  });

  const [activating, setActivating] = useState(false);
  const [activateResult, setActivateResult] =
    useState<ActivationSummary | null>(null);
  const [activateError, setActivateError] = useState<string | null>(null);

  const onActivate = async () => {
    setActivating(true);
    setActivateError(null);
    try {
      const summary = await postActivate();
      setActivateResult(summary);
      // Force a status refresh so the chips reflect the new state.
      queryClient.invalidateQueries({
        queryKey: getGetSupplyImportStatusQueryKey(),
      });
    } catch (err) {
      setActivateError(err instanceof Error ? err.message : String(err));
    } finally {
      setActivating(false);
    }
  };

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
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onActivate}
              disabled={activating}
              data-testid="button-supply-import-activate"
              className="h-7 text-xs"
            >
              <PlayCircle className="h-3.5 w-3.5 mr-1.5" />
              {activating ? 'Activating…' : 'Activate'}
            </Button>
            <Badge
              variant="outline"
              className="text-muted-foreground border-border bg-muted/20 uppercase tracking-wider text-[10px]"
              data-testid="supply-import-readonly-tag"
            >
              Status read-only
            </Badge>
          </div>
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
            {(activateResult || activateError) && (
              <div
                className="rounded border border-border bg-card/40 px-3 py-2 text-xs space-y-1"
                data-testid="supply-import-activate-result"
              >
                {activateError ? (
                  <div className="text-destructive">
                    Activation failed: {activateError}
                  </div>
                ) : activateResult ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
                    <div data-testid="activate-items-promoted">
                      <span className="text-muted-foreground">Items promoted: </span>
                      <span className="font-mono">
                        {formatNumber(activateResult.itemsPromoted)}
                      </span>
                      {activateResult.itemsAlreadyPromoted > 0 && (
                        <span className="text-muted-foreground/70">
                          {' '}(+{formatNumber(activateResult.itemsAlreadyPromoted)} existing)
                        </span>
                      )}
                    </div>
                    <div data-testid="activate-facilities">
                      <span className="text-muted-foreground">Facilities activated: </span>
                      <span className="font-mono">
                        {formatNumber(activateResult.facilitiesActivated)}
                      </span>
                      {activateResult.facilitiesAlreadyActive > 0 && (
                        <span className="text-muted-foreground/70">
                          {' '}(+{formatNumber(activateResult.facilitiesAlreadyActive)} existing)
                        </span>
                      )}
                    </div>
                    <div data-testid="activate-rollup-rows">
                      <span className="text-muted-foreground">Demand rollup rows: </span>
                      <span className="font-mono">
                        {formatNumber(activateResult.rollupRowsWritten)}
                      </span>
                    </div>
                    <div data-testid="activate-inventory-rows">
                      <span className="text-muted-foreground">Derived inventory rows: </span>
                      <span className="font-mono">
                        {formatNumber(activateResult.inventoryRowsWritten)}
                      </span>
                    </div>
                    <div className="col-span-2 sm:col-span-4 text-muted-foreground/80 text-[10px]">
                      Completed in {formatDuration(activateResult.durationMs)} — rerun is idempotent; rollback reverses.
                    </div>
                  </div>
                ) : null}
              </div>
            )}
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
