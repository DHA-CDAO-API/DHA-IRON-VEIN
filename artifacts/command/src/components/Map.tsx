import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Map as MapLibre } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import DeckGL from '@deck.gl/react';
import {
  ScatterplotLayer,
  ArcLayer,
  PathLayer,
  ColumnLayer,
  PolygonLayer,
} from '@deck.gl/layers';
import { TripsLayer } from '@deck.gl/geo-layers';
import { type MapViewState } from '@deck.gl/core';

export type SupplyCategory = 'blood_products' | 'supplies' | 'ppe' | 'other';
export type ThreatTier = 'nominal' | 'heightened' | 'critical';

export type ZoneDrawMode = null | 'rectangle' | 'polygon';

export type ZoneSeverity = 'WATCH' | 'WARNING' | 'CRITICAL';

export interface TheaterZone {
  id: string;
  name: string;
  severity: ZoneSeverity;
  kind?: string;
  polygon: number[][];
  notes?: string | null;
  createdBy?: string | null;
  createdAt?: string;
}

export const ZONE_SEVERITY_COLOR: Record<ZoneSeverity, [number, number, number]> = {
  WATCH: [232, 168, 76],
  WARNING: [232, 120, 76],
  CRITICAL: [220, 64, 76],
};

interface NetworkMapProps {
  nodes?: any[];
  routes?: any[];
  shipments?: any[];
  threats?: any[];
  riskByNode?: any[];
  aorBoundary?: number[][];
  /**
   * Operator-drawn theater zones rendered as filled polygons distinct from
   * the canonical THREAT overlays (those use a dashed outline style).
   */
  zones?: TheaterZone[];
  /**
   * IDs of zones to render in a "selected" highlight state (used to preview
   * which zones a scenario will reference).
   */
  highlightedZoneIds?: Set<string>;
  /**
   * Set of categories the user has selected via the layer panel. If the set is
   * empty (or contains all categories) the map shows everything.
   *
   * @deprecated Prefer `layerSelection` which lets the operator narrow down
   * to specific item ids in addition to whole categories. Still accepted as a
   * fallback to avoid breaking embeds that haven't migrated yet.
   */
  selectedCategories?: Set<SupplyCategory>;
  /**
   * Generalised layer filter. When both `itemIds` and `categories` are empty
   * the map shows everything. When set, a shipment passes the filter if its
   * itemId is in `itemIds` OR its category is in `categories`. Routes are
   * narrowed by category only (route rows don't carry per-item granularity).
   */
  layerSelection?: { itemIds: Set<string>; categories: Set<string> };
  /**
   * When set, nodes whose threat tier matches `tierFilter` render at full
   * opacity and the rest are dimmed. Used by the Blood Readiness widget so
   * clicking a tier chip visually focuses the matching sites without losing
   * the global map context. Pass `null` to clear.
   */
  tierFilter?: ThreatTier | null;
  /**
   * When true, `tierFilter` is applied only to nodes that hold blood
   * (the `bloodNodeIds` set). Other nodes render at normal opacity. Lets
   * the blood widget tier-chip filter focus blood-storing sites without
   * dimming non-blood nodes the operator may still need to see.
   */
  bloodNodeIds?: Set<string>;
  showThreats?: boolean;
  showAOR?: boolean;
  showZones?: boolean;
  /**
   * When `false`, the rAF loop is suspended and both the pulse halos and
   * shipment trip particles are rendered as a single representative still
   * frame (halos at base radius, trips frozen mid-route). Defaults to `true`.
   */
  animate?: boolean;
  onNodeClick?: (node: any, riskInfo: any | null) => void;
  onShipmentClick?: (shipment: any) => void;
  onZoneClick?: (zone: TheaterZone) => void;
  /**
   * Drawing mode. When non-null the map intercepts clicks (instead of
   * forwarding them to nodes) and accumulates polygon vertices.
   */
  drawMode?: ZoneDrawMode;
  /**
   * Called once a shape has been finalised (rectangle: 2nd click, polygon:
   * doubleclick or "finish" call). Receives a closed polygon (first == last).
   */
  onZoneDrawn?: (polygon: number[][]) => void;
  /**
   * Called whenever the in-progress vertices change so the host can render UI
   * affordances (e.g. "click 1 more point").
   */
  onDraftChange?: (vertices: number[][]) => void;
  viewState?: MapViewState;
  onViewStateChange?: (params: { viewState: MapViewState }) => void;
}

// INDOPACOM AOR-spanning view: ~60°E → ~110°W, ~60°N → ~60°S. Centred over
// the dateline with enough zoom-out to show India through the eastern Pacific.
const INITIAL_VIEW_STATE: MapViewState = {
  longitude: 150,
  latitude: 10,
  zoom: 1.7,
  pitch: 28,
  bearing: 0,
};

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// Centralised threat-tier palette. Used by node fills, halos, popup badges,
// and the route-end colour gradient on at-risk shipments so the same node
// reads consistently everywhere on the map.
export const TIER_COLOR: Record<ThreatTier, [number, number, number]> = {
  nominal: [88, 196, 158],     // emerald / nominal
  heightened: [232, 168, 76],  // warm amber / WATCH
  critical: [220, 64, 76],     // blood crimson / CRITICAL
};

export const TIER_LABEL: Record<ThreatTier, string> = {
  nominal: 'NOMINAL',
  heightened: 'WATCH',
  critical: 'CRITICAL',
};

export function tierForRisk(score: number, openAlerts = 0): ThreatTier {
  if (score >= 70) return 'critical';
  if (score >= 35 || openAlerts > 0) return 'heightened';
  return 'nominal';
}

// Per-category palette for arcs/animated trips so the user can tell flows apart
const CATEGORY_COLOR: Record<SupplyCategory, [number, number, number]> = {
  blood_products: [220, 64, 76],     // crimson — life-saving
  supplies: [76, 196, 196],          // teal — primary
  ppe: [180, 130, 230],              // violet — barrier
  other: [148, 163, 184],            // muted slate
};

const ROUTE_BASE_COLOR: [number, number, number, number] = [148, 163, 184, 90];
const ROUTE_DIM_COLOR: [number, number, number, number] = [80, 90, 105, 35];

function detectWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const ctx =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');
    return !!ctx;
  } catch {
    return false;
  }
}

// Compute a curved great-circle polyline between two lon/lat points using
// spherical interpolation. Keeps trip polylines from "wrapping" across the
// antimeridian, which matters for INDOPACOM (Pacific-spanning) routes.
function greatCircleWaypoints(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
  segments = 32,
): Array<[number, number]> {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const λ1 = toRad(lon1);
  const λ2 = toRad(lon2);

  const x1 = Math.cos(φ1) * Math.cos(λ1);
  const y1 = Math.cos(φ1) * Math.sin(λ1);
  const z1 = Math.sin(φ1);
  const x2 = Math.cos(φ2) * Math.cos(λ2);
  const y2 = Math.cos(φ2) * Math.sin(λ2);
  const z2 = Math.sin(φ2);
  const dot = Math.max(-1, Math.min(1, x1 * x2 + y1 * y2 + z1 * z2));
  const ω = Math.acos(dot);
  if (ω < 1e-6) return [[lon1, lat1], [lon2, lat2]];
  const sinω = Math.sin(ω);

  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const A = Math.sin((1 - f) * ω) / sinω;
    const B = Math.sin(f * ω) / sinω;
    const x = A * x1 + B * x2;
    const y = A * y1 + B * y2;
    const z = A * z1 + B * z2;
    const φ = Math.atan2(z, Math.sqrt(x * x + y * y));
    let λ = Math.atan2(y, x);
    let lon = toDeg(λ);
    if (i > 0) {
      const prev = pts[i - 1][0];
      while (lon - prev > 180) lon -= 360;
      while (prev - lon > 180) lon += 360;
    }
    pts.push([lon, toDeg(φ)]);
  }
  return pts;
}

function NetworkFallback({
  nodes = [],
  riskByNode = [],
  onNodeClick,
  selectedCategories,
  layerSelection,
}: NetworkMapProps) {
  const riskMap = new Map(riskByNode.map((r) => [r.nodeId, r]));
  // Mirror the GL map's layer-filter logic so the fallback list view
  // hides/dims non-matching nodes the same way. Without this, clicking
  // a "dim" card would still open a popover (the WebGL pickability
  // guard is bypassed entirely in the fallback path).
  const effectiveItemIds: Set<string> =
    layerSelection?.itemIds ?? new Set<string>();
  const effectiveCategories: Set<string> = (() => {
    const out = new Set<string>();
    if (layerSelection) for (const c of layerSelection.categories) out.add(c);
    if (selectedCategories) for (const c of selectedCategories) out.add(c);
    return out;
  })();
  const allLayersActive =
    effectiveItemIds.size === 0 && effectiveCategories.size === 0;
  const nodeMatchesLayerFilter = (r: any): boolean => {
    if (allLayersActive) return true;
    const dosByCategory: Record<string, number> = r?.dosByCategory ?? {};
    for (const cat of effectiveCategories) {
      const dos = dosByCategory[cat];
      if (dos !== undefined && dos < 999) return true;
    }
    if (effectiveItemIds.size > 0) {
      const top = (r?.topCriticalItems ?? []) as Array<{ itemId?: string }>;
      for (const it of top) {
        if (it?.itemId && effectiveItemIds.has(it.itemId)) return true;
      }
    }
    return false;
  };
  return (
    <div
      className="absolute inset-0 overflow-auto p-4"
      style={{ background: 'radial-gradient(circle at 50% 40%, #1A2333 0%, #0F141B 80%)' }}
    >
      <div className="text-muted-foreground text-xs uppercase tracking-widest mb-3 font-mono">
        Tactical List View · GPU acceleration unavailable
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {nodes.map((n) => {
          const r: any = riskMap.get(n.id);
          const tier: ThreatTier = (r?.tier as ThreatTier) ?? tierForRisk(r?.riskScore ?? 0, r?.openAlerts ?? 0);
          const ring =
            tier === 'critical' ? 'border-destructive text-destructive'
            : tier === 'heightened' ? 'border-amber-500 text-amber-400'
            : 'border-primary/60 text-primary';
          // Build a one-line hover summary for the native browser
          // tooltip. The deck.gl getDeckTooltip card only renders in
          // the WebGL view; this title= attribute gives the same info
          // (tier · DOS · risk · alerts) in the fallback list view so
          // operators always see node health on hover.
          const dosLabel = typeof r?.daysOfSupply === 'number'
            ? (r.daysOfSupply >= 999 ? '∞' : `${r.daysOfSupply.toFixed(1)}d`)
            : '—';
          const riskLabel = typeof r?.riskScore === 'number'
            ? r.riskScore.toFixed(0)
            : '—';
          const alertsLabel = r?.openAlerts ?? 0;
          const matched = nodeMatchesLayerFilter(r);
          const hoverSummary = matched
            ? `${n.name || n.id} (${n.type || 'site'}) — ` +
              `${TIER_LABEL[tier]} · DOS ${dosLabel} · Risk ${riskLabel} · Alerts ${alertsLabel}`
            : `${n.name || n.id} — outside selected supply layers`;
          return (
            <button
              key={n.id}
              onClick={matched ? () => onNodeClick?.(n, r ?? null) : undefined}
              disabled={!matched}
              aria-disabled={!matched}
              title={hoverSummary}
              className={`text-left border ${ring} bg-card/70 rounded p-2 transition ${
                matched ? 'hover:bg-card cursor-pointer' : 'opacity-30 cursor-not-allowed pointer-events-none'
              }`}
            >
              <div className="text-xs font-mono opacity-70">{n.type || 'NODE'}</div>
              <div className="text-sm font-semibold">{n.name || n.id}</div>
              <div className="text-[10px] font-mono opacity-60">
                {Number(n.latitude).toFixed(2)}, {Number(n.longitude).toFixed(2)}
              </div>
              <div className="text-[10px] font-mono mt-1">
                {TIER_LABEL[tier]} · DOS {dosLabel} · Risk {riskLabel}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

class WebGLBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  constructor(p: any) {
    super(p);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() { /* swallowed */ }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function NetworkGLMap(props: NetworkMapProps) {
  const {
    nodes = [],
    routes = [],
    shipments = [],
    threats = [],
    riskByNode = [],
    aorBoundary,
    zones = [],
    highlightedZoneIds,
    selectedCategories,
    layerSelection,
    tierFilter,
    bloodNodeIds,
    showThreats = true,
    showAOR = true,
    showZones = true,
    animate = true,
    onNodeClick,
    onShipmentClick,
    onZoneClick,
    drawMode = null,
    onZoneDrawn,
    onDraftChange,
    viewState,
    onViewStateChange,
  } = props;

  // Drawing buffer (in-progress polygon/rectangle vertices)
  const [draftVertices, setDraftVertices] = useState<number[][]>([]);
  const [hoverCoord, setHoverCoord] = useState<[number, number] | null>(null);
  const lastClickAtRef = useRef<number>(0);

  // Reset draft when draw mode changes (or is cleared)
  useEffect(() => {
    setDraftVertices([]);
    setHoverCoord(null);
    if (onDraftChange) onDraftChange([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawMode]);

  const finishDraft = useCallback(
    (vertices: number[][]) => {
      if (vertices.length < 3) return;
      const closed = [...vertices];
      const first = closed[0];
      const last = closed[closed.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) closed.push([first[0], first[1]]);
      setDraftVertices([]);
      setHoverCoord(null);
      if (onDraftChange) onDraftChange([]);
      if (onZoneDrawn) onZoneDrawn(closed);
    },
    [onDraftChange, onZoneDrawn],
  );

  const [hasWebGL, setHasWebGL] = useState<boolean | null>(null);
  // Tracks the route currently under the cursor so the route-network
  // PathLayer can thicken just that one line. We deliberately do NOT make
  // routes clickable — there is no route-detail action — so picking is used
  // for hover-feedback only and the cursor stays 'grab' over routes.
  const [hoveredRouteId, setHoveredRouteId] = useState<string | null>(null);
  const [internalView, setInternalView] = useState<MapViewState>(viewState ?? INITIAL_VIEW_STATE);
  const animRef = useRef<number | null>(null);
  // Animation clock is held in a ref so per-frame updates do not re-render
  // React or rebuild the layer array. The deck instance is poked directly
  // via `setProps` from the rAF tick.
  const timeRef = useRef(0);
  const deckRef = useRef<any>(null);

  // Per-trip fade state. Indexed by shipment id. We track when each trip
  // first appeared in the live pool (so we can ramp opacity up over ~1.5s)
  // and when it left the live pool (so we can ramp opacity down before the
  // particle is dropped). Without this, the background tick that refreshes
  // the in-flight pool every minute makes particles snap in and out, which
  // reads as flicker on the map.
  type FadeTrip = {
    shipmentId: string;
    path: Array<[number, number]>;
    timestamps: number[];
    baseColor: [number, number, number];
    shipment: any;
    firstSeenAt: number;
    fadeOutStartAt: number | null;
  };
  const tripsPoolRef = useRef<Map<string, FadeTrip>>(new Map());
  const FADE_IN_MS = 1500;
  const FADE_OUT_MS = 1500;

  useEffect(() => {
    setHasWebGL(detectWebGL());
  }, []);

  // The basemap stays still; only the trip particles move.
  const TRIP_LENGTH = 1800;

  const nodeIndex = useMemo(
    () => new Map(nodes.map((n: any) => [n.id, n])),
    [nodes],
  );

  const riskByNodeMap = useMemo(
    () => new Map(riskByNode.map((r: any) => [r.nodeId, r])),
    [riskByNode],
  );

  // Resolve the effective layer filter from either the new `layerSelection`
  // prop (item ids + categories) or the legacy `selectedCategories` prop.
  // An empty selection in both means "show everything".
  const effectiveItemIds = useMemo<Set<string>>(
    () => layerSelection?.itemIds ?? new Set<string>(),
    [layerSelection],
  );
  const effectiveCategories = useMemo<Set<string>>(() => {
    const out = new Set<string>();
    if (layerSelection) for (const c of layerSelection.categories) out.add(c);
    if (selectedCategories) for (const c of selectedCategories) out.add(c);
    return out;
  }, [layerSelection, selectedCategories]);

  const allLayersActive = useMemo(
    () => effectiveItemIds.size === 0 && effectiveCategories.size === 0,
    [effectiveItemIds, effectiveCategories],
  );

  const categoryActive = (cat: string | undefined): boolean => {
    if (allLayersActive) return true;
    if (!cat) return false;
    return effectiveCategories.has(cat);
  };

  // Categories selected via the legacy `selectedCategories` prop are
  // bare-category selections (no per-item narrowing implied), so shipments
  // whose category falls in this set should always pass even when other
  // sub-layers have contributed item-precise IDs. This keeps mixed
  // selections like "LTOWB sub-layer + bare PPE category" working.
  const bareCategorySelections = useMemo<Set<string>>(() => {
    const out = new Set<string>();
    if (selectedCategories) for (const c of selectedCategories) out.add(c);
    return out;
  }, [selectedCategories]);

  // Shipment-level match. When the user has narrowed the selection to
  // specific items (any sub-layer in Blood/Supplies/Custom contributes a
  // concrete itemIds set), require a strict itemId match for shipments
  // that carry an itemId — the category fallback would over-match here
  // because, e.g. picking LTOWB also sets `blood_products` in
  // effectiveCategories, which every PRBC/FFP/Platelet shipment shares.
  // Bare-category selections (legacy prop) still match. Shipments without
  // an itemId fall back to category so legacy rows aren't lost.
  const shipmentMatchesFilter = (s: any): boolean => {
    if (allLayersActive) return true;
    if (s?.itemId) {
      if (effectiveItemIds.has(s.itemId)) return true;
      if (s.category && bareCategorySelections.has(s.category)) return true;
      if (effectiveItemIds.size === 0) return categoryActive(s.category);
      return false;
    }
    return categoryActive(s?.category);
  };

  // Routes don't carry per-item granularity on the wire (their `categories`
  // field is the union of every supply class that has ever traversed them),
  // so deriving route activity from `r.categories` over-matches the same
  // way shipments would. Instead, a route is active iff it currently has
  // at least one in-flight shipment that passes the layer filter. This
  // matches the per-sub-layer "in flight" badge the operator already sees
  // in the Layers panel. We additionally honour bare-category selections
  // (legacy prop): a route whose categories include a bare-category pick
  // is always active, because that path doesn't imply item-level narrowing.
  const activeRouteEndpoints = useMemo<Set<string> | null>(() => {
    if (allLayersActive) return null;
    const set = new Set<string>();
    for (const s of shipments) {
      if (!shipmentMatchesFilter(s)) continue;
      set.add(`${s.fromNode}::${s.toNode}`);
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipments, allLayersActive, effectiveItemIds, effectiveCategories, bareCategorySelections]);

  const routeMatchesFilter = (r: any): boolean => {
    if (allLayersActive) return true;
    if (bareCategorySelections.size > 0) {
      const cats: string[] = r.categories ?? [];
      for (const c of cats) if (bareCategorySelections.has(c)) return true;
    }
    if (!activeRouteEndpoints) return true;
    return activeRouteEndpoints.has(`${r.fromNode}::${r.toNode}`);
  };

  // Per-node tier lookup so routes can inherit the worst tier of their two
  // endpoints. Built from `riskByNodeMap` (the same source `decoratedNodes`
  // uses) so the route palette is always coherent with the node palette —
  // a corridor between two nominal hubs paints nominal, a corridor that
  // touches a heightened or critical site picks up that warmer color.
  const nodeTierMap = useMemo(() => {
    const m = new Map<string, ThreatTier>();
    for (const n of nodes as any[]) {
      const r: any = riskByNodeMap.get(n.id);
      const tier: ThreatTier =
        (r?.tier as ThreatTier) ??
        tierForRisk(r?.riskScore ?? 0, r?.openAlerts ?? 0);
      m.set(n.id, tier);
    }
    return m;
  }, [nodes, riskByNodeMap]);

  // Pre-compute curved waypoints for every route once
  const routePaths = useMemo(() => {
    const out: Array<{
      id: string;
      from: [number, number];
      to: [number, number];
      path: Array<[number, number]>;
      categories: string[];
      reliability: number;
      active: boolean;
      fromTier: ThreatTier;
      toTier: ThreatTier;
      worstTier: ThreatTier;
    }> = [];
    const tierRank: Record<ThreatTier, number> = {
      nominal: 0,
      heightened: 1,
      critical: 2,
    };
    for (const r of routes) {
      const a: any = nodeIndex.get(r.fromNode);
      const b: any = nodeIndex.get(r.toNode);
      if (!a || !b) continue;
      const fromTier = nodeTierMap.get(r.fromNode) ?? 'nominal';
      const toTier = nodeTierMap.get(r.toNode) ?? 'nominal';
      const worstTier: ThreatTier =
        tierRank[fromTier] >= tierRank[toTier] ? fromTier : toTier;
      out.push({
        id: r.id ?? `${r.fromNode}->${r.toNode}`,
        from: [a.longitude, a.latitude],
        to: [b.longitude, b.latitude],
        path: greatCircleWaypoints(a.longitude, a.latitude, b.longitude, b.latitude, 36),
        categories: r.categories ?? [],
        reliability: r.reliability ?? 0.9,
        active: routeMatchesFilter(r),
        fromTier,
        toTier,
        worstTier,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, nodeIndex, nodeTierMap, allLayersActive, selectedCategories, layerSelection, activeRouteEndpoints, bareCategorySelections]);

  // Build animated shipment trips. Each trip is a real shipment row, so the
  // particle the operator sees is clickable and surfaces the underlying
  // cargo (item, quantity, ETA) — not a placeholder. The layer filter is
  // honoured strictly: narrowing to e.g. Blood Products only animates
  // blood-products shipments (no route-based decoy fill). Every trip's
  // timestamps must fit inside [0, TRIP_LENGTH) so that when the animation
  // loops via `loopLength`, no trip is left "in the future" and none get
  // clipped mid-flight.
  const tripData = useMemo(() => {
    type Trip = {
      path: Array<[number, number]>;
      timestamps: number[];
      color: [number, number, number];
      shipment: any;
    };
    const trips: Trip[] = [];
    const SHIPMENT_SPAN = TRIP_LENGTH * 0.55;

    const activeShipments = shipments.filter((s: any) => shipmentMatchesFilter(s));

    // Distribute offsets across the safe window [0, TRIP_LENGTH - span) so
    // timestamps stay strictly inside the loop and trips reach their
    // destination on every cycle.
    const stagger = (i: number, span: number) => {
      const maxStart = Math.max(1, TRIP_LENGTH - span);
      // Deterministic, evenly-spread offsets via a coprime stride.
      return (i * 137) % maxStart;
    };

    let i = 0;
    for (const s of activeShipments) {
      const a: any = nodeIndex.get(s.fromNode);
      const b: any = nodeIndex.get(s.toNode);
      if (!a || !b) continue;
      const wp = greatCircleWaypoints(a.longitude, a.latitude, b.longitude, b.latitude, 36);
      const offset = stagger(i, SHIPMENT_SPAN);
      const ts = wp.map((_, k) => offset + (k / (wp.length - 1)) * SHIPMENT_SPAN);
      trips.push({
        path: wp,
        timestamps: ts,
        color: CATEGORY_COLOR[(s.category as SupplyCategory) ?? 'other'],
        shipment: s,
      });
      i++;
    }
    return trips;
  }, [shipments, nodeIndex, allLayersActive, selectedCategories, layerSelection]);

  // Decorate nodes with their tier + risk for fast lookups in layer callbacks.
  type DecoratedNode = {
    raw: any;
    tier: ThreatTier;
    riskScore: number;
    daysOfSupply: number;
    openAlerts: number;
    dosByCategory: Record<string, number>;
    // Set of itemIds the node is known to carry, derived from the snapshot's
    // per-node `topCriticalItems` (top 3 lowest-DOS items shipped on the
    // wire). It's the only per-item-per-node signal exposed to the client
    // today and is "best effort" — used by the layer-filter dimming logic
    // to detect itemId-level matches when the operator picks a Custom
    // layer that targets specific items.
    topCriticalItemIds: Set<string>;
  };

  const decoratedNodes: DecoratedNode[] = useMemo(() => {
    return nodes.map((n: any) => {
      const r: any = riskByNodeMap.get(n.id);
      const tier: ThreatTier = (r?.tier as ThreatTier) ?? tierForRisk(r?.riskScore ?? 0, r?.openAlerts ?? 0);
      const topItems = (r?.topCriticalItems ?? []) as Array<{ itemId?: string }>;
      const topCriticalItemIds = new Set<string>();
      for (const it of topItems) if (it?.itemId) topCriticalItemIds.add(it.itemId);
      return {
        raw: n,
        tier,
        riskScore: r?.riskScore ?? 0,
        daysOfSupply: r?.daysOfSupply ?? 999,
        openAlerts: r?.openAlerts ?? 0,
        dosByCategory: r?.dosByCategory ?? {},
        topCriticalItemIds,
      };
    });
  }, [nodes, riskByNodeMap]);

  // Whether a node "carries" anything in the current layer filter. Used to
  // dim and skip-pick non-matching nodes once any sub-layer is active. When
  // no filter is active this is always true (full network is visible).
  // - Categories path: the node is in scope if it has a finite DOS for any
  //   selected category (i.e., it actually carries items in that class).
  // - ItemIds path: best-effort match against the top-critical items the
  //   snapshot exposes. Categories of selected sub-layers are also added to
  //   `effectiveCategories`, so the categories check is the primary signal
  //   for built-in layers; the item check tightens custom layers that
  //   target specific itemIds within an otherwise-broad category.
  const nodeMatchesLayerFilter = (d: DecoratedNode): boolean => {
    if (allLayersActive) return true;
    for (const cat of effectiveCategories) {
      const dos = d.dosByCategory?.[cat];
      if (dos !== undefined && dos < 999) return true;
    }
    if (effectiveItemIds.size > 0 && d.topCriticalItemIds.size > 0) {
      for (const id of d.topCriticalItemIds) {
        if (effectiveItemIds.has(id)) return true;
      }
    }
    return false;
  };

  // Decide colour: when exactly one category is active, recolour by that
  // category's DOS (green/amber/red bands). Otherwise use the threat tier.
  // When a `tierFilter` is active, nodes that do NOT match the requested
  // tier are dimmed so the matching set visually pops without removing the
  // surrounding context. `bloodNodeIds`, when provided, scopes the dimming
  // logic to blood-storing nodes only.
  const nodeColor = (d: DecoratedNode): [number, number, number, number] => {
    let rgb: [number, number, number];
    if (effectiveCategories.size === 1 && effectiveItemIds.size === 0) {
      const cat = Array.from(effectiveCategories)[0];
      const dos = d.dosByCategory?.[cat] ?? 999;
      if (dos <= 5) rgb = TIER_COLOR.critical;
      else if (dos <= 14) rgb = TIER_COLOR.heightened;
      else rgb = TIER_COLOR.nominal;
    } else {
      rgb = TIER_COLOR[d.tier];
    }
    let alpha = 235;
    if (tierFilter) {
      const inScope = !bloodNodeIds || bloodNodeIds.has(d.raw.id);
      if (inScope && d.tier !== tierFilter) alpha = 50;
    }
    // Layer-filter dim: when the operator has narrowed the map to a
    // specific supply class (or custom item set), drop nodes that don't
    // carry anything in that selection to the same low-opacity dim ramp
    // used by the tier filter so geographic context is preserved while
    // matching sites pop.
    if (!allLayersActive && !nodeMatchesLayerFilter(d)) {
      alpha = 50;
    }
    return [rgb[0], rgb[1], rgb[2], alpha];
  };

  // ---------------------------------------------------------------------------
  // Static layers — rebuilt only when the underlying data or filters change.
  // These never depend on the animation clock, so they are stable across the
  // 60fps tick loop and deck.gl can keep their GPU buffers warm.
  // ---------------------------------------------------------------------------
  const staticLayers = useMemo(() => {
    const out: any[] = [];

    // 1. AOR boundary outline (drawn first, sits beneath everything)
    if (showAOR && aorBoundary && aorBoundary.length > 0) {
      out.push(
        new PathLayer({
          id: 'aor-boundary',
          data: [{ path: aorBoundary }],
          getPath: (d: any) => d.path,
          getColor: [76, 196, 196, 70],
          getWidth: 2,
          widthUnits: 'pixels',
          widthMinPixels: 1,
          getDashArray: [6, 4],
          dashJustified: true,
          extensions: [],
        }),
      );
    }

    // 2. Route network. With no layer filter active, the full network is
    //    rendered (matching/non-matching styling kept identical to today's
    //    base behaviour). Once any sub-layer is selected we feed the layer
    //    only the matching routes — the faint "ghost" routes for
    //    non-matching corridors are dropped entirely so the operator's eye
    //    lands exactly on the routes carrying the selected supply class.
    out.push(
      new PathLayer({
        id: 'route-network',
        data: allLayersActive ? routePaths : routePaths.filter((r) => r.active),
        getPath: (d: any) => d.path,
        getColor: (d: any) => {
          if (d.id === hoveredRouteId) return [255, 255, 255, 230];
          if (!d.active) return ROUTE_DIM_COLOR;
          // Inherit the worst-tier color of the two endpoints so the
          // route palette tracks node health: nominal corridors stay
          // cool slate-teal; corridors touching a heightened or
          // critical site warm to amber / crimson respectively. Low
          // route reliability further drops alpha so a degraded
          // corridor reads as faded rather than confidently green.
          const tier = (d.worstTier ?? 'nominal') as ThreatTier;
          const base =
            tier === 'nominal' ? ROUTE_BASE_COLOR : TIER_COLOR[tier];
          const reliability = typeof d.reliability === 'number' ? d.reliability : 0.9;
          // Scale alpha 0.6x..1.0x by reliability in [0.5, 1.0].
          const t = Math.max(0, Math.min(1, (reliability - 0.5) / 0.5));
          const baseAlpha = tier === 'nominal' ? 90 : 200;
          const alpha = Math.round(baseAlpha * (0.6 + 0.4 * t));
          return [base[0], base[1], base[2], alpha];
        },
        // Real hover-thickening: the hovered route swells from ~2 px to
        // ~4 px so the operator gets unmistakable feedback that the line
        // they're aiming at is the one that will be acted on. Width is in
        // pixels so it's stable across zoom levels. Active routes that
        // touch an unhealthy site also draw slightly thicker so the eye
        // tracks the warm color naturally.
        getWidth: (d: any) => {
          if (d.id === hoveredRouteId) return 4.5;
          if (!d.active) return 2.2;
          const tier = (d.worstTier ?? 'nominal') as ThreatTier;
          if (tier === 'critical') return 3.2;
          if (tier === 'heightened') return 2.8;
          return 2.2;
        },
        widthUnits: 'pixels',
        widthMinPixels: 2,
        capRounded: true,
        jointRounded: true,
        // `pickable` is on so we receive `onHover` events and can drive the
        // hovered-route state, but routes are not actionable on click — the
        // top-level `getCursor` only flips to 'pointer' for nodes/trips, so
        // hovering a route never advertises a click that doesn't exist.
        pickable: drawMode === null,
        onHover: (info: any) => {
          const next = info.object?.id ?? null;
          setHoveredRouteId((prev) => (prev === next ? prev : next));
        },
        updateTriggers: {
          getColor: [
            allLayersActive,
            Array.from(effectiveCategories).join(','),
            Array.from(effectiveItemIds).join(','),
            hoveredRouteId,
            nodeTierMap,
          ],
          getWidth: [hoveredRouteId, nodeTierMap],
          getDashArray: [allLayersActive],
        },
      }),
    );

    // 3. 3D arcs over active routes — depth comes from `getHeight` proportional to distance.
    out.push(
      new ArcLayer({
        id: 'route-arcs',
        data: routePaths.filter((r) => r.active),
        getSourcePosition: (d: any) => d.from,
        getTargetPosition: (d: any) => d.to,
        getSourceColor: [76, 196, 196, 130],
        getTargetColor: [180, 130, 230, 130],
        getWidth: 1.6,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        getHeight: (d: any) => {
          const [x1, y1] = d.from;
          const [x2, y2] = d.to;
          const dx = x2 - x1;
          const dy = y2 - y1;
          const dist = Math.sqrt(dx * dx + dy * dy);
          return Math.min(0.8, dist / 90);
        },
        greatCircle: true,
      }),
    );

    // 4. Threat overlays (subtle filled boxes)
    if (showThreats) {
      for (const t of threats) {
        const sev = (t.severity || '').toUpperCase();
        const col: [number, number, number, number] =
          sev === 'CRITICAL' ? [220, 64, 76, 50]
          : sev === 'WARNING' ? [220, 64, 76, 35]
          : [232, 168, 76, 30];
        out.push(
          new PathLayer({
            id: `threat-${t.id}`,
            data: [{ path: t.polygon }],
            getPath: (d: any) => d.path,
            getColor: col,
            getWidth: 2,
            widthUnits: 'pixels',
            widthMinPixels: 1,
          }),
        );
      }
    }

    // 4b. Operator-drawn theater zones — filled polygons, with an outline that
    // brightens for highlighted zones (e.g. ones a scenario will reference).
    if (showZones && zones.length > 0) {
      out.push(
        new PolygonLayer({
          id: 'zones-fill',
          data: zones,
          getPolygon: (d: TheaterZone) => d.polygon,
          getFillColor: (d: TheaterZone): [number, number, number, number] => {
            const c = ZONE_SEVERITY_COLOR[d.severity] ?? ZONE_SEVERITY_COLOR.WATCH;
            const highlighted = highlightedZoneIds?.has(d.id);
            return [c[0], c[1], c[2], highlighted ? 110 : 60];
          },
          getLineColor: (d: TheaterZone): [number, number, number, number] => {
            const c = ZONE_SEVERITY_COLOR[d.severity] ?? ZONE_SEVERITY_COLOR.WATCH;
            const highlighted = highlightedZoneIds?.has(d.id);
            return [c[0], c[1], c[2], highlighted ? 240 : 180];
          },
          getLineWidth: (d: TheaterZone) =>
            highlightedZoneIds?.has(d.id) ? 3 : 1.5,
          lineWidthUnits: 'pixels',
          lineWidthMinPixels: 1,
          stroked: true,
          filled: true,
          pickable: drawMode === null,
          onClick: (info: any) => {
            if (drawMode !== null) return;
            if (info.object && onZoneClick) onZoneClick(info.object as TheaterZone);
          },
          updateTriggers: {
            getFillColor: [highlightedZoneIds, drawMode],
            getLineColor: [highlightedZoneIds, drawMode],
            getLineWidth: [highlightedZoneIds],
          },
        }),
      );
    }

    // 4c. Drafting overlay — what the operator is currently drawing.
    if (drawMode !== null) {
      // Build a preview shape from the draft + current hover position.
      let previewPath: number[][] | null = null;
      let previewPoly: number[][] | null = null;
      if (drawMode === 'rectangle') {
        if (draftVertices.length === 1 && hoverCoord) {
          const [x1, y1] = draftVertices[0];
          const [x2, y2] = hoverCoord;
          previewPoly = [
            [x1, y1],
            [x2, y1],
            [x2, y2],
            [x1, y2],
            [x1, y1],
          ];
          previewPath = previewPoly;
        }
      } else if (drawMode === 'polygon') {
        if (draftVertices.length > 0) {
          previewPath =
            hoverCoord && draftVertices.length >= 1
              ? [...draftVertices, hoverCoord as number[]]
              : draftVertices;
          if (draftVertices.length >= 3) {
            previewPoly = [
              ...draftVertices,
              ...(hoverCoord ? [hoverCoord as number[]] : []),
              draftVertices[0],
            ];
          }
        }
      }

      if (previewPoly) {
        out.push(
          new PolygonLayer({
            id: 'zone-draft-fill',
            data: [{ polygon: previewPoly }],
            getPolygon: (d: any) => d.polygon,
            getFillColor: [76, 196, 196, 60],
            getLineColor: [76, 196, 196, 220],
            getLineWidth: 2,
            lineWidthUnits: 'pixels',
            stroked: true,
            filled: true,
            pickable: false,
          }),
        );
      } else if (previewPath) {
        out.push(
          new PathLayer({
            id: 'zone-draft-path',
            data: [{ path: previewPath }],
            getPath: (d: any) => d.path,
            getColor: [76, 196, 196, 220],
            getWidth: 2,
            widthUnits: 'pixels',
            widthMinPixels: 1,
          }),
        );
      }

      if (draftVertices.length > 0) {
        out.push(
          new ScatterplotLayer({
            id: 'zone-draft-vertices',
            data: draftVertices,
            getPosition: (d: any) => d,
            getFillColor: [76, 196, 196, 240],
            getRadius: 4,
            radiusUnits: 'pixels',
            stroked: true,
            getLineColor: [255, 255, 255, 220],
            lineWidthMinPixels: 1.5,
            pickable: false,
          }),
        );
      }
    }

    // 7. 3D node columns. Extruded height encodes site importance + risk.
    //
    // When a layer filter is active we split this into two ColumnLayer
    // instances: the matching-nodes layer remains pickable + autoHighlight
    // (so the operator's hover/click behaviour on relevant sites is
    // unchanged), and the dim non-matching-nodes layer is rendered for
    // geographic context only — not pickable, no autoHighlight, no
    // tooltip, no click. With no filter active we keep a single layer
    // exactly as before.
    const columnElevation = (d: any) => {
      const t = (d.raw.type || '').toLowerCase();
      let base = 30000;
      if (t.includes('strategic') || t.includes('theater')) base = 200000;
      else if (t.includes('hub')) base = 130000;
      else if (t.includes('large mtf')) base = 90000;
      else if (t.includes('mtf')) base = 60000;
      else if (t.includes('bas')) base = 40000;
      else if (t.includes('clinic')) base = 30000;
      else if (t.includes('forward')) base = 35000;
      // Boost height when the site is in trouble so it pops visually
      const tierBoost =
        d.tier === 'critical' ? 1.6 : d.tier === 'heightened' ? 1.25 : 1;
      return base * tierBoost;
    };
    const columnGetPosition = (d: any): [number, number] => [d.raw.longitude, d.raw.latitude];
    const columnMaterial = {
      ambient: 0.55,
      diffuse: 0.7,
      shininess: 32,
      specularColor: [60, 64, 70] as [number, number, number],
    };
    const columnUpdateTriggers = {
      getFillColor: [
        allLayersActive,
        Array.from(effectiveCategories).join(','),
        Array.from(effectiveItemIds).join(','),
        tierFilter ?? '',
        bloodNodeIds ? bloodNodeIds.size : 0,
      ],
    };
    if (allLayersActive) {
      out.push(
        new ColumnLayer({
          id: 'nodes-columns',
          data: decoratedNodes,
          diskResolution: 24,
          // Radius bumped from 22 km → 30 km so the projected disk
          // gives operators a noticeably larger click target without
          // overlapping neighbouring sites at our typical theater zoom.
          radius: 30000,
          extruded: true,
          getPosition: columnGetPosition,
          getFillColor: nodeColor,
          getElevation: columnElevation,
          elevationScale: 1,
          material: columnMaterial,
          pickable: drawMode === null,
          autoHighlight: drawMode === null,
          highlightColor: [255, 255, 255, 200],
          onClick: (info: any) => {
            if (drawMode !== null) return;
            if (info.object && onNodeClick) {
              onNodeClick(info.object.raw, info.object);
            }
          },
          updateTriggers: columnUpdateTriggers,
        }),
      );
    } else {
      const matched: DecoratedNode[] = [];
      const dimmed: DecoratedNode[] = [];
      for (const d of decoratedNodes) {
        if (nodeMatchesLayerFilter(d)) matched.push(d);
        else dimmed.push(d);
      }
      // Dim context layer first so the matched layer composites on top
      // (matched columns can occlude dimmed neighbours, never the other
      // way around). The dim layer is intentionally not pickable so it
      // can't catch hover tooltips, autoHighlight, or click picks.
      if (dimmed.length > 0) {
        out.push(
          new ColumnLayer({
            id: 'nodes-columns-dim',
            data: dimmed,
            diskResolution: 24,
            radius: 30000,
            extruded: true,
            getPosition: columnGetPosition,
            getFillColor: nodeColor,
            getElevation: columnElevation,
            elevationScale: 1,
            material: columnMaterial,
            pickable: false,
            autoHighlight: false,
            updateTriggers: columnUpdateTriggers,
          }),
        );
      }
      out.push(
        new ColumnLayer({
          id: 'nodes-columns',
          data: matched,
          diskResolution: 24,
          radius: 30000,
          extruded: true,
          getPosition: columnGetPosition,
          getFillColor: nodeColor,
          getElevation: columnElevation,
          elevationScale: 1,
          material: columnMaterial,
          pickable: drawMode === null,
          autoHighlight: drawMode === null,
          highlightColor: [255, 255, 255, 200],
          onClick: (info: any) => {
            if (drawMode !== null) return;
            if (info.object && onNodeClick) {
              onNodeClick(info.object.raw, info.object);
            }
          },
          updateTriggers: columnUpdateTriggers,
        }),
      );
    }

    return out;
  }, [
    routePaths, decoratedNodes, threats,
    aorBoundary, showAOR, showThreats, onNodeClick,
    allLayersActive, selectedCategories, layerSelection,
    tierFilter, bloodNodeIds,
    zones, showZones, highlightedZoneIds, onZoneClick,
    drawMode, draftVertices, hoverCoord,
  ]);

  // ---------------------------------------------------------------------------
  // Animated layers — rebuilt every frame inside the rAF loop. The pulse halo
  // uses `radiusScale` (a shader uniform) so the per-node `getRadius` accessor
  // only runs once per node, not 60×/sec. The TripsLayer's `currentTime` is
  // also a uniform on the GPU side, so updating it per frame is essentially
  // free. Layers are pushed via `deck.setProps` so React never re-renders.
  // ---------------------------------------------------------------------------
  const pulseNodes = useMemo(
    () =>
      decoratedNodes.filter((d) => {
        if (d.tier === 'nominal') return false;
        // When a layer filter is active, suppress the attention-grabbing
        // pulse halo on nodes that don't carry anything in the selection
        // — those nodes are rendered as dim context only.
        if (!allLayersActive && !nodeMatchesLayerFilter(d)) return false;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [decoratedNodes, allLayersActive, effectiveCategories, effectiveItemIds],
  );

  // Keep the per-trip fade pool in sync with the live shipment list. New
  // shipment ids are added with `firstSeenAt = now` (so they ramp in), ids
  // that left the live pool are marked `fadeOutStartAt = now` (so they ramp
  // out before being culled in the rAF loop).
  useEffect(() => {
    const now = performance.now();
    const pool = tripsPoolRef.current;
    const incomingIds = new Set<string>();
    for (const t of tripData) {
      const id = t.shipment?.id as string | undefined;
      if (!id) continue;
      incomingIds.add(id);
      const existing = pool.get(id);
      if (existing) {
        // Refresh underlying path/timestamps in case the upstream row
        // shifted (rare, but cheap to keep in sync).
        existing.path = t.path;
        existing.timestamps = t.timestamps;
        existing.baseColor = t.color;
        existing.shipment = t.shipment;
        // If the shipment was fading out and reappeared (e.g. user toggled
        // a category back on), cancel the fade-out and restart fade-in
        // from the current alpha so the transition feels continuous.
        if (existing.fadeOutStartAt !== null) {
          const elapsedFadeOut = now - existing.fadeOutStartAt;
          const remainingAlpha = Math.max(0, 1 - elapsedFadeOut / FADE_OUT_MS);
          existing.fadeOutStartAt = null;
          existing.firstSeenAt = now - remainingAlpha * FADE_IN_MS;
        }
      } else {
        pool.set(id, {
          shipmentId: id,
          path: t.path,
          timestamps: t.timestamps,
          baseColor: t.color,
          shipment: t.shipment,
          firstSeenAt: now,
          fadeOutStartAt: null,
        });
      }
    }
    // Anything in the pool that's no longer in the live list starts fading.
    for (const [id, trip] of pool) {
      if (!incomingIds.has(id) && trip.fadeOutStartAt === null) {
        trip.fadeOutStartAt = now;
      }
    }
  }, [tripData]);

  const buildAnimatedLayers = useCallback((t: number, frozen: boolean) => {
    // When `frozen`, render a single representative still frame: halos at
    // base radius (no breathing) and trips paused mid-route. The accessor
    // logic stays identical so tier colours and per-shipment data still
    // work for picking and tooltips.
    // Pulse breathing rate. `t` advances by 90 units/sec (see rAF tick), so
    // `t / 90` makes one full sin cycle every 2 seconds — a calm ~0.5 Hz
    // breath that reads as "this site needs attention" without strobing.
    const pulse = frozen ? 1 : 1 + 0.45 * Math.sin((t / 90) * Math.PI);
    const currentTime = frozen ? TRIP_LENGTH * 0.5 : t;

    // Compute alpha per trip from its fade-in / fade-out state and drop
    // entries whose fade-out has fully completed. We rebuild a fresh data
    // array each frame so deck.gl re-evaluates `getColor` and uploads new
    // per-vertex alpha (cheap at our scale: ~30–50 trips). When `frozen`,
    // we still walk the pool but snap each trip to full opacity so the
    // still frame doesn't accidentally render half-faded ghosts to a
    // motion-sensitive operator.
    const wallNow = performance.now();
    const pool = tripsPoolRef.current;
    const renderTrips: Array<{
      path: Array<[number, number]>;
      timestamps: number[];
      color: [number, number, number, number];
      shipment: any;
    }> = [];
    for (const [id, trip] of pool) {
      let alpha = 1;
      if (frozen) {
        // In the still frame, drop trips that are fully faded-out so they
        // don't sit as stale entries, but render any other trip at full
        // opacity (no in-progress alpha ramp).
        if (
          trip.fadeOutStartAt !== null &&
          wallNow - trip.fadeOutStartAt >= FADE_OUT_MS
        ) {
          pool.delete(id);
          continue;
        }
        alpha = 1;
      } else if (trip.fadeOutStartAt !== null) {
        const elapsed = wallNow - trip.fadeOutStartAt;
        if (elapsed >= FADE_OUT_MS) {
          pool.delete(id);
          continue;
        }
        alpha = Math.max(0, 1 - elapsed / FADE_OUT_MS);
      } else {
        const elapsed = wallNow - trip.firstSeenAt;
        alpha = Math.max(0, Math.min(1, elapsed / FADE_IN_MS));
      }
      renderTrips.push({
        path: trip.path,
        timestamps: trip.timestamps,
        color: [
          trip.baseColor[0],
          trip.baseColor[1],
          trip.baseColor[2],
          Math.round(alpha * 255),
        ],
        shipment: trip.shipment,
      });
    }

    return [
      // 5. Animated convoys (trip particles flowing along routes). Pickable
      //    so operators can click any moving particle and see the underlying
      //    shipment row (item, qty, ETA, priority).
      new TripsLayer({
        id: 'shipment-trips',
        data: renderTrips,
        getPath: (d: any) => d.path,
        getTimestamps: (d: any) => d.timestamps,
        getColor: (d: any) => d.color,
        opacity: 0.95,
        // Bumped from 3px → 6px so the click target is large enough that
        // operators can reliably hit a moving shipment particle without
        // overshooting. autoHighlight (below) thickens it further on hover.
        widthMinPixels: 6,
        widthUnits: 'pixels',
        getWidth: 5,
        trailLength: 220,
        currentTime,
        loopLength: TRIP_LENGTH,
        capRounded: true,
        jointRounded: true,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 200],
        onClick: (info: any) => {
          if (info.object?.shipment && onShipmentClick) {
            onShipmentClick(info.object.shipment);
          }
        },
      }),
      // 6. Pulse halos for at-risk nodes (only tier > nominal)
      new ScatterplotLayer({
        id: 'node-pulse',
        data: pulseNodes,
        getPosition: (d: any) => [d.raw.longitude, d.raw.latitude],
        getFillColor: (d: any): [number, number, number, number] => {
          const tier = d.tier as ThreatTier;
          const c = TIER_COLOR[tier];
          return [c[0], c[1], c[2], tier === 'critical' ? 70 : 50];
        },
        getRadius: (d: any) => (d.tier === 'critical' ? 140000 : 90000),
        radiusScale: pulse,
        radiusUnits: 'meters',
        stroked: false,
        pickable: false,
        updateTriggers: { getFillColor: [pulseNodes] },
      }),
    ];
    // `tripData` is intentionally absent from the dependency list — the pool
    // is mutated by the sync `useEffect` above, and the rAF loop reads the
    // latest pool from `tripsPoolRef` on every frame. Keeping the callback
    // identity stable avoids rebuilding the static layers array each fetch.
  }, [pulseNodes, onShipmentClick]);

  // Initial layer array for the first React render (before the rAF loop kicks
  // in). Subsequent updates are pushed via `deck.setProps` from the loop.
  // When `animate` is false we render the still frame immediately and skip
  // the rAF loop entirely so motion-sensitive operators see no movement.
  const layers = useMemo(
    () => [...staticLayers, ...buildAnimatedLayers(timeRef.current, !animate)],
    [staticLayers, buildAnimatedLayers, animate],
  );

  // Mirror the latest layer-builder closures into refs so the rAF loop can
  // always read the freshest version WITHOUT being torn down and rebuilt
  // every time the data refetches (which would otherwise reset the
  // animation clock every minute and starve the GPU of new frames — what
  // operators saw as a "static" map).
  const staticLayersRef = useRef(staticLayers);
  const buildAnimatedLayersRef = useRef(buildAnimatedLayers);
  useEffect(() => {
    staticLayersRef.current = staticLayers;
    buildAnimatedLayersRef.current = buildAnimatedLayers;

    // When the rAF loop is suspended (`animate=false`), data refreshes
    // would otherwise leave the still frame stale because nothing is
    // pushing fresh layers to deck.gl. Push one still frame here so a
    // motion-sensitive operator still sees up-to-date trip / node state
    // after a refetch.
    if (!animate && hasWebGL === true) {
      const deck = deckRef.current?.deck;
      if (deck && typeof deck.setProps === 'function') {
        deck.setProps({
          layers: [
            ...staticLayers,
            ...buildAnimatedLayers(timeRef.current, true),
          ],
        });
      }
    }
  }, [staticLayers, buildAnimatedLayers, tripData, animate, hasWebGL]);

  // Animation loop. Updates the time ref and pushes a fresh layer set into
  // the deck instance directly — no React state, no component re-render.
  // Suspends entirely when `animate=false`; in that case we push one still
  // frame so any in-flight props changes (e.g. filter toggles) take effect.
  // The effect deliberately depends ONLY on `hasWebGL` and `animate` — the
  // builder closures are read from refs so an upstream data refetch does
  // not cancel the rAF loop mid-flight.
  useEffect(() => {
    if (hasWebGL !== true) return;
    if (!animate) {
      const deck = deckRef.current?.deck;
      if (deck && typeof deck.setProps === 'function') {
        deck.setProps({
          layers: [
            ...staticLayersRef.current,
            ...buildAnimatedLayersRef.current(timeRef.current, true),
          ],
        });
      }
      return;
    }
    let mounted = true;
    let last = performance.now();
    const tick = (now: number) => {
      if (!mounted) return;
      const dt = (now - last) / 1000;
      last = now;
      timeRef.current = (timeRef.current + dt * 90) % TRIP_LENGTH;
      // deck.gl/react v9 exposes a wrapper ref; the underlying Deck
      // instance (which has `setProps`) lives on `.deck`. Without this
      // indirection the rAF loop silently no-ops and the map appears
      // frozen — exactly the regression operators reported.
      const deck = deckRef.current?.deck;
      if (deck && typeof deck.setProps === 'function') {
        deck.setProps({
          layers: [
            ...staticLayersRef.current,
            ...buildAnimatedLayersRef.current(timeRef.current, false),
          ],
        });
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => {
      mounted = false;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [hasWebGL, animate]);

  if (hasWebGL === null) return null;
  if (!hasWebGL) return <NetworkFallback {...props} />;

  const effectiveViewState = viewState ?? internalView;
  const handleViewStateChange = (params: { viewState: MapViewState }) => {
    if (onViewStateChange) onViewStateChange(params);
    if (!viewState) setInternalView(params.viewState);
  };

  // Map-level click handler — captures clicks while drawing a zone. We
  // detect double-clicks by measuring the gap between consecutive clicks
  // (deck.gl's DeckGL component doesn't expose an onDblClick prop).
  const handleMapClick = (info: any) => {
    if (drawMode === null) return;
    if (!info || !info.coordinate) return;
    const coord: [number, number] = [info.coordinate[0], info.coordinate[1]];
    const now = Date.now();
    const gap = now - lastClickAtRef.current;
    lastClickAtRef.current = now;

    if (drawMode === 'rectangle') {
      if (draftVertices.length === 0) {
        const next = [coord];
        setDraftVertices(next);
        if (onDraftChange) onDraftChange(next);
      } else {
        // Second click — finalise rectangle (4 corners + close).
        const [x1, y1] = draftVertices[0];
        const [x2, y2] = coord;
        finishDraft([
          [x1, y1],
          [x2, y1],
          [x2, y2],
          [x1, y2],
        ]);
      }
      return;
    }

    if (drawMode === 'polygon') {
      // Treat a fast second click as "finish" if we already have at least 3
      // vertices placed. The duplicate vertex is dropped.
      if (gap > 0 && gap < 350 && draftVertices.length >= 3) {
        finishDraft(draftVertices);
        return;
      }
      const next = [...draftVertices, coord];
      setDraftVertices(next);
      if (onDraftChange) onDraftChange(next);
    }
  };

  // Hover handler — drives the live "rubber band" preview.
  const handleMapHover = (info: any) => {
    if (drawMode === null) {
      if (hoverCoord !== null) setHoverCoord(null);
      return;
    }
    if (info && info.coordinate) {
      setHoverCoord([info.coordinate[0], info.coordinate[1]]);
    }
  };

  // Disable map drag while drawing so clicks register cleanly. Outside
  // of draw mode we keep all the normal MapController interactions
  // (drag-pan, drag-rotate, touch, keyboard, double-click zoom) but turn
  // off scroll-wheel zoom — operators repeatedly complained that trying
  // to scroll the dashboard would accidentally zoom the embedded theater
  // map. Holding the cmd/ctrl key still lets you zoom on demand.
  const controllerOpts = drawMode !== null
    ? { dragPan: false, doubleClickZoom: false }
    : ({ scrollZoom: false } as any);

  // Build a deck.gl tooltip object for the node currently under the
  // cursor. Returning a small HTML card here is much faster than
  // mounting a React popover, and it gives operators a quick read on
  // node health before they decide to drill into the site detail page.
  //
  // NOTE: this is intentionally a plain function (not useCallback).
  // The component has early returns above (hasWebGL gate) and adding a
  // hook here would change the hook count between renders and trigger
  // React's "Rendered more hooks" error. deck.gl re-reads getTooltip on
  // every render anyway, so memoization gains nothing.
  const getDeckTooltip = (info: any) => {
    const obj = info?.object;
    if (!obj || obj.layer === undefined && info.layer?.id !== 'nodes-columns') {
      // Only show tooltip for nodes (the columns layer); skip routes/threats.
    }
    if (!info.layer || info.layer.id !== 'nodes-columns') return null;
    const d = obj as DecoratedNode | undefined;
    if (!d) return null;
    // Suppress hover tooltips on dim non-matching nodes when a layer
    // filter is active. The dim columns are present for geographic
    // context only — they don't accept clicks (see ColumnLayer.onClick)
    // and shouldn't catch hover picks either.
    if (!allLayersActive && !nodeMatchesLayerFilter(d)) return null;
    const raw = d.raw ?? {};
    const tier = d.tier;
    const tierColor =
      tier === 'critical'
        ? '#ef4444'
        : tier === 'heightened'
          ? '#f59e0b'
          : '#22c55e';
    const tierLabel = tier === 'critical'
      ? 'CRITICAL'
      : tier === 'heightened'
        ? 'HEIGHTENED'
        : 'NOMINAL';
    const dosNum = typeof d.daysOfSupply === 'number' ? d.daysOfSupply : null;
    const dos = dosNum === null
      ? '—'
      : dosNum >= 999
        ? '∞'
        : `${dosNum.toFixed(1)}d`;
    const risk = typeof d.riskScore === 'number' ? d.riskScore.toFixed(0) : '—';
    const alerts = d.openAlerts ?? 0;
    const type = (raw.type ?? 'site').toString();
    const name = String(raw.name ?? raw.id ?? 'Site');
    const escape = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return {
      html: `
        <div style="font-family: ui-sans-serif, system-ui; min-width: 220px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${tierColor};"></span>
            <span style="font-size:11px;letter-spacing:0.08em;color:${tierColor};font-weight:700;">${tierLabel}</span>
            <span style="font-size:10px;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.06em;margin-left:auto;">${escape(type)}</span>
          </div>
          <div style="font-size:13px;font-weight:600;color:#f4f4f5;margin-bottom:8px;line-height:1.25;">${escape(name)}</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
            <div>
              <div style="font-size:9px;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.06em;">DOS</div>
              <div style="font-size:13px;font-weight:600;color:#f4f4f5;">${dos}</div>
            </div>
            <div>
              <div style="font-size:9px;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.06em;">Risk</div>
              <div style="font-size:13px;font-weight:600;color:#f4f4f5;">${risk}</div>
            </div>
            <div>
              <div style="font-size:9px;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.06em;">Alerts</div>
              <div style="font-size:13px;font-weight:600;color:${alerts > 0 ? '#ef4444' : '#f4f4f5'};">${alerts}</div>
            </div>
          </div>
          <div style="margin-top:8px;padding-top:6px;border-top:1px solid #27272a;font-size:10px;color:#a1a1aa;">
            Click to open site detail
          </div>
        </div>
      `,
      style: {
        background: 'rgba(12, 13, 16, 0.96)',
        border: '1px solid rgba(76, 196, 196, 0.35)',
        borderRadius: '8px',
        padding: '10px 12px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        color: '#f4f4f5',
        pointerEvents: 'none',
        // Push the card down-and-to-the-right of the cursor so the
        // hotspot itself stays visible. Without this, deck.gl anchors
        // the tooltip top-left at the cursor and the card sits directly
        // on top of the hovered node, occluding it.
        //
        // IMPORTANT: do NOT set `transform` here. deck.gl positions the
        // tooltip via inline `transform: translate(x, y)`; overriding
        // that property pins the card to the page origin (top-left
        // corner) regardless of cursor position. Use margin offsets
        // only — the browser composites them on top of deck.gl's
        // translate, which is exactly the behavior we want.
        marginLeft: '18px',
        marginTop: '14px',
      },
    };
  };

  // Smooth zoom helpers used by the +/- overlay buttons. We clamp to a
  // sensible band so operators can't accidentally pan into nothingness.
  const zoomBy = (delta: number) => {
    const cur = effectiveViewState;
    const nextZoom = Math.max(1.5, Math.min(11, (cur.zoom ?? 3) + delta));
    const next: MapViewState = {
      ...cur,
      zoom: nextZoom,
      transitionDuration: 220,
    } as MapViewState;
    if (onViewStateChange) onViewStateChange({ viewState: next });
    if (!viewState) setInternalView(next);
  };

  return (
    <WebGLBoundary fallback={<NetworkFallback {...props} />}>
      <div style={{ position: 'absolute', inset: 0 }}>
        <DeckGL
          ref={deckRef}
          viewState={effectiveViewState}
          onViewStateChange={handleViewStateChange as any}
          controller={controllerOpts as any}
          layers={layers}
          onClick={handleMapClick}
          onHover={handleMapHover}
          getTooltip={getDeckTooltip as any}
          getCursor={({
            isDragging,
            isHovering,
          }: {
            isDragging: boolean;
            isHovering: boolean;
          }) =>
            drawMode !== null
              ? 'crosshair'
              : isDragging
                ? 'grabbing'
                : isHovering
                  ? 'pointer'
                  : 'grab'
          }
        >
          <MapLibre mapStyle={MAP_STYLE} />
        </DeckGL>
        {/* Zoom controls. Operators kept asking for an obvious +/- since
            scroll-wheel zoom is intentionally disabled to stop the
            embedded map from hijacking dashboard scroll. */}
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            pointerEvents: 'auto',
          }}
        >
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => zoomBy(1)}
            style={zoomBtnStyle}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                'rgba(76, 196, 196, 0.18)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                'rgba(12, 13, 16, 0.92)';
            }}
          >
            +
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => zoomBy(-1)}
            style={zoomBtnStyle}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                'rgba(76, 196, 196, 0.18)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                'rgba(12, 13, 16, 0.92)';
            }}
          >
            −
          </button>
        </div>
      </div>
    </WebGLBoundary>
  );
}

const zoomBtnStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(12, 13, 16, 0.92)',
  border: '1px solid rgba(76, 196, 196, 0.45)',
  borderRadius: 6,
  color: '#f4f4f5',
  fontSize: 18,
  fontWeight: 600,
  lineHeight: 1,
  cursor: 'pointer',
  fontFamily: 'ui-sans-serif, system-ui',
  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  userSelect: 'none',
  transition: 'background 120ms ease',
};
