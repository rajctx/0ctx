'use client';

import {
  createContext as createReactContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import {
  CapabilitiesSnapshot,
  createContext as createContextAction,
  getCapabilities,
  getContexts,
  getHealth,
  getMetricsSnapshot,
  HealthSnapshot,
  MetricsSnapshot
} from '@/app/actions';
import type { ContextItem } from '@/lib/graph';

const STATUS_REFRESH_INTERVAL_MS = 15_000;

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

export function DashboardStateProvider({ children }: { children: ReactNode }) {
  const [contexts, setContexts] = useState<ContextItem[]>([]);
  const [activeContextId, setActiveContextId] = useState<string | null>(null);
  const [isContextLoading, setIsContextLoading] = useState(true);

  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilitiesSnapshot | null>(null);
  const [lastHealthCheckAt, setLastHealthCheckAt] = useState<number | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const syncContexts = useCallback(
    async (preference?: { contextId?: string | null; contextName?: string }) => {
      setIsContextLoading(true);
      try {
        const contextList = await getContexts();
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
    []
  );

  const refreshOperationalState = useCallback(async () => {
    const [healthData, metricsData, capabilitiesData] = await Promise.all([
      getHealth(),
      getMetricsSnapshot(),
      getCapabilities()
    ]);
    setHealth(healthData);
    setMetrics(metricsData);
    setCapabilities(capabilitiesData);
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

      const created = await createContextAction(trimmed);
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
    [refreshOperationalState, syncContexts]
  );

  useEffect(() => {
    void refreshDashboardData();
  }, [refreshDashboardData]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshOperationalState();
    }, STATUS_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
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
      health,
      isContextLoading,
      lastHealthCheckAt,
      metrics,
      refreshDashboardData,
      refreshTick
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
