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
    setText('section[data-view="setup"] h1', 'Enable repo and policy');
    const labels = Array.from(document.querySelectorAll?.('section[data-view="setup"] .section-label') || []);
    if (labels[0]) {
      labels[0].textContent = 'Setup';
    }
    if (labels[3]) {
      labels[3].textContent = 'Utilities';
    }
    const headings = Array.from(document.querySelectorAll?.('section[data-view="setup"] h4') || []);
    if (headings[2]) {
      headings[2].textContent = 'Local tools';
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
          ? `${installedGa.length} GA integration${installedGa.length === 1 ? '' : 's'} installed. Use this page only when you need to change setup or policy.`
          : 'No GA integrations are installed yet. Use this page only for the supported agents you actually use.';
    }

    document.getElementById('hookSummary').textContent = `${installedGa.length} ready`;
    document.getElementById('hookList').innerHTML = filteredHooks.length > 0
      ? filteredHooks.map((hook) => `
            <article class="list-item">
              <h4>${esc(integrationLabel(hook.agent))}</h4>
              ${renderMetaLine([
                hook.installed ? 'Ready for normal path' : 'Not installed',
                hook.status || '',
                hook.notes ? formatIntegrationNote(hook.notes) : ''
              ])}
            </article>
          `).join('')
      : gaHooks.length > 0
        ? '<div class="empty-state">No GA integrations match the current filter.</div>'
        : '<div class="empty-state">GA integration health is unavailable until the daemon can read local setup state.</div>';

    const zeroTouch = zeroTouchState();
    const setupHealthLead = document.getElementById('setupHealthLead');
    if (setupHealthLead) {
      setupHealthLead.textContent = state.runtimeIssue
        ? state.runtimeIssue.detail
        : installedGa.length > 0
          ? `${integrationListText(installedGa)} ${installedGa.length === 1 ? 'is' : 'are'} installed for normal use.`
          : 'Install only the supported GA integrations you actually use.';
    }
    const setupUtilityLead = document.getElementById('setupUtilityLead');
    if (setupUtilityLead) {
      setupUtilityLead.textContent = state.runtimeIssue
        ? state.runtimeIssue.detail
        : zeroTouch.ready
          ? 'The normal path is active. Use these tools only when runtime behavior is clearly off.'
          : `${zeroTouch.label}. ${zeroTouch.nextAction || zeroTouch.detail}`;
    }
    const policy = state.dataPolicy || {
      contextId: null,
      workspaceResolved: false,
      syncPolicy: 'local_only',
      captureRetentionDays: 14,
      debugRetentionDays: 7,
      debugArtifactsEnabled: false,
      preset: 'lean'
    };
    const badge = document.getElementById('policySummaryBadge');
    const hint = document.getElementById('policyHint');
    const detailList = document.getElementById('policyDetailList');
    const policyAdvancedDetails = document.getElementById('policyAdvancedDetails');
    const utilitiesDetails = document.getElementById('utilitiesDetails');
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
      syncInput.value = String(policy.syncPolicy || 'local_only').trim().toLowerCase();
      Array.from(syncInput.options || []).forEach((option) => {
        option.disabled = !workspaceResolved && option.value !== 'local_only';
      });
      if (!workspaceResolved && syncInput.value !== 'local_only') {
        syncInput.value = 'local_only';
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

    if (policyAdvancedDetails instanceof HTMLDetailsElement) {
      policyAdvancedDetails.open = preset === 'custom' || preset === 'debug' || preset === 'shared';
    }

    if (utilitiesDetails instanceof HTMLDetailsElement) {
      utilitiesDetails.open = Boolean(state.runtimeIssue);
    }

    if (detailList) {
      const detailItems = [
        { title: 'Policy mode', detail: formatDataPolicyPresetLabel(policy.preset || 'lean') },
        { title: 'Workspace sync (this workspace)', detail: policy.workspaceSyncSummary || workspaceSync.detail },
        { title: 'Machine capture (this machine)', detail: policy.machineCaptureSummary || capturePolicySummary() }
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
      }) + ' Debug trails and opt-in cloud sync stay in Utilities.';
    }

    if (policyAdvancedDetails instanceof HTMLDetailsElement && !supportsMutation) {
      policyAdvancedDetails.open = false;
    }
  }

  Object.assign(app, { applySetupCopy, renderSetup });
})();
