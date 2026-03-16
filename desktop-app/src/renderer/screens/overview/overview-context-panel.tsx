import type { WorkspaceContext } from '../../../shared/types/domain';
import {
  useCheckpoints,
  useDataPolicy,
  useDesktopPosture,
  useDesktopVersion,
  useRepoReadiness,
  useSessions,
  useWorkspaceComparison,
  useWorkstreams
} from '../../features/runtime/queries';

function displayPath(value?: string | null) {
  if (!value) {
    return 'No repository bound';
  }
  return value.replace(/\\/g, '/');
}

function formatPresetLabel(value?: string | null) {
  switch (String(value || '').trim().toLowerCase()) {
    case 'lean':
      return 'Lean';
    case 'shared':
      return 'Shared';
    case 'review':
      return 'Review';
    default:
      return 'Lean';
  }
}

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

interface OverviewContextPanelProps {
  contexts: WorkspaceContext[];
  activeContextId: string | null;
}

export function OverviewContextPanel({ contexts, activeContextId }: OverviewContextPanelProps) {
  const activeContext = contexts.find((context) => context.id === activeContextId) ?? contexts[0] ?? null;
  const comparisonTarget = contexts.find((context) => context.id !== activeContext?.id) ?? null;

  const workstreams = useWorkstreams(activeContext?.id ?? null);
  const sessions = useSessions(activeContext?.id ?? null, null, null, `context-summary:${activeContext?.id ?? 'none'}`);
  const checkpoints = useCheckpoints(activeContext?.id ?? null, null, null, `context-summary:${activeContext?.id ?? 'none'}`);
  const dataPolicy = useDataPolicy(activeContext?.id ?? null);
  const repoReadiness = useRepoReadiness(activeContext?.id ?? null, activeContext?.paths?.[0] ?? null);
  const posture = useDesktopPosture();
  const version = useDesktopVersion();
  const comparison = useWorkspaceComparison(activeContext?.id ?? null, comparisonTarget?.id ?? null);

  const workstreamCount = workstreams.data?.length ?? 0;
  const sessionCount = sessions.data?.length ?? 0;
  const checkpointCount = checkpoints.data?.length ?? 0;
  const presetLabel = formatPresetLabel(repoReadiness.data?.dataPolicyPreset);
  const comparisonSummary = comparisonTarget
    ? `${activeContext?.name ?? 'Workspace'} ↔ ${comparisonTarget.name} ${comparison.data?.comparisonSummary?.replace(/^These workspaces /i, '').replace(/\.$/, '') ?? 'appear independent'}`
    : 'No secondary workspace available for comparison.';

  return (
    <>
      <div className="ctx-section">
        <div className="ctx-header"><span className="brk">[-]</span> Selected Workspace</div>
        <div className="ctx-prose">
          {activeContext?.paths?.[0] ? 'Bound to repository.' : 'No repository folder bound.'} {`${sessionCount} sessions · ${checkpointCount} checkpoints.`} Capture is {repoReadiness.data?.zeroTouchReady ? 'ready' : 'not ready'}.
        </div>
        <div className="data-grid ctx-gap">
          <span className="dk">Repository:</span>
          <span className="dv mono">{displayPath(activeContext?.paths?.[0] ?? null)}</span>

          <span className="dk">Activity:</span>
          <span className="dv">{`${workstreamCount} workstreams · ${sessionCount} sessions`}</span>

          <span className="dk">Policy:</span>
          <span className="dv dv-primary">{presetLabel}</span>
        </div>
      </div>

      <div className="ctx-section">
        <div className="ctx-header"><span className="brk">[-]</span> Capture Posture</div>
        <div className="data-grid">
          <span className="dk">Policy Mode:</span>
          <span className="dv">{`${presetLabel} (default)`}</span>

          <span className="dk">WS Sync:</span>
          <span className="dv mono">{dataPolicy.data?.syncPolicy ?? 'local_only'}</span>

          <span className="dk">Machine:</span>
          <span className="dv">{`${repoReadiness.data?.captureRetentionDays ?? 14}d local capture`}</span>

          <span className="dk">Runtime:</span>
          <span className="dv">Off in normal path</span>
        </div>
      </div>

      <div className="ctx-section">
        <div className="ctx-header"><span className="brk">[-]</span> Workspace Comparison</div>
        <div className="ctx-prose">
          {comparisonSummary} {comparison.data?.comparisonActionHint ?? 'Keep them isolated unless intentionally comparing.'}
        </div>
        <div className="data-grid ctx-gap">
          <span className="dk">Comparison:</span>
          <span className="dv dv-primary">
            {comparisonTarget ? (comparison.data?.comparisonKind ?? 'isolated').replace(/_/g, ' ') : 'none'}
          </span>

          <span className="dk">Repo Overlap:</span>
          <span className="dv">{comparison.data?.sharedRepositoryPaths?.length ? comparison.data.sharedRepositoryPaths.join(', ') : 'none'}</span>

          <span className="dk">Shared Work:</span>
          <span className="dv">{comparison.data?.sharedWorkstreams?.length ? comparison.data.sharedWorkstreams.join(', ') : 'none'}</span>
        </div>
      </div>

      <div className="ctx-section ctx-footer">
        <hr className="ctx-divider" />
        <div className="ctx-header"><span className="brk">[-]</span> Technical Details</div>
        <div className="data-grid">
          <span className="dk">State:</span>
          <span className="dv bright">{formatStateLabel(posture.data)}</span>

          <span className="dk">Workspaces:</span>
          <span className="dv">{`${contexts.length} total`}</span>

          <span className="dk">Version:</span>
          <span className="dv">{version.data ?? 'Unknown'}</span>
        </div>
      </div>
    </>
  );
}
