import {
  useConnectorStatus,
  useDesktopPosture,
  useDesktopStatus,
  useDesktopVersion,
  useDataPolicy,
  useHookHealth,
  useOpenPath,
  useRestartConnector
} from '../../features/runtime/queries';
import { getGaIntegrationCounts } from '../../lib/setup-integrations';

function getMutationErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return 'The connector restart did not complete.';
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
  const connector = useConnectorStatus();
  const restartConnector = useRestartConnector();
  const status = useDesktopStatus();
  const openPath = useOpenPath();

  const { readyCount, totalCount } = getGaIntegrationCounts(hookHealth.data);
  const restartError = restartConnector.isError ? getMutationErrorMessage(restartConnector.error) : null;

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
        <div className="ctx-data ctx-data-wide">
          <span className="cdk">Capture:</span>
          <span className="cdv">{dataPolicy.data?.machineCaptureSummary ?? '14d local capture'}</span>
          <span className="cdk">Debug:</span>
          <span className="cdv">{dataPolicy.data?.debugUtilitySummary ?? 'Off in normal path'}</span>
          <span className="cdk">Hint:</span>
          <span className="cdv muted">{dataPolicy.data?.policyActionHint ?? dataPolicy.data?.normalPathSummary ?? 'Keep lean as the default unless you are actively reviewing or debugging.'}</span>
        </div>
      </div>

      <div className="ctx-section">
        <div className="ctx-header"><span className="brk">[-]</span> Utility Actions</div>
        <div className="ctx-prose ctx-spacing">
          Runtime support. The normal path is active. Use these tools only when runtime behavior is clearly off.
        </div>
        <div className="ctx-action-list">
          <button
            type="button"
            className="ctx-action"
            onClick={() => {
              const target = status.data?.storage.dataDir ?? '';
              if (target) {
                openPath.mutate(target);
              }
            }}
            disabled={!status.data?.storage.dataDir}
          >
            <span className="brk">[→]</span> OPEN DATA DIRECTORY
          </button>
          <button
            type="button"
            className="ctx-action"
            onClick={() => {
              const target = hookHealth.data?.statePath ?? status.data?.storage.hookStatePath ?? '';
              if (target) {
                openPath.mutate(target);
              }
            }}
            disabled={!(hookHealth.data?.statePath ?? status.data?.storage.hookStatePath)}
          >
            <span className="brk">[→]</span> OPEN HOOK STATE
          </button>
          <button
            type="button"
            className="ctx-action"
            onClick={() => {
              restartConnector.mutate();
            }}
            disabled={restartConnector.isPending}
          >
            <span className="brk">[↻]</span> {restartConnector.isPending ? 'RESTARTING CONNECTOR' : 'RESTART CONNECTOR'}
          </button>
        </div>
        {restartError ? <div className="ctx-prose ctx-error">Connector restart failed: {restartError}</div> : null}
      </div>

      <div className="ctx-section ctx-footer">
        <hr className="divider" />
        <div className="ctx-header"><span className="brk">[-]</span> Technical Details</div>
        <div className="ctx-data ctx-data-wide">
          <span className="cdk">State:</span>
          <span className="cdv bright">{formatStateLabel(posture.data)}</span>
          <span className="cdk">Integrations:</span>
          <span className="cdv">{`${readyCount} / ${totalCount} ready`}</span>
          <span className="cdk">Connector:</span>
          <span className="cdv">{connector.data?.running ? 'Running' : 'Unavailable'}</span>
          <span className="cdk">Node:</span>
          <span className="cdv">{status.data?.storage.socketPath ?? 'Unavailable'}</span>
          <span className="cdk">Version:</span>
          <span className="cdv">{version.data ?? 'Unknown'}</span>
        </div>
      </div>
    </>
  );
}
