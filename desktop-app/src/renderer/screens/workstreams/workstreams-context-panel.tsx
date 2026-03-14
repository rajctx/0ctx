import type { WorkstreamSummary } from '../../../shared/types/domain';
import { MessageRichText } from '../../components/content/message-rich-text';
import { useDesktopPosture, useDesktopVersion, useHandoff } from '../../features/runtime/queries';
import { formatRelativeAge, formatShortSha, pickText } from '../../lib/format';

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

interface WorkstreamsContextPanelProps {
  contextId: string | null;
  workspaceName: string | null;
  workstream: WorkstreamSummary | null;
}

export function WorkstreamsContextPanel({ contextId, workspaceName, workstream }: WorkstreamsContextPanelProps) {
  const handoff = useHandoff(contextId, workstream?.branch ?? null, workstream?.worktreePath ?? null);
  const posture = useDesktopPosture();
  const version = useDesktopVersion();

  return (
    <>
      <div className="ctx-section">
        <div className="ctx-header"><span className="brk">[-]</span> Summary</div>
        <div className="ctx-prose ctx-rich">
          <MessageRichText
            compact
            content={pickText(
              workstream
                ? `Active workstream for ${workspaceName ?? 'workspace'} on the ${workstream.branch} branch.\n\n${pickText(workstream.summary, workstream.stateSummary, workstream.handoffSummary, 'Ready to continue from the captured state.')}`
                : null,
              'No active workstream is selected yet.'
            )}
          />
        </div>
      </div>

      <div className="ctx-section">
        <div className="ctx-header"><span className="brk">[-]</span> Handoff Timeline</div>
        <div className="ctx-prose ctx-spacing">Agent continuity</div>
        <div className="timeline">
          {(handoff.data ?? []).slice(0, 4).map((entry, index) => (
            <div key={`${String(entry.sessionId ?? index)}`} className="tl-entry">
              <div className="tl-time">{`${formatRelativeAge(entry.lastTurnAt as string | number | null)} · ${pickText(String(entry.agent ?? ''), 'unknown')}`}</div>
              <div className="tl-text">
                <MessageRichText compact content={pickText(String(entry.summary ?? ''), 'Continuity event recorded for this workstream.')} />
              </div>
              <div className="tl-ref">{`${pickText(String(entry.branch ?? ''), workstream?.branch, 'branch')} · ${pickText(String(entry.agent ?? ''), 'agent')} · ${formatShortSha(String(entry.commitSha ?? ''))}`}</div>
            </div>
          ))}
          {(handoff.data ?? []).length === 0 ? <div className="ctx-prose">No handoff entries are available for this workstream yet.</div> : null}
        </div>
      </div>

      <div className="ctx-section ctx-footer">
        <hr className="divider" />
        <div className="ctx-header"><span className="brk">[-]</span> Technical Details</div>
        <div className="ctx-data">
          <span className="cdk">State:</span>
          <span className="cdv bright">{formatStateLabel(posture.data)}</span>
          <span className="cdk">Commit:</span>
          <span className="cdv mono">{formatShortSha(workstream?.lastCommitSha ?? workstream?.currentHeadSha ?? null)}</span>
          <span className="cdk">Branch:</span>
          <span className="cdv">{pickText(workstream?.branch, 'Unavailable')}</span>
          <span className="cdk">Version:</span>
          <span className="cdv">{version.data ?? 'Unknown'}</span>
        </div>
      </div>
    </>
  );
}
