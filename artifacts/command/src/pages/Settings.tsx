import { useEffect, useMemo, useState } from "react";
import {
  useGetSettings,
  useUpdateSettings,
  getGetSettingsQueryKey,
  type AppSettings,
  type UpdateSettingsInput,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { IronVeinBrand } from "@/components/brand/IronVeinBrand";
import {
  Save,
  Settings2,
  Shield,
  Network,
  Info,
  Cpu,
  Sliders,
  Server,
  AlertTriangle,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

type FormState = {
  aiProvider: "openai";
  aiModel: string;
  autoFlyMap: boolean;
  demandPaddingDays: number;
  wasteFactor: number;
  dmlssConnectorEnabled: boolean;
  alertWatchThresholdDays: number;
  alertCriticalThresholdDays: number;
};

const API_GROUPS: Array<{ name: string; basePath: string; description: string }> = [
  { name: "Network", basePath: "/api/network", description: "Theater nodes & links" },
  { name: "Catalog", basePath: "/api/catalog", description: "Item & supplier catalog" },
  { name: "Inventory", basePath: "/api/inventory", description: "On-hand & DOS by site" },
  { name: "Suppliers", basePath: "/api/suppliers", description: "Supplier directory & coverage" },
  { name: "Orders", basePath: "/api/orders", description: "Resupply orders & shipments" },
  { name: "Alerts", basePath: "/api/alerts", description: "Open watch & critical alerts" },
  { name: "Scenarios", basePath: "/api/scenarios", description: "What-if scenario runs" },
  { name: "Predictive", basePath: "/api/predictive", description: "Forecast & recommendation engine" },
  { name: "Copilot", basePath: "/api/copilot", description: "AI advisor conversations" },
  { name: "Activity", basePath: "/api/activity", description: "User & system activity feed" },
  { name: "Blood", basePath: "/api/blood", description: "Theater blood readiness" },
  { name: "Dashboard", basePath: "/api/dashboard", description: "Operator KPI snapshot" },
  { name: "Overview", basePath: "/api/overview", description: "Command-level rollups" },
  { name: "Settings", basePath: "/api/settings", description: "App-wide configuration" },
  { name: "Profile", basePath: "/api/profile", description: "Operator profile & role" },
];

function defaultsFromSettings(s: AppSettings | undefined): FormState {
  return {
    aiProvider: "openai",
    aiModel: s?.aiModel ?? "",
    autoFlyMap: s?.autoFlyMap ?? true,
    demandPaddingDays: s?.demandPaddingDays ?? 7,
    wasteFactor: s?.wasteFactor ?? 1.1,
    dmlssConnectorEnabled: s?.dmlssConnectorEnabled ?? false,
    alertWatchThresholdDays: s?.alertWatchThresholdDays ?? 14,
    alertCriticalThresholdDays: s?.alertCriticalThresholdDays ?? 5,
  };
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${
        ok ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" : "bg-destructive shadow-[0_0_6px_rgba(239,68,68,0.7)]"
      }`}
      data-testid={ok ? "status-dot-online" : "status-dot-offline"}
    />
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-border/40 last:border-0">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm font-mono text-foreground/90 text-right truncate">{value}</span>
    </div>
  );
}

export default function Settings() {
  const { data: settings, isLoading } = useGetSettings();
  const updateSettings = useUpdateSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Health probe — measures latency client-side and gives us "online" indicator.
  const [healthLatencyMs, setHealthLatencyMs] = useState<number | null>(null);
  const [healthCheckedAt, setHealthCheckedAt] = useState<number>(() => Date.now());
  const health = useQuery({
    queryKey: ["settings-health-probe"],
    queryFn: async () => {
      const started = performance.now();
      const res = await fetch(
        `${import.meta.env.BASE_URL.replace(/\/$/, "")}api/healthz`,
        { credentials: "include" },
      );
      const elapsed = Math.round(performance.now() - started);
      setHealthLatencyMs(elapsed);
      setHealthCheckedAt(Date.now());
      if (!res.ok) throw new Error(`healthz ${res.status}`);
      return (await res.json()) as { status: "ok"; ts: string };
    },
    staleTime: 30_000,
    refetchOnMount: true,
    retry: 0,
  });
  const apiOnline = health.isSuccess;

  const [form, setForm] = useState<FormState>(() => defaultsFromSettings(undefined));
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (settings && !hydrated) {
      setForm(defaultsFromSettings(settings));
      setHydrated(true);
    }
  }, [settings, hydrated]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const thresholdsValid =
    form.alertWatchThresholdDays > form.alertCriticalThresholdDays;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!thresholdsValid) return;
    const payload: UpdateSettingsInput = {
      aiProvider: form.aiProvider,
      aiModel: form.aiModel,
      autoFlyMap: form.autoFlyMap,
      demandPaddingDays: form.demandPaddingDays,
      wasteFactor: form.wasteFactor,
      dmlssConnectorEnabled: form.dmlssConnectorEnabled,
      alertWatchThresholdDays: form.alertWatchThresholdDays,
      alertCriticalThresholdDays: form.alertCriticalThresholdDays,
    };
    updateSettings.mutate(
      { data: payload },
      {
        onSuccess: () => {
          toast({
            title: "Settings saved",
            description: "System configuration updated.",
          });
          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        },
        onError: (err: unknown) => {
          const message = err instanceof Error ? err.message : "Could not update settings.";
          toast({
            title: "Save failed",
            description: message,
            variant: "destructive",
          });
        },
      },
    );
  };

  const env = import.meta.env.MODE;
  const appVersion = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";
  const serverTime = useMemo(() => {
    if (health.data?.ts) return new Date(health.data.ts);
    return null;
  }, [health.data]);

  if (isLoading || !hydrated) {
    return (
      <div className="p-6 text-muted-foreground" data-testid="settings-loading">
        Loading settings...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-6 bg-background overflow-y-auto" data-testid="settings-page">
      <div className="flex items-center gap-3 mb-6 shrink-0">
        <Settings2 className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold uppercase tracking-wider">System Settings</h1>
      </div>

      <form onSubmit={onSubmit} className="max-w-4xl space-y-6 pb-12">
        {/* 1. SYSTEM INFORMATION */}
        <Card className="bg-card/50 border-border" data-testid="card-system-info">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" /> System Information
            </CardTitle>
            <CardDescription>What this solution is and what it's running on.</CardDescription>
          </CardHeader>
          <CardContent>
            <InfoRow
              label="Solution"
              value={
                <span>
                  DHA: IRON-VEIN — <IronVeinBrand />
                </span>
              }
            />
            <InfoRow
              label="Description"
              value="Predictive medical-logistics common operating picture for INDOPACOM."
            />
            <InfoRow label="App version" value={`v${appVersion}`} />
            <InfoRow
              label="Build / environment"
              value={
                <span className="inline-flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider border ${
                      env === "production"
                        ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-400"
                        : "bg-amber-500/10 border-amber-500/40 text-amber-400"
                    }`}
                  >
                    {env}
                  </span>
                </span>
              }
            />
            <InfoRow
              label="API server"
              value={
                <span className="inline-flex items-center gap-2" data-testid="api-server-status">
                  <StatusDot ok={apiOnline} />
                  <span className={apiOnline ? "text-emerald-400" : "text-destructive"}>
                    {health.isLoading
                      ? "checking…"
                      : apiOnline
                      ? `online · ${healthLatencyMs ?? "—"} ms`
                      : "offline"}
                  </span>
                </span>
              }
            />
            <InfoRow
              label="Database connector"
              value={
                <span className="inline-flex items-center gap-2">
                  <StatusDot ok={apiOnline} />
                  <span className={apiOnline ? "text-emerald-400" : "text-destructive"}>
                    {apiOnline ? "reachable via API" : "unknown"}
                  </span>
                </span>
              }
            />
            <InfoRow
              label="Server time"
              value={
                serverTime
                  ? `${serverTime.toISOString().replace("T", " ").slice(0, 19)} UTC`
                  : "—"
              }
            />
            <InfoRow
              label="Last health check"
              value={new Date(healthCheckedAt).toISOString().replace("T", " ").slice(11, 19) + " UTC"}
            />
          </CardContent>
        </Card>

        {/* 2. APIs & INTEGRATIONS */}
        <Card className="bg-card/50 border-border" data-testid="card-apis-integrations">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Server className="h-5 w-5 text-primary" /> APIs &amp; Integrations
            </CardTitle>
            <CardDescription>
              Backend surfaces this app talks to. All routes share one health probe.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-md border border-border bg-background/50">
              <div>
                <div className="text-sm font-semibold">AI provider in use</div>
                <div className="text-xs text-muted-foreground">
                  Used by Copilot and Scenario engine.
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-sm text-primary uppercase">
                  {settings?.aiProvider ?? "openai"}
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  {settings?.aiModel || "(default model)"}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {API_GROUPS.map((api) => (
                <div
                  key={api.name}
                  className="flex items-center justify-between p-2.5 rounded-md border border-border/60 bg-background/40"
                  data-testid={`api-row-${api.name.toLowerCase()}`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{api.name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground truncate">
                      {api.basePath}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusDot ok={apiOnline} />
                    <span
                      className={`text-[11px] uppercase tracking-wider ${
                        apiOnline ? "text-emerald-400" : "text-destructive"
                      }`}
                    >
                      {apiOnline ? "online" : "offline"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* 3. AI CONFIGURATION */}
        <Card className="bg-card/50 border-border" data-testid="card-ai-config">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Cpu className="h-5 w-5 text-primary" /> AI Configuration
            </CardTitle>
            <CardDescription>
              Provider and optional model used for Copilot and Scenarios.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <Label>Provider</Label>
              <RadioGroup
                value={form.aiProvider}
                onValueChange={(v) => update("aiProvider", v as "openai")}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2 border border-border rounded-md p-3 flex-1 bg-background/50">
                  <RadioGroupItem value="openai" id="ai-openai" data-testid="radio-openai" />
                  <Label htmlFor="ai-openai" className="cursor-pointer">OpenAI</Label>
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-model">Model override (optional)</Label>
              <Input
                id="ai-model"
                value={form.aiModel}
                onChange={(e) => update("aiModel", e.target.value)}
                placeholder="e.g. gpt-4o"
                className="bg-background/50 font-mono"
                data-testid="input-ai-model"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to use the provider's default model.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 4. ALERT THRESHOLDS */}
        <Card className="bg-card/50 border-border" data-testid="card-alert-thresholds">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" /> Alert Thresholds
            </CardTitle>
            <CardDescription>
              Days-of-supply boundaries that drive watch and critical alerts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <div className="flex justify-between">
                <Label>Watch threshold (days)</Label>
                <span className="font-mono text-amber-400" data-testid="value-watch-days">
                  {form.alertWatchThresholdDays} days
                </span>
              </div>
              <Slider
                value={[form.alertWatchThresholdDays]}
                onValueChange={([v]) => update("alertWatchThresholdDays", v)}
                min={1}
                max={30}
                step={1}
                data-testid="slider-watch-days"
              />
            </div>
            <div className="space-y-3">
              <div className="flex justify-between">
                <Label>Critical threshold (days)</Label>
                <span className="font-mono text-destructive" data-testid="value-critical-days">
                  {form.alertCriticalThresholdDays} days
                </span>
              </div>
              <Slider
                value={[form.alertCriticalThresholdDays]}
                onValueChange={([v]) => update("alertCriticalThresholdDays", v)}
                min={1}
                max={14}
                step={1}
                data-testid="slider-critical-days"
              />
            </div>
            {!thresholdsValid && (
              <div
                className="flex items-start gap-2 p-3 rounded-md border border-destructive/50 bg-destructive/10 text-destructive text-sm"
                data-testid="error-thresholds"
              >
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Watch threshold must be greater than critical threshold.
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 5. FORECAST & PLANNING PREFERENCES */}
        <Card className="bg-card/50 border-border" data-testid="card-forecast-prefs">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Sliders className="h-5 w-5 text-primary" /> Forecast &amp; Planning Preferences
            </CardTitle>
            <CardDescription>
              Padding and waste assumptions applied to demand forecasts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <div className="flex justify-between">
                <Label>Demand padding (days)</Label>
                <span className="font-mono text-primary" data-testid="value-demand-padding">
                  {form.demandPaddingDays} days
                </span>
              </div>
              <Slider
                value={[form.demandPaddingDays]}
                onValueChange={([v]) => update("demandPaddingDays", v)}
                min={0}
                max={30}
                step={1}
                data-testid="slider-demand-padding"
              />
              <p className="text-xs text-muted-foreground">
                Extra days of demand added to recommended order quantities.
              </p>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between">
                <Label>Waste factor</Label>
                <span className="font-mono text-primary" data-testid="value-waste-factor">
                  {form.wasteFactor.toFixed(2)}×
                </span>
              </div>
              <Slider
                value={[Math.round(form.wasteFactor * 100)]}
                onValueChange={([v]) => update("wasteFactor", Math.round(v) / 100)}
                min={100}
                max={200}
                step={5}
                data-testid="slider-waste-factor"
              />
              <p className="text-xs text-muted-foreground">
                Multiplier applied to projected consumption to account for waste and spoilage.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 6. SYSTEM PREFERENCES */}
        <Card className="bg-card/50 border-border" data-testid="card-system-prefs">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Network className="h-5 w-5 text-primary" /> System Preferences
            </CardTitle>
            <CardDescription>App-wide behavior and integrations.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-4 p-3 rounded-md border border-border bg-background/40">
              <div className="space-y-0.5">
                <Label>Auto-fly map to alerts</Label>
                <div className="text-xs text-muted-foreground">
                  Network map automatically pans to new critical alerts.
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`text-xs uppercase tracking-wider ${
                    form.autoFlyMap ? "text-emerald-400" : "text-muted-foreground"
                  }`}
                  data-testid="label-autofly"
                >
                  {form.autoFlyMap ? "On" : "Off"}
                </span>
                <Switch
                  checked={form.autoFlyMap}
                  onCheckedChange={(v) => update("autoFlyMap", v)}
                  data-testid="switch-autofly"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 p-3 rounded-md border border-border bg-background/40">
              <div className="space-y-0.5">
                <Label>DMLSS connector</Label>
                <div className="text-xs text-muted-foreground">
                  Mirror inventory and orders into the legacy DMLSS schema.
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`text-xs uppercase tracking-wider ${
                    form.dmlssConnectorEnabled ? "text-emerald-400" : "text-muted-foreground"
                  }`}
                  data-testid="label-dmlss"
                >
                  {form.dmlssConnectorEnabled ? "Enabled" : "Disabled"}
                </span>
                <Switch
                  checked={form.dmlssConnectorEnabled}
                  onCheckedChange={(v) => update("dmlssConnectorEnabled", v)}
                  data-testid="switch-dmlss"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 p-3 rounded-md border border-border/60 bg-background/30">
              <div className="space-y-0.5">
                <Label className="text-muted-foreground">Theme</Label>
                <div className="text-xs text-muted-foreground">
                  A light theme is coming later.
                </div>
              </div>
              <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Dark (tactical)
              </span>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3 pt-2 sticky bottom-0 bg-background/80 backdrop-blur-sm py-4 -mx-6 px-6 border-t border-border/40">
          {!thresholdsValid && (
            <span className="text-xs text-destructive self-center">
              Fix validation errors above to save.
            </span>
          )}
          <Button
            type="submit"
            disabled={updateSettings.isPending || !thresholdsValid}
            className="px-8"
            data-testid="button-save-settings"
          >
            <Save className="h-4 w-4 mr-2" />
            {updateSettings.isPending ? "Saving…" : "Save Configuration"}
          </Button>
        </div>
      </form>
    </div>
  );
}
