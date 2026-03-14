import type { WorkstreamSummary } from '../../../shared/types/domain';
import { useDesktopPosture, useDesktopVersion, useInsights, useSessionDetail } from '../../features/runtime/queries';
import { formatShortSha, pickText, workstreamKey } from '../../lib/format';

function formatStateLabel(value?: string | null) {
  switch (value) {
    case 'Connected':
      return 'Synchronized';
    case 'Degraded':
      return 'Degraded';
    case 'Offline':
      return 'Offline';
    default:
      return 'Unknown';
  }
}

interface SessionsContextPanelProps {
  contextId: string | null;
  activeSessionId: string | null;
  activeWorkstream: WorkstreamSummary | null;
  activeWorkstreamKey: string | null;
  fallbackApplied: boolean;
}

export function SessionsContextPanel({
  contextId,
  activeSessionId,
  activeWorkstream,
  activeWorkstreamKey,
  fallbackApplied
}: SessionsContextPanelProps) {
  const detail = useSessionDetail(contextId, activeSessionId);
  const posture = useDesktopPosture();
  const version = useDesktopVersion();
  const session = detail.data?.session ?? null;
  const messages = detail.data?.messages ?? [];
  const effectiveBranch = session?.branch ?? activeWorkstream?.branch ?? null;
  const effectiveWorktreePath = session?.worktreePath ?? activeWorkstream?.worktreePath ?? null;
  const effectiveWorkstreamKey = effectiveBranch ? workstreamKey(effectiveBranch, effectiveWorktreePath) : activeWorkstreamKey;
  const insights = useInsights(contextId, effectiveBranch, effectiveWorktreePath, effectiveWorkstreamKey);

  const facts = [
    { key: 'A', active: Boolean(session?.branch), text: `Branch: ${pickText(session?.branch, activeWorkstream?.branch, 'Unavailable')}` },
    { key: 'B', active: Boolean(session?.agent), text: `Agent: ${pickText(session?.agent, 'Unavailable')}` },
    { key: 'C', active: messages.length > 0, text: `${messages.length} captured messages` },
    { key: 'D', active: Boolean(detail.data?.checkpointCount), text: `${detail.data?.checkpointCount ?? 0} checkpoints linked` },
    { key: 'E', active: Boolean(session?.worktreePath), text: pickText(session?.worktreePath, activeWorkstream?.worktreePath, 'No worktree path recorded') }
  ];

  return (
    <>
      <div className="ctx-section">
        <div className="ctx-header"><span className="brk">[-]</span> Summary</div>
        <div className="ctx-prose">
          {pickText(
            session?.summary ? `${session.summary}${fallbackApplied ? ' Showing workspace session fallback because the selected workstream had no direct matches.' : ''}` : null,
            `Session continuity for ${pickText(session?.branch, activeWorkstream?.branch, 'the selected workstream')}.`,
            'No session is selected yet.'
          )}
        </div>
      </div>

      <div className="ctx-section">
        <div className="ctx-header"><span className="brk">[-]</span> Facts &amp; Directives</div>
        <div className="idx-list">
          {facts.map((fact) => (
            <div key={fact.key} className={fact.active ? 'idx-item active' : 'idx-item dim'}>
              <span className="idx-letter">{fact.key}</span>
              <span className={fact.active ? 'idx-brk active' : 'idx-brk muted'}>{fact.active ? '[●]' : '[ ]'}</span>
              <span className="idx-text">{fact.text}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="ctx-section">
        <div className="ctx-header"><span className="brk">[-]</span> Insights</div>
        <div className="idx-list">
          {(insights.data ?? []).slice(0, 3).map((insight, index) => (
            <div key={insight.nodeId} className="idx-item">
              <span className="idx-letter">{index + 1}</span>
              <span className="idx-brk muted">[↗]</span>
              <span className="idx-text">{pickText(insight.content, insight.title, insight.key, 'Reviewed insight')}</span>
            </div>
          ))}
          {(insights.data ?? []).length === 0 ? (
            <div className="idx-item dim">
              <span className="idx-letter">1</span>
              <span className="idx-brk muted">[ ]</span>
              <span className="idx-text">No reviewed insights are attached to this workstream yet.</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="ctx-section ctx-footer">
        <hr className="divider" />
        <div className="ctx-header"><span className="brk">[-]</span> Technical Details</div>
        <div className="ctx-data">
          <span className="cdk">State:</span>
          <span className="cdv bright">{formatStateLabel(posture.data)}</span>
          <span className="cdk">Messages:</span>
          <span className="cdv">{String(messages.length)}</span>
          <span className="cdk">Agent:</span>
          <span className="cdv">{pickText(session?.agent, 'Unavailable')}</span>
          <span className="cdk">Commit:</span>
          <span className="cdv">{formatShortSha(session?.commitSha ?? null)}</span>
          <span className="cdk">Version:</span>
          <span className="cdv">{version.data ?? 'Unknown'}</span>
        </div>
      </div>
    </>
  );
}
