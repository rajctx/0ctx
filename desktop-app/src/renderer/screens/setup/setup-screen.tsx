import { useDataPolicy, useDesktopStatus, useHookHealth } from '../../features/runtime/queries';
import { useShellStore } from '../../lib/store';

function toTitleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function SetupScreen() {
  const activeContextId = useShellStore((state) => state.activeContextId);
  const status = useDesktopStatus();
  const hookHealth = useHookHealth();
  const dataPolicy = useDataPolicy(activeContextId);

  const repoRoot = status.data?.contexts.find((context) => context.id === activeContextId)?.paths?.[0] ?? '<repo-root>';
  const enableCommand = `0ctx enable --repo-root "${repoRoot}"`;
  const currentPreset = String(dataPolicy.data?.preset ?? 'lean').toLowerCase();
  const integrations = (hookHealth.data?.agents ?? []).filter((agent) => ['claude', 'factory', 'antigravity'].includes(String(agent.agent ?? '')));
  const readyCount = hookHealth.data?.readyCount ?? integrations.filter((agent) => agent.installed).length;

  return (
    <>
      <div>
        <div className="page-eyebrow">Setup</div>
        <div className="page-title">Enable repo and agents</div>
        <div className="page-desc">
          {`${readyCount} GA integrations installed. Use setup only when enabling another repo or when you need to open runtime support when something is off.`}
        </div>
      </div>

      <div className="cmd-section">
        <div className="section-label">Setup Commands &mdash; <span>Repo Action</span></div>
        <div className="cmd-subtitle">Repo enablement</div>
        <div className="cmd-key">Enable Command</div>
        <div className="cmd-block">
          <pre>{enableCommand}</pre>
        </div>
        <div className="cmd-actions">
          <button
            type="button"
            className="cmd-action"
            onClick={() => {
              if (navigator.clipboard) {
                void navigator.clipboard.writeText(enableCommand).catch(() => undefined);
              }
            }}
          >
            <span className="brk">[↓]</span> COPY ENABLE COMMAND
          </button>
          <button
            type="button"
            className="cmd-action"
            onClick={() => {
              if (navigator.clipboard) {
                void navigator.clipboard.writeText('0ctx shell').catch(() => undefined);
              }
            }}
          >
            <span className="brk">[→]</span> COPY 0CTX SHELL
          </button>
        </div>
        <div className="cmd-note">
          {dataPolicy.data?.normalPathSummary ?? 'Use setup only when enabling another repo or when the local runtime clearly needs attention.'}
        </div>
      </div>

      <div className="int-section">
        <div className="section-label">Integration Health &mdash; <span>{`${readyCount} Ready`}</span></div>
        <div className="int-subtitle">GA integration status. Claude, Factory, Antigravity are installed for normal use.</div>
        <div className="int-list">
          {integrations.map((integration) => {
            const name = toTitleCase(String(integration.agent ?? 'integration'));
            const ready = integration.installed;
            return (
              <div key={name} className="int-row">
                <span className="int-name">{name}</span>
                <span className="int-meta">
                  {ready
                    ? 'Ready for normal path · Supported · Installed'
                    : `Needs attention · ${integration.status ?? 'Unknown'} · Not installed`}
                </span>
                <span className="int-status">{ready ? '[●] READY' : '[ ] SKIPPED'}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="policy-section">
        <div className="section-label">Sync and Capture Policy &mdash; <span>{`${toTitleCase(currentPreset)} Default`}</span></div>
        <div className="policy-subtitle">Workspace sync and machine defaults</div>
        <div className="policy-list">
          {([
            ['lean', 'Local-first default for normal product use.', 'Recommended'],
            ['review', 'Longer local capture for deeper inspection.', null],
            ['debug', 'Temporary debug trails and runtime utilities.', null]
          ] as Array<[string, string, string | null]>).map(([name, description, tag]) => {
            const active = currentPreset === name;
            return (
              <div key={name} className="policy-row">
                <span className={active ? 'p-brk on' : 'p-brk off'}>{active ? '[●]' : '[ ]'}</span>
                <span className={active ? 'p-name on' : 'p-name off'}>{toTitleCase(name)}</span>
                <span className="p-desc">
                  {description}
                  {tag ? <span className="p-tag">{tag}</span> : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
