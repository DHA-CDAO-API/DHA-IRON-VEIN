import React, { useMemo, useState } from 'react';
import { Link } from 'wouter';
import {
  useGetNetworkSnapshot,
  getGetNetworkSnapshotQueryKey,
  useListAlerts,
  useAcknowledgeAlert,
  getListAlertsQueryKey,
  useCreateOrder,
  useListTheaterZones,
  useCreateTheaterZone,
  useDeleteTheaterZone,
  getListTheaterZonesQueryKey,
} from '@workspace/api-client-react';
import NetworkGLMap, {
  type SupplyCategory,
  type ThreatTier,
  type ZoneDrawMode,
  type ZoneSeverity,
  type TheaterZone,
  TIER_COLOR,
  TIER_LABEL,
  ZONE_SEVERITY_COLOR,
  tierForRisk,
} from '@/components/Map';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Clock,
  Droplets,
  ExternalLink,
  Hexagon,
  Layers,
  MapPin,
  Package,
  Pencil,
  Plane,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { usePrefersReducedMotion } from '@/hooks/use-reduced-motion';

const CATEGORY_META: Record<
  SupplyCategory,
  { label: string; icon: React.ReactNode; tint: string }
> = {
  blood_products: {
    label: 'Blood Products',
    icon: <Droplets className="h-3.5 w-3.5" />,
    tint: 'text-rose-300',
  },
  supplies: {
    label: 'Supplies',
    icon: <Package className="h-3.5 w-3.5" />,
    tint: 'text-teal-300',
  },
  ppe: {
    label: 'PPE',
    icon: <ShieldCheck className="h-3.5 w-3.5" />,
    tint: 'text-violet-300',
  },
  other: {
    label: 'Other',
    icon: <Activity className="h-3.5 w-3.5" />,
    tint: 'text-slate-300',
  },
};

const PRIMARY_CATEGORIES: SupplyCategory[] = ['blood_products', 'supplies', 'ppe'];

function tierBadgeStyle(tier: ThreatTier): React.CSSProperties {
  const c = TIER_COLOR[tier];
  return {
    backgroundColor: `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.18)`,
    color: `rgb(${c[0]}, ${c[1]}, ${c[2]})`,
    borderColor: `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.55)`,
  };
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  if (diff < 0) return 'in transit';
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  if (h < 48) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

export default function NetworkMapPage() {
  const queryClient = useQueryClient();
  const { data: snapshot } = useGetNetworkSnapshot({
    query: { queryKey: getGetNetworkSnapshotQueryKey() },
  });
  const { data: alerts = [] } = useListAlerts(undefined, {
    query: { queryKey: getListAlertsQueryKey() },
  });
  const ackAlert = useAcknowledgeAlert();
  const createOrder = useCreateOrder();

  // Layer panel state
  const [selectedCats, setSelectedCats] = useState<Set<SupplyCategory>>(new Set());
  const [showThreats, setShowThreats] = useState(true);
  const [showAOR, setShowAOR] = useState(true);
  const [showZones, setShowZones] = useState(true);

  // Motion / animation preference. Defaults to following the OS-level
  // `prefers-reduced-motion` setting, but the user can override either way
  // via the Layers panel toggle (e.g. enable animation despite OS setting,
  // or freeze the map even though the OS isn't requesting reduced motion).
  const prefersReducedMotion = usePrefersReducedMotion();
  const [animateOverride, setAnimateOverride] = useState<boolean | null>(null);
  const animateMap = animateOverride ?? !prefersReducedMotion;

  // Active popup
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);

  // Zone state
  const { data: zones = [] } = useListTheaterZones({
    query: { queryKey: getListTheaterZonesQueryKey() },
  });
  const createZone = useCreateTheaterZone();
  const deleteZone = useDeleteTheaterZone();

  const [drawMode, setDrawMode] = useState<ZoneDrawMode>(null);
  const [draftPolygon, setDraftPolygon] = useState<number[][] | null>(null);
  const [draftVertexCount, setDraftVertexCount] = useState(0);
  const [draftSeverity, setDraftSeverity] = useState<ZoneSeverity>('WARNING');
  const [draftName, setDraftName] = useState('');
  const [draftNotes, setDraftNotes] = useState('');

  const cancelDraw = () => {
    setDrawMode(null);
    setDraftPolygon(null);
    setDraftVertexCount(0);
  };

  const handleZoneDrawn = (polygon: number[][]) => {
    setDrawMode(null);
    setDraftPolygon(polygon);
    setDraftName('');
    setDraftNotes('');
  };

  const handleSaveZone = async () => {
    if (!draftPolygon) return;
    const name = draftName.trim() || `Zone ${zones.length + 1}`;
    try {
      await createZone.mutateAsync({
        data: {
          name,
          severity: draftSeverity,
          kind: 'AD_HOC',
          polygon: draftPolygon,
          notes: draftNotes.trim() || undefined,
          createdBy: 'Operator',
        } as any,
      });
      queryClient.invalidateQueries({ queryKey: getListTheaterZonesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetNetworkSnapshotQueryKey() });
      setDraftPolygon(null);
      setDraftName('');
      setDraftNotes('');
    } catch (err) {
      console.error('failed to save zone', err);
    }
  };

  const handleDeleteZone = async (zoneId: string) => {
    try {
      await deleteZone.mutateAsync({ zoneId });
      queryClient.invalidateQueries({ queryKey: getListTheaterZonesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetNetworkSnapshotQueryKey() });
    } catch (err) {
      console.error('failed to delete zone', err);
    }
  };

  const riskByNodeMap = useMemo(
    () => new Map((snapshot?.riskByNode ?? []).map((r: any) => [r.nodeId, r])),
    [snapshot?.riskByNode],
  );
  const nodeById = useMemo(
    () => new Map((snapshot?.nodes ?? []).map((n: any) => [n.id, n])),
    [snapshot?.nodes],
  );

  const selectedNode = selectedNodeId ? (nodeById.get(selectedNodeId) as any) : null;
  const selectedRisk = selectedNodeId ? (riskByNodeMap.get(selectedNodeId) as any) : null;
  const selectedTier: ThreatTier = selectedRisk?.tier
    ?? tierForRisk(selectedRisk?.riskScore ?? 0, selectedRisk?.openAlerts ?? 0);

  const shipmentsList = (snapshot?.shipments as any[] | undefined) ?? [];
  const selectedShipment = selectedShipmentId
    ? shipmentsList.find((s) => s.id === selectedShipmentId) ?? null
    : null;
  const shipmentFromNode = selectedShipment ? (nodeById.get(selectedShipment.fromNode) as any) : null;
  const shipmentToNode = selectedShipment ? (nodeById.get(selectedShipment.toNode) as any) : null;

  const openAlertsForSelected = useMemo(() => {
    if (!selectedNodeId) return [];
    return (alerts as any[]).filter(
      (a) => a.nodeId === selectedNodeId && (a.status === 'OPEN' || a.status === 'open'),
    );
  }, [alerts, selectedNodeId]);

  // Tier counts for the summary row
  const tierCounts = useMemo(() => {
    const counts: Record<ThreatTier, number> = { nominal: 0, heightened: 0, critical: 0 };
    for (const r of snapshot?.riskByNode ?? []) {
      const t = (r as any).tier as ThreatTier
        ?? tierForRisk((r as any).riskScore ?? 0, (r as any).openAlerts ?? 0);
      counts[t]++;
    }
    return counts;
  }, [snapshot?.riskByNode]);

  const toggleCat = (c: SupplyCategory) => {
    setSelectedCats((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const handleAck = async () => {
    for (const a of openAlertsForSelected) {
      await ackAlert.mutateAsync({
        alertId: a.id,
        data: { acknowledgedBy: 'Current User' } as any,
      });
    }
    queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetNetworkSnapshotQueryKey() });
  };

  const handleResupply = async () => {
    if (!selectedNode || !selectedRisk) return;
    const top = (selectedRisk.topCriticalItems ?? [])[0];
    if (!top) return;
    try {
      await createOrder.mutateAsync({
        data: {
          toNodeId: selectedNode.id,
          itemId: top.itemId,
          quantity: Math.max(50, Math.ceil((14 - (top.daysOfSupply ?? 0)) * 10)),
          priority: selectedTier === 'critical' ? 'FLASH' : 'PRIORITY',
          rationale: `Map-initiated resupply for ${top.itemName} at ${selectedNode.name}`,
        } as any,
      });
      queryClient.invalidateQueries({ queryKey: getGetNetworkSnapshotQueryKey() });
    } catch (err) {
      console.error('failed to create resupply order', err);
    }
  };

  return (
    <div className="h-full relative flex flex-col bg-background overflow-hidden">
      {/* Layers panel */}
      <div className="absolute top-4 left-4 z-10 w-72 pointer-events-auto">
        <Card className="bg-card/85 backdrop-blur-md border-border shadow-2xl">
          <CardContent className="p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                <h3 className="font-semibold text-sm tracking-wider uppercase text-muted-foreground">
                  Layers
                </h3>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px] font-mono uppercase tracking-wider"
                onClick={() => setSelectedCats(new Set())}
                disabled={selectedCats.size === 0}
              >
                All
              </Button>
            </div>

            <div className="flex flex-col gap-1.5">
              {PRIMARY_CATEGORIES.map((c) => {
                const meta = CATEGORY_META[c];
                const checked = selectedCats.has(c);
                return (
                  <label
                    key={c}
                    htmlFor={`layer-${c}`}
                    className={`flex items-center gap-2.5 rounded px-2 py-1.5 cursor-pointer transition border ${
                      checked
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-transparent hover:bg-muted/40'
                    }`}
                  >
                    <Checkbox
                      id={`layer-${c}`}
                      checked={checked}
                      onCheckedChange={() => toggleCat(c)}
                    />
                    <span className={meta.tint}>{meta.icon}</span>
                    <span className="text-sm flex-1">{meta.label}</span>
                  </label>
                );
              })}
            </div>

            <div className="border-t border-border pt-2 flex flex-col gap-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="layer-threats"
                  checked={showThreats}
                  onCheckedChange={(v) => setShowThreats(!!v)}
                />
                <Label htmlFor="layer-threats" className="text-xs cursor-pointer">
                  Threat overlays
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="layer-aor"
                  checked={showAOR}
                  onCheckedChange={(v) => setShowAOR(!!v)}
                />
                <Label htmlFor="layer-aor" className="text-xs cursor-pointer">
                  USINDOPACOM AOR boundary
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="layer-zones"
                  checked={showZones}
                  onCheckedChange={(v) => setShowZones(!!v)}
                />
                <Label htmlFor="layer-zones" className="text-xs cursor-pointer">
                  Theater zones ({zones.length})
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="layer-animate"
                  checked={animateMap}
                  onCheckedChange={(v) => setAnimateOverride(!!v)}
                />
                <Label
                  htmlFor="layer-animate"
                  className="text-xs cursor-pointer flex items-center gap-1.5"
                >
                  <Sparkles className="h-3 w-3 text-primary" />
                  Animate map
                </Label>
              </div>
              {!animateMap && (
                <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground pl-6 -mt-1">
                  {animateOverride === false
                    ? 'Motion off · still frame'
                    : 'OS reduced-motion · still frame'}
                </p>
              )}
            </div>

            <div className="border-t border-border pt-2 grid grid-cols-3 gap-1 text-[10px] font-mono uppercase tracking-wider">
              <TierPill tier="critical" count={tierCounts.critical} />
              <TierPill tier="heightened" count={tierCounts.heightened} />
              <TierPill tier="nominal" count={tierCounts.nominal} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Theater Zones panel */}
      <div className="absolute bottom-4 left-4 z-10 w-72 pointer-events-auto">
        <Card className="bg-card/85 backdrop-blur-md border-border shadow-2xl">
          <CardContent className="p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pencil className="h-4 w-4 text-primary" />
                <h3 className="font-semibold text-sm tracking-wider uppercase text-muted-foreground">
                  Theater Zones
                </h3>
              </div>
              {drawMode !== null && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px] font-mono uppercase tracking-wider text-rose-300"
                  onClick={cancelDraw}
                >
                  Cancel
                </Button>
              )}
            </div>

            {drawMode === null ? (
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 justify-start"
                    onClick={() => setDrawMode('rectangle')}
                  >
                    <Square className="h-3.5 w-3.5 mr-2" />
                    Rectangle
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 justify-start"
                    onClick={() => setDrawMode('polygon')}
                  >
                    <Hexagon className="h-3.5 w-3.5 mr-2" />
                    Polygon
                  </Button>
                </div>

                <div className="flex flex-col gap-1 max-h-44 overflow-y-auto -mr-1 pr-1">
                  {zones.length === 0 ? (
                    <div className="text-[11px] text-muted-foreground italic px-1 py-2">
                      No ad-hoc zones drawn yet. Use Rectangle or Polygon to add one.
                    </div>
                  ) : (
                    zones.map((z: TheaterZone) => {
                      const c = ZONE_SEVERITY_COLOR[z.severity as ZoneSeverity];
                      return (
                        <div
                          key={z.id}
                          className="flex items-center justify-between gap-2 rounded border border-transparent hover:border-border hover:bg-muted/30 px-2 py-1"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-sm border"
                              style={{
                                backgroundColor: `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.5)`,
                                borderColor: `rgb(${c[0]}, ${c[1]}, ${c[2]})`,
                              }}
                            />
                            <span className="text-xs truncate" title={z.name}>
                              {z.name}
                            </span>
                            <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                              {z.severity}
                            </span>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-muted-foreground hover:text-rose-300"
                            onClick={() => handleDeleteZone(z.id)}
                            disabled={deleteZone.isPending}
                            aria-label={`Delete zone ${z.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2 text-[11px] text-muted-foreground">
                <div className="flex items-center gap-1.5 text-primary">
                  <MapPin className="h-3 w-3" />
                  <span className="font-mono uppercase tracking-widest">
                    {drawMode === 'rectangle' ? 'Rectangle mode' : 'Polygon mode'}
                  </span>
                </div>
                {drawMode === 'rectangle' ? (
                  <div>
                    Click <strong>two opposite corners</strong> on the map to define the
                    zone.
                  </div>
                ) : (
                  <div>
                    Click on the map to add vertices. <strong>Double-click</strong> to
                    finish (need at least 3 points).
                  </div>
                )}
                <div className="font-mono text-[10px]">
                  Vertices placed: {draftVertexCount}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Map */}
      <div className="flex-1 w-full h-full relative">
        <NetworkGLMap
          nodes={snapshot?.nodes as any}
          routes={snapshot?.routes as any}
          shipments={snapshot?.shipments as any}
          riskByNode={snapshot?.riskByNode as any}
          threats={snapshot?.threats as any}
          aorBoundary={(snapshot as any)?.aorBoundary}
          zones={zones as TheaterZone[]}
          showZones={showZones}
          drawMode={drawMode}
          onZoneDrawn={handleZoneDrawn}
          onDraftChange={(v) => setDraftVertexCount(v.length)}
          selectedCategories={selectedCats}
          showThreats={showThreats}
          showAOR={showAOR}
          animate={animateMap}
          onNodeClick={(node) => {
            setSelectedShipmentId(null);
            setSelectedNodeId(node?.id ?? null);
          }}
          onShipmentClick={(s) => {
            setSelectedNodeId(null);
            setSelectedShipmentId(s?.id ?? null);
          }}
        />
      </div>

      {/* Save zone dialog */}
      <Dialog
        open={draftPolygon !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDraftPolygon(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Label theater zone</DialogTitle>
            <DialogDescription>
              Give the zone a callsign and severity. It will be visible to every operator
              and selectable in scenarios.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="zone-name" className="text-xs uppercase tracking-wider">
                Name
              </Label>
              <Input
                id="zone-name"
                placeholder="e.g. Taiwan Strait WEZ"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs uppercase tracking-wider">Severity</Label>
              <div className="grid grid-cols-3 gap-2">
                {(['WATCH', 'WARNING', 'CRITICAL'] as ZoneSeverity[]).map((s) => {
                  const c = ZONE_SEVERITY_COLOR[s];
                  const active = draftSeverity === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setDraftSeverity(s)}
                      className={`rounded border px-2 py-1.5 text-[11px] font-mono uppercase tracking-widest transition ${
                        active ? 'ring-2 ring-primary' : 'hover:bg-muted/40'
                      }`}
                      style={{
                        borderColor: `rgb(${c[0]}, ${c[1]}, ${c[2]})`,
                        backgroundColor: active
                          ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.18)`
                          : 'transparent',
                        color: `rgb(${c[0]}, ${c[1]}, ${c[2]})`,
                      }}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="zone-notes" className="text-xs uppercase tracking-wider">
                Notes (optional)
              </Label>
              <Input
                id="zone-notes"
                placeholder="Intent, ROE, expected duration…"
                value={draftNotes}
                onChange={(e) => setDraftNotes(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraftPolygon(null)}>
              Discard
            </Button>
            <Button onClick={handleSaveZone} disabled={createZone.isPending}>
              {createZone.isPending ? 'Saving…' : 'Save zone'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Site popup card */}
      {selectedNode && (
        <div className="absolute top-4 right-4 z-20 w-[360px] pointer-events-auto">
          <Card className="bg-card/95 backdrop-blur-md border-border shadow-2xl">
            <CardContent className="p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    {selectedNode.type ?? 'Site'} · {selectedNode.countryCode ?? '—'}
                  </span>
                  <h3 className="font-semibold text-base leading-tight">
                    {selectedNode.name ?? selectedNode.id}
                  </h3>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 -mr-1 -mt-1"
                  onClick={() => setSelectedNodeId(null)}
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="font-mono text-[10px] tracking-widest border"
                  style={tierBadgeStyle(selectedTier)}
                >
                  {selectedTier === 'critical' && <ShieldAlert className="h-3 w-3 mr-1 inline" />}
                  {selectedTier === 'heightened' && <AlertTriangle className="h-3 w-3 mr-1 inline" />}
                  {selectedTier === 'nominal' && <ShieldCheck className="h-3 w-3 mr-1 inline" />}
                  {TIER_LABEL[selectedTier]}
                </Badge>
                <Badge variant="outline" className="font-mono text-[10px] tracking-widest">
                  DOS {selectedRisk?.daysOfSupply ?? '—'}
                </Badge>
                {selectedRisk?.openAlerts > 0 && (
                  <Badge variant="destructive" className="font-mono text-[10px] tracking-widest">
                    {selectedRisk.openAlerts} OPEN
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] border-t border-border pt-2">
                <div className="flex items-start gap-1.5">
                  <ArrowDownToLine className="h-3 w-3 mt-0.5 text-emerald-400" />
                  <div>
                    <div className="text-muted-foreground uppercase tracking-widest text-[9px]">
                      Last shipment in
                    </div>
                    <div className="font-mono">{timeAgo(selectedRisk?.lastShipmentInAt)}</div>
                  </div>
                </div>
                <div className="flex items-start gap-1.5">
                  <ArrowUpFromLine className="h-3 w-3 mt-0.5 text-amber-400" />
                  <div>
                    <div className="text-muted-foreground uppercase tracking-widest text-[9px]">
                      Last shipment out
                    </div>
                    <div className="font-mono">{timeAgo(selectedRisk?.lastShipmentOutAt)}</div>
                  </div>
                </div>
              </div>

              {selectedRisk?.topCriticalItems && selectedRisk.topCriticalItems.length > 0 && (
                <div className="border-t border-border pt-2">
                  <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground mb-1.5">
                    Top critical items
                  </div>
                  <div className="flex flex-col gap-1">
                    {selectedRisk.topCriticalItems.slice(0, 3).map((it: any) => {
                      const itTier: ThreatTier =
                        it.daysOfSupply <= 5 ? 'critical' : it.daysOfSupply <= 14 ? 'heightened' : 'nominal';
                      return (
                        <div
                          key={it.itemId}
                          className="flex items-center justify-between text-xs gap-2"
                        >
                          <span className="truncate">{it.itemName}</span>
                          <span
                            className="font-mono text-[10px] px-1.5 py-0.5 rounded border"
                            style={tierBadgeStyle(itTier)}
                          >
                            {Number(it.daysOfSupply).toFixed(1)}d
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="border-t border-border pt-3 grid grid-cols-1 gap-2">
                <Link href={`/sites/${selectedNode.id}`}>
                  <Button
                    size="sm"
                    variant="default"
                    className="w-full justify-start"
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-2" />
                    Open site detail
                  </Button>
                </Link>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={handleResupply}
                  disabled={
                    createOrder.isPending ||
                    !(selectedRisk?.topCriticalItems && selectedRisk.topCriticalItems.length > 0)
                  }
                >
                  <Package className="h-3.5 w-3.5 mr-2" />
                  {createOrder.isPending ? 'Creating order…' : 'Order resupply'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={handleAck}
                  disabled={ackAlert.isPending || openAlertsForSelected.length === 0}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-2" />
                  {openAlertsForSelected.length > 0
                    ? `Acknowledge ${openAlertsForSelected.length} alert${openAlertsForSelected.length === 1 ? '' : 's'}`
                    : 'No open alerts'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Shipment popup card — appears when an animated trip is clicked */}
      {selectedShipment && (
        <div className="absolute top-4 right-4 z-20 w-[340px] pointer-events-auto">
          <Card className="bg-card/95 backdrop-blur-md border-border shadow-2xl">
            <CardContent className="p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                    {(() => {
                      const ModeIcon =
                        (selectedShipment.etaDays ?? 0) <= 1.5 ? Plane : Truck;
                      return <ModeIcon className="h-3 w-3" />;
                    })()}
                    In-flight shipment · {selectedShipment.priority ?? 'ROUTINE'}
                  </span>
                  <h3 className="font-semibold text-base leading-tight">
                    {selectedShipment.itemName ?? selectedShipment.itemId}
                  </h3>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 -mr-1 -mt-1"
                  onClick={() => setSelectedShipmentId(null)}
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {(() => {
                  const cat = (selectedShipment.category ?? 'other') as SupplyCategory;
                  const meta = CATEGORY_META[cat];
                  return (
                    <Badge
                      variant="outline"
                      className={`font-mono text-[10px] tracking-widest ${meta.tint}`}
                    >
                      <span className="mr-1 inline-flex">{meta.icon}</span>
                      {meta.label}
                    </Badge>
                  );
                })()}
                <Badge variant="outline" className="font-mono text-[10px] tracking-widest">
                  {selectedShipment.quantity} units
                </Badge>
                <Badge variant="outline" className="font-mono text-[10px] tracking-widest">
                  <Clock className="h-3 w-3 mr-1 inline" />
                  ETA {Number(selectedShipment.etaDays ?? 0).toFixed(1)}d
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] border-t border-border pt-2">
                <div className="flex items-start gap-1.5">
                  <ArrowUpFromLine className="h-3 w-3 mt-0.5 text-amber-400" />
                  <div>
                    <div className="text-muted-foreground uppercase tracking-widest text-[9px]">
                      Origin
                    </div>
                    <div className="font-mono truncate">
                      {shipmentFromNode?.name ?? selectedShipment.fromNode}
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-1.5">
                  <ArrowDownToLine className="h-3 w-3 mt-0.5 text-emerald-400" />
                  <div>
                    <div className="text-muted-foreground uppercase tracking-widest text-[9px]">
                      Destination
                    </div>
                    <div className="font-mono truncate">
                      {shipmentToNode?.name ?? selectedShipment.toNode}
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-border pt-2">
                <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground mb-1">
                  Trip progress
                </div>
                <div className="h-1.5 w-full bg-muted/40 rounded overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{
                      width: `${Math.round((Number(selectedShipment.progress) || 0) * 100)}%`,
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono mt-1 text-muted-foreground">
                  <span>{Math.round((Number(selectedShipment.progress) || 0) * 100)}%</span>
                  <span>arrives in {Number(selectedShipment.etaDays ?? 0).toFixed(1)}d</span>
                </div>
              </div>

              {shipmentToNode && (
                <Link href={`/sites/${shipmentToNode.id}`}>
                  <Button size="sm" variant="default" className="w-full justify-start">
                    <ExternalLink className="h-3.5 w-3.5 mr-2" />
                    Open destination site
                  </Button>
                </Link>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function TierPill({ tier, count }: { tier: ThreatTier; count: number }) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded border py-1"
      style={tierBadgeStyle(tier)}
    >
      <span>{TIER_LABEL[tier]}</span>
      <span className="text-base font-mono">{count}</span>
    </div>
  );
}
