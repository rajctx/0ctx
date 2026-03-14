import { useDesktopPosture, useDesktopStatus, useDesktopVersion, useDataPolicy, useHookHealth, useOpenPath } from '../../features/runtime/queries';

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

function formatPolicyLabel(value?: string | null) {
  if (!value) {
    return 'Lean (default)';
  }
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}${value === 'lean' ? ' (default)' : ''}`;
}

interface SetupContextPanelProps {
  contextId: string | null;
}

export function SetupContextPanel({ contextId }: SetupContextPanelProps) {
  const dataPolicy = useDataPolicy(contextId);
  const posture = useDesktopPosture();
  const version = useDesktopVersion();
  const hookHealth = useHookHealth();
  const status = useDesktopStatus();
  const openPath = useOpenPath();

  const readyCount = hookHealth.data?.readyCount ?? (hookHealth.data?.agents ?? []).filter((agent) => agent.installed).length;

  return (
    <>
      <div className="ctx-section">
        <div className="ctx-header"><span className="brk">[-]</span> Policy Detail</div>
        <div className="ctx-prose ctx-spacing">Current summary</div>
        <div className="ctx-data ctx-data-wide">
          <span className="cdk">Policy Mode:</span>
          <span className="cdv">{formatPolicyLabel(dataPolicy.data?.preset ?? null)}</span>
          <span className="cdk">WS Sync:</span>
          <span className="cdv mono">{dataPolicy.data?.workspaceSyncSummary ?? dataPolicy.data?.syncPolicy ?? 'local_only (default)'}</span>
          <span className="cdk">Machine:</span>
          <span className="cdv">{dataPolicy.data?.machineCaptureSummary ?? '14d local; debug trails off by default'}</span>
          <span className="cdk">Runtime:</span>
          <span className="cdv muted">{dataPolicy.data?.debugUtilitySummary ?? 'Off in normal path'}</span>
        </div>
      </div>

      <div className="ctx-section">
        <div className="ctx-header"><span className="brk">[-]</span> Advanced Overrides</div>
        <div className="ctx-prose dim">
          {dataPolicy.data?.normalPathSummary ?? 'Lean is the normal default. Workspace sync stays local_only and machine capture stays local. Debug trails and opt-in cloud sync stay in Utilities.'}
        </div>
      </div>

      <div className="ctx-section">
        <div className="ctx-header"><span className="brk">[-]</span> Utility Actions</div>
        <div className="ctx-prose ctx-spacing">
          Runtime support. The normal path is active. Use these tools only when runtime behavior is clearly off.
        </div>
        <button
          type="button"
          className="ctx-action"
          onClick={() => {
            const target = status.data?.storage.dataDir ?? '';
            if (target) {
              openPath.mutate(target);
            }
          }}
        >
          <span className="brk">[→]</span> OPEN RUNTIME TOOLS
        </button>
      </div>

      <div className="ctx-section ctx-footer">
        <hr className="divider" />
        <div className="ctx-header"><span className="brk">[-]</span> Technical Details</div>
        <div className="ctx-data ctx-data-wide">
          <span className="cdk">State:</span>
          <span className="cdv bright">{formatStateLabel(posture.data)}</span>
          <span className="cdk">Integrations:</span>
          <span className="cdv">{`${readyCount} / ${(hookHealth.data?.agents ?? []).length || 0} ready`}</span>
          <span className="cdk">Node:</span>
          <span className="cdv">{status.data?.storage.socketPath ?? 'Unavailable'}</span>
          <span className="cdk">Version:</span>
          <span className="cdv">{version.data ?? 'Unknown'}</span>
        </div>
      </div>
    </>
  );
}
