(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
  const {
    state,
    activeContext,
    isGaIntegration,
    integrationLabel,
    integrationType,
    integrationListText,
    formatIntegrationNote,
    automaticContextState,
    formatPosture,
    formatSyncPolicyLabel,
    formatDataPolicyPresetLabel,
    enableCommand,
    hookInstallCommand,
    capturePolicySummary,
    matches,
    esc,
    renderMetaLine,
    short,
    methodSupported
  } = app;

  function renderSetup() {
    document.getElementById('setupCommand').textContent = enableCommand();
    document.getElementById('hookInstallCommand').textContent = hookInstallCommand();

    const hooks = Array.isArray(state.hook?.agents) ? state.hook.agents : [];
    const gaHooks = hooks.filter((hook) => isGaIntegration(hook.agent));
    const installedGa = gaHooks.filter((hook) => hook.installed);
    const filteredHooks = gaHooks.filter((hook) => matches(`${hook.agent} ${hook.status} ${hook.notes || ''} ${hook.command || ''}`));
    const setupPageMeta = document.getElementById('setupPageMeta');
    if (setupPageMeta) {
      setupPageMeta.textContent = state.runtimeIssue
        ? state.runtimeIssue.detail
        : installedGa.length > 0
          ? `${installedGa.length} GA integration${installedGa.length === 1 ? '' : 's'} ${installedGa.length === 1 ? 'is' : 'are'} installed on this machine. Use this screen only to enable another repo, add another GA agent, or repair the runtime when something is off.`
          : 'Enable the repo, install the integrations you actually use, then leave this screen. Daily work should happen in workstreams, sessions, and checkpoints.';
    }

    document.getElementById('hookSummary').textContent = `${installedGa.length} GA installed / ${gaHooks.length}`;
    document.getElementById('hookList').innerHTML = filteredHooks.length > 0
      ? filteredHooks.map((hook) => `
            <article class="list-item">
              <h4>${esc(integrationLabel(hook.agent))}</h4>
              <p>${esc(`${hook.status} | ${hook.installed ? `${integrationType(hook.agent)} installed` : `${integrationType(hook.agent)} not installed`}`)}</p>
              ${renderMetaLine([
                hook.notes ? formatIntegrationNote(hook.notes) : '',
                hook.command ? `${integrationType(hook.agent)} command ready` : ''
              ])}
              ${hook.command ? `<p>${esc(short(hook.command, 180))}</p>` : ''}
            </article>
          `).join('')
      : gaHooks.length > 0
        ? '<div class="empty-state">No GA integrations match the current filter.</div>'
        : '<div class="empty-state">GA integration health is unavailable until the daemon can read local setup state.</div>';

    const supportItems = [
      {
        title: 'Runtime posture',
        detail: formatPosture(state.health?.status || 'offline'),
        hint: state.runtimeIssue
          ? state.runtimeIssue.detail
          : 'Desktop and local runtime are aligned.'
      },
      {
        title: 'Machine session',
        detail: state.auth.authenticated ? 'Signed in' : 'Login required',
        hint: `provider: ${state.auth.provider || 'unknown'}`
      },
      {
        title: 'GA integrations',
        detail: installedGa.length > 0 ? integrationListText(installedGa) : 'No GA integrations installed',
        hint: 'Install only the GA agents you actually use on this machine.'
      },
      {
        title: 'Automatic context',
        detail: automaticContextState(),
        hint: 'Supported agents get the current workstream automatically at session start.'
      },
      {
        title: 'Data policy',
        detail: `${formatDataPolicyPresetLabel(state.dataPolicy?.preset || 'lean')} | ${capturePolicySummary()}`,
        hint: 'Metadata-only sync is the normal default. Local capture stays on this machine and debug trails remain off unless you explicitly enable them.'
      }
    ];
    document.getElementById('setupSupportList').innerHTML = supportItems.map((item) => `
      <article>
        <strong>${esc(item.title)}</strong>
        <p>${esc(item.detail)}</p>
        <p>${esc(item.hint)}</p>
      </article>
    `).join('');
    document.getElementById('setupSupportCopy').textContent = state.runtimeIssue
      ? state.runtimeIssue.detail
      : 'Use utilities only when you need to enable a repo, install GA integrations, check updates, or repair the local runtime.';

    const policy = state.dataPolicy || {
      contextId: null,
      workspaceResolved: false,
      syncPolicy: 'metadata_only',
      captureRetentionDays: 14,
      debugRetentionDays: 7,
      debugArtifactsEnabled: false,
      preset: 'lean'
    };
    const badge = document.getElementById('policySummaryBadge');
    const hint = document.getElementById('policyHint');
    const detailList = document.getElementById('policyDetailList');
    const supportsMutation = methodSupported('setDataPolicy');
    const workspaceResolved = policy.workspaceResolved === true && Boolean(activeContext()?.id);
    const preset = String(policy.preset || 'lean').trim().toLowerCase();

    document.querySelectorAll('#dataPolicyForm [data-policy-preset]').forEach((button) => {
      const presetValue = String(button.getAttribute('data-policy-preset') || '').trim().toLowerCase();
      button.classList.toggle('active', presetValue === preset);
      const requiresWorkspace = presetValue === 'shared';
      button.disabled = !supportsMutation || (requiresWorkspace && !workspaceResolved);
      button.title = requiresWorkspace && !workspaceResolved
        ? 'Shared requires an active workspace because it opts that workspace into full sync.'
        : '';
    });

    if (badge) {
      badge.textContent = formatDataPolicyPresetLabel(policy.preset || 'lean');
    }

    if (detailList) {
      const detailItems = [
        { title: 'Workspace sync', detail: formatSyncPolicyLabel(policy.syncPolicy || 'metadata_only') },
        { title: 'Local capture retention', detail: `${policy.captureRetentionDays || 14} days` },
        { title: 'Debug retention', detail: `${policy.debugRetentionDays || 7} days` },
        { title: 'Debug artifacts', detail: policy.debugArtifactsEnabled === true ? 'Enabled explicitly' : 'Off by default' }
      ];
      detailList.innerHTML = detailItems.map((item) => `
        <article>
          <strong>${esc(item.title)}</strong>
          <p>${esc(item.detail)}</p>
        </article>
      `).join('');
    }

    if (hint) {
      hint.textContent = !supportsMutation
        ? 'Update the local runtime before changing the data policy from the desktop.'
        : preset === 'custom'
          ? 'This workspace is using a custom policy. Choose one of the supported presets to return to a standard product path.'
          : !workspaceResolved
            ? 'Lean, Review, and Debug can be applied immediately. Shared requires an active workspace because it opts that workspace into full sync.'
            : preset === 'shared'
              ? 'Shared opts this workspace into full sync. Raw payloads still stay local and debug trails remain off unless you explicitly enable them elsewhere.'
              : 'Lean is the normal default. Review keeps more local capture, Debug temporarily enables debug trails, and Shared opts this workspace into full sync.';
    }
  }

  Object.assign(app, { renderSetup });
})();
