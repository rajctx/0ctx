import { useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AppShell } from '../components/shell/app-shell';
import { SidebarNav, type SidebarRoute } from '../components/shell/sidebar-nav';
import {
  useCreateSessionCheckpoint,
  useOpenPath,
  useRestartConnector,
  useSessions,
  useUpdatePreferences,
  useWorkstreams,
  useDesktopStatus
} from '../features/runtime/queries';
import { useShellStore, type SetupSection } from '../lib/store';
import { pickText, workstreamKey } from '../lib/format';
import { filterSessionsByQuery, resolveSessionFeed } from '../lib/session-feed';
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
  const openPath = useOpenPath();
  const restartConnector = useRestartConnector();
  const updatePreferences = useUpdatePreferences();
  const createSessionCheckpoint = useCreateSessionCheckpoint();
  const {
    activeContextId,
    activeWorkstreamKey,
    activeSessionId,
    activeSetupSection,
    search,
    setActiveContextId,
    setSearch,
    setActiveWorkstreamKey,
    setActiveSessionId,
    requestSetupSection,
    setActiveCheckpointId,
    setActiveInsightId,
    openDrawer
  } = useShellStore();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const contexts = status?.contexts ?? [];
  const activeWorkspace = useMemo(
    () => contexts.find((context) => context.id === activeContextId) ?? contexts[0] ?? null,
    [contexts, activeContextId]
  );
  const needsWorkstreams = route !== 'overview';
  const needsSessions = route === 'sessions';
  const workstreamsQuery = useWorkstreams(needsWorkstreams ? (activeWorkspace?.id ?? null) : null);
  const workstreams = workstreamsQuery.data ?? [];
  const selectedWorkstream = workstreams.find((stream) => workstreamKey(stream.branch, stream.worktreePath) === activeWorkstreamKey) ?? workstreams[0] ?? null;
  const allSessionsQuery = useSessions(
    needsSessions ? (activeWorkspace?.id ?? null) : null,
    null,
    null,
    `shell:${activeWorkspace?.id ?? 'none'}`,
    { enabled: needsSessions }
  );
  const branchSessionsQuery = useSessions(
    needsSessions ? (activeWorkspace?.id ?? null) : null,
    selectedWorkstream?.branch ?? null,
    selectedWorkstream?.worktreePath ?? null,
    selectedWorkstream ? `shell:${workstreamKey(selectedWorkstream.branch, selectedWorkstream.worktreePath)}` : 'shell:none',
    { enabled: needsSessions }
  );
  const sessionsFeed = resolveSessionFeed({
    hasActiveWorkstream: Boolean(selectedWorkstream),
    workstreamSessions: branchSessionsQuery.data,
    workspaceSessions: allSessionsQuery.data
  });
  const routeSessions = route === 'sessions' ? sessionsFeed.sessions : (allSessionsQuery.data ?? []);
  const sidebarSessions = useMemo(
    () => route === 'sessions' ? filterSessionsByQuery(routeSessions, search) : routeSessions,
    [route, routeSessions, search]
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
    const timeout = window.setTimeout(() => {
      void updatePreferences.mutateAsync({ lastRoute: route }).catch(() => undefined);
    }, 150);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [route, updatePreferences]);

  useEffect(() => {
    if (!isSearchOpen) {
      return;
    }
    setSearchDraft(search);
  }, [isSearchOpen, search]);

  useEffect(() => {
    if (!isSearchOpen) {
      return;
    }

    searchInputRef.current?.focus();
    searchInputRef.current?.select();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSearchOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isSearchOpen]);

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
            fallbackApplied={sessionsFeed.fallbackApplied}
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
    setActiveCheckpointId(null);
    openDrawer('checkpoint');
  };

  const handleCheckpointAction = async () => {
    if (route !== 'sessions' || !activeWorkspace?.id || !activeSessionId) {
      openLatestCheckpoint();
      return;
    }

    const selectedSession = sidebarSessions.find((session) => session.sessionId === activeSessionId);
    if (!selectedSession) {
      openLatestCheckpoint();
      return;
    }

    if (selectedSession.branch) {
      const sessionWorkstreamKey = workstreamKey(selectedSession.branch, selectedSession.worktreePath);
      if (workstreams.some((stream) => workstreamKey(stream.branch, stream.worktreePath) === sessionWorkstreamKey)) {
        setActiveWorkstreamKey(sessionWorkstreamKey);
      }
    }

    try {
      const label = pickText(selectedSession.title, selectedSession.summary, selectedSession.sessionId);
      const created = await createSessionCheckpoint.mutateAsync({
        contextId: activeWorkspace.id,
        sessionId: activeSessionId,
        name: 'Session checkpoint',
        summary: label
      });
      setActiveCheckpointId(created.checkpointId ?? created.id ?? null);
      openDrawer('checkpoint');
    } catch {
      openLatestCheckpoint();
    }
  };

  const openLatestInsight = () => {
    setActiveInsightId(null);
    openDrawer('insight');
  };

  const handleContextSelection = (value: string | null) => {
    setActiveContextId(value || null);
    setSearch('');
    setActiveWorkstreamKey(null);
    setActiveSessionId(null);
    setActiveCheckpointId(null);
    setActiveInsightId(null);

    if (value) {
      navigate('/workstreams');
    }
  };

  const handleWorkstreamSelection = (value: string) => {
    setActiveWorkstreamKey(value);
    setActiveSessionId(null);
    setActiveCheckpointId(null);
    setActiveInsightId(null);
    navigate('/workstreams');
  };

  const handleSessionSelection = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setActiveCheckpointId(null);
    setActiveInsightId(null);
    const selectedSession = sidebarSessions.find((session) => session.sessionId === sessionId);
    if (selectedSession?.branch) {
      const sessionWorkstreamKey = workstreamKey(selectedSession.branch, selectedSession.worktreePath);
      if (workstreams.some((stream) => workstreamKey(stream.branch, stream.worktreePath) === sessionWorkstreamKey)) {
        setActiveWorkstreamKey(sessionWorkstreamKey);
      }
    }
    navigate('/sessions');
  };

  const handleSearch = () => {
    setIsSearchOpen(true);
  };

  const enableCommand = `0ctx enable --repo-root "${activeWorkspace?.paths?.[0] ?? '<repo-root>'}"`;
  const setupSectionLabel: Record<SetupSection, string> = {
    'repo-enablement': 'REPO ENABLEMENT',
    integrations: 'INTEGRATIONS',
    policy: 'POLICY',
    runtime: 'RUNTIME'
  };

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
              <button type="button" className="action" onClick={() => {
                void handleCheckpointAction();
              }}>
                <span className="brk">[+]</span> CREATE CHECKPOINT
              </button>
            </div>
          </>
        );
      case 'setup':
        return (
          <>
            <div className="breadcrumb">
              SETUP / {String(activeWorkspace?.name ?? 'NO WORKSPACE').toUpperCase()} / <span>{setupSectionLabel[activeSetupSection]}</span>
            </div>
            <div className="topbar-actions">
              <button type="button" className="action" onClick={handleSearch}>
                <span className="brk">[ ]</span> SEARCH
              </button>
              {activeSetupSection === 'repo-enablement' ? (
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
              ) : null}
              {activeSetupSection === 'integrations' ? (
                <button
                  type="button"
                  className="action"
                  onClick={() => {
                    void restartConnector.mutateAsync().catch(() => undefined);
                  }}
                >
                  <span className="brk">[↻]</span> RESTART CONNECTOR
                </button>
              ) : null}
              {activeSetupSection === 'runtime' ? (
                <button
                  type="button"
                  className="action"
                  onClick={() => {
                    const target = status?.storage.dataDir ?? '';
                    if (target) {
                      openPath.mutate(target);
                    }
                  }}
                >
                  <span className="brk">[→]</span> OPEN RUNTIME TOOLS
                </button>
              ) : null}
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
            activeSetupSection={activeSetupSection}
            onNavigate={(nextRoute) => navigate(nextRoute === 'overview' ? '/overview' : `/${nextRoute}`)}
            onContextChange={handleContextSelection}
            onWorkstreamChange={handleWorkstreamSelection}
            onSessionChange={handleSessionSelection}
            onSetupSectionChange={(section) => {
              requestSetupSection(section);
            }}
            onOpenCheckpoint={() => {
              void handleCheckpointAction();
            }}
            onOpenInsight={openLatestInsight}
          />
        )}
        topbar={topbar}
        contextPanel={contextPanel}
        contentClassName={route === 'sessions' ? 'stream' : 'content'}
      >
        <Outlet />
      </AppShell>

      {isSearchOpen ? (
        <div className="search-backdrop" onClick={() => setIsSearchOpen(false)}>
          <form
            className="search-shell"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(searchDraft);
              setIsSearchOpen(false);
            }}
          >
            <div className="search-label">{route === 'setup' ? 'Search setup' : 'Filter current surface'}</div>
            <input
              ref={searchInputRef}
              className="search-input"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={route === 'setup' ? 'type to search setup' : 'type to filter this surface'}
            />
            <div className="search-meta">
              {search ? `Current filter: ${search}` : 'No active filter'}
            </div>
            <div className="search-actions">
              <button
                type="button"
                className="cmd-action"
                onClick={() => {
                  setSearch('');
                  setSearchDraft('');
                  setIsSearchOpen(false);
                }}
              >
                <span className="brk">[x]</span> CLEAR
              </button>
              <button type="submit" className="cmd-action">
                <span className="brk">[→]</span> APPLY
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <CheckpointDrawer />
      <InsightDrawer />
    </>
  );
}
