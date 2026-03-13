(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
  const { state, matches, activeContext, zeroTouchState, formatSyncPolicyLabel, formatDataPolicyPresetLabel, describeWorkspaceSyncDisplay, describeDesktopPolicyHint, capturePolicySummary, dataPolicyActionHint, esc, formatRelativeTime, renderMetaLine, short, humanizeLabel, contextById, syncWorkspaceComparisonTargetSelection, workspaceComparisonTargetContext, methodSupported } = app;

  function factStripItem(label, value) {
    return `<article><span>${esc(label)}</span><strong>${esc(value || '-')}</strong></article>`;
  }

  function joinNonEmpty(parts) {
    return parts.filter(Boolean).join(' ');
  }

  function renderWorkspaces() {
    const contexts = state.contexts.filter((context) => matches(`${context.name || ''} ${(context.paths || []).join(' ')}`));
    const context = activeContext();
    document.getElementById('workspaceCount').textContent = `${contexts.length} workspace${contexts.length === 1 ? '' : 's'}`;
    const workspacesPageMeta = document.getElementById('workspacesPageMeta');
    if (workspacesPageMeta) {
      workspacesPageMeta.textContent = context
        ? `${contexts.length} workspace${contexts.length === 1 ? '' : 's'} on this machine. ${context.name} is the current project binding.`
        : `${contexts.length} workspace${contexts.length === 1 ? '' : 's'} on this machine. Bind one repository and future capture routes automatically.`;
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
              ${isActive ? '<span class="item-trailing-meta">Selected</span>' : ''}
            </div>
            <div class="workspace-path text-mono">${esc(repoPath || 'No repository folder bound yet')}</div>
            ${renderMetaLine([
              repoPath ? 'Repo bound' : 'Needs repository binding',
              item.syncPolicy ? formatSyncPolicyLabel(item.syncPolicy) : ''
            ])}
          </article>
        `;
      }).join('')
      : '<div class="empty-state">No workspaces yet. Create one with a name and repository path.</div>';

    const workspaceFactStrip = document.getElementById('workspaceFactStrip');
    const workspaceLeadCopy = document.getElementById('workspaceLeadCopy');
    if (workspaceLeadCopy) {
      workspaceLeadCopy.textContent = context
        ? joinNonEmpty([
            `${context.name} is the current project binding.`,
            Array.isArray(context.paths) && context.paths[0]
              ? 'Future capture routes here from the active repository path.'
              : 'Bind a repository folder so capture can land here automatically.',
            state.allSessions.length > 0
              ? `${state.allSessions.length} captured session${state.allSessions.length === 1 ? '' : 's'} already belong to this workspace.`
              : 'No captured sessions yet.'
          ])
        : 'Create a workspace once, bind a repository folder, and let future capture route here automatically.';
    }

    if (workspaceFactStrip) {
      workspaceFactStrip.innerHTML = context
        ? [
            factStripItem('Repository', Array.isArray(context.paths) && context.paths[0] ? short(context.paths[0], 42) : 'Not bound'),
            factStripItem('Workstreams', `${state.branches.length}`),
            factStripItem('Sessions', `${state.allSessions.length}`),
            factStripItem('Policy', formatDataPolicyPresetLabel((state.dataPolicy || context).preset || 'lean'))
          ].join('')
        : '';
    }

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
        compareEmpty.textContent = 'Select another workspace to compare repository overlap, shared workstreams, and reviewed insights.';
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
          { label: `${context.name} only`, value: comparison.sourceOnlyAgents.length > 0 ? comparison.sourceOnlyAgents.join(', ') : 'none' },
          { label: `${targetContext.name} only`, value: comparison.targetOnlyAgents.length > 0 ? comparison.targetOnlyAgents.join(', ') : 'none' }
        ].map((item) => `<article><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></article>`).join('');
      }
      if (compareEmpty) compareEmpty.classList.add('hidden');
      if (compareBody) compareBody.classList.remove('hidden');
    }

    const focusItems = context
      ? [
          (() => {
            const zeroTouch = zeroTouchState();
            return {
              title: 'Status',
              detail: `${zeroTouch.label}. ${zeroTouch.detail}`,
              hint: zeroTouch.nextAction || 'Use a supported agent in this repo and 0ctx will route capture automatically.'
            };
          })(),
          {
            title: 'Repository',
            detail: Array.isArray(context.paths) && context.paths.length > 0 ? short(context.paths.join(', '), 96) : 'No repository folder bound yet',
            hint: Array.isArray(context.paths) && context.paths.length > 0
              ? 'Capture resolves from the active repo path.'
              : 'Bind a repo path so capture can land here automatically.'
          },
          {
            title: 'History',
            detail: `${state.allSessions.length} session${state.allSessions.length === 1 ? '' : 's'} · ${state.checkpoints.length} checkpoint${state.checkpoints.length === 1 ? '' : 's'}`,
            hint: state.allSessions.length > 0
              ? 'Use Sessions and Checkpoints to continue work without rebuilding context.'
              : 'Complete one captured run in this repo to start building local project memory.'
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
          ${item.hint ? `<p>${esc(item.hint)}</p>` : ''}
        </article>
      `;
    }).join('');

    const policy = state.dataPolicy || {
      contextId: null,
      workspaceResolved: false,
      syncPolicy: 'local_only',
      captureRetentionDays: 14,
      debugRetentionDays: 7,
      debugArtifactsEnabled: false,
      preset: 'lean'
    };
    const policyBadge = document.getElementById('workspacePolicySummaryBadge');
    const policyHint = document.getElementById('workspacePolicyHint');
    const policyDetailList = document.getElementById('workspacePolicyDetailList');
    const actionHint = dataPolicyActionHint(policy);
    const workspaceSync = describeWorkspaceSyncDisplay({
      policy,
      hasActiveWorkspace: Boolean(activeContext()?.id),
      formatSyncPolicyLabel
    });

    if (policyBadge) {
      policyBadge.textContent = formatDataPolicyPresetLabel(policy.preset || 'lean');
    }

    if (policyDetailList) {
      const detailItems = [
        { title: 'Workspace sync', detail: policy.workspaceSyncSummary || workspaceSync.detail },
        { title: 'Machine capture', detail: policy.machineCaptureSummary || capturePolicySummary() }
      ];
      policyDetailList.innerHTML = detailItems.map((item) => `
        <article>
          <strong>${esc(item.title)}</strong>
          <p>${esc(item.detail)}</p>
        </article>
      `).join('');
    }

    if (policyHint) {
      const baseHint = describeDesktopPolicyHint({
        supportsMutation: true,
        policy,
        workspaceResolved: workspaceSync.workspaceResolved,
        actionHint,
        workspaceHint: workspaceSync.hint
      });
      policyHint.textContent = `${baseHint} Utilities are only for deliberate sync, retention, or debug changes.`;
    }
  }

  Object.assign(app, { renderWorkspaces });
})();
