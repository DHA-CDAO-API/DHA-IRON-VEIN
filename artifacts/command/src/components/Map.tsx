import React, { useMemo, useState, useEffect } from 'react';
import { Map as MapLibre } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer, ArcLayer } from '@deck.gl/layers';
import type { MapViewState } from '@deck.gl/core';

interface NetworkMapProps {
  nodes?: any[];
  routes?: any[];
  shipments?: any[];
  threats?: any[];
  riskByNode?: any[];
  onNodeClick?: (node: any) => void;
  viewState?: MapViewState;
  onViewStateChange?: (params: { viewState: MapViewState }) => void;
}

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: 140,
  latitude: 20,
  zoom: 2.5,
  pitch: 45,
  bearing: 0,
};

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

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

function NetworkFallback({
  nodes = [],
  riskByNode = [],
  onNodeClick,
}: NetworkMapProps) {
  const riskMap = new Map(riskByNode.map((r) => [r.nodeId, r.riskScore]));
  return (
    <div
      className="absolute inset-0 overflow-auto p-4"
      style={{ background: 'radial-gradient(circle at 50% 40%, #0E1A2E 0%, #050A14 80%)' }}
    >
      <div className="text-cyan-300 text-xs uppercase tracking-widest mb-3 font-mono">
        Tactical List View · GPU acceleration unavailable
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {nodes.map((n) => {
          const risk = (riskMap.get(n.id) as number | undefined) ?? 0;
          const ring =
            risk > 80 ? 'border-red-500 text-red-300'
            : risk > 50 ? 'border-amber-500 text-amber-300'
            : 'border-cyan-500 text-cyan-300';
          return (
            <button
              key={n.id}
              onClick={() => onNodeClick?.(n)}
              className={`text-left border ${ring} bg-black/40 rounded p-2 hover:bg-black/70 transition`}
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
    /* swallowed - fallback shown */
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
    threats = [],
    riskByNode = [],
    onNodeClick,
    viewState,
    onViewStateChange,
  } = props;

  const [hasWebGL, setHasWebGL] = useState<boolean | null>(null);

  useEffect(() => {
    setHasWebGL(detectWebGL());
  }, []);

  const layers = useMemo(() => {
    const riskMap = new Map(riskByNode.map((r) => [r.nodeId, r.riskScore]));
    const nodeIndex = new Map(nodes.map((n: any) => [n.id, n]));
    return [
      new ArcLayer({
        id: 'routes',
        data: routes,
        getSourcePosition: (d: any) => {
          const n: any = nodeIndex.get(d.fromNode);
          return n ? [n.longitude, n.latitude] : [0, 0];
        },
        getTargetPosition: (d: any) => {
          const n: any = nodeIndex.get(d.toNode);
          return n ? [n.longitude, n.latitude] : [0, 0];
        },
        getSourceColor: [100, 150, 250, 100],
        getTargetColor: [100, 150, 250, 100],
        getWidth: 1,
      }),
      new ArcLayer({
        id: 'shipments',
        data: shipments,
        getSourcePosition: (d: any) => {
          const n: any = nodeIndex.get(d.fromNode);
          return n ? [n.longitude, n.latitude] : [0, 0];
        },
        getTargetPosition: (d: any) => {
          const n: any = nodeIndex.get(d.toNode);
          return n ? [n.longitude, n.latitude] : [0, 0];
        },
        getSourceColor: [0, 255, 255, 255],
        getTargetColor: [0, 255, 255, 255],
        getWidth: 3,
        getTilt: 15,
      }),
      new ScatterplotLayer({
        id: 'nodes',
        data: nodes,
        getPosition: (d: any) => [d.longitude, d.latitude],
        getFillColor: (d: any) => {
          const risk = (riskMap.get(d.id) as number | undefined) ?? 0;
          if (risk > 80) return [255, 60, 60, 255];
          if (risk > 50) return [255, 160, 60, 255];
          return [0, 255, 255, 200];
        },
        getRadius: (d: any) => (d.type === 'REGIONAL_HUB' ? 30000 : 15000),
        pickable: true,
        onClick: (info) => {
          if (info.object && onNodeClick) onNodeClick(info.object);
        },
        autoHighlight: true,
        highlightColor: [255, 255, 255, 255],
      }),
    ];
  }, [nodes, routes, shipments, threats, riskByNode, onNodeClick]);

  if (hasWebGL === null) return null;
  if (!hasWebGL) return <NetworkFallback {...props} />;

  return (
    <WebGLBoundary fallback={<NetworkFallback {...props} />}>
      <DeckGL
        initialViewState={viewState || INITIAL_VIEW_STATE}
        onViewStateChange={onViewStateChange as any}
        controller={true}
        layers={layers}
        getTooltip={({ object }: any) =>
          object && (object.name || object.label || 'Network Element')
        }
      >
        <MapLibre mapStyle={MAP_STYLE} />
      </DeckGL>
    </WebGLBoundary>
  );
}
