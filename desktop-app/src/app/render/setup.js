(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
  const { state, activeContext, isGaIntegration, isPreviewIntegration, integrationLabel, integrationType, integrationListText, formatIntegrationNote, automaticContextState, formatPosture, formatSyncPolicyLabel, enableCommand, hookInstallCommand, hookIngestCommand, capturePolicySummary, matches, esc, renderMetaLine, short, methodSupported } = app;

  function renderSetup() {
    document.getElementById('setupCommand').textContent = enableCommand();
    document.getElementById('hookInstallCommand').textContent = hookInstallCommand();
    document.getElementById('hookIngestCommand').textContent = hookIngestCommand();

    const hooks = Array.isArray(state.hook?.agents) ? state.hook.agents : [];
    const gaHooks = hooks.filter((hook) => isGaIntegration(hook.agent));
    const previewHooks = hooks.filter((hook) => isPreviewIntegration(hook.agent));
    const installedGa = gaHooks.filter((hook) => hook.installed);
    const installedPreview = previewHooks.filter((hook) => hook.installed);
    const filteredHooks = gaHooks.filter((hook) => matches(`${hook.agent} ${hook.status} ${hook.notes || ''} ${hook.command || ''}`));
    const setupPageMeta = document.getElementById('setupPageMeta');
    if (setupPageMeta) {
      setupPageMeta.textContent = state.runtimeIssue
        ? state.runtimeIssue.detail
        : installedGa.length > 0
          ? `${installedGa.length} GA integration${installedGa.length === 1 ? '' : 's'} ${installedGa.length === 1 ? 'is' : 'are'} installed on this machine. Use this screen only to enable another repo, add another GA agent, run a smoke test, or repair the runtime.`
          : installedPreview.length > 0
            ? 'No GA integrations are installed on this machine. Install Claude, Factory, or Antigravity for the normal product path.'
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
          detail: `${formatSyncPolicyLabel(state.dataPolicy?.syncPolicy || activeContext()?.syncPolicy)} | ${capturePolicySummary()}`,
          hint: 'Metadata-only sync is the normal default. Local capture stays on this machine and debug trails remain off unless you enable them.'
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
        : 'Use utilities only when you need to enable a repo, install GA integrations, smoke-test capture, check updates, or repair the local runtime.';

    const policy = state.dataPolicy || {
      contextId: null,
      workspaceResolved: false,
      syncPolicy: 'metadata_only',
      captureRetentionDays: 14,
      debugRetentionDays: 7,
      debugArtifactsEnabled: false
    };
    const syncSelect = document.getElementById('policySync');
    const captureInput = document.getElementById('policyCaptureRetention');
    const debugInput = document.getElementById('policyDebugRetention');
    const debugToggle = document.getElementById('policyDebugArtifacts');
    const saveBtn = document.getElementById('saveDataPolicyBtn');
    const badge = document.getElementById('policySummaryBadge');
    const hint = document.getElementById('policyHint');
    const supportsMutation = methodSupported('setDataPolicy');
    const workspaceResolved = policy.workspaceResolved === true && Boolean(activeContext()?.id);

    if (syncSelect) {
      syncSelect.value = String(policy.syncPolicy || 'metadata_only');
      syncSelect.disabled = !supportsMutation || !workspaceResolved;
    }
    if (captureInput) captureInput.value = String(policy.captureRetentionDays || 14);
    if (debugInput) debugInput.value = String(policy.debugRetentionDays || 7);
    if (debugToggle) debugToggle.checked = policy.debugArtifactsEnabled === true;
    if (saveBtn) saveBtn.disabled = !supportsMutation;
    if (badge) {
      badge.textContent = workspaceResolved
        ? formatSyncPolicyLabel(policy.syncPolicy || 'metadata_only')
        : `${formatSyncPolicyLabel(policy.syncPolicy || 'metadata_only')} | no workspace`;
    }
    if (hint) {
      hint.textContent = !supportsMutation
        ? 'Update the local runtime before changing policy from the desktop.'
        : !workspaceResolved
          ? 'Capture and debug settings can be updated globally here. Workspace sync requires an active workspace.'
          : 'Metadata-only sync is the normal default. Raw payloads stay local and debug artifacts stay off unless you explicitly enable them.';
    }
  }

  Object.assign(app, { renderSetup });
})();
