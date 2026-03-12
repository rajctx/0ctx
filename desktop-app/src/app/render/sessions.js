(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
  const { state, matches, activeContext, activeBranch, activeSession, activeSessionKnowledgePreview, selectedKnowledgeKeys, selectedTurn, describeSession, describeTurn, describeSelectedTurn, describeBranchLane, esc, formatRelativeTime, renderMetaLine, humanizeLabel, commitShort, renderChip, chipToneForRole, chipToneForAgent, formatTime, renderKnowledgeCandidates, describeKnowledgePreviewSummary, normalizeBranch } = app;

  function renderSessions() {
    const sessions = state.sessions.filter((session) => matches(`${session.sessionId} ${session.summary || ''} ${session.branch || ''} ${session.commitSha || ''} ${session.agent || ''}`));
    const turns = state.turns.filter((turn) => matches(`${turn.content || ''} ${turn.role || ''} ${turn.commitSha || ''} ${turn.agent || ''}`));
    const lane = activeBranch();
    const session = activeSession();
    const sessionSummary = session ? describeSession(session) : null;
    const context = activeContext();
    document.getElementById('sessionHeadline').textContent = `${sessions.length} session${sessions.length === 1 ? '' : 's'}`;
    document.getElementById('turnCount').textContent = `${turns.length} message${turns.length === 1 ? '' : 's'}`;
    const sessionsPageMeta = document.getElementById('sessionsPageMeta');
    if (sessionsPageMeta) {
      sessionsPageMeta.textContent = session
        ? `${session.agent || 'Agent'} on ${normalizeBranch(session.branch)}. Read the message stream and capture a checkpoint when the session reaches a useful state.`
        : lane
          ? `Reading sessions for ${describeBranchLane(lane).title}. Choose a session to inspect its messages.`
          : context
          ? `Choose a workstream inside ${context.name}, then open a session to read the message stream.`
            : 'Choose a workspace and workstream before reading captured sessions.';
    }
    document.getElementById('sessionFocusTitle').textContent = sessionSummary?.title || (lane ? describeBranchLane(lane).title : 'Choose a session');
    document.getElementById('sessionFocusMeta').textContent = session
      ? `${sessionSummary?.preview || 'Read the stream below.'} ${session.agent ? `Agent: ${session.agent}.` : ''}`.trim()
      : lane
        ? `Selected workstream: ${describeBranchLane(lane).title}. Choose a session to read its message stream and create a checkpoint.`
        : 'Pick a workstream, then choose a session to read the message stream and capture a checkpoint.';

    document.getElementById('sessionList').innerHTML = sessions.length > 0
      ? sessions.map((session) => {
        const summary = describeSession(session);
        return `
          <article class="list-item conversation-card ${session.sessionId === state.activeSessionId ? 'active' : ''}" data-session-id="${esc(session.sessionId)}">
            <p class="item-kicker">${esc(formatRelativeTime(session.lastTurnAt || session.startedAt))}</p>
            <h4 class="item-title">${esc(summary.title)}</h4>
            <p class="item-preview">${esc(summary.preview)}</p>
            ${renderMetaLine([
              session.agent || '',
              `${session.turnCount || 0} messages`,
              session.commitSha ? `#${commitShort(session.commitSha)}` : ''
            ])}
          </article>
        `;
      }).join('')
      : '<div class="empty-state">No sessions are loaded for this workstream yet.</div>';

    document.getElementById('turnList').innerHTML = turns.length > 0
      ? turns.map((turn) => {
        const summary = describeTurn(turn);
        return `
          <article class="list-item conversation-card ${turn.nodeId === state.activeTurnId ? 'active' : ''}" data-turn-id="${esc(turn.nodeId)}">
            <p class="item-kicker">${esc(formatRelativeTime(turn.createdAt))}</p>
            <h4 class="item-title">${esc(summary.title)}</h4>
            <p class="item-preview">${esc(summary.preview)}</p>
            ${renderMetaLine([
              humanizeLabel(turn.role || 'message'),
              turn.commitSha ? `#${commitShort(turn.commitSha)}` : ''
            ])}
          </article>
        `;
      }).join('')
      : '<div class="empty-state">Choose a session to load its message stream.</div>';

    const createBtn = document.getElementById('createCheckpointBtn');
    const previewBtn = document.getElementById('previewSessionKnowledgeBtn');
    const extractBtn = document.getElementById('extractSessionKnowledgeBtn');
    if (createBtn) {
      createBtn.disabled = !state.activeSessionId;
    }
    if (previewBtn) {
      previewBtn.disabled = !state.activeSessionId;
    }
    if (extractBtn) {
      extractBtn.disabled = !state.activeSessionId;
    }

    const turn = selectedTurn();
    const body = document.getElementById('turnDetailBody');
    const empty = document.getElementById('turnDetailEmpty');
    if (!turn) {
      document.getElementById('turnDetailTitle').textContent = 'Choose a message';
      empty.classList.remove('hidden');
      body.classList.add('hidden');
      document.getElementById('turnPrimaryLabel').textContent = 'Message';
      document.getElementById('turnSecondaryLabel').textContent = 'Related context';
      document.getElementById('turnPrompt').textContent = '';
      document.getElementById('turnReply').textContent = '';
      document.getElementById('turnLeadMeta').innerHTML = '';
      document.getElementById('turnTechnical').innerHTML = '';
      document.getElementById('turnMeta').innerHTML = state.sessionDetail?.session
        ? `<article><span>Session</span><strong>${esc(short(state.sessionDetail.session.summary || state.sessionDetail.session.sessionId, 72))}</strong></article><article><span>Checkpoint count</span><strong>${esc(String(state.sessionDetail.checkpointCount || 0))}</strong></article>`
        : '';
      document.getElementById('sessionKnowledgePreviewPanel').classList.add('hidden');
      document.getElementById('sessionKnowledgePreviewBadge').textContent = '0 candidates';
      document.getElementById('sessionKnowledgePreviewMeta').textContent = '0 strong · 0 review · 0 weak';
      document.getElementById('sessionKnowledgePreviewList').innerHTML = '';
      return;
    }

    const detail = describeSelectedTurn(turn);
    empty.classList.add('hidden');
    body.classList.remove('hidden');
    document.getElementById('turnDetailTitle').textContent = short(detail.title || turn.nodeId, 70);
    document.getElementById('turnPrimaryLabel').textContent = detail.primaryLabel;
    document.getElementById('turnSecondaryLabel').textContent = detail.secondaryLabel;
    document.getElementById('turnPrompt').textContent = detail.primaryText || 'No visible message text was extracted for this capture.';
    document.getElementById('turnReply').textContent = detail.secondaryText || 'No adjacent message context is available.';
    document.getElementById('turnLeadMeta').innerHTML = [
      renderChip(turn.role || 'message', chipToneForRole(turn.role)),
      renderChip(turn.agent || activeSession()?.agent || 'unknown', chipToneForAgent(turn.agent || activeSession()?.agent)),
      renderChip(formatRelativeTime(turn.createdAt), 'beige'),
      turn.branch ? renderChip(normalizeBranch(turn.branch), 'green') : '',
      turn.commitSha ? renderChip(`#${commitShort(turn.commitSha)}`, 'beige', { mono: true }) : ''
    ].filter(Boolean).join('');

    const meta = [
      { label: 'Captured', value: formatTime(turn.createdAt) },
      { label: 'Session checkpoints', value: String(state.sessionDetail?.checkpointCount || 0) },
      { label: 'Session summary', value: short(state.sessionDetail?.session?.summary || turn.sessionId || 'No session summary stored', 88) }
    ];
    document.getElementById('turnMeta').innerHTML = meta.map((item) => {
      return `<article><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></article>`;
    }).join('');

    const technical = [
      { label: 'Session id', value: turn.sessionId || '-' },
      { label: 'Message id', value: turn.messageId || '-' },
      { label: 'Node id', value: turn.nodeId },
      { label: 'Parent id', value: turn.parentId || 'none' },
      { label: 'Branch', value: turn.branch || 'none' },
      { label: 'Commit', value: turn.commitSha || 'none' },
      { label: 'Visibility', value: turn.hidden ? 'Hidden by default' : 'Visible in insights view' }
    ];
    document.getElementById('turnTechnical').innerHTML = technical.map((item) => {
      return `<article><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></article>`;
    }).join('');

    const preview = activeSessionKnowledgePreview();
    const previewPanel = document.getElementById('sessionKnowledgePreviewPanel');
    if (!preview) {
      previewPanel.classList.add('hidden');
      document.getElementById('sessionKnowledgePreviewBadge').textContent = '0 selected';
      document.getElementById('sessionKnowledgePreviewMeta').textContent = '0 strong · 0 review · 0 weak';
      document.getElementById('sessionKnowledgePreviewList').innerHTML = '';
    } else {
      previewPanel.classList.remove('hidden');
      const selectedCount = selectedKnowledgeKeys('session').length;
      document.getElementById('sessionKnowledgePreviewBadge').textContent = `${selectedCount} selected / ${preview.candidateCount}`;
      document.getElementById('sessionKnowledgePreviewMeta').textContent = describeKnowledgePreviewSummary(preview.summary);
      document.getElementById('sessionKnowledgePreviewList').innerHTML = renderKnowledgeCandidates(preview.candidates, 'session');
    }
  }

  Object.assign(app, { renderSessions });
})();
