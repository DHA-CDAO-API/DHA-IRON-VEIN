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
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
  Beaker,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Droplets,
  ExternalLink,
  Hexagon,
  Layers,
  MapPin,
  Package,
  Pencil,
  Plane,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Square,
  Stethoscope,
  Syringe,
  Trash2,
  Truck,
  X,
  Zap,
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

// ---------------------------------------------------------------------------
// Sub-layer taxonomy. The Layers panel groups items into a 2-level tree:
// top-level Group (Blood / Supplies / Custom) → Sub-layer (Whole Blood, PRBC,
// PPE, Cold-Chain, etc). Built-in sub-layers are derived from item metadata
// (productNoun for blood products, commodityType for supplies). Custom
// sub-layers are operator-defined and persisted in localStorage.
// ---------------------------------------------------------------------------

type GroupId = 'blood' | 'supplies' | 'custom';

type CatalogItem = {
  id: string;
  name: string;
  category?: string | null;
  commodityType?: string | null;
  productNoun?: string | null;
  criticality?: string | null;
};

type SubLayer = {
  id: string;            // unique within the group
  key: string;           // global key "group:sublayer-id"
  group: GroupId;
  name: string;
  itemIds: string[];
  // Implied categories so route-level filtering still works (routes don't
  // carry per-item granularity).
  categories: SupplyCategory[];
  icon: React.ReactNode;
  tint: string;
  color?: string;        // optional override (used by Custom layers)
  isCustom?: boolean;
};

const BLOOD_SUBLAYER_ORDER = [
  'LTOWB',
  'PRBC',
  'Plasma',
  'Platelets',
  'Cryo',
  'FDP',
] as const;
type BloodSubLayerName = (typeof BLOOD_SUBLAYER_ORDER)[number];

const BLOOD_SUBLAYER_META: Record<
  BloodSubLayerName,
  { label: string; tint: string; productNouns: string[]; itemIdPrefixes: string[] }
> = {
  LTOWB: {
    label: 'Whole Blood (LTOWB)',
    tint: 'text-rose-200',
    productNouns: ['Whole Blood'],
    itemIdPrefixes: ['ltow_'],
  },
  PRBC: {
    label: 'Red Cells (PRBC)',
    tint: 'text-rose-300',
    productNouns: ['Red Cells'],
    itemIdPrefixes: ['prbc_'],
  },
  Plasma: {
    label: 'Plasma (FFP / Liquid)',
    tint: 'text-amber-200',
    productNouns: ['Plasma'],
    itemIdPrefixes: ['ffp_', 'plasma_'],
  },
  Platelets: {
    label: 'Platelets',
    tint: 'text-yellow-200',
    productNouns: ['Platelets'],
    itemIdPrefixes: ['platelets'],
  },
  Cryo: {
    label: 'Cryoprecipitate',
    tint: 'text-cyan-200',
    productNouns: ['Cryoprecipitate'],
    itemIdPrefixes: ['cryo'],
  },
  FDP: {
    label: 'Freeze-Dried Plasma',
    tint: 'text-orange-200',
    productNouns: ['Plasma (Freeze-Dried)'],
    itemIdPrefixes: ['fdp'],
  },
};

// Component family (DB column on bloodLots) → which BloodSubLayerName it
// rolls up into. Used to slice viableByComponent into the panel breakdown.
const COMPONENT_TO_SUBLAYER: Record<string, BloodSubLayerName> = {
  LTOWB: 'LTOWB',
  PRBC: 'PRBC',
  FFP: 'Plasma',
  PLASMA: 'Plasma',
  PLATELETS: 'Platelets',
  CRYO: 'Cryo',
  FDP: 'FDP',
};

function bloodSubLayerFor(item: CatalogItem): BloodSubLayerName | null {
  if (item.category !== 'blood_products') return null;
  for (const name of BLOOD_SUBLAYER_ORDER) {
    const meta = BLOOD_SUBLAYER_META[name];
    if (item.productNoun && meta.productNouns.includes(item.productNoun)) return name;
    if (meta.itemIdPrefixes.some((p) => item.id === p || item.id.startsWith(p))) return name;
  }
  return null;
}

const SUPPLY_SUBLAYER_ORDER = [
  'PPE',
  'Testing',
  'Cold-Chain',
  'Transfusion',
  'Phlebotomy',
  'Trauma & Care',
] as const;
type SupplySubLayerName = (typeof SUPPLY_SUBLAYER_ORDER)[number];

const SUPPLY_SUBLAYER_META: Record<
  SupplySubLayerName,
  { tint: string; icon: React.ReactNode; commodityTypes?: string[] }
> = {
  PPE: { tint: 'text-violet-300', icon: <ShieldCheck className="h-3.5 w-3.5" /> },
  Testing: {
    tint: 'text-emerald-300',
    icon: <Beaker className="h-3.5 w-3.5" />,
    commodityTypes: ['Blood Bank Reagent', 'Diagnostic Reagent'],
  },
  'Cold-Chain': {
    tint: 'text-sky-300',
    icon: <Snowflake className="h-3.5 w-3.5" />,
    commodityTypes: ['Cold Chain'],
  },
  Transfusion: {
    tint: 'text-rose-300',
    icon: <Zap className="h-3.5 w-3.5" />,
    commodityTypes: ['IV Administration', 'Patient ID'],
  },
  Phlebotomy: {
    tint: 'text-amber-300',
    icon: <Syringe className="h-3.5 w-3.5" />,
    commodityTypes: [
      'Phlebotomy',
      'Antiseptic',
      'Wound Care',
      'Hemorrhage Control',
      'Specimen Transport',
      'Lab Admin',
    ],
  },
  'Trauma & Care': {
    tint: 'text-slate-300',
    icon: <Stethoscope className="h-3.5 w-3.5" />,
  },
};

function supplySubLayerFor(item: CatalogItem): SupplySubLayerName | null {
  // PPE is its own top-level item-category; fold it under Supplies for the panel.
  if (item.category === 'ppe') return 'PPE';
  if (item.category !== 'supplies') return null;
  const ct = item.commodityType ?? '';
  for (const name of SUPPLY_SUBLAYER_ORDER) {
    const meta = SUPPLY_SUBLAYER_META[name];
    if (meta.commodityTypes?.includes(ct)) return name;
  }
  return 'Trauma & Care';
}

// Custom layer payload persisted in localStorage. Versioned so future schema
// changes (e.g. adding `description`, `criticalOnly`) can no-op older blobs
// without throwing parse errors.
type CustomLayer = {
  id: string;
  name: string;
  color: string;
  itemIds: string[];
  createdAt: string;
};

const CUSTOM_LAYERS_KEY = 'command:network:custom-layers';
const CUSTOM_LAYERS_VERSION = 1;

const CUSTOM_LAYER_COLORS = [
  '#a78bfa', // violet
  '#34d399', // emerald
  '#f472b6', // pink
  '#fbbf24', // amber
  '#60a5fa', // blue
  '#22d3ee', // cyan
  '#fb923c', // orange
  '#f87171', // red
];

function loadCustomLayers(): CustomLayer[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_LAYERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== CUSTOM_LAYERS_VERSION) return [];
    if (!Array.isArray(parsed.layers)) return [];
    // Filter out malformed entries so a single bad blob doesn't break the panel.
    return parsed.layers.filter(
      (l: any) =>
        typeof l?.id === 'string' &&
        typeof l?.name === 'string' &&
        Array.isArray(l?.itemIds),
    );
  } catch {
    return [];
  }
}

function saveCustomLayers(layers: CustomLayer[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      CUSTOM_LAYERS_KEY,
      JSON.stringify({ version: CUSTOM_LAYERS_VERSION, layers }),
    );
  } catch {
    // Quota / private-mode failures shouldn't break the panel.
  }
}

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

  // Layer panel state. `selectedSubLayerKeys` holds keys of the form
  // `${groupId}:${sublayerId}`. Empty set === "show everything" (the panel
  // header surfaces an "All" pill when nothing is selected).
  const [selectedSubLayerKeys, setSelectedSubLayerKeys] = useState<Set<string>>(
    () => new Set<string>(),
  );
  // Per-group collapsed state — Blood + Supplies open by default, Custom
  // opens automatically once the operator creates their first custom layer.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<GroupId>>(
    () => new Set<GroupId>([]),
  );
  const [layerSearch, setLayerSearch] = useState('');
  const [customLayers, setCustomLayers] = useState<CustomLayer[]>(() =>
    loadCustomLayers(),
  );
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [editingCustomId, setEditingCustomId] = useState<string | null>(null);
  // Tier filter driven by Blood Readiness chips. Dims non-matching nodes on
  // the map and narrows the fragile-sites list to the chosen tier.
  const [bloodTierFilter, setBloodTierFilter] = useState<ThreatTier | null>(null);

  const [showThreats, setShowThreats] = useState(true);
  const [showAOR, setShowAOR] = useState(true);
  const [showZones, setShowZones] = useState(true);

  // Motion / animation preference. Default is animation ON because the live
  // pulse / convoy motion is part of the situational-awareness signal in a
  // command-centre dashboard. We still surface the OS-level
  // `prefers-reduced-motion` hint so the user can flip the toggle off in
  // one click via the Layers panel, and any explicit override wins.
  const prefersReducedMotion = usePrefersReducedMotion();
  const [animateOverride, setAnimateOverride] = useState<boolean | null>(null);
  const animateMap = animateOverride ?? true;

  // Collapsible Layers card (persisted in localStorage)
  const LAYERS_COLLAPSED_KEY = 'command:network:layers-collapsed';
  const [layersCollapsed, setLayersCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(LAYERS_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleLayersCollapsed = () => {
    setLayersCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(LAYERS_COLLAPSED_KEY, next ? '1' : '0');
      } catch {}
      return next;
    });
  };

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

  const totalInFlight = shipmentsList.length;

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

  // ---------------------------------------------------------------------------
  // Sub-layer tree. Built from the snapshot's item catalog so categorisation
  // changes server-side automatically flow through to the panel without
  // touching client constants. Empty sub-layers (e.g. FDP when the seed has
  // none) are kept so the operator can still see what's available; the
  // in-flight badge will read 0.
  // ---------------------------------------------------------------------------
  const itemsCatalog = useMemo<CatalogItem[]>(
    () => ((snapshot as any)?.items ?? []) as CatalogItem[],
    [snapshot],
  );
  const itemById = useMemo(
    () => new Map(itemsCatalog.map((i) => [i.id, i])),
    [itemsCatalog],
  );

  const { bloodSubLayers, supplySubLayers } = useMemo(() => {
    const bloodBuckets = new Map<BloodSubLayerName, string[]>();
    for (const name of BLOOD_SUBLAYER_ORDER) bloodBuckets.set(name, []);
    const supplyBuckets = new Map<SupplySubLayerName, string[]>();
    for (const name of SUPPLY_SUBLAYER_ORDER) supplyBuckets.set(name, []);
    for (const item of itemsCatalog) {
      const blood = bloodSubLayerFor(item);
      if (blood) bloodBuckets.get(blood)!.push(item.id);
      const supply = supplySubLayerFor(item);
      if (supply) supplyBuckets.get(supply)!.push(item.id);
    }
    const blood: SubLayer[] = BLOOD_SUBLAYER_ORDER.map((name) => ({
      id: name,
      key: `blood:${name}`,
      group: 'blood',
      name: BLOOD_SUBLAYER_META[name].label,
      itemIds: bloodBuckets.get(name) ?? [],
      categories: ['blood_products'],
      icon: <Droplets className="h-3.5 w-3.5" />,
      tint: BLOOD_SUBLAYER_META[name].tint,
    }));
    const supplies: SubLayer[] = SUPPLY_SUBLAYER_ORDER.map((name) => {
      const itemIds = supplyBuckets.get(name) ?? [];
      // PPE rolls into the legacy `ppe` category; everything else is `supplies`.
      const cats: SupplyCategory[] = name === 'PPE' ? ['ppe'] : ['supplies'];
      return {
        id: name,
        key: `supplies:${name}`,
        group: 'supplies' as const,
        name,
        itemIds,
        categories: cats,
        icon: SUPPLY_SUBLAYER_META[name].icon,
        tint: SUPPLY_SUBLAYER_META[name].tint,
      };
    });
    return { bloodSubLayers: blood, supplySubLayers: supplies };
  }, [itemsCatalog]);

  // Custom layers materialised as SubLayer rows so they render through the
  // same group-row component as built-ins.
  const customSubLayers = useMemo<SubLayer[]>(
    () =>
      customLayers.map((l) => {
        const cats = new Set<SupplyCategory>();
        for (const id of l.itemIds) {
          const it = itemById.get(id);
          if (it?.category === 'blood_products') cats.add('blood_products');
          else if (it?.category === 'ppe') cats.add('ppe');
          else if (it?.category === 'supplies') cats.add('supplies');
          else cats.add('other');
        }
        return {
          id: l.id,
          key: `custom:${l.id}`,
          group: 'custom' as const,
          name: l.name,
          itemIds: l.itemIds,
          categories: Array.from(cats),
          icon: <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: l.color }}
          />,
          tint: 'text-foreground',
          color: l.color,
          isCustom: true,
        };
      }),
    [customLayers, itemById],
  );

  const allSubLayers = useMemo(
    () => [...bloodSubLayers, ...supplySubLayers, ...customSubLayers],
    [bloodSubLayers, supplySubLayers, customSubLayers],
  );

  // Persist custom layers to localStorage on every change (versioned blob,
  // capped to in-memory state — no debounce needed at this volume).
  React.useEffect(() => {
    saveCustomLayers(customLayers);
  }, [customLayers]);

  // Per-sub-layer in-flight count. We index shipments by itemId once so the
  // badges all rebuild in O(items + shipments) rather than O(items × shipments).
  const shipmentsByItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of shipmentsList) {
      const k = (s as any)?.itemId as string | undefined;
      if (!k) continue;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [shipmentsList]);

  const inFlightForSubLayer = (sl: SubLayer): number => {
    let n = 0;
    for (const id of sl.itemIds) n += shipmentsByItem.get(id) ?? 0;
    return n;
  };

  // Build the actual map filter from selected sub-layers. Empty selection
  // means the snapshot's full graph stays visible.
  const layerSelection = useMemo(() => {
    const itemIds = new Set<string>();
    const categories = new Set<string>();
    for (const sl of allSubLayers) {
      if (!selectedSubLayerKeys.has(sl.key)) continue;
      for (const id of sl.itemIds) itemIds.add(id);
      for (const c of sl.categories) categories.add(c);
    }
    return { itemIds, categories };
  }, [allSubLayers, selectedSubLayerKeys]);

  // Filter the visible sub-layer tree by the search query (matches sub-layer
  // name AND any item name inside the sub-layer for power users).
  const matchSearch = (sl: SubLayer, q: string): boolean => {
    if (!q) return true;
    const needle = q.toLowerCase();
    if (sl.name.toLowerCase().includes(needle)) return true;
    for (const id of sl.itemIds) {
      const it = itemById.get(id);
      if (it?.name?.toLowerCase().includes(needle)) return true;
    }
    return false;
  };

  const toggleSubLayer = (key: string) => {
    setSelectedSubLayerKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleGroup = (g: GroupId) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  // Blood readiness rollup — per-tier counts, per-component viable totals,
  // 72h-expiring sum, and the 5 most-fragile sites by viable DOS.
  type BloodRow = {
    nodeId: string;
    viableDaysOfSupply: number;
    totalViableUnits: number;
    unitsExpiringWithin72h?: number;
    tier: ThreatTier;
    viableByComponent?: Record<string, number>;
  };
  const bloodRollup = useMemo(() => {
    const rows = ((snapshot as any)?.bloodReadinessByNode ?? []) as BloodRow[];
    const counts: Record<ThreatTier, number> = { nominal: 0, heightened: 0, critical: 0 };
    const viableBySubLayer: Record<BloodSubLayerName, number> = {
      LTOWB: 0,
      PRBC: 0,
      Plasma: 0,
      Platelets: 0,
      Cryo: 0,
      FDP: 0,
    };
    let expiringTotal = 0;
    let viableTotal = 0;
    for (const r of rows) {
      counts[r.tier ?? 'nominal']++;
      expiringTotal += r.unitsExpiringWithin72h ?? 0;
      viableTotal += r.totalViableUnits ?? 0;
      const byC = r.viableByComponent ?? {};
      for (const [comp, units] of Object.entries(byC)) {
        const sub = COMPONENT_TO_SUBLAYER[comp];
        if (sub) viableBySubLayer[sub] += units;
      }
    }
    const fragile = [...rows].sort(
      (a, b) => (a.viableDaysOfSupply ?? 999) - (b.viableDaysOfSupply ?? 999),
    );
    return {
      counts,
      fragile,
      total: rows.length,
      viableBySubLayer,
      expiringTotal,
      viableTotal,
    };
  }, [snapshot]);

  // Set of node ids that hold blood — used by the map to scope tier dimming
  // when the operator clicks a blood-readiness chip (so non-blood sites stay
  // at full opacity).
  const bloodNodeIds = useMemo(
    () => new Set(bloodRollup.fragile.map((r) => r.nodeId)),
    [bloodRollup],
  );

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
      {/* Left rail — Layers + Blood Readiness + Theater Zones, all in a
          single full-height scroll column so the cards share one scroll
          context and use the available height naturally. */}
      <div className="absolute top-4 bottom-4 left-4 z-10 w-80 pointer-events-auto flex flex-col gap-4 overflow-y-auto network-rail pr-1 -mr-1">
        <Card className="bg-card/85 backdrop-blur-md border-border shadow-2xl">
          <CardContent className={`p-4 flex flex-col ${layersCollapsed ? 'gap-0' : 'gap-3'}`}>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={toggleLayersCollapsed}
                aria-expanded={!layersCollapsed}
                aria-controls="network-layers-body"
                className="flex items-center gap-2 -ml-1 px-1 py-0.5 rounded hover:bg-muted/40 transition cursor-pointer"
                title={layersCollapsed ? 'Expand layers' : 'Collapse layers'}
              >
                {layersCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <Layers className="h-4 w-4 text-primary" />
                <h3 className="font-semibold text-sm tracking-wider uppercase text-muted-foreground">
                  Layers
                </h3>
                {layersCollapsed && (
                  <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
                    · {selectedSubLayerKeys.size === 0
                      ? 'all'
                      : `${selectedSubLayerKeys.size} on`}
                  </span>
                )}
              </button>
              {!layersCollapsed && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px] font-mono uppercase tracking-wider"
                  onClick={() => setSelectedSubLayerKeys(new Set())}
                  disabled={selectedSubLayerKeys.size === 0}
                  data-testid="layers-clear"
                >
                  All
                </Button>
              )}
            </div>

            {!layersCollapsed && (
              <div id="network-layers-body" className="flex flex-col gap-3">
                <div
                  className="flex items-center justify-between rounded border border-border/60 bg-muted/30 px-2 py-1"
                  data-testid="in-flight-total"
                >
                  <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    <Plane className="h-3 w-3 text-primary" />
                    In flight
                  </div>
                  <span className="font-mono text-xs text-foreground tabular-nums">
                    {totalInFlight}
                  </span>
                </div>

                {/* Search box — narrows the visible sub-layer list. Empty
                    sub-layers (no items match) are hidden while a query is active. */}
                <div className="relative">
                  <Search className="h-3 w-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    value={layerSearch}
                    onChange={(e) => setLayerSearch(e.target.value)}
                    placeholder="Search layers or items…"
                    className="h-7 pl-6 pr-7 text-xs"
                    data-testid="layer-search"
                  />
                  {layerSearch && (
                    <button
                      type="button"
                      onClick={() => setLayerSearch('')}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label="Clear search"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>

                <LayerGroupSection
                  groupId="blood"
                  title="Blood Products"
                  icon={<Droplets className="h-3.5 w-3.5 text-rose-300" />}
                  subLayers={bloodSubLayers}
                  search={layerSearch}
                  matchSearch={matchSearch}
                  selected={selectedSubLayerKeys}
                  collapsed={collapsedGroups.has('blood')}
                  onToggleCollapsed={() => toggleGroup('blood')}
                  onToggleSubLayer={toggleSubLayer}
                  inFlight={inFlightForSubLayer}
                />

                <LayerGroupSection
                  groupId="supplies"
                  title="Supplies"
                  icon={<Package className="h-3.5 w-3.5 text-teal-300" />}
                  subLayers={supplySubLayers}
                  search={layerSearch}
                  matchSearch={matchSearch}
                  selected={selectedSubLayerKeys}
                  collapsed={collapsedGroups.has('supplies')}
                  onToggleCollapsed={() => toggleGroup('supplies')}
                  onToggleSubLayer={toggleSubLayer}
                  inFlight={inFlightForSubLayer}
                />

                <LayerGroupSection
                  groupId="custom"
                  title="Custom"
                  icon={<Sparkles className="h-3.5 w-3.5 text-amber-300" />}
                  subLayers={customSubLayers}
                  search={layerSearch}
                  matchSearch={matchSearch}
                  selected={selectedSubLayerKeys}
                  collapsed={collapsedGroups.has('custom')}
                  onToggleCollapsed={() => toggleGroup('custom')}
                  onToggleSubLayer={toggleSubLayer}
                  inFlight={inFlightForSubLayer}
                  emptyHint="No custom layers yet."
                  onEditCustom={(id) => {
                    setEditingCustomId(id);
                    setCustomDialogOpen(true);
                  }}
                  onDeleteCustom={(id) => {
                    setCustomLayers((prev) => prev.filter((l) => l.id !== id));
                    setSelectedSubLayerKeys((prev) => {
                      const next = new Set(prev);
                      next.delete(`custom:${id}`);
                      return next;
                    });
                  }}
                />

                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 justify-center text-xs"
                  onClick={() => {
                    setEditingCustomId(null);
                    setCustomDialogOpen(true);
                  }}
                  data-testid="add-custom-layer"
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Custom Layer
                </Button>
              </div>
            )}

            {!layersCollapsed && (
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
            )}

            {!layersCollapsed && (
            <div className="border-t border-border pt-2 grid grid-cols-3 gap-1 text-[10px] font-mono uppercase tracking-wider">
              <TierPill tier="critical" count={tierCounts.critical} />
              <TierPill tier="heightened" count={tierCounts.heightened} />
              <TierPill tier="nominal" count={tierCounts.nominal} />
            </div>
            )}
          </CardContent>
        </Card>

        {/* Blood Readiness widget — clickable tier chips dim non-matching
            nodes on the map and narrow the fragile list, plus a per-component
            viable-units breakdown and a 72h-expiring total. */}
        <Card className="bg-card/85 backdrop-blur-md border-border shadow-2xl">
          <CardContent className="p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Droplets className="h-4 w-4 text-rose-300" />
                <h3 className="font-semibold text-sm tracking-wider uppercase text-muted-foreground">
                  Blood Readiness
                </h3>
              </div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                {bloodRollup.total} {bloodRollup.total === 1 ? 'site' : 'sites'}
              </span>
            </div>

            <TooltipProvider delayDuration={200}>
              <div className="grid grid-cols-3 gap-1 text-[10px] font-mono uppercase tracking-wider">
                <TierChip
                  tier="critical"
                  count={bloodRollup.counts.critical}
                  label="≤3d"
                  active={bloodTierFilter === 'critical'}
                  onClick={() =>
                    setBloodTierFilter((p) => (p === 'critical' ? null : 'critical'))
                  }
                  tooltip="Sites with viable blood DOS ≤ 3 days"
                />
                <TierChip
                  tier="heightened"
                  count={bloodRollup.counts.heightened}
                  label="≤7d"
                  active={bloodTierFilter === 'heightened'}
                  onClick={() =>
                    setBloodTierFilter((p) => (p === 'heightened' ? null : 'heightened'))
                  }
                  tooltip="Sites with viable blood DOS between 3 and 7 days"
                />
                <TierChip
                  tier="nominal"
                  count={bloodRollup.counts.nominal}
                  label=">7d"
                  active={bloodTierFilter === 'nominal'}
                  onClick={() =>
                    setBloodTierFilter((p) => (p === 'nominal' ? null : 'nominal'))
                  }
                  tooltip="Sites with viable blood DOS > 7 days"
                />
              </div>
            </TooltipProvider>

            {bloodTierFilter && (
              <button
                type="button"
                onClick={() => setBloodTierFilter(null)}
                className="self-start flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground"
                data-testid="blood-tier-clear"
              >
                <X className="h-3 w-3" />
                Clear tier filter
              </button>
            )}

            {/* Per-component viable units breakdown + 72h expiring total */}
            <div className="border-t border-border pt-2 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">
                  Viable units · by component
                </span>
                <span
                  className="font-mono text-[10px] tabular-nums text-foreground"
                  data-testid="blood-viable-total"
                >
                  {bloodRollup.viableTotal.toLocaleString()}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {BLOOD_SUBLAYER_ORDER.map((c) => (
                  <div
                    key={c}
                    className="rounded border border-border/60 bg-muted/30 px-1.5 py-1 flex flex-col"
                    data-testid={`blood-component-${c}`}
                  >
                    <span className={`text-[9px] font-mono uppercase tracking-widest ${BLOOD_SUBLAYER_META[c].tint}`}>
                      {c}
                    </span>
                    <span className="font-mono text-xs tabular-nums">
                      {bloodRollup.viableBySubLayer[c].toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
              <div
                className={`flex items-center justify-between rounded border px-2 py-1 mt-1 ${
                  bloodRollup.expiringTotal > 0
                    ? 'border-amber-500/40 bg-amber-500/10'
                    : 'border-border/60 bg-muted/30'
                }`}
                data-testid="blood-expiring-72h"
              >
                <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  Expiring ≤72h
                </span>
                <span
                  className={`font-mono text-xs tabular-nums ${
                    bloodRollup.expiringTotal > 0 ? 'text-amber-200' : 'text-foreground'
                  }`}
                >
                  {bloodRollup.expiringTotal.toLocaleString()} units
                </span>
              </div>
            </div>

            <div className="border-t border-border pt-2 flex flex-col gap-1">
              <div className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground mb-0.5">
                {bloodTierFilter
                  ? `${TIER_LABEL[bloodTierFilter]} sites`
                  : 'Most fragile · viable blood DOS'}
              </div>
              {(() => {
                const filtered = bloodTierFilter
                  ? bloodRollup.fragile.filter(
                      (r) => (r.tier ?? 'nominal') === bloodTierFilter,
                    )
                  : bloodRollup.fragile.slice(0, 5);
                if (filtered.length === 0) {
                  return (
                    <div className="text-[11px] text-muted-foreground italic px-1 py-1.5">
                      {bloodTierFilter
                        ? 'No sites match this tier.'
                        : 'No blood-storing sites in snapshot.'}
                    </div>
                  );
                }
                return filtered.slice(0, 6).map((row) => {
                  const node = nodeById.get(row.nodeId) as any;
                  const name = node?.name ?? row.nodeId;
                  const dos = row.viableDaysOfSupply ?? 0;
                  const tier = (row.tier ?? 'nominal') as ThreatTier;
                  return (
                    <Link
                      key={row.nodeId}
                      href={`/sites/${row.nodeId}?tab=blood-readiness`}
                      data-testid={`blood-fragile-${row.nodeId}`}
                      className="flex items-center justify-between gap-2 rounded border border-transparent hover:border-border hover:bg-muted/30 px-2 py-1 cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span
                          className="inline-block h-2 w-2 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: `rgb(${TIER_COLOR[tier][0]}, ${TIER_COLOR[tier][1]}, ${TIER_COLOR[tier][2]})`,
                          }}
                        />
                        <span className="text-xs truncate" title={name}>
                          {name}
                        </span>
                      </div>
                      <span
                        className="font-mono text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap"
                        style={tierBadgeStyle(tier)}
                      >
                        {dos >= 999 ? '∞' : `${dos.toFixed(1)}d`}
                      </span>
                    </Link>
                  );
                });
              })()}
            </div>
          </CardContent>
        </Card>

        {/* Theater Zones panel — third card in the same left rail. */}
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
          layerSelection={layerSelection}
          tierFilter={bloodTierFilter}
          bloodNodeIds={bloodNodeIds}
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

      {/* Custom Layer dialog — create or edit a user-defined sub-layer.
          Saved blob is persisted to localStorage via the customLayers effect. */}
      <CustomLayerDialog
        open={customDialogOpen}
        onOpenChange={(open) => {
          setCustomDialogOpen(open);
          if (!open) setEditingCustomId(null);
        }}
        editing={
          editingCustomId
            ? customLayers.find((l) => l.id === editingCustomId) ?? null
            : null
        }
        items={itemsCatalog}
        onSave={(layer) => {
          setCustomLayers((prev) => {
            const idx = prev.findIndex((l) => l.id === layer.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = layer;
              return next;
            }
            return [...prev, layer];
          });
          setCollapsedGroups((prev) => {
            const next = new Set(prev);
            next.delete('custom');
            return next;
          });
          setSelectedSubLayerKeys((prev) => {
            const next = new Set(prev);
            next.add(`custom:${layer.id}`);
            return next;
          });
          setCustomDialogOpen(false);
          setEditingCustomId(null);
        }}
      />

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

              {selectedShipment.orderId && (
                <Link href={`/orders/${selectedShipment.orderId}`}>
                  <Button size="sm" variant="default" className="w-full justify-start">
                    <Package className="h-3.5 w-3.5 mr-2" />
                    Open order
                  </Button>
                </Link>
              )}
              {shipmentToNode && (
                <Link href={`/sites/${shipmentToNode.id}`}>
                  <Button
                    size="sm"
                    variant={selectedShipment.orderId ? "outline" : "default"}
                    className="w-full justify-start"
                  >
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

// Clickable tier chip used in the Blood Readiness widget. Behaves like
// `TierPill` visually but adds an active state and a tooltip explaining
// the tier definition (≤3d / ≤7d / >7d).
function TierChip({
  tier,
  count,
  label,
  active,
  onClick,
  tooltip,
}: {
  tier: ThreatTier;
  count: number;
  label: string;
  active: boolean;
  onClick: () => void;
  tooltip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-pressed={active}
          data-testid={`blood-tier-${tier}`}
          className={`flex flex-col items-center justify-center rounded border py-1 transition cursor-pointer ${
            active ? 'ring-2 ring-offset-1 ring-offset-background ring-foreground/40' : ''
          }`}
          style={tierBadgeStyle(tier)}
        >
          <span>{label}</span>
          <span className="text-base font-mono leading-none mt-0.5">{count}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <span className="text-xs">{tooltip}</span>
      </TooltipContent>
    </Tooltip>
  );
}

// Renders a collapsible group inside the Layers panel. Filters its children
// by the search query and shows an in-flight badge per sub-layer.
function LayerGroupSection({
  groupId,
  title,
  icon,
  subLayers,
  search,
  matchSearch,
  selected,
  collapsed,
  onToggleCollapsed,
  onToggleSubLayer,
  inFlight,
  emptyHint,
  onEditCustom,
  onDeleteCustom,
}: {
  groupId: GroupId;
  title: string;
  icon: React.ReactNode;
  subLayers: SubLayer[];
  search: string;
  matchSearch: (sl: SubLayer, q: string) => boolean;
  selected: Set<string>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onToggleSubLayer: (key: string) => void;
  inFlight: (sl: SubLayer) => number;
  emptyHint?: string;
  onEditCustom?: (id: string) => void;
  onDeleteCustom?: (id: string) => void;
}) {
  const visible = subLayers.filter((sl) => matchSearch(sl, search));
  const onCount = visible.filter((sl) => selected.has(sl.key)).length;

  // When the user is searching, force the group open so matches are visible
  // even if they had collapsed it earlier.
  const effectivelyCollapsed = collapsed && !search;

  // Hide groups that have nothing matching the active search to keep the
  // panel compact.
  if (search && visible.length === 0) return null;

  return (
    <div className="flex flex-col" data-testid={`layer-group-${groupId}`}>
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-expanded={!effectivelyCollapsed}
        className="flex items-center gap-1.5 px-1 py-0.5 -ml-1 rounded hover:bg-muted/40 transition cursor-pointer"
      >
        {effectivelyCollapsed ? (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        )}
        {icon}
        <span className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
          {title}
        </span>
        <span className="ml-auto text-[10px] font-mono tabular-nums text-muted-foreground/70">
          {onCount > 0 ? `${onCount}/${visible.length}` : visible.length}
        </span>
      </button>
      {!effectivelyCollapsed && (
        <div className="flex flex-col gap-0.5 mt-1 pl-3">
          {visible.length === 0 && emptyHint && (
            <div className="text-[10px] italic text-muted-foreground px-1 py-1">
              {emptyHint}
            </div>
          )}
          {visible.map((sl) => {
            const checked = selected.has(sl.key);
            const inFltCount = inFlight(sl);
            return (
              <div
                key={sl.key}
                className={`flex items-center gap-2 rounded px-1.5 py-1 transition border group ${
                  checked
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-transparent hover:bg-muted/40'
                }`}
              >
                <Checkbox
                  id={`sublayer-${sl.key}`}
                  checked={checked}
                  onCheckedChange={() => onToggleSubLayer(sl.key)}
                  data-testid={`sublayer-${sl.key}`}
                />
                <Label
                  htmlFor={`sublayer-${sl.key}`}
                  className={`flex items-center gap-1.5 flex-1 text-xs cursor-pointer ${sl.tint}`}
                >
                  {sl.icon}
                  <span className="text-foreground truncate">{sl.name}</span>
                </Label>
                <span
                  className="font-mono text-[10px] tabular-nums px-1 py-0.5 rounded border border-border/60 bg-background/60 text-muted-foreground min-w-[1.5rem] text-center"
                  title={`${inFltCount} in flight`}
                >
                  {inFltCount}
                </span>
                {sl.isCustom && onEditCustom && onDeleteCustom && (
                  <div className="flex items-center opacity-0 group-hover:opacity-100 transition">
                    <button
                      type="button"
                      onClick={() => onEditCustom(sl.id)}
                      className="p-0.5 text-muted-foreground hover:text-foreground"
                      aria-label={`Edit ${sl.name}`}
                      title="Edit"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteCustom(sl.id)}
                      className="p-0.5 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${sl.name}`}
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Create / edit dialog for a custom layer. Items are grouped by the
// built-in sub-layer (Blood components or Supplies functional buckets) so
// the picker matches the panel hierarchy. A search field narrows the list.
function CustomLayerDialog({
  open,
  onOpenChange,
  editing,
  items,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: CustomLayer | null;
  items: CatalogItem[];
  onSave: (layer: CustomLayer) => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(CUSTOM_LAYER_COLORS[0]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  // Reset/seed form whenever the dialog opens for a new or existing layer.
  React.useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setColor(editing.color);
      setPicked(new Set(editing.itemIds));
    } else {
      setName('');
      setColor(CUSTOM_LAYER_COLORS[Math.floor(Math.random() * CUSTOM_LAYER_COLORS.length)]);
      setPicked(new Set());
    }
    setQuery('');
  }, [open, editing]);

  const grouped = useMemo(() => {
    const buckets: { id: string; label: string; items: CatalogItem[] }[] = [];
    const bloodMap = new Map<string, CatalogItem[]>();
    const supplyMap = new Map<string, CatalogItem[]>();
    const other: CatalogItem[] = [];
    for (const it of items) {
      const blood = bloodSubLayerFor(it);
      if (blood) {
        if (!bloodMap.has(blood)) bloodMap.set(blood, []);
        bloodMap.get(blood)!.push(it);
        continue;
      }
      const supply = supplySubLayerFor(it);
      if (supply) {
        if (!supplyMap.has(supply)) supplyMap.set(supply, []);
        supplyMap.get(supply)!.push(it);
        continue;
      }
      other.push(it);
    }
    for (const name of BLOOD_SUBLAYER_ORDER) {
      const arr = bloodMap.get(name) ?? [];
      if (arr.length) buckets.push({ id: `blood:${name}`, label: `Blood · ${name}`, items: arr });
    }
    for (const name of SUPPLY_SUBLAYER_ORDER) {
      const arr = supplyMap.get(name) ?? [];
      if (arr.length) buckets.push({ id: `supplies:${name}`, label: `Supplies · ${name}`, items: arr });
    }
    if (other.length) buckets.push({ id: 'other', label: 'Other', items: other });
    return buckets;
  }, [items]);

  const filteredGrouped = useMemo(() => {
    if (!query) return grouped;
    const q = query.toLowerCase();
    return grouped
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (it) =>
            it.name.toLowerCase().includes(q) ||
            (it.productNoun ?? '').toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [grouped, query]);

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canSave = name.trim().length > 0 && picked.size > 0;

  const handleSave = () => {
    if (!canSave) return;
    const id = editing?.id ?? `cl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    onSave({
      id,
      name: name.trim(),
      color,
      itemIds: Array.from(picked),
      createdAt: editing?.createdAt ?? new Date().toISOString(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Custom Layer' : 'New Custom Layer'}</DialogTitle>
          <DialogDescription>
            Pick the items this layer should include. Selected items become
            their own filterable sub-layer in the Layers panel.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <Label htmlFor="custom-layer-name" className="text-xs">Name</Label>
              <Input
                id="custom-layer-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Surgical Resupply Kit"
                className="h-8 mt-1"
                data-testid="custom-layer-name"
                autoFocus
              />
            </div>
            <div>
              <Label className="text-xs">Color</Label>
              <div className="flex items-center gap-1 mt-1">
                {CUSTOM_LAYER_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`Color ${c}`}
                    className={`h-6 w-6 rounded-full border-2 transition ${
                      color === c
                        ? 'border-foreground scale-110'
                        : 'border-transparent hover:border-muted-foreground/40'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search items by name…"
              className="h-8 pl-7"
              data-testid="custom-layer-item-search"
            />
          </div>

          <div className="border rounded max-h-72 overflow-y-auto">
            {filteredGrouped.length === 0 && (
              <div className="text-xs text-muted-foreground italic p-3">
                No items match this search.
              </div>
            )}
            {filteredGrouped.map((g) => (
              <div key={g.id} className="border-b border-border last:border-0">
                <div className="px-2 py-1 bg-muted/30 text-[10px] font-mono uppercase tracking-widest text-muted-foreground sticky top-0">
                  {g.label}
                </div>
                <div className="flex flex-col">
                  {g.items.map((it) => {
                    const checked = picked.has(it.id);
                    return (
                      <label
                        key={it.id}
                        className={`flex items-center gap-2 px-2 py-1 cursor-pointer text-xs hover:bg-muted/40 ${
                          checked ? 'bg-primary/5' : ''
                        }`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => togglePick(it.id)}
                          data-testid={`custom-layer-item-${it.id}`}
                        />
                        <span className="flex-1 truncate" title={it.name}>{it.name}</span>
                        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                          {it.commodityType ?? it.category}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            {picked.size} item{picked.size === 1 ? '' : 's'} selected
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!canSave}
            data-testid="custom-layer-save"
          >
            {editing ? 'Save changes' : 'Create layer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
