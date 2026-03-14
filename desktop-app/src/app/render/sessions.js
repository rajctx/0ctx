(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
  const {
    state,
    matches,
    activeContext,
    activeBranch,
    activeSession,
    activeSessionKnowledgePreview,
    selectedKnowledgeKeys,
    selectedTurn,
    describeSession,
    describeTurn,
    describeSelectedTurn,
    esc,
    short,
    formatRelativeTime,
    renderMetaLine,
    humanizeLabel,
    commitShort,
    renderKnowledgeCandidates,
    describeKnowledgePreviewSummary,
    normalizeBranch,
    renderReadableBody
  } = app;

  function renderSessions() {
    const visibleSessions = state.sessions.filter((session) => {
      return matches(`${session.sessionId} ${session.summary || ''} ${session.branch || ''} ${session.commitSha || ''} ${session.agent || ''}`);
    });
    const allTurns = Array.isArray(state.turns) ? state.turns : [];
    const visibleTurns = allTurns.filter((turn) => {
      return matches(`${turn.content || ''} ${turn.role || ''} ${turn.commitSha || ''} ${turn.agent || ''}`);
    });
    const newestFirstTurns = [...visibleTurns].reverse();
    const lane = activeBranch();
    const session = activeSession();
    const sessionSummary = session ? describeSession(session) : null;
    const context = activeContext();
    const participants = collectParticipants(session, allTurns);
    const participantSummary = summarizeParticipants(participants);
    const sessionTurns = session ? turnsForSession(newestFirstTurns, session) : [];

    document.getElementById('sessionHeadline').textContent = `${visibleSessions.length} session${visibleSessions.length === 1 ? '' : 's'}`;
    document.getElementById('turnCount').textContent = session
      ? `${sessionTurns.length || session.turnCount || 0} message${(sessionTurns.length || session.turnCount || 0) === 1 ? '' : 's'}`
      : '0 messages';

    const sessionsPageMeta = document.getElementById('sessionsPageMeta');
    if (sessionsPageMeta) {
      if (lane) {
        sessionsPageMeta.textContent = '';
        sessionsPageMeta.classList.add('hidden');
      } else {
        sessionsPageMeta.classList.remove('hidden');
        sessionsPageMeta.textContent = context
          ? `Choose a workstream inside ${context.name} to inspect captured conversations.`
          : 'Choose a workspace to inspect captured conversations.';
      }
    }

    document.getElementById('sessionList').innerHTML = visibleSessions.length > 0
      ? visibleSessions.map((entry) => renderSessionNode(entry, newestFirstTurns, allTurns)).join('')
      : '<div class="empty-state">No sessions are loaded for this workstream yet.</div>';

    document.getElementById('turnContextLead').textContent = session
      ? short(resolveSessionContextCopy(session, sessionSummary), 84)
      : (lane
        ? 'Choose a session to inspect its context, workstream, and saved checkpoints.'
        : 'Choose a workstream and session to inspect captured context.');

    document.getElementById('turnMeta').innerHTML = session
      ? buildContextMeta(session, participantSummary)
      : renderContextPlaceholder();

    const previewBtn = document.getElementById('previewSessionKnowledgeBtn');
    const extractBtn = document.getElementById('extractSessionKnowledgeBtn');
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
      document.getElementById('turnSessionMeta').innerHTML = session
        ? renderMetaLine(buildSessionFocusFacts(session, sessionTurns.length || session.turnCount || 0, participantSummary))
        : '';
      document.getElementById('turnDetailTitle').textContent = 'Choose a message';
      empty.classList.remove('hidden');
      body.classList.add('hidden');
      document.getElementById('turnPrimaryLabel').textContent = 'Message';
      document.getElementById('turnSecondaryLabel').textContent = 'Related context';
      document.getElementById('turnPrompt').textContent = '';
      document.getElementById('turnReply').textContent = '';
      document.getElementById('turnLeadMeta').innerHTML = '';
      document.getElementById('turnTechnical').innerHTML = renderTechnicalPlaceholder();
    } else {
      const detail = describeSelectedTurn(turn);
      empty.classList.add('hidden');
      body.classList.remove('hidden');
      document.getElementById('turnSessionMeta').innerHTML = session
        ? renderMetaLine(buildSessionFocusFacts(session, sessionTurns.length || session.turnCount || 0, participantSummary))
        : '';
      document.getElementById('turnDetailTitle').textContent = short(detail.title || turn.nodeId, 72);
      document.getElementById('turnPrimaryLabel').textContent = detail.primaryLabel;
      document.getElementById('turnSecondaryLabel').textContent = detail.secondaryLabel;
      document.getElementById('turnPrompt').innerHTML = renderReadableBody(detail.primaryText);
      document.getElementById('turnReply').innerHTML = renderReadableBody(detail.secondaryText);
      document.getElementById('turnLeadMeta').innerHTML = renderMetaLine([
        humanizeLabel(turn.role || 'message'),
        turn.agent || activeSession()?.agent || '',
        `updated ${formatRelativeTime(turn.createdAt)}`,
        turn.commitSha ? `#${commitShort(turn.commitSha)}` : ''
      ]);
      document.getElementById('turnTechnical').innerHTML = buildTechnicalMeta(turn);
    }

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

    syncSessionStatusBar();
  }

  Object.assign(app, { renderSessions });

  function renderSessionNode(session, newestFirstTurns, allTurns) {
    const summary = describeSession(session);
    const active = session.sessionId === state.activeSessionId;
    const participants = active ? collectParticipants(session, allTurns) : collectParticipants(session, []);
    const participantSummary = summarizeParticipants(participants);
    const sessionTurns = turnsForSession(newestFirstTurns, session);
    const messageRows = active
      ? renderTurnTree(sessionTurns)
      : '';
    const summaryTitle = cleanDisplayText(summary.title || session.summary || session.sessionId);
    const summaryPreview = cleanDisplayText(summary.preview || session.summary || '');

    return `
      <section class="session-node ${active ? 'active' : ''}">
        <button class="session-node-head ${active ? 'active' : ''}" type="button" data-session-id="${esc(session.sessionId)}">
          <p class="item-kicker">${esc(formatRelativeTime(session.lastTurnAt || session.startedAt))}</p>
          <h3 class="item-title">${esc(short(summaryTitle, 56))}</h3>
          ${summaryPreview ? `<p class="item-preview">${esc(short(summaryPreview, active ? 62 : 54))}</p>` : ''}
          <div class="session-node-meta">
            ${renderMetaLine([
              participantSummary || '',
              `${session.turnCount || 0} messages`,
              session.branch ? normalizeBranch(session.branch) : ''
            ])}
          </div>
        </button>
        ${active ? `
          <div class="session-node-turns">
            ${messageRows}
          </div>
        ` : ''}
      </section>
    `;
  }

  function renderTurnTree(turns) {
    if (turns.length === 0) {
      return '<div class="session-turn-empty">No captured messages are visible for this session yet.</div>';
    }

    return turns.map((turn) => {
      const summary = describeTurn(turn);
      const preview = cleanDisplayText(summary.preview || turn.content || summary.title || humanizeLabel(turn.role || 'message'));
      return `
        <button class="message-node ${turn.nodeId === state.activeTurnId ? 'active' : ''}" type="button" data-turn-id="${esc(turn.nodeId)}">
          <p class="item-kicker">${esc(humanizeLabel(turn.role || 'message'))} · ${esc(formatRelativeTime(turn.createdAt))}</p>
          <p class="message-node-copy">${esc(short(preview, 72))}</p>
        </button>
      `;
    }).join('');
  }

  function collectParticipants(session, turns) {
    const agents = Array.isArray(turns)
      ? [...new Set(turns.map((turn) => String(turn?.agent || '').trim()).filter(Boolean))]
      : [];
    if (agents.length > 0) {
      return agents;
    }
    const fallback = String(session?.agent || '').trim();
    return fallback ? [fallback] : [];
  }

  function summarizeParticipants(participants) {
    if (!Array.isArray(participants) || participants.length === 0) {
      return '';
    }
    if (participants.length === 1) {
      return participants[0];
    }
    return `${participants[0]} + ${participants.length - 1} others`;
  }

  function buildSessionFocusFacts(session, messageCount, participantSummary) {
    return [
      session.branch ? normalizeBranch(session.branch) : '',
      participantSummary,
      `${messageCount || 0} messages`,
      `updated ${formatRelativeTime(session.lastTurnAt || session.startedAt)}`,
      session.commitSha ? `#${commitShort(session.commitSha)}` : ''
    ].filter(Boolean);
  }

  function resolveSessionContextCopy(session, sessionSummary) {
    const detailSummary = cleanDisplayText(state.sessionDetail?.session?.summary);
    return detailSummary
      ? short(detailSummary, 160)
      : short(cleanDisplayText(sessionSummary?.preview || session.summary || 'Read the selected message and use the companion facts to understand how it fits the session.'), 160);
  }

  function turnsForSession(turns, session) {
    if (!Array.isArray(turns) || !session?.sessionId) {
      return [];
    }
    const scoped = turns.filter((turn) => {
      const turnSessionId = String(turn?.sessionId || '').trim();
      return turnSessionId ? turnSessionId === session.sessionId : false;
    });
    return scoped.length > 0 ? scoped : turns;
  }

  function buildContextMeta(session, participantSummary) {
    const items = [];
    if (state.sessionDetail?.checkpointCount) {
      items.push({ label: 'Checkpoints', value: String(state.sessionDetail.checkpointCount) });
    }
    if (session.branch) {
      items.push({ label: 'Workstream', value: normalizeBranch(session.branch) });
    }
    if (participantSummary) {
      items.push({ label: 'Participants', value: participantSummary });
    }
    if (session.commitSha) {
      items.push({ label: 'Commit', value: `#${commitShort(session.commitSha)}` });
    }
    return items.map((item) => `<article><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></article>`).join('');
  }

  function buildTechnicalMeta(turn) {
    const items = [
      { label: 'Session id', value: turn.sessionId || '-' },
      { label: 'Message id', value: turn.messageId || '-' },
      { label: 'Node id', value: turn.nodeId || '-' },
      { label: 'Parent id', value: turn.parentId || 'none' },
      { label: 'Role', value: humanizeLabel(turn.role || 'message') },
      { label: 'Branch', value: turn.branch ? normalizeBranch(turn.branch) : 'none' },
      { label: 'Commit', value: turn.commitSha ? `#${commitShort(turn.commitSha)}` : 'none' },
      { label: 'Visibility', value: turn.hidden ? 'Hidden by default' : 'Visible in insights view' }
    ];
    return items.map((item) => `<article><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></article>`).join('');
  }

  function renderTechnicalPlaceholder() {
    return `
      <article>
        <span>Message</span>
        <strong>Select a message to inspect capture metadata.</strong>
      </article>
    `;
  }

  function renderContextPlaceholder() {
    return `
      <article>
        <span>Session</span>
        <strong>Select a session to inspect its summary, workstream, and participants.</strong>
      </article>
    `;
  }

  function syncSessionStatusBar() {
    const globalStatusTxt = document.getElementById('statusTxt');
    const globalStatusTime = document.getElementById('statusTime');
    const sessionStatusTxt = document.getElementById('sessionStatusTxt');
    const sessionStatusTime = document.getElementById('sessionStatusTime');
    if (sessionStatusTxt && globalStatusTxt) {
      sessionStatusTxt.textContent = globalStatusTxt.textContent || 'Ready.';
    }
    if (sessionStatusTime && globalStatusTime) {
      sessionStatusTime.textContent = globalStatusTime.textContent || '-';
    }
  }

  function cleanDisplayText(value) {
    return String(value ?? '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/[_#>~-]/g, ' ')
      .replace(/\r?\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
})();
