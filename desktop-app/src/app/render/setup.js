(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
  const {
    state,
    activeContext,
    isGaIntegration,
    integrationLabel,
    integrationListText,
    formatIntegrationNote,
    zeroTouchState,
    formatPosture,
    formatSyncPolicyLabel,
    formatDataPolicyPresetLabel,
    describeWorkspaceSyncDisplay,
    describeDesktopPolicyHint,
    enableCommand,
    capturePolicySummary,
    dataPolicyActionHint,
    matches,
    esc,
    renderMetaLine,
    short,
    methodSupported
  } = app;

  function setText(selector, text) {
    if (typeof document?.querySelector !== 'function') {
      return;
    }
    const element = document.querySelector(selector);
    if (element) {
      element.textContent = text;
    }
  }

  function applySetupCopy() {
    setText('section[data-view="setup"] .page-kicker', 'Setup');
    setText('section[data-view="setup"] h1', 'Enable repo and agents');
    const labels = Array.from(document.querySelectorAll?.('section[data-view="setup"] .section-label') || []);
    if (labels[0]) {
      labels[0].textContent = 'Setup commands';
    }
    if (labels[3]) {
      labels[3].textContent = 'Utility actions';
    }
    const headings = Array.from(document.querySelectorAll?.('section[data-view="setup"] h4') || []);
    if (headings[2]) {
      headings[2].textContent = 'Runtime utilities';
    }
  }

  function renderSetup() {
    applySetupCopy();
    document.getElementById('setupCommand').textContent = enableCommand();

    const hooks = Array.isArray(state.hook?.agents) ? state.hook.agents : [];
    const gaHooks = hooks.filter((hook) => isGaIntegration(hook.agent));
    const installedGa = gaHooks.filter((hook) => hook.installed);
    const filteredHooks = gaHooks.filter((hook) => matches(`${hook.agent} ${hook.status} ${hook.notes || ''} ${hook.command || ''}`));
    const setupPageMeta = document.getElementById('setupPageMeta');
    if (setupPageMeta) {
      setupPageMeta.textContent = state.runtimeIssue
        ? state.runtimeIssue.detail
        : installedGa.length > 0
          ? `${installedGa.length} GA integration${installedGa.length === 1 ? '' : 's'} ${installedGa.length === 1 ? 'is' : 'are'} installed on this machine. Use this screen only to enable another repo, add another GA agent, or open runtime utilities when something is off.`
          : 'No GA integrations are installed on this machine yet. Use this screen to add a supported integration for the normal repo-first path.';
    }

    document.getElementById('hookSummary').textContent = `${installedGa.length} GA installed / ${gaHooks.length}`;
    document.getElementById('hookList').innerHTML = filteredHooks.length > 0
      ? filteredHooks.map((hook) => `
            <article class="list-item">
              <h4>${esc(integrationLabel(hook.agent))}</h4>
              <p>${esc(`${hook.status} | ${hook.installed ? 'Installed' : 'Not installed'}`)}</p>
              ${renderMetaLine([
                hook.notes ? formatIntegrationNote(hook.notes) : '',
                hook.command ? 'Command ready' : ''
              ])}
              ${hook.command ? `<p>${esc(short(hook.command, 180))}</p>` : ''}
            </article>
          `).join('')
      : gaHooks.length > 0
        ? '<div class="empty-state">No GA integrations match the current filter.</div>'
        : '<div class="empty-state">GA integration health is unavailable until the daemon can read local setup state.</div>';

    const zeroTouch = zeroTouchState();
    const supportItems = [
      {
        title: 'Normal path',
        detail: `${zeroTouch.label} | ${zeroTouch.detail}`,
        hint: zeroTouch.nextAction
      },
      {
        title: 'Runtime posture',
        detail: formatPosture(state.health?.status || 'offline'),
        hint: state.runtimeIssue
          ? state.runtimeIssue.detail
          : 'Desktop and local runtime are aligned.'
      },
      {
        title: 'GA integrations',
        detail: installedGa.length > 0
          ? integrationListText(installedGa)
          : 'No GA integrations installed',
        hint: installedGa.length > 0
          ? 'Install only the GA agents you actually use on this machine.'
          : 'Install only the GA agents you actually use on this machine.'
      },
      {
        title: 'Sync and capture',
        detail: (() => {
          const workspaceSync = describeWorkspaceSyncDisplay({
            policy: state.dataPolicy,
            hasActiveWorkspace: Boolean(activeContext()?.id),
            formatSyncPolicyLabel
          });
          return `Workspace sync: ${workspaceSync.detail}`;
        })(),
        hint: (() => {
          const workspaceSync = describeWorkspaceSyncDisplay({
            policy: state.dataPolicy,
            hasActiveWorkspace: Boolean(activeContext()?.id),
            formatSyncPolicyLabel
          });
          return `Machine capture: ${capturePolicySummary()}${workspaceSync.hint ? `. ${workspaceSync.hint}` : ''}`;
        })()
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
      : zeroTouch.ready
        ? 'The supported path is active. Use Utilities only when enabling another repo, adding another GA integration, or changing machine defaults deliberately.'
        : 'Use setup once to reach the supported path, then work from the bound repo in the agent.';

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
    const syncInput = document.getElementById('dataPolicySyncPolicy');
    const captureInput = document.getElementById('dataPolicyCaptureRetention');
    const debugInput = document.getElementById('dataPolicyDebugRetention');
    const debugToggle = document.getElementById('dataPolicyDebugArtifacts');
    const applyCustomButton = document.getElementById('applyCustomDataPolicy');
    const supportsMutation = methodSupported('setDataPolicy');
    const preset = String(policy.preset || 'lean').trim().toLowerCase();
    const actionHint = dataPolicyActionHint(policy);
    const workspaceSync = describeWorkspaceSyncDisplay({
      policy,
      hasActiveWorkspace: Boolean(activeContext()?.id),
      formatSyncPolicyLabel
    });
    const workspaceResolved = workspaceSync.workspaceResolved;

    document.querySelectorAll('#dataPolicyForm [data-policy-preset]').forEach((button) => {
      const presetValue = String(button.getAttribute('data-policy-preset') || '').trim().toLowerCase();
      button.classList.toggle('active', presetValue === preset);
      const requiresWorkspace = presetValue === 'shared';
      button.disabled = !supportsMutation || (requiresWorkspace && !workspaceResolved);
      button.title = requiresWorkspace && !workspaceResolved
        ? 'Full sync is available only after a workspace is active.'
        : '';
    });

    if (syncInput) {
      syncInput.value = String(policy.syncPolicy || 'metadata_only').trim().toLowerCase();
      Array.from(syncInput.options || []).forEach((option) => {
        option.disabled = option.value === 'full_sync' && !workspaceResolved;
      });
      if (!workspaceResolved && syncInput.value === 'full_sync') {
        syncInput.value = 'metadata_only';
      }
      syncInput.disabled = !supportsMutation;
    }
    if (captureInput) {
      captureInput.value = String(Number.isFinite(policy.captureRetentionDays) ? policy.captureRetentionDays : 14);
      captureInput.disabled = !supportsMutation;
    }
    if (debugInput) {
      debugInput.value = String(Number.isFinite(policy.debugRetentionDays) ? policy.debugRetentionDays : 7);
      debugInput.disabled = !supportsMutation;
    }
    if (debugToggle) {
      debugToggle.checked = policy.debugArtifactsEnabled === true;
      debugToggle.disabled = !supportsMutation;
    }
    if (applyCustomButton) {
      applyCustomButton.disabled = !supportsMutation;
    }

    if (badge) {
      badge.textContent = formatDataPolicyPresetLabel(policy.preset || 'lean');
    }

    if (detailList) {
      const detailItems = [
        { title: 'Policy mode', detail: formatDataPolicyPresetLabel(policy.preset || 'lean') },
        { title: 'Workspace sync (this workspace)', detail: workspaceSync.detail },
        { title: 'Machine capture (this machine)', detail: capturePolicySummary() },
        {
          title: 'Debug trails (utility-only)',
          detail: app.debugArtifactsEnabled()
            ? 'Enabled locally for troubleshooting'
            : 'Off in the normal product path'
        }
      ];
      detailList.innerHTML = detailItems.map((item) => `
        <article>
          <strong>${esc(item.title)}</strong>
          <p>${esc(item.detail)}</p>
        </article>
      `).join('');
    }

    if (hint) {
      hint.textContent = describeDesktopPolicyHint({
        supportsMutation,
        policy,
        workspaceResolved,
        actionHint,
        workspaceHint: workspaceSync.hint
      }) + ' Open Advanced policy controls only when a workspace needs a deliberate override.';
    }
  }

  Object.assign(app, { applySetupCopy, renderSetup });
})();
