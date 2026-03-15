import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  useConnectorStatus,
  useDataPolicy,
  useDesktopStatus,
  useHookHealth,
  useOpenPath,
  useRestartConnector,
  useSetDataPolicy
} from '../../features/runtime/queries';
import { getGaIntegrationCounts } from '../../lib/setup-integrations';
import { useShellStore, type SetupSection } from '../../lib/store';

function toTitleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getMutationErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return 'The connector restart did not complete.';
}

export function SetupScreen() {
  const activeContextId = useShellStore((state) => state.activeContextId);
  const activeSetupSection = useShellStore((state) => state.activeSetupSection);
  const setupSectionScrollRequest = useShellStore((state) => state.setupSectionScrollRequest);
  const setActiveSetupSection = useShellStore((state) => state.setActiveSetupSection);
  const search = useShellStore((state) => state.search);
  const status = useDesktopStatus();
  const connector = useConnectorStatus();
  const hookHealth = useHookHealth();
  const openPath = useOpenPath();
  const restartConnector = useRestartConnector();
  const dataPolicy = useDataPolicy(activeContextId);
  const setDataPolicy = useSetDataPolicy();
  const [pendingPreset, setPendingPreset] = useState<string | null>(null);

  const repoSectionRef = useRef<HTMLDivElement>(null);
  const integrationsSectionRef = useRef<HTMLDivElement>(null);
  const policySectionRef = useRef<HTMLDivElement>(null);
  const runtimeSectionRef = useRef<HTMLDivElement>(null);

  const repoRoot = status.data?.contexts.find((context) => context.id === activeContextId)?.paths?.[0] ?? '<repo-root>';
  const enableCommand = `0ctx enable --repo-root "${repoRoot}"`;
  const currentPreset = String(dataPolicy.data?.preset ?? 'lean').toLowerCase();
  const { integrations, readyCount, totalCount } = getGaIntegrationCounts(hookHealth.data);
  const restartError = restartConnector.isError ? getMutationErrorMessage(restartConnector.error) : null;
  const runtimeActions = [
    {
      key: 'data-dir',
      label: 'OPEN DATA DIRECTORY',
      symbol: '[→]',
      description: status.data?.storage.dataDir ?? 'Local data directory unavailable',
      onClick: () => {
        const target = status.data?.storage.dataDir ?? '';
        if (target) {
          openPath.mutate(target);
        }
      },
      disabled: !status.data?.storage.dataDir
    },
    {
      key: 'hook-state',
      label: 'OPEN HOOK STATE',
      symbol: '[→]',
      description: hookHealth.data?.statePath ?? status.data?.storage.hookStatePath ?? 'Hook state path unavailable',
      onClick: () => {
        const target = hookHealth.data?.statePath ?? status.data?.storage.hookStatePath ?? '';
        if (target) {
          openPath.mutate(target);
        }
      },
      disabled: !(hookHealth.data?.statePath ?? status.data?.storage.hookStatePath)
    },
    {
      key: 'restart',
      label: restartConnector.isPending ? 'RESTARTING CONNECTOR' : 'RESTART CONNECTOR',
      symbol: '[↻]',
      description: connector.data?.running
        ? `Connector running${connector.data?.pid ? ` · PID ${connector.data.pid}` : ''}`
        : 'Connector is stopped or unavailable',
      onClick: () => {
        restartConnector.mutate();
      },
      disabled: restartConnector.isPending
    }
  ] as const;
  const normalizedSearch = search.trim().toLowerCase();
  const shouldRenderSection = (section: SetupSection, ...tokens: Array<string | null | undefined>) => {
    if (!normalizedSearch) {
      return true;
    }

    return [section, ...tokens]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(normalizedSearch);
  };
  const visibleSections = {
    repo: shouldRenderSection(
      'repo-enablement',
      'repo enablement enable command repo action',
      enableCommand,
      dataPolicy.data?.normalPathSummary
    ),
    integrations: shouldRenderSection(
      'integrations',
      'integration health claude factory antigravity supported installed',
      ...integrations.flatMap((integration) => [integration.id, integration.label, String(integration.status ?? ''), String(integration.notes ?? '')])
    ),
    policy: shouldRenderSection(
      'policy',
      'lean review debug sync capture policy workspace defaults runtime utilities',
      dataPolicy.data?.normalPathSummary,
      dataPolicy.data?.policyActionHint
    ),
    runtime: shouldRenderSection(
      'runtime',
      'runtime support data directory hook state connector storage socket database',
      status.data?.storage.dataDir,
      status.data?.storage.dbPath,
      status.data?.storage.socketPath,
      hookHealth.data?.statePath
    )
  };
  const hasVisibleSection = visibleSections.repo || visibleSections.integrations || visibleSections.policy || visibleSections.runtime;

  useEffect(() => {
    const availableSections = ([
      visibleSections.repo ? 'repo-enablement' : null,
      visibleSections.integrations ? 'integrations' : null,
      visibleSections.policy ? 'policy' : null,
      visibleSections.runtime ? 'runtime' : null
    ].filter(Boolean) as SetupSection[]);

    if (availableSections.length > 0 && !availableSections.includes(activeSetupSection)) {
      setActiveSetupSection(availableSections[0]);
    }
  }, [
    activeSetupSection,
    setActiveSetupSection,
    visibleSections.integrations,
    visibleSections.policy,
    visibleSections.repo,
    visibleSections.runtime
  ]);

  useEffect(() => {
    const sectionRefMap: Record<SetupSection, RefObject<HTMLDivElement | null>> = {
      'repo-enablement': repoSectionRef,
      integrations: integrationsSectionRef,
      policy: policySectionRef,
      runtime: runtimeSectionRef
    };

    sectionRefMap[activeSetupSection].current?.scrollIntoView({
      block: 'start',
      behavior: 'smooth'
    });
  }, [activeSetupSection, setupSectionScrollRequest]);

  useEffect(() => {
    const sectionEntries: Array<[SetupSection, HTMLDivElement | null]> = [
      ['repo-enablement', repoSectionRef.current],
      ['integrations', integrationsSectionRef.current],
      ['policy', policySectionRef.current],
      ['runtime', runtimeSectionRef.current]
    ];
    const visibleEntry = sectionEntries.find(([, node]) => node && node.offsetParent !== null);
    const root = visibleEntry?.[1]?.closest('.content');

    if (!root || !('IntersectionObserver' in window)) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const next = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        const section = next?.target.getAttribute('data-setup-section') as SetupSection | null;

        if (section && section !== activeSetupSection) {
          setActiveSetupSection(section);
        }
      },
      {
        root,
        threshold: [0.25, 0.5, 0.75],
        rootMargin: '-10% 0px -55% 0px'
      }
    );

    for (const [, node] of sectionEntries) {
      if (node && node.offsetParent !== null) {
        observer.observe(node);
      }
    }

    return () => {
      observer.disconnect();
    };
  }, [activeSetupSection, setActiveSetupSection, visibleSections.integrations, visibleSections.policy, visibleSections.repo, visibleSections.runtime]);

  async function applyPreset(preset: 'lean' | 'review' | 'debug') {
    if (!activeContextId || preset === currentPreset || pendingPreset) {
      return;
    }

    try {
      setPendingPreset(preset);
      await setDataPolicy.mutateAsync({ contextId: activeContextId, preset });
    } finally {
      setPendingPreset(null);
    }
  }

  return (
    <>
      <div>
        <div className="page-eyebrow">Setup</div>
        <div className="page-title">Enable repo and agents</div>
        <div className="page-desc">
          {`${readyCount} / ${totalCount} GA integrations ready. Use setup only when enabling another repo or when you need to open runtime support when something is off.`}
        </div>
      </div>

      {!hasVisibleSection ? (
        <div className="cmd-section">
          <div className="section-label">Setup Search</div>
          <div className="cmd-note">No setup sections match the current search. Clear the search filter to show repo enablement, integrations, policy, and runtime tools.</div>
        </div>
      ) : null}

      {visibleSections.repo ? (
        <div ref={repoSectionRef} className="cmd-section setup-section" data-setup-section="repo-enablement">
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
      ) : null}

      {visibleSections.integrations ? (
        <div ref={integrationsSectionRef} className="int-section setup-section" data-setup-section="integrations">
          <div className="section-label">Integration Health &mdash; <span>{`${readyCount} / ${totalCount} Ready`}</span></div>
          <div className="int-subtitle">GA integration status. Claude, Factory, Antigravity are installed for normal use.</div>
          <div className="int-list">
            {integrations.map((integration) => {
              const ready = integration.installed;
              return (
                <div key={integration.id} className="int-row">
                  <span className="int-name">{integration.label}</span>
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
          <div className="cmd-actions">
            <button
              type="button"
              className="cmd-action"
              onClick={() => {
                restartConnector.mutate();
              }}
              disabled={restartConnector.isPending}
            >
              <span className="brk">[↻]</span> {restartConnector.isPending ? 'RESTARTING CONNECTOR' : 'RESTART CONNECTOR'}
            </button>
            <button
              type="button"
              className="cmd-action"
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
          </div>
          {restartError ? <div className="cmd-note cmd-note-error">Connector restart failed: {restartError}</div> : null}
        </div>
      ) : null}

      {visibleSections.policy ? (
        <div ref={policySectionRef} className="policy-section setup-section" data-setup-section="policy">
          <div className="section-label">Sync and Capture Policy &mdash; <span>{`${toTitleCase(currentPreset)} Default`}</span></div>
          <div className="policy-subtitle">Workspace sync and machine defaults</div>
          <div className="policy-list">
            {([
              ['lean', 'Local-first default for normal product use.', 'Recommended'],
              ['review', 'Longer local capture for deeper inspection.', 'Longer retention'],
              ['debug', 'Temporary debug trails and runtime utilities.', 'Use when runtime is off']
            ] as Array<['lean' | 'review' | 'debug', string, string | null]>).map(([name, description, tag]) => {
              const active = currentPreset === name;
              const pending = pendingPreset === name;
              return (
                <button
                  key={name}
                  type="button"
                  className={active ? 'policy-row active' : 'policy-row'}
                  onClick={() => {
                    void applyPreset(name);
                  }}
                  disabled={!activeContextId || active || Boolean(pendingPreset)}
                  aria-pressed={active}
                >
                  <span className={active ? 'p-brk on' : 'p-brk off'}>{active ? '[●]' : '[ ]'}</span>
                  <span className={active ? 'p-name on' : 'p-name off'}>{toTitleCase(name)}</span>
                  <span className="p-desc">
                    {description}
                    {tag ? <span className="p-tag">{tag}</span> : null}
                    {pending ? <span className="p-tag">Applying</span> : null}
                    {active ? <span className="p-tag">Current</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="cmd-note">
            {dataPolicy.data?.policyActionHint ?? dataPolicy.data?.workspaceSyncHint ?? 'Switch presets here when you need deeper review capture or short-lived debug utilities.'}
          </div>
        </div>
      ) : null}

      {visibleSections.runtime ? (
        <div ref={runtimeSectionRef} className="cmd-section setup-section" data-setup-section="runtime">
          <div className="section-label">Runtime Support &mdash; <span>Utility Actions</span></div>
          <div className="cmd-subtitle">Local runtime tools</div>
          <div className="cmd-note">
            Open the local runtime state when behavior is off. These actions inspect machine state; they do not modify the repo.
          </div>
          <div className="runtime-grid">
            <div className="runtime-row">
              <span className="dk">Connector</span>
              <span className="dv">{connector.data?.running ? 'Running' : 'Unavailable'}</span>
              <span className="dk">Socket</span>
              <span className="dv mono">{status.data?.storage.socketPath ?? 'Unavailable'}</span>
            </div>
            <div className="runtime-row">
              <span className="dk">Database</span>
              <span className="dv mono">{status.data?.storage.dbPath ?? 'Unavailable'}</span>
              <span className="dk">Hook State</span>
              <span className="dv mono">{hookHealth.data?.statePath ?? status.data?.storage.hookStatePath ?? 'Unavailable'}</span>
            </div>
            <div className="runtime-row">
              <span className="dk">Data Dir</span>
              <span className="dv mono">{status.data?.storage.dataDir ?? 'Unavailable'}</span>
              <span className="dk">Last Error</span>
              <span className="dv">{connector.data?.lastError ?? 'None recorded'}</span>
            </div>
          </div>
          <div className="runtime-actions">
            {runtimeActions.map((action) => (
              <button
                key={action.key}
                type="button"
                className="runtime-action"
                onClick={action.onClick}
                disabled={action.disabled}
              >
                <span className="runtime-action-label"><span className="brk">{action.symbol}</span> {action.label}</span>
                <span className="runtime-action-meta">{action.description}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
