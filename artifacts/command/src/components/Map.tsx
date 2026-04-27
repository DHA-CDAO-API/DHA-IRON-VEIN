import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Map as MapLibre } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer, PathLayer } from '@deck.gl/layers';
import { TripsLayer } from '@deck.gl/geo-layers';
import { FlyToInterpolator, type MapViewState } from '@deck.gl/core';

interface NetworkMapProps {
  nodes?: any[];
  routes?: any[];
  shipments?: any[];
  threats?: any[];
  riskByNode?: any[];
  onNodeClick?: (node: any) => void;
  viewState?: MapViewState;
  onViewStateChange?: (params: { viewState: MapViewState }) => void;
  autoPan?: boolean;
}

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: 138,
  latitude: 18,
  zoom: 3.1,
  pitch: 38,
  bearing: 0,
};

// Subdued dark basemap that complements the new warm slate theme
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// Theme-aligned palette (RGBA arrays, 0-255)
const COLOR = {
  routeIdle: [148, 163, 184, 90] as [number, number, number, number],         // muted slate
  shipmentTeal: [76, 196, 196, 230] as [number, number, number, number],     // primary teal
  nodeNominal: [160, 200, 200, 230] as [number, number, number, number],     // pale teal
  nodeWarn: [232, 168, 76, 240] as [number, number, number, number],         // warm amber
  nodeAlert: [220, 64, 76, 245] as [number, number, number, number],         // blood crimson
  pulseAlert: [220, 64, 76, 80] as [number, number, number, number],
};

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

// Compute a curved great-circle-ish polyline between two lon/lat points.
// Uses spherical interpolation (slerp on unit sphere) for accuracy across
// the Pacific theater (avoids the open-ocean straight-line artefact).
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
    // Keep longitudes contiguous so paths don't wrap across the antimeridian
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
  const riskMap = new Map(riskByNode.map((r) => [r.nodeId, r.riskScore]));
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
          const risk = (riskMap.get(n.id) as number | undefined) ?? 0;
          const ring =
            risk > 80 ? 'border-destructive text-destructive'
            : risk > 50 ? 'border-amber-500 text-amber-400'
            : 'border-primary/60 text-primary';
          return (
            <button
              key={n.id}
              onClick={() => onNodeClick?.(n)}
              className={`text-left border ${ring} bg-card/70 rounded p-2 hover:bg-card transition`}
            >
              <div className="text-xs font-mono opacity-70">{n.type || 'NODE'}</div>
              <div className="text-sm font-semibold">{n.name || n.id}</div>
              <div className="text-[10px] font-mono opacity-60">
                {Number(n.latitude).toFixed(2)}, {Number(n.longitude).toFixed(2)}
              </div>
              <div className="text-[10px] font-mono mt-1">RISK {risk.toFixed(0)}</div>
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
  componentDidCatch() {
    /* swallowed */
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function NetworkGLMap(props: NetworkMapProps) {
  const {
    nodes = [],
    routes = [],
    shipments = [],
    riskByNode = [],
    onNodeClick,
    viewState,
    onViewStateChange,
    autoPan = true,
  } = props;

  const [hasWebGL, setHasWebGL] = useState<boolean | null>(null);
  // Drive the TripsLayer animation (looped time)
  const [time, setTime] = useState(0);
  // Internal viewState used only when parent does not supply one (auto-pan)
  const [internalView, setInternalView] = useState<MapViewState>(viewState ?? INITIAL_VIEW_STATE);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    setHasWebGL(detectWebGL());
  }, []);

  // Smooth animation loop (~60fps), loops every ~24s of "shipment time"
  const TRIP_LENGTH = 1800; // virtual seconds, tuned with getTimestamps below
  useEffect(() => {
    if (hasWebGL !== true) return;
    let mounted = true;
    let last = performance.now();
    const tick = (now: number) => {
      if (!mounted) return;
      const dt = (now - last) / 1000;
      last = now;
      setTime((t) => (t + dt * 90) % TRIP_LENGTH); // 90 virtual seconds / wall second
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => {
      mounted = false;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [hasWebGL]);

  const nodeIndex = useMemo(
    () => new Map(nodes.map((n: any) => [n.id, n])),
    [nodes],
  );

  // Pre-compute curved waypoints for every route once
  const routePaths = useMemo(() => {
    const out: Array<{ id: string; path: Array<[number, number]>; reliability: number }> = [];
    for (const r of routes) {
      const a: any = nodeIndex.get(r.fromNode);
      const b: any = nodeIndex.get(r.toNode);
      if (!a || !b) continue;
      out.push({
        id: `${r.fromNode}->${r.toNode}`,
        path: greatCircleWaypoints(a.longitude, a.latitude, b.longitude, b.latitude, 36),
        reliability: r.reliability ?? 0.9,
      });
    }
    return out;
  }, [routes, nodeIndex]);

  // Build shipment trips (waypoints + per-vertex timestamps).
  // If shipments are present, animate those; otherwise animate a representative
  // subset of routes so the map always looks alive.
  const tripData = useMemo(() => {
    const source = shipments.length > 0
      ? shipments
      : routes.slice(0, 14); // representative active corridors
    const trips: Array<{ path: Array<[number, number]>; timestamps: number[]; color: [number, number, number] }> = [];
    let i = 0;
    for (const s of source) {
      const a: any = nodeIndex.get(s.fromNode);
      const b: any = nodeIndex.get(s.toNode);
      if (!a || !b) continue;
      const wp = greatCircleWaypoints(a.longitude, a.latitude, b.longitude, b.latitude, 36);
      // Stagger trip start so multiple convoys traverse simultaneously
      const offset = (i * 130) % TRIP_LENGTH;
      const span = TRIP_LENGTH * 0.55; // each trip occupies ~55% of cycle
      const ts = wp.map((_, k) => offset + (k / (wp.length - 1)) * span);
      trips.push({
        path: wp,
        timestamps: ts,
        color: [76, 196, 196],
      });
      i++;
    }
    return trips;
  }, [shipments, routes, nodeIndex]);

  // Auto-pan across hot spots every 9s when no parent-controlled viewState
  useEffect(() => {
    if (!autoPan || viewState || hasWebGL !== true) return;
    const hotSpots: MapViewState[] = [
      { longitude: 127.8, latitude: 26.3, zoom: 5.2, pitch: 40, bearing: 0 },   // Okinawa hub
      { longitude: 121.5, latitude: 14.6, zoom: 4.8, pitch: 40, bearing: 10 }, // Luzon / Philippines
      { longitude: 144.8, latitude: 13.5, zoom: 5.4, pitch: 40, bearing: -10 }, // Guam
      { longitude: 130.9, latitude: -12.4, zoom: 4.8, pitch: 40, bearing: 0 }, // Darwin
      { longitude: 138, latitude: 18, zoom: 3.1, pitch: 38, bearing: 0 },      // Theater overview
    ];
    let idx = 0;
    const advance = () => {
      idx = (idx + 1) % hotSpots.length;
      setInternalView({
        ...hotSpots[idx],
        transitionDuration: 4000,
        transitionInterpolator: new FlyToInterpolator({ speed: 0.8 }),
      } as MapViewState);
    };
    // Initial pan after a short pause
    const initial = setTimeout(advance, 1500);
    const intvl = setInterval(advance, 9000);
    return () => {
      clearTimeout(initial);
      clearInterval(intvl);
    };
  }, [autoPan, viewState, hasWebGL]);

  const layers = useMemo(() => {
    const riskMap = new Map(riskByNode.map((r) => [r.nodeId, r.riskScore]));

    // Pulse radius for alerted nodes (blooms over ~1.6s)
    const pulse = 1 + 0.6 * Math.sin((time / 30) * Math.PI);

    return [
      // Faded route network (always visible)
      new PathLayer({
        id: 'route-network',
        data: routePaths,
        getPath: (d: any) => d.path,
        getColor: COLOR.routeIdle,
        getWidth: 1.4,
        widthUnits: 'pixels',
        widthMinPixels: 1,
        capRounded: true,
        jointRounded: true,
      }),
      // Animated convoys
      new TripsLayer({
        id: 'shipment-trips',
        data: tripData,
        getPath: (d: any) => d.path,
        getTimestamps: (d: any) => d.timestamps,
        getColor: (d: any) => d.color,
        opacity: 0.95,
        widthMinPixels: 3,
        widthUnits: 'pixels',
        getWidth: 3.5,
        trailLength: 220,
        currentTime: time,
        capRounded: true,
        jointRounded: true,
      }),
      // Pulse halos for alerted nodes
      new ScatterplotLayer({
        id: 'node-pulse',
        data: nodes.filter((n: any) => ((riskMap.get(n.id) as number) ?? 0) > 60),
        getPosition: (d: any) => [d.longitude, d.latitude],
        getFillColor: COLOR.pulseAlert,
        getRadius: (d: any) => {
          const risk = (riskMap.get(d.id) as number) ?? 0;
          const base = risk > 80 ? 50000 : 35000;
          return base * pulse;
        },
        radiusUnits: 'meters',
        stroked: false,
        pickable: false,
      }),
      // Node markers
      new ScatterplotLayer({
        id: 'nodes',
        data: nodes,
        getPosition: (d: any) => [d.longitude, d.latitude],
        getFillColor: (d: any) => {
          const risk = (riskMap.get(d.id) as number | undefined) ?? 0;
          if (risk > 80) return COLOR.nodeAlert;
          if (risk > 50) return COLOR.nodeWarn;
          return COLOR.nodeNominal;
        },
        getLineColor: [15, 20, 27, 220],
        getRadius: (d: any) => {
          const t = (d.type || '').toLowerCase();
          if (t === 'strategic' || t === 'theater') return 36000;
          if (t === 'hub') return 26000;
          if (t === 'mtf') return 17000;
          return 12000;
        },
        radiusUnits: 'meters',
        stroked: true,
        lineWidthUnits: 'pixels',
        lineWidthMinPixels: 1,
        getLineWidth: 1,
        pickable: true,
        onClick: (info: any) => {
          if (info.object && onNodeClick) onNodeClick(info.object);
        },
        autoHighlight: true,
        highlightColor: [255, 255, 255, 255],
      }),
    ];
  }, [nodes, routePaths, tripData, riskByNode, onNodeClick, time]);

  if (hasWebGL === null) return null;
  if (!hasWebGL) return <NetworkFallback {...props} />;

  const effectiveViewState = viewState ?? internalView;
  const handleViewStateChange = (params: { viewState: MapViewState }) => {
    if (onViewStateChange) onViewStateChange(params);
    if (!viewState) setInternalView(params.viewState);
  };

  return (
    <WebGLBoundary fallback={<NetworkFallback {...props} />}>
      <DeckGL
        viewState={effectiveViewState}
        onViewStateChange={handleViewStateChange as any}
        controller={true}
        layers={layers}
        getTooltip={({ object }: any) => {
          if (!object) return null;
          if (object.name) {
            const risk = (
              (new Map(riskByNode.map((r) => [r.nodeId, r.riskScore])).get(object.id) as number | undefined) ?? 0
            ).toFixed(0);
            return {
              text: `${object.name}\n${object.type ?? 'Node'} · risk ${risk}`,
            };
          }
          return null;
        }}
      >
        <MapLibre mapStyle={MAP_STYLE} />
      </DeckGL>
    </WebGLBoundary>
  );
}
