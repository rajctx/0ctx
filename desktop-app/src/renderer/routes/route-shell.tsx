import { useEffect, useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AppShell } from '../components/shell/app-shell';
import { SidebarNav, type SidebarRoute } from '../components/shell/sidebar-nav';
import {
  useCheckpoints,
  useInsights,
  useSessions,
  useUpdatePreferences,
  useWorkstreams,
  useDesktopStatus
} from '../features/runtime/queries';
import { useShellStore } from '../lib/store';
import { workstreamKey } from '../lib/format';
import { CheckpointDrawer } from '../features/checkpoints/checkpoint-drawer';
import { InsightDrawer } from '../features/insights/insight-drawer';
import { OverviewContextPanel } from '../screens/overview/overview-context-panel';
import { WorkstreamsContextPanel } from '../screens/workstreams/workstreams-context-panel';
import { SessionsContextPanel } from '../screens/sessions/sessions-context-panel';
import { SetupContextPanel } from '../screens/setup/setup-context-panel';

function resolveRoute(pathname: string): SidebarRoute {
  if (pathname.startsWith('/workstreams')) {
    return 'workstreams';
  }
  if (pathname.startsWith('/sessions')) {
    return 'sessions';
  }
  if (pathname.startsWith('/setup')) {
    return 'setup';
  }
  return 'overview';
}

export function RouteShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const route = resolveRoute(location.pathname);
  const { data: status } = useDesktopStatus();
  const updatePreferences = useUpdatePreferences();
  const {
    activeContextId,
    activeWorkstreamKey,
    activeSessionId,
    setActiveContextId,
    setSearch,
    setActiveWorkstreamKey,
    setActiveSessionId,
    setActiveCheckpointId,
    setActiveInsightId,
    openDrawer
  } = useShellStore();

  const contexts = status?.contexts ?? [];
  const activeWorkspace = useMemo(
    () => contexts.find((context) => context.id === activeContextId) ?? contexts[0] ?? null,
    [contexts, activeContextId]
  );
  const workstreamsQuery = useWorkstreams(activeWorkspace?.id ?? null);
  const workstreams = workstreamsQuery.data ?? [];
  const selectedWorkstream = workstreams.find((stream) => workstreamKey(stream.branch, stream.worktreePath) === activeWorkstreamKey) ?? workstreams[0] ?? null;
  const allSessionsQuery = useSessions(activeWorkspace?.id ?? null, null, null, `shell:${activeWorkspace?.id ?? 'none'}`);
  const branchSessionsQuery = useSessions(
    activeWorkspace?.id ?? null,
    selectedWorkstream?.branch ?? null,
    selectedWorkstream?.worktreePath ?? null,
    selectedWorkstream ? `shell:${workstreamKey(selectedWorkstream.branch, selectedWorkstream.worktreePath)}` : 'shell:none'
  );
  const sidebarSessions = route === 'sessions' ? (branchSessionsQuery.data ?? []) : (allSessionsQuery.data ?? []);
  const checkpointsQuery = useCheckpoints(
    activeWorkspace?.id ?? null,
    selectedWorkstream?.branch ?? null,
    selectedWorkstream?.worktreePath ?? null,
    selectedWorkstream ? workstreamKey(selectedWorkstream.branch, selectedWorkstream.worktreePath) : null
  );
  const insightsQuery = useInsights(
    activeWorkspace?.id ?? null,
    selectedWorkstream?.branch ?? null,
    selectedWorkstream?.worktreePath ?? null,
    selectedWorkstream ? workstreamKey(selectedWorkstream.branch, selectedWorkstream.worktreePath) : null
  );

  useEffect(() => {
    if (!activeContextId && contexts[0]?.id) {
      setActiveContextId(contexts[0].id);
    }
  }, [activeContextId, contexts, setActiveContextId]);

  useEffect(() => {
    if (workstreams.length > 0 && (!activeWorkstreamKey || !workstreams.some((stream) => workstreamKey(stream.branch, stream.worktreePath) === activeWorkstreamKey))) {
      setActiveWorkstreamKey(workstreamKey(workstreams[0].branch, workstreams[0].worktreePath));
    }
  }, [activeWorkstreamKey, setActiveWorkstreamKey, workstreams]);

  useEffect(() => {
    if (
      route === 'sessions'
      && sidebarSessions.length > 0
      && (!activeSessionId || !sidebarSessions.some((session) => session.sessionId === activeSessionId))
    ) {
      setActiveSessionId(sidebarSessions[0].sessionId);
    }
  }, [activeSessionId, route, setActiveSessionId, sidebarSessions]);

  useEffect(() => {
    void updatePreferences.mutateAsync({ lastRoute: route }).catch(() => undefined);
  }, [route, updatePreferences]);

  const contextPanel = (() => {
    switch (route) {
      case 'workstreams':
        return (
          <WorkstreamsContextPanel
            contextId={activeWorkspace?.id ?? null}
            workspaceName={activeWorkspace?.name ?? null}
            workstream={selectedWorkstream}
          />
        );
      case 'sessions':
        return (
          <SessionsContextPanel
            contextId={activeWorkspace?.id ?? null}
            activeSessionId={activeSessionId}
            activeWorkstream={selectedWorkstream}
            activeWorkstreamKey={selectedWorkstream ? workstreamKey(selectedWorkstream.branch, selectedWorkstream.worktreePath) : null}
          />
        );
      case 'setup':
        return <SetupContextPanel contextId={activeWorkspace?.id ?? null} />;
      case 'overview':
      default:
        return <OverviewContextPanel contexts={contexts} activeContextId={activeWorkspace?.id ?? null} />;
    }
  })();

  const openLatestCheckpoint = () => {
    setActiveCheckpointId(checkpointsQuery.data?.[0]?.checkpointId ?? null);
    openDrawer('checkpoint');
  };

  const openLatestInsight = () => {
    setActiveInsightId(insightsQuery.data?.[0]?.nodeId ?? null);
    openDrawer('insight');
  };

  const handleSearch = () => {
    const next = window.prompt(route === 'setup' ? 'Search setup' : 'Filter current surface', '');
    if (next !== null) {
      setSearch(next);
    }
  };

  const enableCommand = `0ctx enable --repo-root "${activeWorkspace?.paths?.[0] ?? '<repo-root>'}"`;

  const topbar = (() => {
    switch (route) {
      case 'workstreams':
        return (
          <>
            <div className="breadcrumb">
              WORKSTREAMS / {String(activeWorkspace?.name ?? 'NO WORKSPACE').toUpperCase()} / <span>{String(selectedWorkstream?.branch ?? 'NONE').toUpperCase()}</span>
            </div>
            <div className="topbar-actions">
              <button type="button" className="action" onClick={handleSearch}>
                <span className="brk">[ ]</span> FILTER
              </button>
              <button type="button" className="action" onClick={() => navigate('/sessions')}>
                <span className="brk">[→]</span> OPEN SESSIONS
              </button>
            </div>
          </>
        );
      case 'sessions':
        return (
          <>
            <div className="breadcrumb">
              WORKSTREAMS / {String(activeWorkspace?.name ?? 'NO WORKSPACE').toUpperCase()} / <span>SESSIONS</span>
            </div>
            <div className="topbar-actions">
              <button type="button" className="action" onClick={handleSearch}>
                <span className="brk">[ ]</span> FILTER
              </button>
              <button type="button" className="action" onClick={openLatestCheckpoint}>
                <span className="brk">[+]</span> CREATE CHECKPOINT
              </button>
            </div>
          </>
        );
      case 'setup':
        return (
          <>
            <div className="breadcrumb">
              SETUP / {String(activeWorkspace?.name ?? 'NO WORKSPACE').toUpperCase()} / <span>REPO ENABLEMENT</span>
            </div>
            <div className="topbar-actions">
              <button type="button" className="action" onClick={handleSearch}>
                <span className="brk">[ ]</span> SEARCH
              </button>
              <button
                type="button"
                className="action"
                onClick={() => {
                  if (navigator.clipboard) {
                    void navigator.clipboard.writeText(enableCommand).catch(() => undefined);
                  }
                }}
              >
                <span className="brk">[↓]</span> COPY ENABLE COMMAND
              </button>
            </div>
          </>
        );
      case 'overview':
      default:
        return (
          <>
            <div className="breadcrumb">
              WORKSPACES / OVERVIEW / <span>BINDINGS</span>
            </div>
            <div className="topbar-actions">
              <button type="button" className="action" onClick={handleSearch}>
                <span className="brk">[ ]</span> FILTER
              </button>
              <button
                type="button"
                className="action"
                onClick={() => {
                  document.getElementById('workspace-name-input')?.focus();
                }}
              >
                <span className="brk">[+]</span> CREATE WORKSPACE
              </button>
            </div>
          </>
        );
    }
  })();

  return (
    <>
      <AppShell
        sidebar={(
          <SidebarNav
            route={route}
            contexts={contexts}
            activeContextId={activeWorkspace?.id ?? null}
            workstreams={workstreams}
            activeWorkstreamKey={selectedWorkstream ? workstreamKey(selectedWorkstream.branch, selectedWorkstream.worktreePath) : null}
            sessions={sidebarSessions}
            activeSessionId={activeSessionId}
            onNavigate={(nextRoute) => navigate(nextRoute === 'overview' ? '/overview' : `/${nextRoute}`)}
            onContextChange={(value) => {
              setActiveContextId(value || null);
              setSearch('');
              setActiveWorkstreamKey(null);
              setActiveSessionId(null);
              setActiveCheckpointId(null);
              setActiveInsightId(null);
            }}
            onWorkstreamChange={(value) => {
              setActiveWorkstreamKey(value);
              setActiveSessionId(null);
              setActiveCheckpointId(null);
              setActiveInsightId(null);
            }}
            onSessionChange={setActiveSessionId}
            onOpenCheckpoint={openLatestCheckpoint}
            onOpenInsight={openLatestInsight}
          />
        )}
        topbar={topbar}
        contextPanel={contextPanel}
        contentClassName={route === 'sessions' ? 'stream' : 'content'}
      >
        <Outlet />
      </AppShell>

      <CheckpointDrawer />
      <InsightDrawer />
    </>
  );
}
