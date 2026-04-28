import React, { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  useGetNetworkSnapshot,
  useGetDashboardOverview,
  getGetNetworkSnapshotQueryKey,
  getGetDashboardOverviewQueryKey,
  getGetOverviewActivityStreamQueryKey,
  getGetOverviewLeaderboardQueryKey,
  getGetOverviewColdChainPulseQueryKey,
  getGetOverviewMissionRiskMatrixQueryKey,
  getGetOverviewCascadeQueryKey,
  getGetOverviewAiBriefQueryKey,
} from "@workspace/api-client-react";
import NetworkGLMap from "@/components/Map";
import { MousePointerClick } from "lucide-react";
import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import RefreshControls, {
  readPersistedInterval,
  writePersistedInterval,
  DEFAULT_REFRESH_INTERVAL_MS,
} from "@/components/RefreshControls";
import { VitalSignsStrip } from "@/components/overview/VitalSignsStrip";
import { PersonaSwitcher } from "@/components/overview/PersonaSwitcher";
import { AiBriefCard } from "@/components/overview/AiBriefCard";
import { MissionRiskMatrix } from "@/components/overview/MissionRiskMatrix";
import { TimeToFailLeaderboard } from "@/components/overview/TimeToFailLeaderboard";
import { ConstraintCascade } from "@/components/overview/ConstraintCascade";
import { ColdChainPulse } from "@/components/overview/ColdChainPulse";
import { WalkingBloodBank } from "@/components/overview/WalkingBloodBank";
import { LiveActivityStream } from "@/components/overview/LiveActivityStream";
import {
  PERSONA_WIDGET_ORDER,
  type Persona,
  type WidgetId,
  readPersistedPersona,
  writePersistedPersona,
} from "@/components/overview/persona";

const REFRESH_STORAGE_KEY = "command:overview:refresh-interval-ms";
const ACTIVITY_LIMIT = 30;
const PULSE_WINDOW = 60;
const LEADERBOARD_LIMIT = 10;

export default function CommandOverview() {
  const [, setLocation] = useLocation();
  const [intervalMs, setIntervalMs] = useState<number>(() =>
    readPersistedInterval(REFRESH_STORAGE_KEY, DEFAULT_REFRESH_INTERVAL_MS),
  );
  const [persona, setPersona] = useState<Persona>(() => readPersistedPersona());

  const handleNodeClick = useCallback(
    (node: any) => {
      if (node?.id) setLocation(`/sites/${node.id}`);
    },
    [setLocation],
  );
  const handleShipmentClick = useCallback(
    (shipment: any) => {
      const orderId = shipment?.orderId as string | null | undefined;
      if (orderId) setLocation(`/orders/${orderId}`);
      else setLocation("/orders");
    },
    [setLocation],
  );

  const handleIntervalChange = (ms: number) => {
    setIntervalMs(ms);
    writePersistedInterval(REFRESH_STORAGE_KEY, ms);
  };

  const handlePersonaChange = (p: Persona) => {
    setPersona(p);
    writePersistedPersona(p);
  };

  const snapshotKey = useMemo(() => getGetNetworkSnapshotQueryKey(), []);
  const overviewKey = useMemo(() => getGetDashboardOverviewQueryKey(), []);
  const activityKey = useMemo(
    () => getGetOverviewActivityStreamQueryKey({ limit: ACTIVITY_LIMIT }),
    [],
  );
  const leaderboardKey = useMemo(
    () => getGetOverviewLeaderboardQueryKey({ limit: LEADERBOARD_LIMIT }),
    [],
  );
  const pulseKey = useMemo(
    () => getGetOverviewColdChainPulseQueryKey({ windowMinutes: PULSE_WINDOW }),
    [],
  );
  const matrixKey = useMemo(
    () => getGetOverviewMissionRiskMatrixQueryKey(),
    [],
  );
  const cascadeKey = useMemo(() => getGetOverviewCascadeQueryKey(), []);
  const aiBriefKey = useMemo(() => getGetOverviewAiBriefQueryKey(), []);

  const { data: snapshot, isLoading: snapLoading } = useGetNetworkSnapshot({
    query: { queryKey: snapshotKey },
  });

  const { data: overview } = useGetDashboardOverview({
    query: { queryKey: overviewKey },
  });

  const refreshKeys = useMemo(
    () => [
      snapshotKey,
      overviewKey,
      activityKey,
      leaderboardKey,
      pulseKey,
      matrixKey,
      cascadeKey,
      aiBriefKey,
    ],
    [
      snapshotKey,
      overviewKey,
      activityKey,
      leaderboardKey,
      pulseKey,
      matrixKey,
      cascadeKey,
      aiBriefKey,
    ],
  );

  const { refreshNow, isRefreshing, lastUpdatedAt } = useAutoRefresh({
    intervalMs,
    queryKeys: refreshKeys,
  });

  const widgetOrder = PERSONA_WIDGET_ORDER[persona];

  // The AI Brief is always rendered above the multi-column grid (full width),
  // and the Map keeps a 2-col span. Everything else flows in a 3-col grid in
  // the persona-driven order.
  const aiBriefFirst = widgetOrder.includes("ai_brief");
  const gridWidgets = widgetOrder.filter(
    (w) => w !== "ai_brief" && w !== "map",
  );
  const mapAfter = widgetOrder.includes("map");

  return (
    <div
      className="h-full flex flex-col p-4 gap-4 overflow-y-auto bg-background text-foreground"
      data-testid="command-overview-page"
    >
      {/* Page Header */}
      <div className="flex items-center justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-lg font-bold tracking-wide text-foreground">
            Command Overview
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Theater-wide readiness, risk, and live shipment posture.
          </p>
        </div>
        <RefreshControls
          intervalMs={intervalMs}
          onIntervalChange={handleIntervalChange}
          lastUpdatedAt={lastUpdatedAt}
          isRefreshing={isRefreshing}
          onRefreshNow={() => void refreshNow()}
        />
      </div>

      {/* Vital Signs strip */}
      <VitalSignsStrip
        bloodReadiness={overview?.bloodReadiness}
        kpis={overview?.kpis}
        refreshTick={lastUpdatedAt}
      />

      {/* Persona switcher */}
      <div className="shrink-0" data-testid="persona-switcher">
        <PersonaSwitcher value={persona} onChange={handlePersonaChange} />
      </div>

      {/* AI Brief — full width */}
      {aiBriefFirst && <AiBriefCard />}

      {/* Multi-column widget grid driven by persona ordering */}
      <div
        className="grid grid-cols-1 lg:grid-cols-3 lg:grid-flow-row-dense gap-4 auto-rows-[minmax(280px,auto)]"
        data-testid="overview-grid"
      >
        {gridWidgets.map((w) => (
          <WidgetSlot key={w} widget={w} />
        ))}
      </div>

      {/* Map — peer of the cards, but spans more horizontally */}
      {mapAfter && (
        <div
          className="rounded-xl overflow-hidden border border-border relative bg-card"
          style={{ minHeight: "420px" }}
          data-testid="theater-map-card"
        >
          <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
            <Badge
              variant="outline"
              className="bg-background/80 backdrop-blur-sm border-primary text-primary shadow-lg"
            >
              Live Theater Map
            </Badge>
            <Badge
              variant="outline"
              className="bg-background/80 backdrop-blur-sm border-border text-muted-foreground shadow-lg gap-1.5 font-normal"
            >
              <MousePointerClick className="h-3 w-3" />
              Click any node or shipment to inspect
            </Badge>
          </div>
          {snapLoading ? (
            <div className="w-full h-[420px] flex items-center justify-center bg-muted/20">
              <Skeleton className="w-full h-full" />
            </div>
          ) : (
            <div className="w-full h-[420px] relative">
              <NetworkGLMap
                nodes={snapshot?.nodes}
                routes={snapshot?.routes}
                shipments={snapshot?.shipments}
                riskByNode={snapshot?.riskByNode}
                threats={snapshot?.threats}
                onNodeClick={handleNodeClick}
                onShipmentClick={handleShipmentClick}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WidgetSlot({ widget }: { widget: WidgetId }) {
  switch (widget) {
    case "mission_matrix":
      return (
        <div className="lg:col-span-2">
          <MissionRiskMatrix />
        </div>
      );
    case "leaderboard":
      return (
        <div className="lg:col-span-1 min-h-[420px]">
          <TimeToFailLeaderboard />
        </div>
      );
    case "cascade":
      return (
        <div className="lg:col-span-3">
          <ConstraintCascade />
        </div>
      );
    case "cold_chain_pulse":
      return (
        <div className="lg:col-span-2">
          <ColdChainPulse />
        </div>
      );
    case "wbb_abo":
      return (
        <div className="lg:col-span-1">
          <WalkingBloodBank />
        </div>
      );
    case "activity_stream":
      return (
        <div className="lg:col-span-3 min-h-[360px]">
          <LiveActivityStream />
        </div>
      );
    default:
      return null;
  }
}

