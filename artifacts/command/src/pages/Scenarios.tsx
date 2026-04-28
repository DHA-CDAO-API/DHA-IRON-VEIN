import React from "react";
import {
  useListPresetEvents,
  useListScenarios,
  useRunScenario,
  usePreviewScenario,
  useListNodes,
  usePromoteRecommendationToOrder,
  getGetScenarioQueryOptions,
  getListScenariosQueryKey,
  useListTheaterZones,
  getListTheaterZonesQueryKey,
  type PresetEvent,
  type Recommendation,
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
import { AiBadge } from "@/components/ui/ai-badge";
import { SortableTable, type SortableColumn } from "@/components/ui/sortable-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const [error, setError] = React.useState<string | null>(null);
  const [loadingSavedId, setLoadingSavedId] = React.useState<string | null>(null);
  const [rerunningSavedId, setRerunningSavedId] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
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

  const handleSaveCustom = React.useCallback(async () => {
    setError(null);
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
              <ResultPanel result={result} />
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
            const anyBusy = !!loadingSavedId || !!rerunningSavedId || runScenario.isPending;
            return (
              <Card
                key={scenario.id}
                className="bg-card/50 border-border hover:border-primary/40 transition-colors"
              >
                <CardContent className="p-3">
                  <button
                    type="button"
                    onClick={() => handleLoadSaved(scenario.id)}
                    disabled={anyBusy}
                    className="w-full text-left disabled:opacity-70 disabled:cursor-not-allowed"
                    title="Load this scenario back into the builder"
                  >
                    <div className="font-medium text-sm mb-1 line-clamp-2">
                      {scenario.name}
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        {new Date(scenario.createdAt).toLocaleDateString()}
                      </span>
                      <span className="uppercase">{scenario.status}</span>
                    </div>
                  </button>
                  <div className="mt-2 flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={anyBusy}
                      onClick={() => handleLoadSaved(scenario.id)}
                      className="h-7 px-2 text-[11px] flex-1"
                    >
                      {isLoadingThis ? (
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
                      disabled={anyBusy}
                      onClick={() => handleRerunSaved(scenario.id)}
                      className="h-7 px-2 text-[11px] flex-1 border-primary/40 text-primary hover:bg-primary/10"
                    >
                      {isRerunningThis ? (
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
                </CardContent>
              </Card>
            );
          })
        )}
        {scenarios && scenarios.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-4">
            No saved scenarios
          </div>
        ) : null}
      </div>
    </div>
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

function ResultPanel({ result }: { result: ScenarioResult }) {
  const summary = result.summary;
  const peakNode = summary.peakRiskNodeName ?? summary.peakRiskNodeId ?? "—";
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
        <SectionHeader title={`Per-Node Impacts (${result.perNode.length})`} />
        <div className="rounded-md border border-border bg-background/30">
          <SortableTable
            data={result.perNode}
            rowKey={(r) => r.nodeId}
            initialSort={{ key: "riskScore", direction: "desc" }}
            columns={
              [
                {
                  key: "nodeName",
                  label: "Node",
                  sortAccessor: (r) => r.nodeName,
                  render: (r) => <span className="text-xs font-medium">{r.nodeName}</span>,
                },
                {
                  key: "daysOfSupplyBefore",
                  label: "DOS Before",
                  align: "right",
                  sortAccessor: (r) => r.daysOfSupplyBefore,
                  render: (r) => (
                    <span className="text-xs font-mono">
                      {r.daysOfSupplyBefore.toFixed(1)}d
                    </span>
                  ),
                },
                {
                  key: "daysOfSupplyAfter",
                  label: "DOS After",
                  align: "right",
                  sortAccessor: (r) => r.daysOfSupplyAfter,
                  render: (r) => (
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
                  ),
                },
                {
                  key: "peakShortageDay",
                  label: "Peak Day",
                  align: "right",
                  sortAccessor: (r) => r.peakShortageDay ?? 0,
                  render: (r) => (
                    <span className="text-xs font-mono">
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
                    <span className="text-xs font-mono text-muted-foreground">
                      {r.criticalItemIds.length}
                    </span>
                  ),
                },
                {
                  key: "riskScore",
                  label: "Risk",
                  align: "right",
                  sortAccessor: (r) => r.riskScore ?? 0,
                  render: (r) => (
                    <span
                      className={cn(
                        "text-xs font-mono font-semibold",
                        (r.riskScore ?? 0) > 60
                          ? "text-destructive"
                          : (r.riskScore ?? 0) > 30
                            ? "text-amber-400"
                            : "text-foreground",
                      )}
                    >
                      {(r.riskScore ?? 0).toFixed(0)}
                    </span>
                  ),
                },
              ] satisfies SortableColumn<(typeof result.perNode)[number]>[]
            }
          />
        </div>
      </section>

      <section>
        <SectionHeader title={`Per-Item Impacts (${result.perItem.length})`} />
        <div className="rounded-md border border-border bg-background/30">
          <SortableTable
            data={result.perItem}
            rowKey={(r) => r.itemId}
            initialSort={{ key: "totalShortfall", direction: "desc" }}
            columns={
              [
                {
                  key: "itemName",
                  label: "Item",
                  sortAccessor: (r) => r.itemName,
                  render: (r) => <span className="text-xs font-medium">{r.itemName}</span>,
                },
                {
                  key: "peakDemandPerDay",
                  label: "Peak Demand/Day",
                  align: "right",
                  sortAccessor: (r) => r.peakDemandPerDay,
                  render: (r) => (
                    <span className="text-xs font-mono">
                      {r.peakDemandPerDay.toFixed(2)}
                    </span>
                  ),
                },
                {
                  key: "totalShortfall",
                  label: "Shortfall",
                  align: "right",
                  sortAccessor: (r) => r.totalShortfall,
                  render: (r) => (
                    <span
                      className={cn(
                        "text-xs font-mono",
                        r.totalShortfall > 0 ? "text-amber-400" : "text-muted-foreground",
                      )}
                    >
                      {r.totalShortfall.toLocaleString()}
                    </span>
                  ),
                },
                {
                  key: "recommendedReorder",
                  label: "Reorder",
                  align: "right",
                  sortAccessor: (r) => r.recommendedReorder,
                  render: (r) => (
                    <span className="text-xs font-mono text-primary">
                      {r.recommendedReorder.toLocaleString()}
                    </span>
                  ),
                },
              ] satisfies SortableColumn<(typeof result.perItem)[number]>[]
            }
          />
        </div>
      </section>

      {result.recommendations.length > 0 ? (
        <section>
          <SectionHeader
            title={`Recommended Actions (${result.recommendations.length})`}
            badge={<AiBadge label="Powered by AI" />}
          />
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

function RecommendationCards({
  recommendations,
}: {
  recommendations: Recommendation[];
}) {
  const promote = usePromoteRecommendationToOrder();
  const [promotedById, setPromotedById] = React.useState<
    Record<string, { orderId: string; orderNo: string }>
  >({});
  const [errorById, setErrorById] = React.useState<Record<string, string>>({});

  const handlePromote = async (rec: Recommendation) => {
    setErrorById((prev) => ({ ...prev, [rec.id]: "" }));
    try {
      const res = await promote.mutateAsync({ recommendationId: rec.id });
      const order = res as { id?: string; orderNo?: string } | undefined;
      setPromotedById((prev) => ({
        ...prev,
        [rec.id]: {
          orderId: order?.id ?? "promoted",
          orderNo: order?.orderNo ?? order?.id ?? "PROMOTED",
        },
      }));
    } catch (e) {
      setErrorById((prev) => ({
        ...prev,
        [rec.id]: (e as Error)?.message ?? "Promote failed",
      }));
    }
  };

  return (
    <ul className="space-y-2">
      {recommendations.map((r) => {
        const initiallyPromoted = !!r.promotedOrderId;
        const localPromote = promotedById[r.id];
        const isPromoted = initiallyPromoted || !!localPromote;
        const promotedRef =
          localPromote?.orderNo ?? r.promotedOrderId ?? null;
        const isPending =
          promote.isPending && promote.variables?.recommendationId === r.id;
        const err = errorById[r.id];
        return (
          <li
            key={r.id}
            data-testid={`rec-card-${r.id}`}
            className={cn(
              "rounded-md border bg-background/40 p-3 text-xs space-y-2",
              isPromoted ? "border-emerald-500/30" : "border-border",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant="outline"
                  className={cn("text-[10px]", kindClass(r.kind))}
                >
                  {r.kind}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn("text-[10px]", priorityClass(r.priority))}
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
              <div className="text-right shrink-0">
                <div className="font-mono text-sm font-bold">
                  {r.quantity.toLocaleString()}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  units
                </div>
              </div>
            </div>

            <p className="text-muted-foreground leading-snug">{r.rationale}</p>

            <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-border/50">
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                {r.suggestedSupplierName ? (
                  <span className="flex items-center gap-1">
                    <Truck className="h-3 w-3" />
                    {r.suggestedSupplierName}
                  </span>
                ) : null}
                <span className="font-mono">ETA {r.etaDays.toFixed(0)}d</span>
                {typeof r.estimatedCost === "number" ? (
                  <span className="font-mono">
                    ${r.estimatedCost.toLocaleString()}
                  </span>
                ) : null}
              </div>
              {isPromoted ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {promotedRef ? `Promoted · ${promotedRef}` : "Promoted"}
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => handlePromote(r)}
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
