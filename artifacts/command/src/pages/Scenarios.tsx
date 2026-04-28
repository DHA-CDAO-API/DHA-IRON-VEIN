import React from "react";
import {
  useListPresetEvents,
  useListScenarios,
  useRunScenario,
  usePreviewScenario,
  useUpdateScenario,
  useDeleteScenario,
  useListNodes,
  useListSuppliers,
  usePromoteRecommendationToOrder,
  getGetScenarioQueryOptions,
  getGetScenarioQueryKey,
  getListScenariosQueryKey,
  useListTheaterZones,
  getListTheaterZonesQueryKey,
  type PresetEvent,
  type Recommendation,
  type Scenario as SavedScenario,
  type ScenarioResult,
  type TheaterZone,
  type Node as NetworkNode,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AiBadge } from "@/components/ui/ai-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { SortableTable, type SortableColumn } from "@/components/ui/sortable-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Loader2,
  PlayCircle,
  ShieldAlert,
  Wrench,
  Activity,
  X,
  CheckCircle2,
  Truck,
  RotateCw,
  Upload,
  Save,
  Search,
  Pencil,
  Trash2,
  Check,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import {
  PromoteDialog,
  defaultPriorityForKind,
  type PromoteOverrides,
} from "@/components/PromoteDialog";

type Perturbation = {
  affectedNodes?: string[];
  encounterMultiplier?: number;
  populationMultiplier?: number;
  wasteMultiplier?: number;
  routeReliabilityDelta?: number;
  routeDelayDays?: number;
  specimensMultiplier?: number;
  itemSkew?: Record<string, number>;
};

type CustomBuilderState = {
  name: string;
  kind: string;
  summary: string;
  affectedNodes: string[];
  zoneIds: string[];
  populationMultiplier: number;
  encounterMultiplier: number;
  wasteMultiplier: number;
  routeDelayDays: number;
  routeReliabilityDelta: number;
  horizonDays: number;
};

const DEFAULT_BUILDER: CustomBuilderState = {
  name: "Custom Scenario",
  kind: "custom",
  summary: "Operator-authored perturbation across selected nodes.",
  affectedNodes: [],
  zoneIds: [],
  populationMultiplier: 1.1,
  encounterMultiplier: 1.5,
  wasteMultiplier: 1.2,
  routeDelayDays: 3,
  routeReliabilityDelta: -0.2,
  horizonDays: 21,
};

const ZONE_SEVERITY_COLOR: Record<string, [number, number, number]> = {
  WATCH: [232, 168, 76],
  WARNING: [232, 120, 76],
  CRITICAL: [220, 64, 76],
};

const KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "war_conflict", label: "War / Kinetic" },
  { value: "contested_logistics", label: "Contested Logistics" },
  { value: "mass_casualty", label: "MASCAL Surge" },
  { value: "cyber_comms", label: "Cyber / Comms Denial" },
  { value: "infra_disruption", label: "Infrastructure Disruption" },
  { value: "natural_disaster", label: "Weather / Natural Disaster" },
  { value: "custom", label: "Custom" },
];

function severityClass(severity: string): string {
  const s = severity.toUpperCase();
  if (s === "CRITICAL")
    return "bg-destructive/15 text-destructive border-destructive/40";
  if (s === "HIGH")
    return "bg-amber-500/15 text-amber-400 border-amber-500/40";
  return "bg-muted text-muted-foreground border-border";
}

function kindLabel(kind: string | undefined): string {
  if (!kind) return "—";
  const found = KIND_OPTIONS.find((k) => k.value === kind);
  return found?.label ?? kind.replace(/_/g, " ").toUpperCase();
}

type SavedScenarioDetail = ScenarioResult & {
  inputs?: {
    perturbation?: Perturbation;
    horizonDays?: number;
    presetEventId?: string;
    presetName?: string;
  };
  kind?: string;
};

function builderFromSavedDetail(
  detail: SavedScenarioDetail,
  prev: CustomBuilderState,
): CustomBuilderState {
  const p = detail.inputs?.perturbation ?? {};
  return {
    name: detail.scenario?.name ?? prev.name,
    kind: detail.kind ?? prev.kind,
    summary: detail.scenario?.description ?? prev.summary,
    affectedNodes: p.affectedNodes ?? prev.affectedNodes,
    populationMultiplier: p.populationMultiplier ?? prev.populationMultiplier,
    encounterMultiplier: p.encounterMultiplier ?? prev.encounterMultiplier,
    wasteMultiplier: p.wasteMultiplier ?? prev.wasteMultiplier,
    routeDelayDays: p.routeDelayDays ?? prev.routeDelayDays,
    routeReliabilityDelta: p.routeReliabilityDelta ?? prev.routeReliabilityDelta,
    horizonDays: detail.inputs?.horizonDays ?? prev.horizonDays,
    zoneIds: (detail as any).zoneIds ?? prev.zoneIds,
  };
}

export default function Scenarios() {
  const { data: presets, isLoading: presetsLoading } = useListPresetEvents();
  const { data: scenarios, isLoading: scenariosLoading } = useListScenarios();
  const { data: nodes } = useListNodes();
  const { data: zones = [] } = useListTheaterZones({
    query: { queryKey: getListTheaterZonesQueryKey() },
  });
  const runScenario = useRunScenario();
  const previewScenario = usePreviewScenario();
  const queryClient = useQueryClient();

  const [builder, setBuilder] = React.useState<CustomBuilderState>(DEFAULT_BUILDER);
  const [result, setResult] = React.useState<ScenarioResult | null>(null);
  const [previousResult, setPreviousResult] =
    React.useState<ScenarioResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loadingSavedId, setLoadingSavedId] = React.useState<string | null>(null);
  const [rerunningSavedId, setRerunningSavedId] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<SavedScenario | null>(null);
  const updateScenario = useUpdateScenario();
  const deleteScenario = useDeleteScenario();
  // When the builder state is replaced programmatically (load a saved run,
  // re-run, etc.) we don't want the live-preview effect to fire and
  // overwrite the freshly fetched/computed result.
  const skipNextPreviewRef = React.useRef(false);

  const focusableNodes: NetworkNode[] = React.useMemo(
    () =>
      (nodes ?? []).filter(
        (n) => !/supplier|prime|conus|dla/i.test(`${n.id} ${n.name} ${n.type}`),
      ),
    [nodes],
  );

  const handleRunPreset = React.useCallback(
    async (preset: PresetEvent) => {
      setError(null);
      setPreviousResult(null);
      try {
        const res = (await runScenario.mutateAsync({
          data: {
            name: preset.label,
            kind: (preset as PresetEvent & { kind?: string }).kind ?? "preset",
            presetEventId: preset.id,
            summary: preset.description,
            horizonDays:
              (preset as PresetEvent & { durationDays?: number }).durationDays ??
              21,
            generateBrief: true,
          } as Parameters<typeof runScenario.mutateAsync>[0]["data"],
        })) as ScenarioResult;
        setResult(res);
      } catch (e) {
        setError((e as Error)?.message ?? "Scenario run failed");
      }
    },
    [runScenario],
  );

  const fetchSavedDetail = React.useCallback(
    async (scenarioId: string): Promise<SavedScenarioDetail> => {
      const opts = getGetScenarioQueryOptions(scenarioId);
      return queryClient.fetchQuery(opts) as Promise<SavedScenarioDetail>;
    },
    [queryClient],
  );

  const handleLoadSaved = React.useCallback(
    async (scenarioId: string) => {
      setError(null);
      setLoadingSavedId(scenarioId);
      setPreviousResult(null);
      try {
        const detail = await fetchSavedDetail(scenarioId);
        skipNextPreviewRef.current = true;
        setResult(detail);
        setBuilder((prev) => builderFromSavedDetail(detail, prev));
      } catch (e) {
        setError((e as Error)?.message ?? "Failed to load saved scenario");
      } finally {
        setLoadingSavedId(null);
      }
    },
    [fetchSavedDetail],
  );

  const handleRerunSaved = React.useCallback(
    async (scenarioId: string) => {
      setError(null);
      setRerunningSavedId(scenarioId);
      try {
        const detail = await fetchSavedDetail(scenarioId);
        const inputs = detail.inputs ?? {};
        const perturbation = inputs.perturbation;
        const presetEventId = inputs.presetEventId;
        const horizonDays = inputs.horizonDays ?? 21;
        skipNextPreviewRef.current = true;
        setBuilder((prev) => builderFromSavedDetail(detail, prev));
        const res = (await runScenario.mutateAsync({
          data: {
            name: detail.scenario?.name ?? "Re-run scenario",
            kind: detail.kind ?? "custom",
            summary: detail.scenario?.description ?? undefined,
            horizonDays,
            ...(presetEventId ? { presetEventId } : {}),
            ...(perturbation ? { perturbation } : {}),
            generateBrief: true,
          } as Parameters<typeof runScenario.mutateAsync>[0]["data"],
        })) as ScenarioResult;
        skipNextPreviewRef.current = true;
        setPreviousResult(detail);
        setResult(res);
        await queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
      } catch (e) {
        setError((e as Error)?.message ?? "Re-run failed");
      } finally {
        setRerunningSavedId(null);
      }
    },
    [fetchSavedDetail, runScenario, queryClient],
  );

  const handleRenameSaved = React.useCallback(
    async (scenarioId: string, nextName: string) => {
      setError(null);
      const trimmed = nextName.trim();
      if (trimmed.length === 0) {
        setError("Scenario name cannot be empty.");
        return false;
      }
      try {
        await updateScenario.mutateAsync({
          scenarioId,
          data: { name: trimmed },
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() }),
          queryClient.invalidateQueries({
            queryKey: getGetScenarioQueryKey(scenarioId),
          }),
        ]);
        setRenamingId(null);
        return true;
      } catch (e) {
        setError((e as Error)?.message ?? "Rename failed");
        return false;
      }
    },
    [updateScenario, queryClient],
  );

  const handleConfirmDelete = React.useCallback(async () => {
    if (!pendingDelete) return;
    setError(null);
    const id = pendingDelete.id;
    try {
      await deleteScenario.mutateAsync({ scenarioId: id });
      await queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
      queryClient.removeQueries({ queryKey: getGetScenarioQueryKey(id) });
      setPendingDelete(null);
      // If the deleted scenario was the one currently displayed, clear the
      // output so the operator isn't staring at a stale result.
      if (result?.scenario?.id === id) {
        setResult(null);
        setSavedAt(null);
      }
    } catch (e) {
      setError((e as Error)?.message ?? "Delete failed");
    }
  }, [pendingDelete, deleteScenario, queryClient, result]);

  const handleSaveCustom = React.useCallback(async () => {
    setError(null);
    setPreviousResult(null);
    if (!builder.name.trim()) {
      setError("Name your scenario before saving.");
      return;
    }
    if (builder.affectedNodes.length === 0 && builder.zoneIds.length === 0) {
      setError("Select at least one affected node or theater zone.");
      return;
    }
    const perturbation: Perturbation = {
      affectedNodes: builder.affectedNodes,
      populationMultiplier: builder.populationMultiplier,
      encounterMultiplier: builder.encounterMultiplier,
      wasteMultiplier: builder.wasteMultiplier,
      routeDelayDays: builder.routeDelayDays,
      routeReliabilityDelta: builder.routeReliabilityDelta,
    };
    try {
      const res = (await runScenario.mutateAsync({
        data: {
          name: builder.name.trim(),
          kind: builder.kind,
          summary: builder.summary.trim() || undefined,
          horizonDays: builder.horizonDays,
          perturbation,
          zoneIds: builder.zoneIds.length > 0 ? builder.zoneIds : undefined,
          generateBrief: true,
        } as Parameters<typeof runScenario.mutateAsync>[0]["data"],
      })) as ScenarioResult;
      skipNextPreviewRef.current = true;
      setResult(res);
      setSavedAt(Date.now());
      await queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
    } catch (e) {
      setError((e as Error)?.message ?? "Scenario save failed");
    }
  }, [builder, runScenario, queryClient]);

  // ---------- Live preview ----------
  // Whenever the builder changes, debounce-call the preview endpoint so the
  // operator can see the simulation update without clicking a button.
  // We skip the call when the change came from a programmatic load/re-run.
  const previewMutate = previewScenario.mutateAsync;
  React.useEffect(() => {
    if (skipNextPreviewRef.current) {
      skipNextPreviewRef.current = false;
      return;
    }
    if (builder.affectedNodes.length === 0 || !builder.name.trim()) {
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      const perturbation: Perturbation = {
        affectedNodes: builder.affectedNodes,
        populationMultiplier: builder.populationMultiplier,
        encounterMultiplier: builder.encounterMultiplier,
        wasteMultiplier: builder.wasteMultiplier,
        routeDelayDays: builder.routeDelayDays,
        routeReliabilityDelta: builder.routeReliabilityDelta,
      };
      try {
        const res = (await previewMutate({
          data: {
            name: builder.name.trim(),
            kind: builder.kind,
            summary: builder.summary.trim() || undefined,
            horizonDays: builder.horizonDays,
            perturbation,
            generateBrief: false,
          } as Parameters<typeof previewMutate>[0]["data"],
        })) as ScenarioResult;
        if (!cancelled) {
          setResult(res);
          setSavedAt(null);
          setPreviousResult(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error)?.message ?? "Preview failed");
        }
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [builder, previewMutate]);

  return (
    <div className="h-full flex p-4 gap-4 bg-background text-foreground overflow-hidden">
      {/* Left Rail - Presets + Custom Builder */}
      <div className="w-[340px] flex flex-col gap-4 shrink-0 overflow-y-auto pr-1">
        <div className="text-sm font-bold uppercase tracking-wider text-muted-foreground px-1">
          Preset Scenarios
        </div>

        {presetsLoading ? (
          <Skeleton className="h-48" />
        ) : (
          presets?.map((preset) => (
            <PresetCard
              key={preset.id}
              preset={preset}
              isRunning={
                runScenario.isPending &&
                runScenario.variables?.data?.presetEventId === preset.id
              }
              disabled={runScenario.isPending}
              onRun={() => handleRunPreset(preset)}
            />
          ))
        )}

        <div className="text-sm font-bold uppercase tracking-wider text-muted-foreground px-1 pt-2 flex items-center gap-2">
          <Wrench className="h-3.5 w-3.5" /> Custom Builder
        </div>
        <CustomBuilder
          state={builder}
          onChange={setBuilder}
          nodes={focusableNodes}
          zones={zones as TheaterZone[]}
          isSaving={
            runScenario.isPending &&
            !runScenario.variables?.data?.presetEventId
          }
          isRunning={
            runScenario.isPending &&
            !runScenario.variables?.data?.presetEventId
          }
          isPreviewing={previewScenario.isPending}
          savedAt={savedAt}
          onSave={handleSaveCustom}
          onRun={() => {}}
        />
      </div>

      {/* Center - Output Panel */}
      <div className="flex-1 flex flex-col gap-3 min-w-0 overflow-hidden">
        <div className="flex items-center justify-between px-1 gap-2">
          <div className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            Simulation Output
            {previewScenario.isPending ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-normal normal-case tracking-normal text-primary">
                <Loader2 className="h-3 w-3 animate-spin" />
                live preview…
              </span>
            ) : null}
          </div>
          {result ? <AiBadge label="Powered by AI" /> : null}
        </div>
        <Card className="flex-1 bg-card/30 border-border overflow-hidden flex flex-col">
          <CardContent className="p-0 flex-1 flex flex-col overflow-hidden">
            {error ? (
              <div className="m-4 px-3 py-2 rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-xs flex items-center justify-between gap-2">
                <span>{error}</span>
                <button
                  onClick={() => setError(null)}
                  className="text-destructive hover:text-destructive/80"
                  aria-label="Dismiss"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : null}
            {(runScenario.isPending || previewScenario.isPending) && !result ? (
              <RunningPlaceholder />
            ) : result ? (
              <ResultPanel result={result} previous={previousResult} />
            ) : (
              <EmptyPlaceholder />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right Rail - Saved Runs */}
      <div className="w-[280px] flex flex-col gap-3 shrink-0 overflow-y-auto pr-1">
        <div className="text-sm font-bold uppercase tracking-wider text-muted-foreground px-1">
          Saved Runs
        </div>
        {scenariosLoading ? (
          <Skeleton className="h-48" />
        ) : (
          scenarios?.map((scenario) => {
            const isLoadingThis = loadingSavedId === scenario.id;
            const isRerunningThis = rerunningSavedId === scenario.id;
            const isDeletingThis =
              deleteScenario.isPending && pendingDelete?.id === scenario.id;
            const anyBusy =
              !!loadingSavedId ||
              !!rerunningSavedId ||
              runScenario.isPending ||
              deleteScenario.isPending;
            return (
              <SavedRunCard
                key={scenario.id}
                scenario={scenario}
                isLoading={isLoadingThis}
                isRerunning={isRerunningThis}
                isDeleting={isDeletingThis}
                disabled={anyBusy}
                isRenaming={renamingId === scenario.id}
                isSavingRename={
                  updateScenario.isPending &&
                  updateScenario.variables?.scenarioId === scenario.id
                }
                onLoad={() => handleLoadSaved(scenario.id)}
                onRerun={() => handleRerunSaved(scenario.id)}
                onStartRename={() => setRenamingId(scenario.id)}
                onCancelRename={() => setRenamingId(null)}
                onSubmitRename={(name) => handleRenameSaved(scenario.id, name)}
                onRequestDelete={() => setPendingDelete(scenario)}
              />
            );
          })
        )}
        {scenarios && scenarios.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-4">
            No saved scenarios
          </div>
        ) : null}
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteScenario.isPending) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete saved scenario?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? (
                <>
                  This will permanently remove{" "}
                  <span className="font-medium text-foreground">
                    “{pendingDelete.name}”
                  </span>{" "}
                  and any recommendations it produced. This cannot be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteScenario.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirmDelete();
              }}
              disabled={deleteScenario.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteScenario.isPending ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Deleting…
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------- Saved run card (right rail) ----------

function SavedRunCard({
  scenario,
  isLoading,
  isRerunning,
  isDeleting,
  disabled,
  isRenaming,
  isSavingRename,
  onLoad,
  onRerun,
  onStartRename,
  onCancelRename,
  onSubmitRename,
  onRequestDelete,
}: {
  scenario: SavedScenario;
  isLoading: boolean;
  isRerunning: boolean;
  isDeleting: boolean;
  disabled: boolean;
  isRenaming: boolean;
  isSavingRename: boolean;
  onLoad: () => void;
  onRerun: () => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onSubmitRename: (name: string) => Promise<boolean> | boolean;
  onRequestDelete: () => void;
}) {
  const [draftName, setDraftName] = React.useState(scenario.name);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Reset the draft each time we enter rename mode so the input mirrors
  // the latest persisted name (in case the card was just re-fetched).
  React.useEffect(() => {
    if (isRenaming) {
      setDraftName(scenario.name);
      // Focus + select on the next tick so the input is ready.
      window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }
  }, [isRenaming, scenario.name]);

  const submit = async () => {
    if (draftName.trim() === scenario.name.trim()) {
      onCancelRename();
      return;
    }
    await onSubmitRename(draftName);
  };

  return (
    <Card className="bg-card/50 border-border hover:border-primary/40 transition-colors">
      <CardContent className="p-3">
        {isRenaming ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="flex items-center gap-1 mb-1"
          >
            <Input
              ref={inputRef}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  onCancelRename();
                }
              }}
              disabled={isSavingRename}
              maxLength={200}
              className="h-7 text-sm flex-1"
              aria-label="Scenario name"
            />
            <Button
              type="submit"
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              disabled={isSavingRename || draftName.trim().length === 0}
              title="Save name"
              aria-label="Save name"
            >
              {isSavingRename ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              onClick={onCancelRename}
              disabled={isSavingRename}
              title="Cancel rename"
              aria-label="Cancel rename"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </form>
        ) : (
          <button
            type="button"
            onClick={onLoad}
            disabled={disabled}
            className="w-full text-left disabled:opacity-70 disabled:cursor-not-allowed"
            title="Load this scenario back into the builder"
          >
            <div className="font-medium text-sm mb-1 line-clamp-2">
              {scenario.name}
            </div>
          </button>
        )}
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{new Date(scenario.createdAt).toLocaleDateString()}</span>
          <span className="uppercase">{scenario.status}</span>
        </div>
        <div className="mt-2 flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || isRenaming}
            onClick={onLoad}
            className="h-7 px-2 text-[11px] flex-1"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Loading…
              </>
            ) : (
              <>
                <Upload className="h-3 w-3 mr-1" />
                Load
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || isRenaming}
            onClick={onRerun}
            className="h-7 px-2 text-[11px] flex-1 border-primary/40 text-primary hover:bg-primary/10"
          >
            {isRerunning ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Re-running…
              </>
            ) : (
              <>
                <RotateCw className="h-3 w-3 mr-1" />
                Re-run
              </>
            )}
          </Button>
        </div>
        <div className="mt-1 flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || isRenaming}
            onClick={onStartRename}
            className="h-7 px-2 text-[11px] flex-1 text-muted-foreground hover:text-foreground"
            title="Rename this scenario"
          >
            <Pencil className="h-3 w-3 mr-1" />
            Rename
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || isRenaming}
            onClick={onRequestDelete}
            className="h-7 px-2 text-[11px] flex-1 text-muted-foreground hover:text-destructive"
            title="Delete this scenario"
          >
            {isDeleting ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Deleting…
              </>
            ) : (
              <>
                <Trash2 className="h-3 w-3 mr-1" />
                Delete
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Preset card ----------

function PresetCard({
  preset,
  onRun,
  isRunning,
  disabled,
}: {
  preset: PresetEvent;
  onRun: () => void;
  isRunning: boolean;
  disabled: boolean;
}) {
  const kind = (preset as PresetEvent & { kind?: string }).kind;
  return (
    <Card className="bg-card/50 border-border group hover:border-primary/50 transition-colors">
      <CardContent className="p-3">
        <div className="flex justify-between items-start mb-1.5 gap-2">
          <h3 className="font-bold text-sm leading-tight">{preset.label}</h3>
          <Badge
            variant="outline"
            className={cn("text-[10px] shrink-0", severityClass(preset.severity))}
          >
            {preset.severity}
          </Badge>
        </div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
          {kindLabel(kind)}
        </div>
        <p className="text-xs text-muted-foreground line-clamp-3 mb-3">
          {preset.description}
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={onRun}
          className="w-full border-primary/50 text-primary hover:bg-primary/10"
        >
          {isRunning ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Running…
            </>
          ) : (
            <>
              <PlayCircle className="h-4 w-4 mr-2" /> Run Scenario
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------- Custom builder ----------

function CustomBuilder({
  state,
  onChange,
  nodes,
  zones,
  onSave,
  onRun,
  isSaving,
  isRunning,
  isPreviewing,
  savedAt,
}: {
  state: CustomBuilderState;
  onChange: (next: CustomBuilderState) => void;
  nodes: NetworkNode[];
  zones: TheaterZone[];
  onSave: () => void;
  onRun: () => void;
  isSaving: boolean;
  isRunning: boolean;
  isPreviewing: boolean;
  savedAt: number | null;
}) {
  const update = <K extends keyof CustomBuilderState>(
    key: K,
    value: CustomBuilderState[K],
  ) => onChange({ ...state, [key]: value });

  const toggleNode = (id: string) => {
    const has = state.affectedNodes.includes(id);
    update(
      "affectedNodes",
      has ? state.affectedNodes.filter((n) => n !== id) : [...state.affectedNodes, id],
    );
  };

  const toggleZone = (id: string) => {
    const has = state.zoneIds.includes(id);
    update(
      "zoneIds",
      has ? state.zoneIds.filter((z) => z !== id) : [...state.zoneIds, id],
    );
  };

  return (
    <Card className="bg-card/50 border-border">
      <CardContent className="p-3 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="builder-name" className="text-xs">
            Name
          </Label>
          <Input
            id="builder-name"
            value={state.name}
            onChange={(e) => update("name", e.target.value)}
            className="h-8 text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Kind</Label>
          <Select value={state.kind} onValueChange={(v) => update("kind", v)}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KIND_OPTIONS.map((k) => (
                <SelectItem key={k.value} value={k.value}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">
            Affected Nodes ({state.affectedNodes.length})
          </Label>
          <div className="max-h-32 overflow-y-auto rounded-md border border-border bg-background/50 p-1.5 space-y-0.5">
            {nodes.length === 0 ? (
              <div className="text-[11px] text-muted-foreground px-1 py-1">
                Loading nodes…
              </div>
            ) : (
              nodes.map((n) => {
                const checked = state.affectedNodes.includes(n.id);
                return (
                  <button
                    type="button"
                    key={n.id}
                    onClick={() => toggleNode(n.id)}
                    className={cn(
                      "w-full text-left px-1.5 py-1 rounded text-[11px] flex items-center justify-between gap-2",
                      checked
                        ? "bg-primary/15 text-primary"
                        : "hover:bg-muted/40 text-muted-foreground",
                    )}
                  >
                    <span className="truncate">{n.name}</span>
                    <span className="shrink-0 text-[10px] uppercase opacity-60">
                      {n.type}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">
            Theater Zones ({state.zoneIds.length})
          </Label>
          <div className="max-h-28 overflow-y-auto rounded-md border border-border bg-background/50 p-1.5 space-y-0.5">
            {zones.length === 0 ? (
              <div className="text-[11px] text-muted-foreground px-1 py-1 italic">
                Draw zones on the Network Map to make them selectable here.
              </div>
            ) : (
              zones.map((z) => {
                const checked = state.zoneIds.includes(z.id);
                const c =
                  ZONE_SEVERITY_COLOR[z.severity] ?? ZONE_SEVERITY_COLOR.WATCH;
                return (
                  <button
                    type="button"
                    key={z.id}
                    onClick={() => toggleZone(z.id)}
                    className={cn(
                      "w-full text-left px-1.5 py-1 rounded text-[11px] flex items-center justify-between gap-2",
                      checked
                        ? "bg-primary/15 text-primary"
                        : "hover:bg-muted/40 text-muted-foreground",
                    )}
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="inline-block h-2 w-2 rounded-sm border shrink-0"
                        style={{
                          backgroundColor: `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.5)`,
                          borderColor: `rgb(${c[0]}, ${c[1]}, ${c[2]})`,
                        }}
                      />
                      <span className="truncate">{z.name}</span>
                    </span>
                    <span className="shrink-0 text-[9px] font-mono uppercase opacity-70">
                      {z.severity}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <SliderField
          label="Population Multiplier"
          min={0.5}
          max={3}
          step={0.05}
          value={state.populationMultiplier}
          onChange={(v) => update("populationMultiplier", v)}
        />
        <SliderField
          label="Encounter Multiplier"
          min={0.5}
          max={4}
          step={0.05}
          value={state.encounterMultiplier}
          onChange={(v) => update("encounterMultiplier", v)}
        />
        <SliderField
          label="Waste Multiplier"
          min={1}
          max={3}
          step={0.05}
          value={state.wasteMultiplier}
          onChange={(v) => update("wasteMultiplier", v)}
        />
        <SliderField
          label="Route Delay (days)"
          min={0}
          max={14}
          step={1}
          value={state.routeDelayDays}
          onChange={(v) => update("routeDelayDays", v)}
          format={(v) => `${v.toFixed(0)}d`}
        />
        <SliderField
          label="Route Reliability Δ"
          min={-0.7}
          max={0.2}
          step={0.05}
          value={state.routeReliabilityDelta}
          onChange={(v) => update("routeReliabilityDelta", v)}
          format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`}
        />
        <SliderField
          label="Horizon (days)"
          min={5}
          max={45}
          step={1}
          value={state.horizonDays}
          onChange={(v) => update("horizonDays", v)}
          format={(v) => `${v.toFixed(0)}d`}
        />

        <div className="space-y-1.5">
          <Label htmlFor="builder-summary" className="text-xs">
            Summary (optional)
          </Label>
          <Textarea
            id="builder-summary"
            value={state.summary}
            onChange={(e) => update("summary", e.target.value)}
            rows={2}
            className="text-xs"
          />
        </div>

        <Button
          size="sm"
          disabled={isSaving || state.affectedNodes.length === 0 || !state.name.trim()}
          onClick={onSave}
          className="w-full"
        >
          {isSaving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" /> Save Custom Scenario
            </>
          )}
        </Button>
        <div className="text-[10px] text-muted-foreground text-center px-1 leading-tight">
          {isPreviewing ? (
            <span className="inline-flex items-center gap-1 text-primary">
              <Loader2 className="h-3 w-3 animate-spin" /> Updating live preview…
            </span>
          ) : savedAt ? (
            <span className="text-emerald-400">
              Saved to library · {new Date(savedAt).toLocaleTimeString()}
            </span>
          ) : state.affectedNodes.length === 0 ? (
            "Select at least one affected node to see a live preview."
          ) : (
            "Adjust any parameter — the simulation updates automatically."
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SliderField({
  label,
  min,
  max,
  step,
  value,
  onChange,
  format,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-[11px] text-muted-foreground">{label}</Label>
        <span className="text-[11px] font-mono text-foreground">
          {format ? format(value) : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full bg-muted accent-primary cursor-pointer"
      />
    </div>
  );
}

// ---------- Output panel ----------

function EmptyPlaceholder() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-3 text-muted-foreground">
      <ShieldAlert className="h-14 w-14 text-muted opacity-60" />
      <div className="text-sm font-medium">No scenario loaded</div>
      <div className="text-xs max-w-xs">
        Load a preset on the left or build a custom scenario to project a 21-day
        sustainment forecast.
      </div>
    </div>
  );
}

function RunningPlaceholder() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-3 text-muted-foreground">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
      <div className="text-sm font-medium">Running simulation…</div>
      <div className="text-xs max-w-xs">
        Modeling perturbation across nodes and generating COA brief.
      </div>
    </div>
  );
}

type DiffNodeRow = ScenarioResult["perNode"][number] & { __removed?: boolean };
type DiffItemRow = ScenarioResult["perItem"][number] & { __removed?: boolean };

function ResultPanel({
  result,
  previous,
}: {
  result: ScenarioResult;
  previous?: ScenarioResult | null;
}) {
  const summary = result.summary;
  const peakNode = summary.peakRiskNodeName ?? summary.peakRiskNodeId ?? "—";

  const prevNodeMap = React.useMemo(() => {
    if (!previous) return null;
    return new Map(previous.perNode.map((n) => [n.nodeId, n] as const));
  }, [previous]);

  const prevItemMap = React.useMemo(() => {
    if (!previous) return null;
    return new Map(previous.perItem.map((i) => [i.itemId, i] as const));
  }, [previous]);

  const perNodeData = React.useMemo<DiffNodeRow[]>(() => {
    if (!previous) return result.perNode as DiffNodeRow[];
    const currentIds = new Set(result.perNode.map((n) => n.nodeId));
    const removed = previous.perNode
      .filter((n) => !currentIds.has(n.nodeId))
      .map((n) => ({ ...n, __removed: true }) as DiffNodeRow);
    return [...(result.perNode as DiffNodeRow[]), ...removed];
  }, [result.perNode, previous]);

  const perItemData = React.useMemo<DiffItemRow[]>(() => {
    if (!previous) return result.perItem as DiffItemRow[];
    const currentIds = new Set(result.perItem.map((i) => i.itemId));
    const removed = previous.perItem
      .filter((i) => !currentIds.has(i.itemId))
      .map((i) => ({ ...i, __removed: true }) as DiffItemRow);
    return [...(result.perItem as DiffItemRow[]), ...removed];
  }, [result.perItem, previous]);

  const nodeDiffCounts = React.useMemo(() => {
    if (!prevNodeMap) return null;
    const added = result.perNode.filter((n) => !prevNodeMap.has(n.nodeId)).length;
    const removed = perNodeData.filter((n) => n.__removed).length;
    return { added, removed };
  }, [result.perNode, perNodeData, prevNodeMap]);

  const itemDiffCounts = React.useMemo(() => {
    if (!prevItemMap) return null;
    const added = result.perItem.filter((i) => !prevItemMap.has(i.itemId)).length;
    const removed = perItemData.filter((i) => i.__removed).length;
    return { added, removed };
  }, [result.perItem, perItemData, prevItemMap]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <h3 className="text-base font-bold">{result.scenario.name}</h3>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {kindLabel((result as ScenarioResult & { kind?: string }).kind)}
          </span>
        </div>
        {result.scenario.description ? (
          <p className="text-xs text-muted-foreground mb-3">
            {result.scenario.description}
          </p>
        ) : null}

        {previous ? <RerunDiffBar current={result} previous={previous} /> : null}

        <div className="grid grid-cols-4 gap-2">
          <KpiTile
            label="DOS Before"
            value={`${summary.networkDaysOfSupplyBefore?.toFixed(1) ?? "—"}d`}
          />
          <KpiTile
            label="DOS After"
            value={`${summary.networkDaysOfSupplyAfter?.toFixed(1) ?? "—"}d`}
            tone={
              (summary.networkDaysOfSupplyAfter ?? 0) <
              (summary.networkDaysOfSupplyBefore ?? 0)
                ? "warn"
                : "ok"
            }
          />
          <KpiTile
            label="Shortage Events"
            value={String(summary.estimatedShortageEvents)}
            tone={summary.estimatedShortageEvents > 0 ? "warn" : "ok"}
          />
          <KpiTile label="Peak Risk Node" value={peakNode} small />
        </div>
      </div>

      {result.narrative ? (
        <section>
          <SectionHeader title="COA Brief" badge={<AiBadge label="Powered by AI" />} />
          <div className="rounded-md border border-border bg-background/50 p-3 text-xs whitespace-pre-wrap leading-relaxed">
            {result.narrative}
          </div>
        </section>
      ) : null}

      <section>
        <SectionHeader title="Network Risk Timeline" icon={<Activity className="h-3.5 w-3.5" />} />
        <div className="rounded-md border border-border bg-background/30 p-2 h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={result.timeline} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} />
              <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                  fontSize: 11,
                }}
              />
              <Line
                type="monotone"
                dataKey="networkDaysOfSupply"
                name="Network DOS"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="openShortages"
                name="Open Shortages"
                stroke="hsl(var(--destructive))"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="demandIndex"
                name="Demand Index"
                stroke="hsl(var(--chart-3, 220 70% 50%))"
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <SectionHeader
          title={`Per-Node Impacts (${result.perNode.length})`}
          badge={
            nodeDiffCounts &&
            (nodeDiffCounts.added > 0 || nodeDiffCounts.removed > 0) ? (
              <span
                className="text-[10px] font-mono text-muted-foreground"
                data-testid="per-node-diff-counts"
              >
                {nodeDiffCounts.added > 0 ? (
                  <span className="text-emerald-400">+{nodeDiffCounts.added} new</span>
                ) : null}
                {nodeDiffCounts.added > 0 && nodeDiffCounts.removed > 0 ? (
                  <span className="mx-1">·</span>
                ) : null}
                {nodeDiffCounts.removed > 0 ? (
                  <span className="text-muted-foreground">
                    -{nodeDiffCounts.removed} removed
                  </span>
                ) : null}
              </span>
            ) : undefined
          }
        />
        <div className="rounded-md border border-border bg-background/30">
          <SortableTable
            data={perNodeData}
            rowKey={(r) => `${r.__removed ? "rm-" : ""}${r.nodeId}`}
            initialSort={{ key: "riskScore", direction: "desc" }}
            columns={
              [
                {
                  key: "nodeName",
                  label: "Node",
                  sortAccessor: (r) => r.nodeName,
                  render: (r) => (
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className={cn(
                          "text-xs font-medium",
                          r.__removed && "line-through text-muted-foreground",
                        )}
                      >
                        {r.nodeName}
                      </span>
                      {prevNodeMap && !r.__removed && !prevNodeMap.has(r.nodeId) ? (
                        <span
                          data-testid={`per-node-new-${r.nodeId}`}
                          className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-semibold"
                        >
                          new
                        </span>
                      ) : null}
                      {r.__removed ? (
                        <span
                          data-testid={`per-node-removed-${r.nodeId}`}
                          className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-muted text-muted-foreground font-semibold"
                        >
                          removed
                        </span>
                      ) : null}
                    </span>
                  ),
                },
                {
                  key: "daysOfSupplyBefore",
                  label: "DOS Before",
                  align: "right",
                  sortAccessor: (r) => r.daysOfSupplyBefore,
                  render: (r) => (
                    <span
                      className={cn(
                        "text-xs font-mono",
                        r.__removed && "line-through text-muted-foreground",
                      )}
                    >
                      {r.daysOfSupplyBefore.toFixed(1)}d
                    </span>
                  ),
                },
                {
                  key: "daysOfSupplyAfter",
                  label: "DOS After",
                  align: "right",
                  sortAccessor: (r) => r.daysOfSupplyAfter,
                  render: (r) => {
                    if (r.__removed) {
                      return (
                        <span className="text-xs font-mono line-through text-muted-foreground">
                          {r.daysOfSupplyAfter.toFixed(1)}d
                        </span>
                      );
                    }
                    const prev = prevNodeMap?.get(r.nodeId);
                    const delta =
                      prev != null
                        ? r.daysOfSupplyAfter - prev.daysOfSupplyAfter
                        : null;
                    const showDelta = delta != null && Math.abs(delta) >= 0.05;
                    return (
                      <span className="inline-flex items-baseline gap-1 justify-end">
                        <span
                          className={cn(
                            "text-xs font-mono",
                            r.daysOfSupplyAfter < r.daysOfSupplyBefore
                              ? "text-amber-400"
                              : "text-muted-foreground",
                          )}
                        >
                          {r.daysOfSupplyAfter.toFixed(1)}d
                        </span>
                        {showDelta ? (
                          <span
                            data-testid={`per-node-dos-delta-${r.nodeId}`}
                            className={cn(
                              "text-[10px] font-mono",
                              delta! > 0 ? "text-emerald-400" : "text-amber-400",
                            )}
                          >
                            ({delta! > 0 ? "+" : ""}
                            {delta!.toFixed(1)}d)
                          </span>
                        ) : null}
                      </span>
                    );
                  },
                },
                {
                  key: "peakShortageDay",
                  label: "Peak Day",
                  align: "right",
                  sortAccessor: (r) => r.peakShortageDay ?? 0,
                  render: (r) => (
                    <span
                      className={cn(
                        "text-xs font-mono",
                        r.__removed && "line-through text-muted-foreground",
                      )}
                    >
                      {r.peakShortageDay != null ? `D+${r.peakShortageDay}` : "—"}
                    </span>
                  ),
                },
                {
                  key: "criticalItemIds",
                  label: "Critical Items",
                  align: "right",
                  sortAccessor: (r) => r.criticalItemIds.length,
                  render: (r) => (
                    <span
                      className={cn(
                        "text-xs font-mono text-muted-foreground",
                        r.__removed && "line-through",
                      )}
                    >
                      {r.criticalItemIds.length}
                    </span>
                  ),
                },
                {
                  key: "riskScore",
                  label: "Risk",
                  align: "right",
                  sortAccessor: (r) => r.riskScore ?? 0,
                  render: (r) => {
                    const score = r.riskScore ?? 0;
                    if (r.__removed) {
                      return (
                        <span className="text-xs font-mono font-semibold line-through text-muted-foreground">
                          {score.toFixed(0)}
                        </span>
                      );
                    }
                    const prev = prevNodeMap?.get(r.nodeId);
                    const prevScore = prev?.riskScore ?? null;
                    const delta = prevScore != null ? score - prevScore : null;
                    const showDelta = delta != null && Math.abs(delta) >= 0.5;
                    return (
                      <span className="inline-flex items-baseline gap-1 justify-end">
                        <span
                          className={cn(
                            "text-xs font-mono font-semibold",
                            score > 60
                              ? "text-destructive"
                              : score > 30
                                ? "text-amber-400"
                                : "text-foreground",
                          )}
                        >
                          {score.toFixed(0)}
                        </span>
                        {showDelta ? (
                          <span
                            data-testid={`per-node-risk-delta-${r.nodeId}`}
                            className={cn(
                              "text-[10px] font-mono",
                              delta! > 0 ? "text-amber-400" : "text-emerald-400",
                            )}
                          >
                            ({delta! > 0 ? "+" : ""}
                            {delta!.toFixed(0)})
                          </span>
                        ) : null}
                      </span>
                    );
                  },
                },
              ] satisfies SortableColumn<DiffNodeRow>[]
            }
          />
        </div>
      </section>

      <section>
        <SectionHeader
          title={`Per-Item Impacts (${result.perItem.length})`}
          badge={
            itemDiffCounts &&
            (itemDiffCounts.added > 0 || itemDiffCounts.removed > 0) ? (
              <span
                className="text-[10px] font-mono text-muted-foreground"
                data-testid="per-item-diff-counts"
              >
                {itemDiffCounts.added > 0 ? (
                  <span className="text-emerald-400">+{itemDiffCounts.added} new</span>
                ) : null}
                {itemDiffCounts.added > 0 && itemDiffCounts.removed > 0 ? (
                  <span className="mx-1">·</span>
                ) : null}
                {itemDiffCounts.removed > 0 ? (
                  <span className="text-muted-foreground">
                    -{itemDiffCounts.removed} removed
                  </span>
                ) : null}
              </span>
            ) : undefined
          }
        />
        <div className="rounded-md border border-border bg-background/30">
          <SortableTable
            data={perItemData}
            rowKey={(r) => `${r.__removed ? "rm-" : ""}${r.itemId}`}
            initialSort={{ key: "totalShortfall", direction: "desc" }}
            columns={
              [
                {
                  key: "itemName",
                  label: "Item",
                  sortAccessor: (r) => r.itemName,
                  render: (r) => (
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className={cn(
                          "text-xs font-medium",
                          r.__removed && "line-through text-muted-foreground",
                        )}
                      >
                        {r.itemName}
                      </span>
                      {prevItemMap && !r.__removed && !prevItemMap.has(r.itemId) ? (
                        <span
                          data-testid={`per-item-new-${r.itemId}`}
                          className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-semibold"
                        >
                          new
                        </span>
                      ) : null}
                      {r.__removed ? (
                        <span
                          data-testid={`per-item-removed-${r.itemId}`}
                          className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-muted text-muted-foreground font-semibold"
                        >
                          removed
                        </span>
                      ) : null}
                    </span>
                  ),
                },
                {
                  key: "peakDemandPerDay",
                  label: "Peak Demand/Day",
                  align: "right",
                  sortAccessor: (r) => r.peakDemandPerDay,
                  render: (r) => (
                    <span
                      className={cn(
                        "text-xs font-mono",
                        r.__removed && "line-through text-muted-foreground",
                      )}
                    >
                      {r.peakDemandPerDay.toFixed(2)}
                    </span>
                  ),
                },
                {
                  key: "totalShortfall",
                  label: "Shortfall",
                  align: "right",
                  sortAccessor: (r) => r.totalShortfall,
                  render: (r) => {
                    if (r.__removed) {
                      return (
                        <span className="text-xs font-mono line-through text-muted-foreground">
                          {r.totalShortfall.toLocaleString()}
                        </span>
                      );
                    }
                    const prev = prevItemMap?.get(r.itemId);
                    const delta =
                      prev != null ? r.totalShortfall - prev.totalShortfall : null;
                    const showDelta = delta != null && delta !== 0;
                    return (
                      <span className="inline-flex items-baseline gap-1 justify-end">
                        <span
                          className={cn(
                            "text-xs font-mono",
                            r.totalShortfall > 0
                              ? "text-amber-400"
                              : "text-muted-foreground",
                          )}
                        >
                          {r.totalShortfall.toLocaleString()}
                        </span>
                        {showDelta ? (
                          <span
                            data-testid={`per-item-shortfall-delta-${r.itemId}`}
                            className={cn(
                              "text-[10px] font-mono",
                              delta! > 0 ? "text-amber-400" : "text-emerald-400",
                            )}
                          >
                            ({delta! > 0 ? "+" : ""}
                            {delta!.toLocaleString()})
                          </span>
                        ) : null}
                      </span>
                    );
                  },
                },
                {
                  key: "recommendedReorder",
                  label: "Reorder",
                  align: "right",
                  sortAccessor: (r) => r.recommendedReorder,
                  render: (r) => (
                    <span
                      className={cn(
                        "text-xs font-mono text-primary",
                        r.__removed && "line-through text-muted-foreground",
                      )}
                    >
                      {r.recommendedReorder.toLocaleString()}
                    </span>
                  ),
                },
              ] satisfies SortableColumn<DiffItemRow>[]
            }
          />
        </div>
      </section>

      {result.recommendations.length > 0 ? (
        <section>
          <RecommendationCards recommendations={result.recommendations} />
        </section>
      ) : null}
    </div>
  );
}

function priorityClass(priority: string | undefined): string {
  const p = (priority ?? "").toUpperCase();
  if (p === "FLASH")
    return "bg-destructive/15 text-destructive border-destructive/40";
  if (p === "URGENT")
    return "bg-amber-500/15 text-amber-400 border-amber-500/40";
  return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
}

function kindClass(kind: string | undefined): string {
  const k = (kind ?? "").toUpperCase();
  if (k === "ESCALATE")
    return "bg-destructive/10 text-destructive border-destructive/30";
  if (k === "REROUTE")
    return "bg-amber-500/10 text-amber-400 border-amber-500/30";
  if (k === "SUBSTITUTE")
    return "bg-sky-500/10 text-sky-400 border-sky-500/30";
  return "bg-primary/10 text-primary border-primary/30";
}

const PRIORITY_FILTERS: Array<{ value: string; label: string }> = [
  { value: "FLASH", label: "FLASH" },
  { value: "URGENT", label: "URGENT" },
  { value: "ROUTINE", label: "ROUTINE" },
];

type RecSortValue = "priority" | "eta" | "cost" | "quantity";

const REC_SORT_OPTIONS: Array<{ value: RecSortValue; label: string }> = [
  { value: "priority", label: "Priority (default)" },
  { value: "eta", label: "ETA (fastest first)" },
  { value: "cost", label: "Cost (lowest first)" },
  { value: "quantity", label: "Quantity (largest first)" },
];

function sortRecommendations(
  recs: Recommendation[],
  sortBy: RecSortValue,
): Recommendation[] {
  if (sortBy === "priority") return recs;
  const arr = [...recs];
  arr.sort((a, b) => {
    if (sortBy === "eta") {
      return (a.etaDays ?? Infinity) - (b.etaDays ?? Infinity);
    }
    if (sortBy === "cost") {
      const aCost = typeof a.estimatedCost === "number" ? a.estimatedCost : Infinity;
      const bCost = typeof b.estimatedCost === "number" ? b.estimatedCost : Infinity;
      return aCost - bCost;
    }
    // quantity: largest first
    return (b.quantity ?? 0) - (a.quantity ?? 0);
  });
  return arr;
}
function RecommendationCards({
  recommendations,
}: {
  recommendations: Recommendation[];
}) {
  const promote = usePromoteRecommendationToOrder();
  const { data: suppliers } = useListSuppliers();
  const { toast } = useToast();
  const [promotedById, setPromotedById] = React.useState<
    Record<string, { orderId: string; orderNo: string }>
  >({});
  const [errorById, setErrorById] = React.useState<Record<string, string>>({});
  const [editing, setEditing] = React.useState<Recommendation | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [batchRunningIds, setBatchRunningIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [batchProgress, setBatchProgress] = React.useState<{
    done: number;
    total: number;
    succeeded: number;
    failed: number;
  } | null>(null);
  const [batchCancelled, setBatchCancelled] = React.useState(false);
  const [batchCancelRequested, setBatchCancelRequested] = React.useState(false);
  const cancelRequestedRef = React.useRef(false);
  const isBatchRunning = batchRunningIds.size > 0;
  const showProgressSummary = !isBatchRunning && batchProgress !== null;

  const [priorityFilter, setPriorityFilter] = React.useState<Set<string>>(
    new Set(),
  );
  const [searchQuery, setSearchQuery] = React.useState("");
  const [hidePromoted, setHidePromoted] = React.useState(false);
  const [sortBy, setSortBy] = React.useState<RecSortValue>("priority");

  const togglePriority = (value: string) => {
    setPriorityFilter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const clearFilters = () => {
    setPriorityFilter(new Set());
    setSearchQuery("");
    setHidePromoted(false);
  };

  const handleConfirm = async (
    rec: Recommendation,
    overrides: PromoteOverrides,
  ) => {
    setErrorById((prev) => ({ ...prev, [rec.id]: "" }));
    try {
      const res = await promote.mutateAsync({
        recommendationId: rec.id,
        data: {
          quantity: overrides.quantity,
          supplierId: overrides.supplierId,
          etaDays: overrides.etaDays,
          priority: overrides.priority,
        },
      });
      const order = res as { id?: string; orderNo?: string } | undefined;
      setPromotedById((prev) => ({
        ...prev,
        [rec.id]: {
          orderId: order?.id ?? "promoted",
          orderNo: order?.orderNo ?? order?.id ?? "PROMOTED",
        },
      }));
      setEditing(null);
    } catch (e) {
      setErrorById((prev) => ({
        ...prev,
        [rec.id]: (e as Error)?.message ?? "Promote failed",
      }));
    }
  };

  const filtered = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matched = recommendations.filter((r) => {
      if (priorityFilter.size > 0) {
        const p = (r.priority ?? "").toUpperCase();
        if (!priorityFilter.has(p)) return false;
      }
      if (q) {
        const haystack = [
          r.itemName,
          r.itemId,
          r.nodeName,
          r.nodeId,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (hidePromoted) {
        const isPromoted = !!r.promotedOrderId || !!promotedById[r.id];
        if (isPromoted) return false;
      }
      return true;
    });
    return sortRecommendations(matched, sortBy);
  }, [recommendations, priorityFilter, searchQuery, hidePromoted, promotedById, sortBy]);

  // Promotable = open (not yet promoted) recs from the full list.
  // Used for selection pruning and for the promote pipeline.
  const promotableIds = React.useMemo(() => {
    return recommendations
      .filter((r) => !r.promotedOrderId && !promotedById[r.id])
      .map((r) => r.id);
  }, [recommendations, promotedById]);

  // "Select all open" respects the active filter and only selects what's visible.
  const visiblePromotableIds = React.useMemo(() => {
    return filtered
      .filter((r) => !r.promotedOrderId && !promotedById[r.id])
      .map((r) => r.id);
  }, [filtered, promotedById]);

  // Drop selections that are no longer promotable (e.g. after promotion).
  React.useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const allowed = new Set(promotableIds);
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (allowed.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [promotableIds]);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllOpen = () => {
    setSelectedIds(new Set(visiblePromotableIds));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const promoteOne = async (recId: string) => {
    setErrorById((prev) => ({ ...prev, [recId]: "" }));
    try {
      const res = await promote.mutateAsync({
        recommendationId: recId,
        data: {},
      });
      const order = res as { id?: string; orderNo?: string } | undefined;
      setPromotedById((prev) => ({
        ...prev,
        [recId]: {
          orderId: order?.id ?? "promoted",
          orderNo: order?.orderNo ?? order?.id ?? "PROMOTED",
        },
      }));
      return true;
    } catch (e) {
      setErrorById((prev) => ({
        ...prev,
        [recId]: (e as Error)?.message ?? "Promote failed",
      }));
      return false;
    }
  };

  const handleBulkPromote = async () => {
    const promotableSet = new Set(promotableIds);
    const ids = Array.from(selectedIds).filter((id) => promotableSet.has(id));
    if (ids.length === 0) return;
    const CONCURRENCY = 4;
    cancelRequestedRef.current = false;
    setBatchCancelRequested(false);
    setBatchCancelled(false);
    let succeeded = 0;
    let failed = 0;
    let done = 0;
    setBatchProgress({ done: 0, total: ids.length, succeeded: 0, failed: 0 });

    let cursor = 0;
    const runOne = async (id: string) => {
      setBatchRunningIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      const ok = await promoteOne(id);
      setBatchRunningIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (ok) succeeded += 1;
      else failed += 1;
      done += 1;
      setBatchProgress({
        done,
        total: ids.length,
        succeeded,
        failed,
      });
      if (ok) {
        setSelectedIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    };

    const worker = async () => {
      while (true) {
        if (cancelRequestedRef.current) return;
        const i = cursor;
        cursor += 1;
        if (i >= ids.length) return;
        await runOne(ids[i]);
      }
    };

    const workerCount = Math.min(CONCURRENCY, ids.length);
    const workers: Promise<void>[] = [];
    for (let i = 0; i < workerCount; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
    setBatchRunningIds(new Set());
    const wasCancelled = cancelRequestedRef.current;
    if (wasCancelled) {
      setBatchCancelled(true);
    }
    setBatchCancelRequested(false);

    const failedSuffix = failed > 0 ? ` · ${failed} failed` : "";
    if (wasCancelled) {
      toast({
        title: "Bulk promote cancelled",
        description: `Cancelled at ${done} of ${ids.length}${failedSuffix}`,
        variant: "destructive",
      });
    } else if (failed > 0) {
      toast({
        title: "Bulk promote finished with errors",
        description: `Promoted ${succeeded} of ${ids.length}${failedSuffix}`,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Bulk promote complete",
        description: `Promoted ${succeeded} of ${ids.length}`,
      });
    }
  };

  const handleCancelBatch = () => {
    if (!isBatchRunning || cancelRequestedRef.current) return;
    cancelRequestedRef.current = true;
    setBatchCancelRequested(true);
  };

  const selectedCount = selectedIds.size;
  const allVisibleOpenSelected =
    visiblePromotableIds.length > 0 &&
    visiblePromotableIds.every((id) => selectedIds.has(id));

  const total = recommendations.length;
  const visible = filtered.length;
  const hasActiveFilters =
    priorityFilter.size > 0 || searchQuery.trim().length > 0 || hidePromoted;
  const headerTitle = hasActiveFilters
    ? `Recommended Actions (${visible} of ${total})`
    : `Recommended Actions (${total})`;

  return (
    <>
      <SectionHeader
        title={headerTitle}
        badge={<AiBadge label="Powered by AI" />}
      />
      <div className="mb-2 space-y-2 rounded-md border border-border bg-background/30 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Priority
          </span>
          {PRIORITY_FILTERS.map((p) => {
            const active = priorityFilter.has(p.value);
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => togglePriority(p.value)}
                data-testid={`rec-filter-priority-${p.value}`}
                aria-pressed={active}
                className={cn(
                  "px-2 py-0.5 rounded-full border text-[10px] font-medium uppercase tracking-wider transition-colors",
                  active
                    ? priorityClass(p.value)
                    : "bg-transparent text-muted-foreground border-border hover:border-primary/40",
                )}
              >
                {p.label}
              </button>
            );
          })}
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              data-testid="rec-filter-clear"
              className="ml-auto text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by node or item…"
              data-testid="rec-filter-search"
              className="h-7 pl-7 text-xs"
            />
          </div>
          <div className="inline-flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Sort
            </span>
            <Select
              value={sortBy}
              onValueChange={(v) => setSortBy(v as RecSortValue)}
            >
              <SelectTrigger
                data-testid="rec-sort"
                className="h-7 w-[180px] text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REC_SORT_OPTIONS.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    data-testid={`rec-sort-option-${opt.value}`}
                    className="text-xs"
                  >
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="inline-flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer">
            <Switch
              checked={hidePromoted}
              onCheckedChange={setHidePromoted}
              data-testid="rec-filter-hide-promoted"
            />
            Hide promoted
          </label>
        </div>
      </div>

      {(selectedCount > 0 || isBatchRunning || showProgressSummary) && (
        <div
          data-testid="rec-bulk-toolbar"
          className="sticky top-0 z-10 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-background/95 backdrop-blur p-2 shadow-sm"
        >
          <div className="flex items-center gap-3 text-xs">
            {!showProgressSummary ? (
              <span className="font-semibold text-primary">
                {selectedCount} selected
              </span>
            ) : null}
            {batchProgress ? (
              <span
                className={cn(
                  "text-muted-foreground",
                  showProgressSummary &&
                    !batchCancelled &&
                    batchProgress.failed === 0 &&
                    "text-emerald-400 font-medium",
                  showProgressSummary &&
                    !batchCancelled &&
                    batchProgress.failed > 0 &&
                    "text-amber-400 font-medium",
                  showProgressSummary &&
                    batchCancelled &&
                    "text-amber-400 font-medium",
                )}
                data-testid="rec-bulk-progress"
              >
                {isBatchRunning
                  ? "Promoting"
                  : batchCancelled
                    ? "Cancelled"
                    : "Done"}{" "}
                {batchProgress.done}/{batchProgress.total}
                {batchProgress.failed > 0
                  ? ` · ${batchProgress.failed} failed`
                  : ""}
              </span>
            ) : visiblePromotableIds.length > 0 ? (
              <button
                type="button"
                onClick={allVisibleOpenSelected ? clearSelection : selectAllOpen}
                className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                data-testid="rec-bulk-select-all"
              >
                {allVisibleOpenSelected
                  ? "Clear selection"
                  : `Select all open (${visiblePromotableIds.length})`}
              </button>
            ) : null}
            {isBatchRunning ? (
              <Button
                size="sm"
                variant="outline"
                onClick={handleCancelBatch}
                disabled={batchCancelRequested}
                className="h-6 px-2 text-[11px]"
                data-testid="rec-bulk-cancel"
              >
                {batchCancelRequested ? "Cancelling…" : "Cancel"}
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {showProgressSummary ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setBatchProgress(null);
                  setBatchCancelled(false);
                }}
                className="h-7 text-xs"
                data-testid="rec-bulk-dismiss"
              >
                Dismiss
              </Button>
            ) : selectedCount > 0 && !isBatchRunning ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={clearSelection}
                className="h-7 text-xs"
                data-testid="rec-bulk-clear"
              >
                Clear
              </Button>
            ) : null}
            {!showProgressSummary ? (
              <Button
                size="sm"
                onClick={handleBulkPromote}
                disabled={isBatchRunning || selectedCount === 0}
                data-testid="rec-bulk-promote"
                className="h-7"
              >
                {isBatchRunning ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Promoting {batchProgress?.done ?? 0}/
                    {batchProgress?.total ?? selectedCount}…
                  </>
                ) : (
                  `Promote ${selectedCount} selected to POs`
                )}
              </Button>
            ) : null}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-md border border-border bg-background/30 px-3 py-6 text-center text-xs text-muted-foreground">
          No recommendations match the current filters.
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => {
            const initiallyPromoted = !!r.promotedOrderId;
            const localPromote = promotedById[r.id];
            const isPromoted = initiallyPromoted || !!localPromote;
            const promotedRef =
              localPromote?.orderNo ?? r.promotedOrderId ?? null;
            const isRunningSingle =
              promote.isPending &&
              promote.variables?.recommendationId === r.id &&
              batchRunningIds.size === 0;
            const isRunningInBatch = batchRunningIds.has(r.id);
            const isPending = isRunningSingle || isRunningInBatch;
            const isQueued =
              isBatchRunning && selectedIds.has(r.id) && !isPending;
            const err = errorById[r.id];
            const isSelected = selectedIds.has(r.id);
            return (
              <li
                key={r.id}
                data-testid={`rec-card-${r.id}`}
                className={cn(
                  "rounded-md border bg-background/40 p-3 text-xs space-y-2",
                  isPromoted
                    ? "border-emerald-500/30"
                    : isSelected
                      ? "border-primary/50"
                      : "border-border",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 flex-wrap">
                    {!isPromoted ? (
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelected(r.id)}
                        disabled={isBatchRunning}
                        aria-label={`Select recommendation ${r.itemName ?? r.itemId} for ${r.nodeName ?? r.nodeId}`}
                        data-testid={`rec-select-${r.id}`}
                        className="mt-0.5"
                      />
                    ) : null}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant="outline"
                        className={cn("text-[10px]", kindClass(r.kind))}
                      >
                        {r.kind}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          priorityClass(r.priority),
                        )}
                      >
                        {r.priority}
                      </Badge>
                      <span className="font-semibold text-sm leading-tight">
                        {r.itemName ?? r.itemId}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-medium text-sm leading-tight text-primary">
                        {r.nodeName ?? r.nodeId}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono text-sm font-bold">
                      {r.quantity.toLocaleString()}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      units
                    </div>
                  </div>
                </div>

                <p className="text-muted-foreground leading-snug">
                  {r.rationale}
                </p>

                <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-border/50">
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    {r.suggestedSupplierName ? (
                      <span className="flex items-center gap-1">
                        <Truck className="h-3 w-3" />
                        {r.suggestedSupplierName}
                      </span>
                    ) : null}
                    <span className="font-mono">
                      ETA {r.etaDays.toFixed(0)}d
                    </span>
                    {typeof r.estimatedCost === "number" ? (
                      <span className="font-mono">
                        {formatCurrency(r.estimatedCost)}
                      </span>
                    ) : null}
                  </div>
                  {isPromoted ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {promotedRef ? `Promoted · ${promotedRef}` : "Promoted"}
                    </span>
                  ) : isQueued ? (
                    <span className="text-[11px] text-muted-foreground italic">
                      Queued…
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending || isBatchRunning}
                      onClick={() => setEditing(r)}
                      data-testid={`rec-promote-${r.id}`}
                      className="border-primary/50 text-primary hover:bg-primary/10 h-7"
                    >
                      {isPending ? (
                        <>
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          Promoting…
                        </>
                      ) : (
                        "Promote to PO"
                      )}
                    </Button>
                  )}
                </div>
                {err ? (
                  <div className="text-[11px] text-destructive">{err}</div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <PromoteDialog
        rec={editing}
        suppliers={suppliers ?? []}
        isSubmitting={
          promote.isPending &&
          editing != null &&
          promote.variables?.recommendationId === editing.id
        }
        onCancel={() => setEditing(null)}
        onConfirm={(overrides) => {
          if (editing) handleConfirm(editing, overrides);
        }}
      />
    </>
  );
}


function KpiTile({
  label,
  value,
  tone,
  small,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
  small?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
        {label}
      </div>
      <div
        className={cn(
          small ? "text-xs" : "text-base",
          "font-bold",
          tone === "warn" && "text-amber-400",
          tone === "ok" && "text-emerald-400",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function RerunDiffBar({
  current,
  previous,
}: {
  current: ScenarioResult;
  previous: ScenarioResult;
}) {
  const cur = current.summary;
  const prev = previous.summary;

  const dosAfter = cur.networkDaysOfSupplyAfter;
  const prevDosAfter = prev.networkDaysOfSupplyAfter;
  const dosDelta =
    typeof dosAfter === "number" && typeof prevDosAfter === "number"
      ? dosAfter - prevDosAfter
      : null;

  const events = cur.estimatedShortageEvents ?? 0;
  const prevEvents = prev.estimatedShortageEvents ?? 0;
  const eventsDelta = events - prevEvents;

  const peakNow = cur.peakRiskNodeName ?? cur.peakRiskNodeId ?? "—";
  const peakPrev = prev.peakRiskNodeName ?? prev.peakRiskNodeId ?? "—";
  const peakChanged = peakNow !== peakPrev;

  // DOS After: lower is worse (warn red), higher is better (emerald)
  const dosTone =
    dosDelta == null || Math.abs(dosDelta) < 0.05
      ? "neutral"
      : dosDelta < 0
        ? "warn"
        : "ok";
  // Shortage events: more is worse
  const eventsTone =
    eventsDelta === 0 ? "neutral" : eventsDelta > 0 ? "warn" : "ok";

  const fmtSignedFixed = (n: number, d: number) =>
    `${n >= 0 ? "+" : ""}${n.toFixed(d)}`;
  const fmtSignedInt = (n: number) => `${n >= 0 ? "+" : ""}${n}`;

  return (
    <div
      data-testid="rerun-diff-bar"
      className="mb-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs flex flex-wrap items-center gap-x-4 gap-y-1"
    >
      <span className="text-[10px] uppercase tracking-wider text-primary font-semibold">
        vs. previous run
      </span>
      <span className="flex items-center gap-1">
        <span className="text-muted-foreground">DOS After</span>
        <span className="font-mono font-semibold">
          {typeof dosAfter === "number" ? `${dosAfter.toFixed(1)}d` : "—"}
        </span>
        {dosDelta != null ? (
          <span
            className={cn(
              "font-mono",
              dosTone === "warn" && "text-amber-400",
              dosTone === "ok" && "text-emerald-400",
              dosTone === "neutral" && "text-muted-foreground",
            )}
          >
            ({fmtSignedFixed(dosDelta, 1)}d)
          </span>
        ) : null}
      </span>
      <span className="flex items-center gap-1">
        <span className="text-muted-foreground">Shortage Events</span>
        <span className="font-mono font-semibold">{events}</span>
        <span
          className={cn(
            "font-mono",
            eventsTone === "warn" && "text-amber-400",
            eventsTone === "ok" && "text-emerald-400",
            eventsTone === "neutral" && "text-muted-foreground",
          )}
        >
          ({fmtSignedInt(eventsDelta)})
        </span>
      </span>
      <span className="flex items-center gap-1">
        <span className="text-muted-foreground">Peak Risk Node</span>
        {peakChanged ? (
          <span className="font-mono">
            <span className="text-muted-foreground">{peakPrev}</span>
            <span className="text-muted-foreground mx-1">→</span>
            <span className="text-foreground font-semibold">{peakNow}</span>
          </span>
        ) : (
          <span className="font-mono font-semibold">
            {peakNow}
            <span className="ml-1 text-muted-foreground font-normal">(unchanged)</span>
          </span>
        )}
      </span>
    </div>
  );
}

function SectionHeader({
  title,
  badge,
  icon,
}: {
  title: string;
  badge?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-2 px-1">
      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        {icon}
        {title}
      </div>
      {badge}
    </div>
  );
}
