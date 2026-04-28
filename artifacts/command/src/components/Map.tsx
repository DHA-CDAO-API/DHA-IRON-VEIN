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
   */
  selectedCategories?: Set<SupplyCategory>;
  showThreats?: boolean;
  showAOR?: boolean;
  showZones?: boolean;
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

function NetworkFallback({ nodes = [], riskByNode = [], onNodeClick }: NetworkMapProps) {
  const riskMap = new Map(riskByNode.map((r) => [r.nodeId, r]));
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
          return (
            <button
              key={n.id}
              onClick={() => onNodeClick?.(n, r ?? null)}
              className={`text-left border ${ring} bg-card/70 rounded p-2 hover:bg-card transition`}
            >
              <div className="text-xs font-mono opacity-70">{n.type || 'NODE'}</div>
              <div className="text-sm font-semibold">{n.name || n.id}</div>
              <div className="text-[10px] font-mono opacity-60">
                {Number(n.latitude).toFixed(2)}, {Number(n.longitude).toFixed(2)}
              </div>
              <div className="text-[10px] font-mono mt-1">
                {TIER_LABEL[tier]} · DOS {r?.daysOfSupply ?? '—'}
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
    showThreats = true,
    showAOR = true,
    showZones = true,
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
  const [internalView, setInternalView] = useState<MapViewState>(viewState ?? INITIAL_VIEW_STATE);
  const animRef = useRef<number | null>(null);
  // Animation clock is held in a ref so per-frame updates do not re-render
  // React or rebuild the layer array. The deck instance is poked directly
  // via `setProps` from the rAF tick.
  const timeRef = useRef(0);
  const deckRef = useRef<any>(null);

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

  // Decide whether a route / shipment passes the active layer filter.
  const allCategoriesActive = useMemo(() => {
    if (!selectedCategories || selectedCategories.size === 0) return true;
    return false;
  }, [selectedCategories]);

  const categoryActive = (cat: string | undefined): boolean => {
    if (allCategoriesActive) return true;
    if (!cat) return false;
    return selectedCategories!.has(cat as SupplyCategory);
  };

  const routeMatchesFilter = (r: any): boolean => {
    if (allCategoriesActive) return true;
    const cats: string[] = r.categories ?? [];
    if (cats.length === 0) return false;
    for (const c of cats) if (categoryActive(c)) return true;
    return false;
  };

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
    }> = [];
    for (const r of routes) {
      const a: any = nodeIndex.get(r.fromNode);
      const b: any = nodeIndex.get(r.toNode);
      if (!a || !b) continue;
      out.push({
        id: r.id ?? `${r.fromNode}->${r.toNode}`,
        from: [a.longitude, a.latitude],
        to: [b.longitude, b.latitude],
        path: greatCircleWaypoints(a.longitude, a.latitude, b.longitude, b.latitude, 36),
        categories: r.categories ?? [],
        reliability: r.reliability ?? 0.9,
        active: routeMatchesFilter(r),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, nodeIndex, allCategoriesActive, selectedCategories]);

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

    const activeShipments = shipments.filter((s: any) => categoryActive(s.category));

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
  }, [shipments, nodeIndex, allCategoriesActive, selectedCategories]);

  // Decorate nodes with their tier + risk for fast lookups in layer callbacks.
  type DecoratedNode = {
    raw: any;
    tier: ThreatTier;
    riskScore: number;
    daysOfSupply: number;
    openAlerts: number;
    dosByCategory: Record<string, number>;
  };

  const decoratedNodes: DecoratedNode[] = useMemo(() => {
    return nodes.map((n: any) => {
      const r: any = riskByNodeMap.get(n.id);
      const tier: ThreatTier = (r?.tier as ThreatTier) ?? tierForRisk(r?.riskScore ?? 0, r?.openAlerts ?? 0);
      return {
        raw: n,
        tier,
        riskScore: r?.riskScore ?? 0,
        daysOfSupply: r?.daysOfSupply ?? 999,
        openAlerts: r?.openAlerts ?? 0,
        dosByCategory: r?.dosByCategory ?? {},
      };
    });
  }, [nodes, riskByNodeMap]);

  // Decide colour: when a single category is selected, recolour by that
  // category's DOS (green/amber/red bands). Otherwise use the threat tier.
  const nodeColor = (d: DecoratedNode): [number, number, number, number] => {
    if (selectedCategories && selectedCategories.size === 1) {
      const cat = Array.from(selectedCategories)[0];
      const dos = d.dosByCategory?.[cat] ?? 999;
      let rgb: [number, number, number];
      if (dos <= 5) rgb = TIER_COLOR.critical;
      else if (dos <= 14) rgb = TIER_COLOR.heightened;
      else rgb = TIER_COLOR.nominal;
      return [...rgb, 235];
    }
    const rgb = TIER_COLOR[d.tier];
    return [...rgb, 235];
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

    // 2. Faint full route network (always visible, dimmed when filtered)
    out.push(
      new PathLayer({
        id: 'route-network',
        data: routePaths,
        getPath: (d: any) => d.path,
        getColor: (d: any) => (d.active ? ROUTE_BASE_COLOR : ROUTE_DIM_COLOR),
        getWidth: 1.4,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        capRounded: true,
        jointRounded: true,
        updateTriggers: {
          getColor: [allCategoriesActive, Array.from(selectedCategories ?? []).join(',')],
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
    out.push(
      new ColumnLayer({
        id: 'nodes-columns',
        data: decoratedNodes,
        diskResolution: 24,
        radius: 22000,
        extruded: true,
        getPosition: (d: any) => [d.raw.longitude, d.raw.latitude],
        getFillColor: nodeColor,
        getElevation: (d: any) => {
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
        },
        elevationScale: 1,
        material: { ambient: 0.55, diffuse: 0.7, shininess: 32, specularColor: [60, 64, 70] },
        pickable: drawMode === null,
        autoHighlight: drawMode === null,
        highlightColor: [255, 255, 255, 200],
        onClick: (info: any) => {
          if (drawMode !== null) return;
          if (info.object && onNodeClick) {
            onNodeClick(info.object.raw, info.object);
          }
        },
        updateTriggers: {
          getFillColor: [allCategoriesActive, Array.from(selectedCategories ?? []).join(',')],
        },
      }),
    );

    return out;
  }, [
    routePaths, decoratedNodes, threats,
    aorBoundary, showAOR, showThreats, onNodeClick,
    allCategoriesActive, selectedCategories,
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
    () => decoratedNodes.filter((d) => d.tier !== 'nominal'),
    [decoratedNodes],
  );

  const buildAnimatedLayers = useCallback((t: number) => {
    const pulse = 1 + 0.45 * Math.sin((t / 30) * Math.PI);
    return [
      // 5. Animated convoys (trip particles flowing along routes). Pickable
      //    so operators can click any moving particle and see the underlying
      //    shipment row (item, qty, ETA, priority).
      new TripsLayer({
        id: 'shipment-trips',
        data: tripData,
        getPath: (d: any) => d.path,
        getTimestamps: (d: any) => d.timestamps,
        getColor: (d: any) => d.color,
        opacity: 0.95,
        widthMinPixels: 3,
        widthUnits: 'pixels',
        getWidth: 4,
        trailLength: 220,
        currentTime: t,
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
  }, [tripData, pulseNodes, onShipmentClick]);

  // Initial layer array for the first React render (before the rAF loop kicks
  // in). Subsequent updates are pushed via `deck.setProps` from the loop.
  const layers = useMemo(
    () => [...staticLayers, ...buildAnimatedLayers(timeRef.current)],
    [staticLayers, buildAnimatedLayers],
  );

  // Animation loop. Updates the time ref and pushes a fresh layer set into
  // the deck instance directly — no React state, no component re-render.
  useEffect(() => {
    if (hasWebGL !== true) return;
    let mounted = true;
    let last = performance.now();
    const tick = (now: number) => {
      if (!mounted) return;
      const dt = (now - last) / 1000;
      last = now;
      timeRef.current = (timeRef.current + dt * 90) % TRIP_LENGTH;
      const deck = deckRef.current;
      if (deck && typeof deck.setProps === 'function') {
        deck.setProps({
          layers: [...staticLayers, ...buildAnimatedLayers(timeRef.current)],
        });
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => {
      mounted = false;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [hasWebGL, staticLayers, buildAnimatedLayers]);

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

  // Disable map drag while drawing so clicks register cleanly.
  const controllerOpts = drawMode !== null
    ? { dragPan: false, doubleClickZoom: false }
    : true;

  return (
    <WebGLBoundary fallback={<NetworkFallback {...props} />}>
      <DeckGL
        ref={deckRef}
        viewState={effectiveViewState}
        onViewStateChange={handleViewStateChange as any}
        controller={controllerOpts as any}
        layers={layers}
        onClick={handleMapClick}
        onHover={handleMapHover}
        getCursor={({ isDragging }: { isDragging: boolean }) =>
          drawMode !== null ? 'crosshair' : isDragging ? 'grabbing' : 'grab'
        }
      >
        <MapLibre mapStyle={MAP_STYLE} />
      </DeckGL>
    </WebGLBoundary>
  );
}
