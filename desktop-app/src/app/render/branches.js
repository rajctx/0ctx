(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
  const { state, matches, activeContext, activeBranch, comparisonTargetBranch, branchKey, esc, formatRelativeTime, describeBranchLane, describeSession, renderMetaLine, commitShort, describeWorkstreamSync, describeWorkstreamActionHint, describeWorkstreamCheckout, normalizeBranch, short } = app;

  function renderBranches() {
      const branches = state.branches.filter((lane) => matches(`${lane.branch} ${lane.worktreePath || ''} ${lane.lastAgent || ''} ${lane.lastCommitSha || ''}`));
      const context = activeContext();
      document.getElementById('branchHeadline').textContent = `${branches.length} workstream${branches.length === 1 ? '' : 's'}`;
      document.getElementById('branchSessionCount').textContent = `${state.sessions.length} session${state.sessions.length === 1 ? '' : 's'}`;
    const branchesPageMeta = document.getElementById('branchesPageMeta');
    if (branchesPageMeta) {
      branchesPageMeta.textContent = state.runtimeIssue
        ? 'Update the local runtime to enable workstreams, workstream sessions, and handoff timelines.'
        : context
          ? `${context.name} has ${branches.length} tracked workstream${branches.length === 1 ? '' : 's'} in the current view.`
          : 'Choose a workspace to inspect branch-level work.';
    }

    document.getElementById('branchList').innerHTML = branches.length > 0
      ? branches.map((lane) => {
        const summary = describeBranchLane(lane);
        const key = branchKey(lane.branch, lane.worktreePath);
        return `
          <article class="list-item conversation-card branch-card ${key === state.activeBranchKey ? 'active' : ''}" data-branch-key="${esc(key)}">
            <p class="item-kicker">${esc(formatRelativeTime(lane.lastActivityAt))}</p>
            <h4 class="item-title">${esc(summary.title)}</h4>
            <p class="item-preview">${esc(summary.preview)}</p>
            ${renderMetaLine([
              `${lane.sessionCount} sessions`,
              `${lane.checkpointCount} checkpoints`,
              lane.lastAgent || '',
              lane.lastCommitSha ? `#${commitShort(lane.lastCommitSha)}` : '',
              describeWorkstreamSync(lane)
            ])}
          </article>
        `;
        }).join('')
        : state.runtimeIssue
          ? '<div class="empty-state">This desktop build needs a newer local runtime before workstreams can load.</div>'
          : '<div class="empty-state">No workstreams yet. Capture one agent session in this repo, then refresh.</div>';

      document.getElementById('branchSessionList').innerHTML = state.sessions.length > 0
      ? state.sessions.map((session) => {
        const summary = describeSession(session);
        return `
          <article class="list-item conversation-card ${session.sessionId === state.activeSessionId ? 'active' : ''}" data-session-id="${esc(session.sessionId)}" data-open-view="sessions">
            <p class="item-kicker">${esc(formatRelativeTime(session.lastTurnAt || session.startedAt))}</p>
            <h4 class="item-title">${esc(summary.title)}</h4>
            <p class="item-preview">${esc(summary.preview)}</p>
            ${renderMetaLine([
              `${session.turnCount || 0} messages`,
              session.agent || '',
              session.commitSha ? `#${commitShort(session.commitSha)}` : ''
            ])}
          </article>
        `;
        }).join('')
        : '<div class="empty-state">Select a workstream to inspect the sessions captured on it.</div>';

      const compareSelect = document.getElementById('branchCompareSelect');
      const compareEmpty = document.getElementById('branchCompareEmpty');
      const compareBody = document.getElementById('branchCompareBody');

      if (state.runtimeIssue && branches.length === 0) {
        document.getElementById('branchDetailTitle').textContent = 'Update the local runtime';
        document.getElementById('branchLeadCopy').textContent = '';
        document.getElementById('branchMeta').innerHTML = '';
        document.getElementById('branchSessionList').innerHTML = '<div class="empty-state">Branch sessions will appear here after the local runtime is updated.</div>';
        document.getElementById('handoffList').innerHTML = '<div class="empty-state">Agent handoff history will appear here after the local runtime is updated.</div>';
        if (compareSelect) compareSelect.innerHTML = '<option value="">Unavailable</option>';
        if (compareEmpty) {
          compareEmpty.textContent = 'Workstream comparison will appear here after the local runtime is updated.';
          compareEmpty.classList.remove('hidden');
        }
        if (compareBody) compareBody.classList.add('hidden');
        document.getElementById('branchDetailEmpty').innerHTML = `
          <div class="empty-flow">
            <strong>Branch views need a newer runtime.</strong>
            <p>${esc(state.runtimeIssue.detail)}</p>
          <div class="row-actions">
            <button class="btn primary" data-banner-action="refresh">Refresh</button>
            <button class="btn tertiary" data-banner-action="setup">Open utilities</button>
          </div>
        </div>
      `;
        document.getElementById('branchDetailEmpty').classList.remove('hidden');
        document.getElementById('branchDetailBody').classList.add('hidden');
        return;
      }

      const lane = activeBranch();
      const comparisonTarget = comparisonTargetBranch();
      const detailBody = document.getElementById('branchDetailBody');
      const empty = document.getElementById('branchDetailEmpty');
      if (!lane) {
        document.getElementById('branchDetailTitle').textContent = 'Choose a workstream';
        document.getElementById('branchLeadCopy').textContent = '';
        document.getElementById('branchMeta').innerHTML = '';
        document.getElementById('branchSessionList').innerHTML = '<div class="empty-state">Choose a workstream to see the captured sessions on it.</div>';
        document.getElementById('handoffList').innerHTML = '<div class="empty-state">No handoff history yet.</div>';
        if (compareSelect) compareSelect.innerHTML = '<option value="">Choose a workstream first</option>';
        if (compareEmpty) {
          compareEmpty.textContent = 'Select a workstream first, then compare it against another workstream in this workspace.';
          compareEmpty.classList.remove('hidden');
        }
        if (compareBody) compareBody.classList.add('hidden');
        empty.innerHTML = 'Select a workstream to inspect cross-agent activity and checkpoint coverage.';
        empty.classList.remove('hidden');
        detailBody.classList.add('hidden');
        return;
      }

      document.getElementById('branchDetailTitle').textContent = describeBranchLane(lane).title;
      document.getElementById('branchLeadCopy').textContent = [
        `${describeBranchLane(lane).title} carries ${lane.sessionCount} captured session${lane.sessionCount === 1 ? '' : 's'} and ${lane.checkpointCount} checkpoint${lane.checkpointCount === 1 ? '' : 's'}.`,
        lane.lastAgent ? `The most recent handoff came from ${lane.lastAgent}` : 'No agent has touched this workstream yet.',
        lane.handoffSummary ? `${lane.handoffSummary}.` : '',
        describeWorkstreamSync(lane) ? `${describeWorkstreamSync(lane)}.` : '',
        describeWorkstreamActionHint(lane) ? `Next: ${describeWorkstreamActionHint(lane)}.` : '',
        lane.lastActivityAt ? `${formatRelativeTime(lane.lastActivityAt)}.` : ''
      ].join(' ').trim();
      empty.classList.add('hidden');
      detailBody.classList.remove('hidden');
      const meta = [
        { label: 'Workstream', value: normalizeBranch(lane.branch) },
        { label: 'Checked-out HEAD', value: lane.currentHeadSha ? commitShort(lane.currentHeadSha) : 'unknown' },
        { label: 'HEAD ref', value: lane.currentHeadRef || (lane.isDetachedHead ? 'detached' : 'unknown') },
        { label: 'Checkout', value: describeWorkstreamCheckout(lane) || 'unknown' },
        { label: 'Last agent', value: lane.lastAgent || 'unknown' },
        { label: 'Latest commit', value: lane.lastCommitSha || 'none' },
        { label: 'Handoff readiness', value: lane.handoffSummary || 'unknown' },
        { label: 'Git state', value: describeWorkstreamSync(lane) || 'unknown' },
        { label: 'Recommended next step', value: describeWorkstreamActionHint(lane) || 'Continue normally' },
        { label: 'Blockers', value: lane.handoffBlockers?.length ? lane.handoffBlockers.join(' ') : 'none' },
        { label: 'Review before handoff', value: lane.handoffReviewItems?.length ? lane.handoffReviewItems.join(' ') : 'none' },
        { label: 'Capture drift', value: lane.headDiffersFromCaptured === true ? 'yes' : lane.headDiffersFromCaptured === false ? 'no' : 'unknown' },
        { label: 'Baseline', value: lane.baseline?.summary || 'No default-branch baseline available' },
        { label: 'Upstream', value: lane.upstream || 'not configured' },
        { label: 'Agents on workstream', value: lane.agentSet?.length ? lane.agentSet.join(', ') : 'none' },
        { label: 'Worktree', value: lane.worktreePath || 'Primary workspace root' }
      ];
    document.getElementById('branchMeta').innerHTML = meta.map((item) => `<article><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></article>`).join('');

    if (compareSelect) {
      const sourceKey = branchKey(lane.branch, lane.worktreePath);
      const comparisonCandidates = state.branches.filter((item) => branchKey(item.branch, item.worktreePath) !== sourceKey);
      compareSelect.innerHTML = comparisonCandidates.length > 0
        ? comparisonCandidates.map((item) => {
            const itemKey = branchKey(item.branch, item.worktreePath);
            return `<option value="${esc(itemKey)}"${itemKey === state.comparisonTargetKey ? ' selected' : ''}>${esc(describeBranchLane(item).title)}</option>`;
          }).join('')
        : '<option value="">No other workstreams yet</option>';
      compareSelect.disabled = comparisonCandidates.length === 0;
    }

    if (!comparisonTarget || !state.branchComparison) {
      if (compareEmpty) {
        compareEmpty.textContent = state.branches.length > 1
          ? 'Choose another workstream to compare git divergence, recent activity, and shared agents.'
          : 'A second workstream is needed before comparison is available.';
        compareEmpty.classList.remove('hidden');
      }
      if (compareBody) compareBody.classList.add('hidden');
    } else {
      const comparison = state.branchComparison;
      const comparisonSummary = document.getElementById('branchComparisonSummary');
      const comparisonMeta = document.getElementById('branchComparisonMeta');
      const comparisonAgents = document.getElementById('branchComparisonAgents');
        if (comparisonSummary) {
        const lines = [comparison.comparisonSummary || comparison.comparisonText || 'No comparison summary is available for these workstreams.'];
        if (comparison.comparisonActionHint) {
          lines.push(`Next: ${comparison.comparisonActionHint}`);
        }
        if (comparison.reconcileStrategySummary) {
          lines.push(`Reconcile: ${comparison.reconcileStrategySummary}`);
        }
        if (Array.isArray(comparison.reconcileSteps) && comparison.reconcileSteps.length > 0) {
          lines.push(`Steps: ${comparison.reconcileSteps.map((step, index) => `${index + 1}) ${step}`).join(' ')}`);
        }
        comparisonSummary.textContent = lines.join(' ');
      }
      if (comparisonMeta) {
        const gitSummary = comparison.comparable && comparison.sameRepository
          ? [
              `source ahead ${comparison.sourceAheadCount ?? '?'}`,
              `target ahead ${comparison.targetAheadCount ?? '?'}`,
              comparison.mergeBaseSha ? `merge base #${commitShort(comparison.mergeBaseSha)}` : 'merge base unavailable',
              `newer ${comparison.newerSide}`
            ].join(' · ')
          : (comparison.sameRepository ? 'Git comparison unavailable' : 'Different repositories');
        const overlapSummary = typeof comparison.sharedChangedFileCount === 'number'
          ? `source ${comparison.sourceChangedFileCount ?? '?'} · target ${comparison.targetChangedFileCount ?? '?'} · shared ${comparison.sharedChangedFileCount}`
          : 'Changed-file overlap unavailable';
        const lineOverlapSummary = typeof comparison.sharedConflictLikelyCount === 'number'
          ? `shared ${comparison.sharedConflictLikelyCount} · ${comparison.lineOverlapKind || 'unknown'}`
          : 'Changed-line overlap unavailable';
        comparisonMeta.innerHTML = [
          `<article><span>Source</span><strong>${esc(describeBranchLane(comparison.source).title)}</strong></article>`,
          `<article><span>Target</span><strong>${esc(describeBranchLane(comparison.target).title)}</strong></article>`,
          `<article><span>State</span><strong>${esc((comparison.comparisonKind || 'unknown').replace(/_/g, ' '))}</strong></article>`,
          `<article><span>Ready</span><strong>${esc(String(comparison.comparisonReadiness || 'unknown'))}</strong></article>`,
          `<article><span>Git divergence</span><strong>${esc(gitSummary)}</strong></article>`,
          `<article><span>Changed-file overlap</span><strong>${esc(overlapSummary)}</strong></article>`,
          `<article><span>Changed-line overlap</span><strong>${esc(lineOverlapSummary)}</strong></article>`,
          `<article><span>Hotspots</span><strong>${esc(comparison.changeHotspotSummary || 'none')}</strong></article>`,
          `<article><span>Merge risk</span><strong>${esc(comparison.mergeRiskSummary || 'unknown')}</strong></article>`,
          `<article><span>Reconcile</span><strong>${esc(comparison.reconcileStrategySummary || 'unknown')}</strong></article>`,
          `<article><span>Reconcile steps</span><strong>${esc(Array.isArray(comparison.reconcileSteps) && comparison.reconcileSteps.length > 0 ? comparison.reconcileSteps.join(' | ') : 'none')}</strong></article>`,
          `<article><span>Blockers</span><strong>${esc(comparison.comparisonBlockers?.length ? comparison.comparisonBlockers.join(' ') : 'none')}</strong></article>`,
          `<article><span>Review</span><strong>${esc(comparison.comparisonReviewItems?.length ? comparison.comparisonReviewItems.join(' ') : 'none')}</strong></article>`,
          `<article><span>Shared agents</span><strong>${esc(comparison.sharedAgents.length > 0 ? comparison.sharedAgents.join(', ') : 'none')}</strong></article>`
        ].join('');
      }
      if (comparisonAgents) {
        comparisonAgents.innerHTML = [
          { label: 'Shared', value: comparison.sharedAgents },
          { label: 'Only on source', value: comparison.sourceOnlyAgents },
          { label: 'Only on target', value: comparison.targetOnlyAgents },
          { label: 'Focus areas', value: comparison.sharedChangedAreas || [] },
          { label: 'Shared files', value: comparison.sharedChangedFiles || [] },
          { label: 'Likely conflict files', value: comparison.sharedConflictLikelyFiles || [] },
          { label: 'Only on source files', value: comparison.sourceOnlyChangedFiles || [] },
          { label: 'Only on target files', value: comparison.targetOnlyChangedFiles || [] },
          { label: 'Source status', value: [comparison.source?.stateSummary || 'unknown'] },
          { label: 'Target status', value: [comparison.target?.stateSummary || 'unknown'] },
          { label: 'Source handoff', value: [comparison.source?.handoffSummary || 'unknown'] },
          { label: 'Target handoff', value: [comparison.target?.handoffSummary || 'unknown'] }
        ].map((item) => `<article><span>${esc(item.label)}</span><strong>${esc(item.value.length > 0 ? item.value.join(', ') : 'none')}</strong></article>`).join('');
      }
      if (compareEmpty) compareEmpty.classList.add('hidden');
      if (compareBody) compareBody.classList.remove('hidden');
    }

    document.getElementById('handoffList').innerHTML = state.handoff.length > 0
      ? state.handoff.map((entry) => `
          <article class="list-item conversation-card" data-session-id="${esc(entry.sessionId)}" data-open-view="sessions">
            <p class="item-kicker">${esc(formatRelativeTime(entry.lastTurnAt))}</p>
            <h4 class="item-title">${esc(entry.agent || 'unknown agent')}</h4>
            <p class="item-preview">${esc(short(entry.summary || 'No summary stored for this session.', 150))}</p>
            ${renderMetaLine([
              normalizeBranch(entry.branch),
              entry.agent || '',
              entry.commitSha ? `#${commitShort(entry.commitSha)}` : ''
            ])}
          </article>
        `).join('')
      : '<div class="empty-state">No handoff history recorded for this workstream yet.</div>';
  }

  Object.assign(app, { renderBranches });
})();
