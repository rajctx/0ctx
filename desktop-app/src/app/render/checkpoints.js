(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
  const { state, matches, activeSession, selectedCheckpoint, activeCheckpointKnowledgePreview, selectedKnowledgeKeys, describeCheckpoint, describeSession, esc, formatRelativeTime, renderMetaLine, commitShort, formatTime, renderKnowledgeCandidates, short, normalizeBranch } = app;

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
        document.getElementById('checkpointKnowledgePreviewList').innerHTML = '';
        empty.classList.remove('hidden');
      body.classList.add('hidden');
      return;
    }

      const checkpoint = detail.checkpoint;
      const checkpointSummary = describeCheckpoint(checkpoint);
      document.getElementById('checkpointDetailTitle').textContent = short(checkpoint.summary || checkpoint.name || checkpoint.id, 72);
      document.getElementById('checkpointLeadCopy').textContent = [
        checkpointSummary.title,
        checkpoint.branch
      ? `tracks the ${normalizeBranch(checkpoint.branch)} workstream`
          : 'captures a workspace snapshot',
        `from ${formatRelativeTime(checkpoint.createdAt)}.`,
        checkpoint.sessionId
          ? `It stays linked to the originating conversation so you can explain or rewind it without losing the surrounding context.`
          : `It can still be explained or rewound even without a linked captured conversation.`
      ].join(' ');
      empty.classList.add('hidden');
      body.classList.remove('hidden');
      document.getElementById('checkpointFactStrip').innerHTML = [
        { label: 'Snapshot', value: `${String(detail.snapshotNodeCount || 0)} nodes / ${String(detail.snapshotEdgeCount || 0)} edges` },
        { label: 'Linked session', value: checkpoint.sessionId ? short(checkpoint.sessionId, 28) : 'None' },
        { label: 'Commit', value: checkpoint.commitSha ? `#${commitShort(checkpoint.commitSha)}` : 'Unpinned' },
        { label: 'Agents', value: checkpoint.agentSet?.length ? checkpoint.agentSet.join(', ') : 'Unknown' }
      ].map((item) => `<article><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></article>`).join('');
      const meta = [
        { label: 'Kind', value: checkpoint.kind },
        { label: 'Branch', value: checkpoint.branch || 'none' },
        { label: 'Commit', value: checkpoint.commitSha || 'none' },
      { label: 'Created', value: formatTime(checkpoint.createdAt) },
      { label: 'Agents', value: checkpoint.agentSet?.length ? checkpoint.agentSet.join(', ') : 'none' },
      { label: 'Snapshot', value: `${String(detail.snapshotNodeCount || 0)} nodes, ${String(detail.snapshotEdgeCount || 0)} edges` },
      { label: 'Session', value: checkpoint.sessionId || 'none' }
    ];
    document.getElementById('checkpointMeta').innerHTML = meta.map((item) => `<article><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></article>`).join('');

    const preview = activeCheckpointKnowledgePreview();
    const previewPanel = document.getElementById('checkpointKnowledgePreviewPanel');
    if (!preview) {
      previewPanel.classList.add('hidden');
      document.getElementById('checkpointKnowledgePreviewBadge').textContent = '0 selected';
      document.getElementById('checkpointKnowledgePreviewList').innerHTML = '';
    } else {
      previewPanel.classList.remove('hidden');
      const selectedCount = selectedKnowledgeKeys('checkpoint').length;
      document.getElementById('checkpointKnowledgePreviewBadge').textContent = `${selectedCount} selected / ${preview.candidateCount}`;
      document.getElementById('checkpointKnowledgePreviewList').innerHTML = renderKnowledgeCandidates(preview.candidates, 'checkpoint');
    }
  }

  Object.assign(app, { renderCheckpoints });
})();
