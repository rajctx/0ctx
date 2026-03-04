'use client';

import {
  createContext as createReactContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import {
  CapabilitiesSnapshot,
  createContext as createContextAction,
  getContexts,
  getOperationalSnapshot,
  HealthSnapshot,
  MetricsSnapshot,
  RuntimeConnectorSnapshot
} from '@/app/actions';
import type { ContextItem } from '@/lib/graph';

const STATUS_REFRESH_INTERVAL_MS = 30_000;

interface DashboardStateValue {
  contexts: ContextItem[];
  activeContextId: string | null;
  activeContext: ContextItem | null;
  setActiveContextId: (contextId: string | null) => void;
  isContextLoading: boolean;
  health: HealthSnapshot | null;
  metrics: MetricsSnapshot | null;
  capabilities: CapabilitiesSnapshot | null;
  daemonOnline: boolean;
  methodCount: number;
  requestCount: number | null;
  connectorPosture: string;
  connectorRegistered: boolean;
  connectorBridgeHealthy: boolean;
  connectorCloudConnected: boolean;
  availableMachines: RuntimeConnectorSnapshot[];
  selectedMachineId: string | null;
  setSelectedMachineId: (machineId: string | null) => void;
  lastHealthCheckAt: number | null;
  refreshTick: number;
  refreshDashboardData: () => Promise<void>;
  createNewContext: (name: string) => Promise<void>;
}

const DashboardStateContext = createReactContext<DashboardStateValue | null>(null);

function resolveDaemonOnline(snapshot: HealthSnapshot | null): boolean {
  if (!snapshot) return false;
  if (typeof snapshot.ok === 'boolean') return snapshot.ok;
  if (typeof snapshot.status === 'string') return snapshot.status.toLowerCase() === 'ok';
  return true;
}

function resolveRequestCount(snapshot: MetricsSnapshot | null): number | null {
  if (typeof snapshot?.totalRequests === 'number') return snapshot.totalRequests;
  if (typeof snapshot?.requestCount === 'number') return snapshot.requestCount;
  if (typeof snapshot?.requests === 'number') return snapshot.requests;
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function DashboardStateProvider({ children }: { children: ReactNode }) {
  const [contexts, setContexts] = useState<ContextItem[]>([]);
  const [activeContextId, setActiveContextId] = useState<string | null>(null);
  const [isContextLoading, setIsContextLoading] = useState(true);

  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilitiesSnapshot | null>(null);
  const [connectorPosture, setConnectorPosture] = useState('unknown');
  const [connectorRegistered, setConnectorRegistered] = useState(false);
  const [connectorBridgeHealthy, setConnectorBridgeHealthy] = useState(false);
  const [connectorCloudConnected, setConnectorCloudConnected] = useState(false);
  const [availableMachines, setAvailableMachines] = useState<RuntimeConnectorSnapshot[]>([]);
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [lastHealthCheckAt, setLastHealthCheckAt] = useState<number | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const syncContexts = useCallback(
    async (preference?: { contextId?: string | null; contextName?: string }) => {
      setIsContextLoading(true);
      try {
        const contextList = await getContexts(selectedMachineId);
        if (!contextList) {
          // Keep previous state on transient bridge/API failures.
          return;
        }
        setContexts(contextList);
        setActiveContextId(previous => {
          if (contextList.length === 0) return null;

          if (preference?.contextId && contextList.some(item => item.id === preference.contextId)) {
            return preference.contextId;
          }

          if (preference?.contextName) {
            const byName = [...contextList]
              .reverse()
              .find(item => item.name.toLowerCase() === preference.contextName?.toLowerCase());
            if (byName) return byName.id;
          }

          if (previous && contextList.some(item => item.id === previous)) return previous;
          return contextList[0].id;
        });
      } finally {
        setIsContextLoading(false);
      }
    },
    [selectedMachineId]
  );

  // Single API call replaces the previous 4 parallel calls to /api/v1/runtime/status
  const refreshOperationalState = useCallback(async () => {
    const snapshot = await getOperationalSnapshot();
    const connectorPayload = snapshot.connectorStatus.payload;
    const registration = asRecord(connectorPayload?.registration);
    const bridge = asRecord(connectorPayload?.bridge);
    const cloud = asRecord(connectorPayload?.cloud);
    const defaultMachineId = typeof connectorPayload?.defaultMachineId === 'string'
      ? connectorPayload.defaultMachineId
      : null;
    const connectorList = Array.isArray(connectorPayload?.connectors)
      ? connectorPayload.connectors
          .filter((item): item is RuntimeConnectorSnapshot => (
            Boolean(item)
            && typeof item === 'object'
            && typeof (item as RuntimeConnectorSnapshot).machineId === 'string'
          ))
      : [];
    setHealth(snapshot.health);
    setMetrics(snapshot.metrics);
    setCapabilities(snapshot.capabilities);
    setAvailableMachines(connectorList);
    setSelectedMachineId(previous => {
      if (previous && connectorList.some(connector => connector.machineId === previous)) {
        return previous;
      }
      if (defaultMachineId && connectorList.some(connector => connector.machineId === defaultMachineId)) {
        return defaultMachineId;
      }
      if (connectorList.length === 0) return null;
      const sorted = [...connectorList].sort((a, b) => {
        const aTs = typeof a.lastHeartbeatAt === 'number' ? a.lastHeartbeatAt : 0;
        const bTs = typeof b.lastHeartbeatAt === 'number' ? b.lastHeartbeatAt : 0;
        if (bTs !== aTs) return bTs - aTs;
        return a.machineId.localeCompare(b.machineId);
      });
      return sorted[0].machineId;
    });
    setConnectorPosture(typeof connectorPayload?.posture === 'string' ? connectorPayload.posture : 'unknown');
    setConnectorRegistered(registration?.registered === true);
    setConnectorBridgeHealthy(bridge?.healthy === true);
    setConnectorCloudConnected(cloud?.connected === true);
    setLastHealthCheckAt(Date.now());
  }, []);

  const refreshDashboardData = useCallback(async () => {
    await Promise.all([syncContexts(), refreshOperationalState()]);
    setRefreshTick(current => current + 1);
  }, [refreshOperationalState, syncContexts]);

  const createNewContext = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;

      const created = await createContextAction(trimmed, [], selectedMachineId);
      const contextId =
        created && typeof created === 'object' && 'id' in created && typeof created.id === 'string'
          ? created.id
          : null;

      await Promise.all([
        syncContexts({
          contextId,
          contextName: trimmed
        }),
        refreshOperationalState()
      ]);
      setRefreshTick(current => current + 1);
    },
    [refreshOperationalState, selectedMachineId, syncContexts]
  );

  useEffect(() => {
    void refreshDashboardData();
  }, [refreshDashboardData]);

  // Visibility-aware polling: pause when tab is hidden
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    function startPolling() {
      if (intervalRef.current) return;
      intervalRef.current = setInterval(() => {
        void refreshOperationalState();
      }, STATUS_REFRESH_INTERVAL_MS);
    }

    function stopPolling() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        // Refresh immediately when tab becomes visible again
        void refreshOperationalState();
        startPolling();
      } else {
        stopPolling();
      }
    }

    startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshOperationalState]);

  const activeContext = useMemo(
    () => contexts.find(context => context.id === activeContextId) ?? null,
    [activeContextId, contexts]
  );

  const value = useMemo<DashboardStateValue>(
    () => ({
      contexts,
      activeContextId,
      activeContext,
      setActiveContextId,
      isContextLoading,
      health,
      metrics,
      capabilities,
      daemonOnline: resolveDaemonOnline(health),
      methodCount: Array.isArray(capabilities?.methods) ? capabilities.methods.length : 0,
      requestCount: resolveRequestCount(metrics),
      connectorPosture,
      connectorRegistered,
      connectorBridgeHealthy,
      connectorCloudConnected,
      availableMachines,
      selectedMachineId,
      setSelectedMachineId,
      lastHealthCheckAt,
      refreshTick,
      refreshDashboardData,
      createNewContext
    }),
    [
      activeContext,
      activeContextId,
      capabilities,
      contexts,
      createNewContext,
      connectorBridgeHealthy,
      connectorCloudConnected,
      connectorPosture,
      connectorRegistered,
      availableMachines,
      health,
      isContextLoading,
      lastHealthCheckAt,
      metrics,
      refreshDashboardData,
      refreshTick,
      selectedMachineId
    ]
  );

  return <DashboardStateContext.Provider value={value}>{children}</DashboardStateContext.Provider>;
}

export function useDashboardState(): DashboardStateValue {
  const context = useContext(DashboardStateContext);
  if (!context) {
    throw new Error('useDashboardState must be used within DashboardStateProvider.');
  }
  return context;
}
