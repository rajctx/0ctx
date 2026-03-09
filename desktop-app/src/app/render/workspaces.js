(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
  const { state, matches, activeContext, captureState, automaticContextState, formatSyncPolicyLabel, formatDataPolicyPresetLabel, capturePolicySummary, esc, formatRelativeTime, renderChip, renderMetaLine, short, humanizeLabel, methodSupported, contextById, syncWorkspaceComparisonTargetSelection, workspaceComparisonTargetContext } = app;

  function renderWorkspaces() {
    const contexts = state.contexts.filter((context) => matches(`${context.name || ''} ${(context.paths || []).join(' ')}`));
    const context = activeContext();
    const capture = captureState();
    document.getElementById('workspaceCount').textContent = `${contexts.length} workspace${contexts.length === 1 ? '' : 's'}`;
    const workspacesPageMeta = document.getElementById('workspacesPageMeta');
    if (workspacesPageMeta) {
      workspacesPageMeta.textContent = `${contexts.length} workspace${contexts.length === 1 ? '' : 's'} on this machine.${context ? ` Current selection: ${context.name}.` : ''}`;
    }

    document.getElementById('workspaceList').innerHTML = contexts.length > 0
      ? contexts.map((item) => {
        const pathList = Array.isArray(item.paths) ? item.paths.filter(Boolean) : [];
        const repoPath = pathList[0] || '';
        const isActive = item.id === state.activeContextId;
        const createdCopy = item.createdAt ? formatRelativeTime(item.createdAt) : 'Recently created';
        return `
          <article class="list-item conversation-card workspace-card-item ${isActive ? 'active' : ''}" data-context-id="${esc(item.id)}">
            <div class="workspace-card-head">
              <div>
                <p class="item-kicker">${esc(isActive ? 'Current workspace' : createdCopy)}</p>
                <h4 class="item-title">${esc(item.name || item.id)}</h4>
              </div>
              ${isActive ? renderChip('Selected', 'green') : ''}
            </div>
            <p class="item-preview">${esc(
              repoPath
                ? 'Repository binding is ready for automatic capture.'
                : 'Bind a repository folder to route future capture automatically.'
            )}</p>
            <div class="workspace-path text-mono">${esc(repoPath || 'No repository folder bound yet')}</div>
            ${renderMetaLine([
              repoPath ? 'Repo bound' : 'Needs repo',
              item.syncPolicy ? humanizeLabel(item.syncPolicy) : '',
              pathList.length > 1 ? `${pathList.length} paths` : ''
            ])}
          </article>
        `;
      }).join('')
      : '<div class="empty-state">No workspaces yet. Create one with a name and repository path.</div>';

    const compareSelect = document.getElementById('workspaceCompareSelect');
    const compareEmpty = document.getElementById('workspaceCompareEmpty');
    const compareBody = document.getElementById('workspaceCompareBody');
    const compareTitle = document.getElementById('workspaceCompareTitle');
    const compareSummary = document.getElementById('workspaceComparisonSummary');
    const compareMeta = document.getElementById('workspaceComparisonMeta');
    const compareOverlap = document.getElementById('workspaceComparisonOverlap');
    const compareSupported = methodSupported('compareWorkspaces');
    const targetContext = syncWorkspaceComparisonTargetSelection();
    const comparison = state.workspaceComparison;
    const compareTargets = state.contexts.filter((item) => item.id !== state.activeContextId);

    if (compareSelect) {
      compareSelect.innerHTML = compareTargets.length > 0
        ? compareTargets.map((item) => `
            <option value="${esc(item.id)}"${item.id === state.workspaceComparisonTargetContextId ? ' selected' : ''}>
              ${esc(item.name || item.id)}
            </option>
          `).join('')
        : '<option value="">No other workspaces</option>';
      compareSelect.disabled = !compareSupported || compareTargets.length === 0;
    }

    if (!compareSupported) {
      if (compareTitle) compareTitle.textContent = 'Runtime update required';
      if (compareEmpty) {
        compareEmpty.textContent = 'Update the local runtime to compare workspaces and review overlap explicitly.';
        compareEmpty.classList.remove('hidden');
      }
      if (compareBody) compareBody.classList.add('hidden');
    } else if (!context) {
      if (compareTitle) compareTitle.textContent = 'Choose a workspace';
      if (compareEmpty) {
        compareEmpty.textContent = 'Select a workspace first, then compare it against another workspace on this machine.';
        compareEmpty.classList.remove('hidden');
      }
      if (compareBody) compareBody.classList.add('hidden');
    } else if (compareTargets.length === 0) {
      if (compareTitle) compareTitle.textContent = 'No other workspaces yet';
      if (compareEmpty) {
        compareEmpty.textContent = 'Create another workspace before comparing repository overlap, workstreams, or reviewed insights.';
        compareEmpty.classList.remove('hidden');
      }
      if (compareBody) compareBody.classList.add('hidden');
    } else if (!comparison || !targetContext) {
      if (compareTitle) compareTitle.textContent = 'Choose another workspace';
      if (compareEmpty) {
        compareEmpty.textContent = 'Select another workspace to compare repository overlap, shared workstreams, reviewed insights, and agents.';
        compareEmpty.classList.remove('hidden');
      }
      if (compareBody) compareBody.classList.add('hidden');
    } else {
      if (compareTitle) compareTitle.textContent = `Compare ${context.name} with ${targetContext.name}`;
      if (compareSummary) {
        compareSummary.textContent = comparison.comparisonActionHint
          ? `${comparison.comparisonSummary} Next: ${comparison.comparisonActionHint}`
          : comparison.comparisonSummary;
      }
      if (compareMeta) {
        compareMeta.innerHTML = [
          { label: context.name, value: `${comparison.source.workstreamCount} workstreams · ${comparison.source.sessionCount} sessions · ${comparison.source.checkpointCount} checkpoints` },
          { label: targetContext.name, value: `${comparison.target.workstreamCount} workstreams · ${comparison.target.sessionCount} sessions · ${comparison.target.checkpointCount} checkpoints` },
          { label: 'Comparison', value: humanizeLabel(comparison.comparisonKind || 'isolated') },
          { label: 'Shared agents', value: comparison.sharedAgents.length > 0 ? comparison.sharedAgents.join(', ') : 'none' }
        ].map((item) => `<article><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></article>`).join('');
      }
      if (compareOverlap) {
        compareOverlap.innerHTML = [
          { label: 'Repository overlap', value: comparison.sharedRepositoryPaths.length > 0 ? comparison.sharedRepositoryPaths.join(', ') : 'none' },
          { label: 'Shared workstreams', value: comparison.sharedWorkstreams.length > 0 ? comparison.sharedWorkstreams.join(', ') : 'none' },
          { label: 'Shared insights', value: comparison.sharedInsights.length > 0 ? comparison.sharedInsights.join(', ') : 'none' },
          { label: `Only in ${context.name}`, value: comparison.sourceOnlyAgents.length > 0 ? comparison.sourceOnlyAgents.join(', ') : 'none' },
          { label: `Only in ${targetContext.name}`, value: comparison.targetOnlyAgents.length > 0 ? comparison.targetOnlyAgents.join(', ') : 'none' },
          { label: 'Target sync policy', value: formatSyncPolicyLabel(comparison.target.syncPolicy) }
        ].map((item) => `<article><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></article>`).join('');
      }
      if (compareEmpty) compareEmpty.classList.add('hidden');
      if (compareBody) compareBody.classList.remove('hidden');
    }

    const focusItems = context
      ? [
          {
            title: 'Repository binding',
            detail: Array.isArray(context.paths) && context.paths.length > 0 ? context.paths.join(', ') : 'No repository folder bound yet',
            hint: Array.isArray(context.paths) && context.paths.length > 0
              ? 'Installed integrations resolve this workspace from the active repo path.'
              : 'Bind a repo path so capture can route here automatically.'
          },
          {
            title: 'Capture readiness',
            detail: `${capture.label} | ${capture.detail}`,
            hint: 'This reflects the supported product path for the integrations installed on this machine.'
          },
          {
            title: 'Automatic context',
            detail: automaticContextState(),
            hint: 'Supported agents get the current workstream pack automatically at session start.'
          },
          {
            title: 'Workstreams',
            detail: `${state.branches.length} tracked workstream${state.branches.length === 1 ? '' : 's'}`,
            hint: 'Branches and worktrees stay grouped as workstreams inside this workspace.'
          },
          {
            title: 'Captured sessions',
            detail: `${state.allSessions.length} session${state.allSessions.length === 1 ? '' : 's'}`,
            hint: 'All captured runs currently linked to this project.'
          },
          {
            title: 'Data policy',
            detail: `${formatSyncPolicyLabel(state.dataPolicy?.syncPolicy || context.syncPolicy)} | ${capturePolicySummary()}`,
            hint: (state.dataPolicy?.syncPolicy || context.syncPolicy) === 'full_sync'
              ? 'Richer cloud sync is enabled explicitly for this workspace. Raw payload sidecars still stay local.'
              : 'Metadata-only sync is the normal default. Local capture stays on this machine and debug trails remain off unless you enable them.'
          }
        ]
      : [
          {
            title: 'No workspace selected',
            detail: 'Create a workspace and bind its repository path to begin automatic capture.',
            hint: 'Once a repo is bound, future sessions can route into it automatically.'
          }
        ];
    document.getElementById('workspaceFocus').innerHTML = focusItems.map((item) => {
      return `
        <article>
          <span>${esc(item.title)}</span>
          <strong>${esc(item.detail)}</strong>
          <p>${esc(item.hint || '')}</p>
        </article>
      `;
    }).join('');

    const policy = state.dataPolicy || {
      contextId: null,
      workspaceResolved: false,
      syncPolicy: 'metadata_only',
      captureRetentionDays: 14,
      debugRetentionDays: 7,
      debugArtifactsEnabled: false,
      preset: 'lean'
    };
    const policyBadge = document.getElementById('workspacePolicySummaryBadge');
    const policyHint = document.getElementById('workspacePolicyHint');
    const policyDetailList = document.getElementById('workspacePolicyDetailList');
    const supportsMutation = methodSupported('setDataPolicy');
    const workspaceResolved = policy.workspaceResolved === true && Boolean(activeContext()?.id);
    const preset = String(policy.preset || 'lean').trim().toLowerCase();

    document.querySelectorAll('.workspace-policy-preset').forEach((button) => {
      const presetValue = String(button.getAttribute('data-policy-preset') || '').trim().toLowerCase();
      button.classList.toggle('active', presetValue === preset);
      const requiresWorkspace = presetValue === 'shared';
      button.disabled = !supportsMutation || (requiresWorkspace && !workspaceResolved);
      button.title = requiresWorkspace && !workspaceResolved
        ? 'Shared requires an active workspace because it opts that workspace into full sync.'
        : '';
    });

    if (policyBadge) {
      policyBadge.textContent = formatDataPolicyPresetLabel(policy.preset || 'lean');
    }

    if (policyDetailList) {
      const detailItems = [
        { title: 'Workspace sync', detail: formatSyncPolicyLabel(policy.syncPolicy || 'metadata_only') },
        { title: 'Local capture retention', detail: `${policy.captureRetentionDays || 14} days` },
        { title: 'Debug retention', detail: `${policy.debugRetentionDays || 7} days` },
        { title: 'Debug artifacts', detail: policy.debugArtifactsEnabled === true ? 'Enabled explicitly' : 'Off by default' }
      ];
      policyDetailList.innerHTML = detailItems.map((item) => `
        <article>
          <strong>${esc(item.title)}</strong>
          <p>${esc(item.detail)}</p>
        </article>
      `).join('');
    }

    if (policyHint) {
      policyHint.textContent = !supportsMutation
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

  Object.assign(app, { renderWorkspaces });
})();
