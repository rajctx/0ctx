(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
  const { state, matches, activeSession, selectedCheckpoint, activeCheckpointKnowledgePreview, selectedKnowledgeKeys, describeCheckpoint, describeSession, esc, formatRelativeTime, renderMetaLine, commitShort, renderKnowledgeCandidates, describeKnowledgePreviewSummary, short, normalizeBranch } = app;

  function joinNonEmpty(parts) {
    return parts.map((part) => String(part || '').trim()).filter(Boolean).join(' ');
  }

  function factStripItem(label, value) {
    return `<article><span>${esc(label)}</span><strong>${esc(value || '-')}</strong></article>`;
  }

  function renderCheckpoints() {
      const checkpoints = state.checkpoints.filter((checkpoint) => matches(`${checkpoint.summary || ''} ${checkpoint.name || ''} ${checkpoint.sessionId || ''} ${checkpoint.commitSha || ''}`));
      document.getElementById('checkpointHeadline').textContent = `${checkpoints.length} checkpoint${checkpoints.length === 1 ? '' : 's'}`;
      const checkpointsPageMeta = document.getElementById('checkpointsPageMeta');
    if (checkpointsPageMeta) {
      checkpointsPageMeta.textContent = state.activeCheckpointId
        ? 'Explain the selected checkpoint or rewind the workspace to its stored snapshot.'
        : `There are ${checkpoints.length} checkpoint${checkpoints.length === 1 ? '' : 's'} in the current view.`;
    }

    document.getElementById('checkpointList').innerHTML = checkpoints.length > 0
      ? checkpoints.map((checkpoint) => {
        const summary = describeCheckpoint(checkpoint);
        return `
          <article class="list-item conversation-card ${checkpoint.checkpointId === state.activeCheckpointId ? 'active' : ''}" data-checkpoint-id="${esc(checkpoint.checkpointId)}">
            <p class="item-kicker">${esc(formatRelativeTime(checkpoint.createdAt))}</p>
            <h4 class="item-title">${esc(summary.title)}</h4>
            <p class="item-preview">${esc(summary.preview)}</p>
            ${renderMetaLine([
              checkpoint.kind,
              checkpoint.sessionId ? 'linked session' : '',
              checkpoint.commitSha ? `#${commitShort(checkpoint.commitSha)}` : ''
            ])}
          </article>
        `;
      }).join('')
      : '<div class="empty-state">No checkpoints yet for this workstream.</div>';

    const sessionCard = document.getElementById('checkpointSessionCard');
    const linkedSession = state.checkpointSessionDetail?.session || activeSession();
    if (linkedSession && selectedCheckpoint()?.sessionId) {
      const summary = describeSession(linkedSession);
      sessionCard.innerHTML = `
        <article class="list-item conversation-card" data-session-id="${esc(linkedSession.sessionId)}" data-open-view="sessions">
          <p class="item-kicker">${esc(formatRelativeTime(linkedSession.lastTurnAt || linkedSession.startedAt))}</p>
          <h4 class="item-title">${esc(summary.title)}</h4>
          <p class="item-preview">${esc(summary.preview)}</p>
          ${renderMetaLine([
            `${linkedSession.turnCount || 0} messages`,
            linkedSession.agent || '',
            linkedSession.commitSha ? `#${commitShort(linkedSession.commitSha)}` : ''
          ])}
        </article>
      `;
    } else {
      sessionCard.innerHTML = '<div class="empty-state">This checkpoint is not linked to a captured session.</div>';
    }

    const detail = state.checkpointDetail;
    const empty = document.getElementById('checkpointDetailEmpty');
    const body = document.getElementById('checkpointDetailBody');
    const explainBtn = document.getElementById('explainCheckpointBtn');
    const previewBtn = document.getElementById('previewCheckpointKnowledgeBtn');
    const extractBtn = document.getElementById('extractCheckpointKnowledgeBtn');
    const rewindBtn = document.getElementById('rewindCheckpointBtn');
    if (explainBtn) {
      explainBtn.disabled = !state.activeCheckpointId;
    }
    if (previewBtn) {
      previewBtn.disabled = !state.activeCheckpointId;
    }
    if (extractBtn) {
      extractBtn.disabled = !state.activeCheckpointId;
    }
    if (rewindBtn) {
      rewindBtn.disabled = !state.activeCheckpointId;
    }

      if (!detail?.checkpoint) {
        document.getElementById('checkpointDetailTitle').textContent = 'Choose a checkpoint';
        document.getElementById('checkpointLeadCopy').textContent = '';
        document.getElementById('checkpointFactStrip').innerHTML = '';
        document.getElementById('checkpointMeta').innerHTML = '';
        document.getElementById('checkpointKnowledgePreviewPanel').classList.add('hidden');
        document.getElementById('checkpointKnowledgePreviewBadge').textContent = '0 candidates';
        document.getElementById('checkpointKnowledgePreviewMeta').textContent = '0 strong · 0 review · 0 weak';
        document.getElementById('checkpointKnowledgePreviewList').innerHTML = '';
        empty.classList.remove('hidden');
      body.classList.add('hidden');
      return;
    }

      const checkpoint = detail.checkpoint;
      document.getElementById('checkpointDetailTitle').textContent = short(checkpoint.summary || checkpoint.name || checkpoint.id, 72);
      document.getElementById('checkpointLeadCopy').textContent = joinNonEmpty([
        checkpoint.branch
          ? `Restore ${normalizeBranch(checkpoint.branch)} from this saved point.`
          : 'Restore the workspace from this saved point.',
        checkpoint.sessionId ? 'Linked to the originating conversation.' : ''
      ]);
      empty.classList.add('hidden');
      body.classList.remove('hidden');
      document.getElementById('checkpointFactStrip').innerHTML = [
        factStripItem('Created', formatRelativeTime(checkpoint.createdAt)),
        factStripItem('Workstream', checkpoint.branch ? normalizeBranch(checkpoint.branch) : 'Workspace snapshot'),
        factStripItem('Snapshot', `${String(detail.snapshotNodeCount || 0)} nodes · ${String(detail.snapshotEdgeCount || 0)} edges`)
      ].join('');
      const meta = [
        { label: 'Commit', value: checkpoint.commitSha ? `#${commitShort(checkpoint.commitSha)}` : 'Unpinned' },
        { label: 'Kind', value: checkpoint.kind },
        { label: 'Session link', value: checkpoint.sessionId ? 'Attached below' : 'No linked session' }
      ];
    document.getElementById('checkpointMeta').innerHTML = meta.map((item) => `<article><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></article>`).join('');

    const preview = activeCheckpointKnowledgePreview();
    const previewPanel = document.getElementById('checkpointKnowledgePreviewPanel');
    if (!preview) {
      previewPanel.classList.add('hidden');
      document.getElementById('checkpointKnowledgePreviewBadge').textContent = '0 selected';
      document.getElementById('checkpointKnowledgePreviewMeta').textContent = '0 strong · 0 review · 0 weak';
      document.getElementById('checkpointKnowledgePreviewList').innerHTML = '';
    } else {
      previewPanel.classList.remove('hidden');
      const selectedCount = selectedKnowledgeKeys('checkpoint').length;
      document.getElementById('checkpointKnowledgePreviewBadge').textContent = `${selectedCount} selected / ${preview.candidateCount}`;
      document.getElementById('checkpointKnowledgePreviewMeta').textContent = describeKnowledgePreviewSummary(preview.summary);
      document.getElementById('checkpointKnowledgePreviewList').innerHTML = renderKnowledgeCandidates(preview.candidates, 'checkpoint');
    }
  }

  Object.assign(app, { renderCheckpoints });
})();
