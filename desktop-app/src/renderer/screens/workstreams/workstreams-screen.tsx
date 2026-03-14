import { useMemo } from 'react';
import { useSessions, useWorkstreamComparison, useWorkstreams } from '../../features/runtime/queries';
import { formatRelativeAge, formatShortSha, pickText, workstreamKey } from '../../lib/format';
import { useShellStore } from '../../lib/store';

function formatReadinessBadge(value?: string | null) {
  switch (value) {
    case 'ready':
      return '[●] Ready to continue';
    case 'review':
      return '[~] Review before handoff';
    case 'blocked':
      return '[ ] Blocked';
    default:
      return '[ ] Needs review';
  }
}

export function WorkstreamsScreen() {
  const { activeContextId, activeWorkstreamKey, setActiveWorkstreamKey, search } = useShellStore();
  const workstreamsQuery = useWorkstreams(activeContextId);

  const filteredWorkstreams = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return workstreamsQuery.data ?? [];
    }
    return (workstreamsQuery.data ?? []).filter((stream) =>
      `${stream.branch} ${stream.summary ?? ''} ${stream.stateSummary ?? ''} ${stream.handoffSummary ?? ''}`.toLowerCase().includes(query)
    );
  }, [search, workstreamsQuery.data]);

  const activeWorkstream = filteredWorkstreams.find((stream) => workstreamKey(stream.branch, stream.worktreePath) === activeWorkstreamKey)
    ?? filteredWorkstreams[0]
    ?? null;
  const compareTarget = filteredWorkstreams.find((stream) => workstreamKey(stream.branch, stream.worktreePath) !== workstreamKey(activeWorkstream?.branch, activeWorkstream?.worktreePath)) ?? null;
  const sessions = useSessions(
    activeContextId,
    activeWorkstream?.branch ?? null,
    activeWorkstream?.worktreePath ?? null,
    activeWorkstream ? workstreamKey(activeWorkstream.branch, activeWorkstream.worktreePath) : null
  );
  const comparison = useWorkstreamComparison(
    activeContextId,
    activeWorkstream?.branch ?? null,
    activeWorkstream?.worktreePath ?? null,
    compareTarget?.branch ?? null,
    compareTarget?.worktreePath ?? null
  );

  return (
    <>
      <div>
        <div className="page-eyebrow">Workstreams</div>
        <div className="page-title">Workstreams and handoffs</div>
        <div className="page-desc">
          {pickText(
            activeWorkstream
              ? `${filteredWorkstreams.length} tracked workstreams are available for this workspace. Inspect workstreams, see which agent touched them, and follow the handoff path.`
              : null,
            'No tracked workstreams are available yet.'
          )}
        </div>
      </div>

      <div className="ws-detail">
        <div className="section-label">Current Workstream</div>

        <div className="ws-title-row">
          <div className="ws-title">{activeWorkstream ? `${activeWorkstream.branch} | ${pickText(activeWorkstream.repositoryRoot, 'workspace')}` : 'No active workstream'}</div>
          <button
            type="button"
            className="ws-badge"
            onClick={() => {
              if (activeWorkstream) {
                setActiveWorkstreamKey(workstreamKey(activeWorkstream.branch, activeWorkstream.worktreePath));
              }
            }}
          >
            {formatReadinessBadge(activeWorkstream?.handoffReadiness ?? null)}
          </button>
        </div>

        <div className="ws-body">
          {pickText(
            activeWorkstream
              ? `${activeWorkstream.branch} has ${activeWorkstream.sessionCount ?? 0} sessions and ${activeWorkstream.checkpointCount ?? 0} checkpoints. Latest handoff: ${pickText(activeWorkstream.lastAgent, 'unknown')}. Next: ${pickText(activeWorkstream.handoffSummary, activeWorkstream.stateActionHint, 'create a checkpoint before handoff if you need a durable restore point.')}`
              : null,
            'Select a workstream to inspect state, recent sessions, and handoff readiness.'
          )}
        </div>

        <div className="data-rows">
          <div className="data-row">
            <span className="dk">State</span>
            <span className="dv">{pickText(activeWorkstream?.stateSummary, 'No captured state summary')}</span>
            <span className="dk">History</span>
            <span className="dv">{`${activeWorkstream?.sessionCount ?? 0} sessions · ${activeWorkstream?.checkpointCount ?? 0} checkpoints`}</span>
          </div>
          <div className="data-row">
            <span className="dk">Latest Commit</span>
            <span className="dv mono bright">{formatShortSha(activeWorkstream?.lastCommitSha ?? activeWorkstream?.currentHeadSha ?? null)}</span>
            <span className="dk">Handoff</span>
            <span className="dv bright">{pickText(activeWorkstream?.handoffSummary, formatReadinessBadge(activeWorkstream?.handoffReadiness ?? null))}</span>
          </div>
          <div className="data-row half">
            <span className="dk">Checkout</span>
            <span className="dv">
              {activeWorkstream?.checkedOutHere
                ? 'Checked out here'
                : activeWorkstream?.checkedOutElsewhere
                  ? 'Checked out in another worktree'
                  : 'No checkout metadata available'}
            </span>
          </div>
        </div>
      </div>

      <div>
        <div className="section-label">Recent Sessions &mdash; <span>{sessions.data?.length ?? 0}</span></div>
        <div className="sessions-list">
          {(sessions.data ?? []).slice(0, 5).map((session) => (
            <div key={session.sessionId} className="sess-row">
              <div className="sess-header">
                <span className="sess-icon">[↗]</span>
                <span className={session.sessionId ? 'sess-title' : 'sess-title dim'}>
                  {pickText(session.title, session.summary, session.sessionId)}
                </span>
              </div>
              <div className="sess-meta">
                {`${formatRelativeAge(session.lastTurnAt ?? session.updatedAt ?? session.startedAt ?? session.createdAt)} · ${pickText(session.agent, 'unknown')} · ${session.turnCount ?? session.messageCount ?? 0} messages · ${formatShortSha(session.commitSha ?? null)}`}
              </div>
            </div>
          ))}
          {(sessions.data ?? []).length === 0 ? <div className="compare-note">No sessions have been captured for this workstream yet.</div> : null}
        </div>
      </div>

      <div className="compare-row">
        <div className="section-label">Compare Workstreams</div>
        <div className="compare-entry">
          <span className="brk">[~]</span>
          <span className="compare-name">
            {compareTarget ? `${compareTarget.branch} ↔ ${activeWorkstream?.branch ?? 'active'}` : 'Add another tracked workstream'}
          </span>
        </div>
        <div className="compare-note">
          {pickText(
            comparison.data?.comparisonSummary,
            compareTarget ? 'Choose another workstream to compare git divergence, recent activity, and shared agents.' : 'Choose another workstream to compare git divergence, recent activity, and shared agents.'
          )}
          {comparison.data?.comparisonActionHint ? ` ${comparison.data.comparisonActionHint}` : ''}
        </div>
      </div>
    </>
  );
}
