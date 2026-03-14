import { useMemo } from 'react';
import type { ChatSessionSummary, WorkspaceContext, WorkstreamSummary } from '../../../shared/types/domain';
import { normalizePath, pickText, workstreamKey } from '../../lib/format';

export type SidebarRoute = 'overview' | 'workstreams' | 'sessions' | 'setup';

interface SidebarNavProps {
  route: SidebarRoute;
  contexts: WorkspaceContext[];
  activeContextId: string | null;
  workstreams: WorkstreamSummary[];
  activeWorkstreamKey: string | null;
  sessions: ChatSessionSummary[];
  activeSessionId: string | null;
  onNavigate: (route: SidebarRoute) => void;
  onContextChange: (contextId: string) => void;
  onWorkstreamChange: (key: string) => void;
  onSessionChange: (sessionId: string) => void;
  onOpenCheckpoint: () => void;
  onOpenInsight: () => void;
}

function sessionLabel(session: ChatSessionSummary, index: number, total: number) {
  const prefix = `Session ${Math.max(1, total - index)}`;
  const detail = pickText(session.title, session.summary, '').replace(/\s+/g, ' ').trim();
  return detail ? `${prefix}` : prefix;
}

export function SidebarNav({
  route,
  contexts,
  activeContextId,
  workstreams,
  activeWorkstreamKey,
  sessions,
  activeSessionId,
  onNavigate,
  onContextChange,
  onWorkstreamChange,
  onSessionChange,
  onOpenCheckpoint,
  onOpenInsight
}: SidebarNavProps) {
  const activeContext = useMemo(
    () => contexts.find((context) => context.id === activeContextId) ?? contexts[0] ?? null,
    [contexts, activeContextId]
  );

  const visibleContexts = contexts.slice(0, 3);
  const visibleWorkstreams = workstreams.slice(0, 3);
  const visibleSessions = sessions.slice(0, 3);

  const workspaceFooter = (
    <div className="sidebar-footer">
      <div className="footer-label">Workspace</div>
      <div className="footer-ws">{activeContext?.name ?? 'No workspace selected'}</div>
      <div className="footer-meta">
        {normalizePath(activeContext?.paths?.[0] ?? '') || 'No repository bound'}
        <br />
        {`${workstreams.length} workstreams · ${sessions.length} sessions`}
      </div>
      <div className="live-badge">
        <span className="live-dot" />
        <span className="live-label">Live</span>
      </div>
    </div>
  );

  const workstreamFooter = (
    <div className="sidebar-footer">
      <div className="footer-label">Continuity</div>
      <div className="live-badge">
        <span className="live-dot" />
        <span className="live-lbl">Agent handoff is healthy</span>
      </div>
      <div className="footer-val">
        Show state, commit, readiness, recent sessions, and handoff history without oversized hero blocks.
      </div>
    </div>
  );

  const sessionsFooter = (
    <div className="sidebar-footer">
      <div className="footer-label">Conversations</div>
      <div className="footer-note">
        Thread list should feel like a timeline. Show session hierarchy, message count, workstream, participants, and selected turn.
      </div>
    </div>
  );

  const setupFooter = (
    <div className="sidebar-footer">
      <div className="footer-label">Setup Intent</div>
      <div className="footer-title">Keep the normal path obvious</div>
      <div className="footer-note">
        Enable the repo once, leave policy on lean unless needed, and push runtime tools to a lower tier.
      </div>
    </div>
  );

  return (
    <>
      <div className="sys-header">
        OCTX_SYS / MEMORY <span className="cursor" />
      </div>

      <nav className="nav">
        <button type="button" className={route === 'overview' ? 'nav-row active' : 'nav-row'} onClick={() => onNavigate('overview')}>
          <span className="brk">{route === 'overview' ? '[-]' : '[+]'}</span> WORKSPACES
        </button>
        {route === 'overview' ? (
          <div className="nav-sub">
            {visibleContexts.map((context) => {
              const active = context.id === activeContext?.id;
              return (
                <button
                  key={context.id}
                  type="button"
                  className={active ? 'nav-row active' : 'nav-row'}
                  onClick={() => onContextChange(context.id)}
                >
                  <span className="brk">{active ? '[●]' : '[ ]'}</span> {context.name}
                </button>
              );
            })}
          </div>
        ) : null}

        <button type="button" className={route === 'workstreams' ? 'nav-row active' : 'nav-row'} onClick={() => onNavigate('workstreams')}>
          <span className="brk">{route === 'workstreams' ? '[-]' : '[+]'}</span> WORKSTREAMS
        </button>
        {route === 'workstreams' ? (
          <div className="nav-sub">
            {visibleWorkstreams.map((stream) => {
              const key = workstreamKey(stream.branch, stream.worktreePath);
              const active = key === activeWorkstreamKey;
              return (
                <button
                  key={key}
                  type="button"
                  className={active ? 'nav-row active' : 'nav-row'}
                  onClick={() => onWorkstreamChange(key)}
                >
                  <span className="brk">{active ? '[●]' : '[ ]'}</span> {`${stream.branch} | ${activeContext?.name ?? 'workspace'}`}
                </button>
              );
            })}
          </div>
        ) : null}

        <button type="button" className={route === 'sessions' ? 'nav-row active' : 'nav-row'} onClick={() => onNavigate('sessions')}>
          <span className="brk">{route === 'sessions' ? '[-]' : '[+]'}</span> SESSIONS
        </button>
        {route === 'sessions' ? (
          <div className="nav-sub">
            {visibleSessions.map((session, index) => {
              const active = session.sessionId === activeSessionId;
              return (
                <button
                  key={session.sessionId}
                  type="button"
                  className={active ? 'nav-row active' : 'nav-row'}
                  onClick={() => onSessionChange(session.sessionId)}
                >
                  <span className="brk">{active ? '[●]' : '[ ]'}</span> {sessionLabel(session, index, visibleSessions.length)}
                </button>
              );
            })}
          </div>
        ) : null}

        <button type="button" className="nav-row" onClick={onOpenCheckpoint}>
          <span className="brk">[+]</span> CHECKPOINTS
        </button>
        <button type="button" className="nav-row" onClick={onOpenInsight}>
          <span className="brk">[+]</span> INSIGHTS
        </button>

        <button
          type="button"
          className={route === 'setup' ? 'nav-row active nav-row-gap' : 'nav-row nav-row-gap'}
          onClick={() => onNavigate('setup')}
        >
          <span className="brk">{route === 'setup' ? '[-]' : '[+]'}</span> SETUP
        </button>
        {route === 'setup' ? (
          <div className="nav-sub">
            <div className="nav-row active"><span className="brk">[●]</span> repo enablement</div>
            <div className="nav-row"><span className="brk">[ ]</span> integrations</div>
            <div className="nav-row"><span className="brk">[ ]</span> policy</div>
            <div className="nav-row"><span className="brk">[ ]</span> runtime</div>
          </div>
        ) : null}
      </nav>

      {route === 'overview' ? workspaceFooter : null}
      {route === 'workstreams' ? workstreamFooter : null}
      {route === 'sessions' ? sessionsFooter : null}
      {route === 'setup' ? setupFooter : null}
    </>
  );
}
