const fs = require('node:fs');
const path = require('node:path');

function createElement(initialClasses = []) {
  const classSet = new Set(initialClasses);
  return {
    textContent: '',
    innerHTML: '',
    disabled: false,
    title: '',
    value: '',
    checked: false,
    dataset: {},
    classList: {
      add(...tokens) {
        tokens.forEach((token) => classSet.add(token));
      },
      remove(...tokens) {
        tokens.forEach((token) => classSet.delete(token));
      },
      toggle(token, force) {
        if (force === undefined) {
          if (classSet.has(token)) {
            classSet.delete(token);
            return false;
          }
          classSet.add(token);
          return true;
        }
        if (force) {
          classSet.add(token);
          return true;
        }
        classSet.delete(token);
        return false;
      },
      contains(token) {
        return classSet.has(token);
      }
    },
    get className() {
      return Array.from(classSet).join(' ');
    },
    set className(value) {
      classSet.clear();
      String(value || '').split(/\s+/).filter(Boolean).forEach((token) => classSet.add(token));
    }
  };
}

function createEnvironment({ withTurn, withPreview, withSession = true }) {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) {
      const hiddenByDefault = new Set(['turnDetailBody', 'sessionKnowledgePreviewPanel']);
      elements.set(id, createElement(hiddenByDefault.has(id) ? ['hidden'] : []));
    }
    return elements.get(id);
  };

  global.document = {
    getElementById: getElement
  };

  const session = {
    sessionId: 'session-1',
    summary: 'Refine the reader surface',
    branch: 'main',
    commitSha: 'abcdef123456',
    agent: 'factory',
    startedAt: '2026-03-10T10:00:00.000Z',
    lastTurnAt: '2026-03-10T11:00:00.000Z',
    turnCount: 4
  };
  const turn = {
    nodeId: 'turn-1',
    role: 'assistant',
    content: 'Here is a longer assistant reply with actual detail.',
    agent: 'factory',
    branch: 'main',
    commitSha: 'abcdef123456',
    createdAt: '2026-03-10T11:00:00.000Z',
    sessionId: 'session-1',
    messageId: 'message-1',
    parentId: 'parent-1',
    hidden: false
  };

  const state = {
    q: '',
    contexts: [{ id: 'ctx-1', name: 'Inbox Agent' }],
    activeContextId: 'ctx-1',
    branches: [{ branch: 'main', worktreePath: null }],
    activeBranchKey: JSON.stringify(['main', '']),
    sessions: withSession ? [session] : [],
    allSessions: withSession ? [session] : [],
    activeSessionId: withSession ? 'session-1' : null,
    sessionDetail: withSession
      ? {
          checkpointCount: 2,
          session: {
            sessionId: 'session-1',
            summary: 'A deliberately long session summary that should still render as stacked metadata without colliding in the detail rail.'
          }
        }
      : null,
    turns: withSession && withTurn ? [turn] : [],
    activeTurnId: withSession && withTurn ? 'turn-1' : null,
    sessionKnowledgePreview: withPreview
      ? {
          candidateCount: 2,
          summary: { strong: 1, review: 1, weak: 0 },
          candidates: [{ key: 'decision-1' }, { key: 'constraint-1' }]
        }
      : null,
    sessionKnowledgeSelectedKeys: withPreview ? ['decision-1'] : []
  };

  global.window = {
    OctxDesktop: {
      state,
      matches: () => true,
      activeContext: () => state.contexts[0],
      activeBranch: () => state.branches[0],
      activeSession: () => state.sessions[0] || null,
      activeSessionKnowledgePreview: () => state.sessionKnowledgePreview,
      selectedKnowledgeKeys: () => state.sessionKnowledgeSelectedKeys,
      selectedTurn: () => (withSession && withTurn ? state.turns[0] : null),
      describeSession: (entry) => ({
        title: entry.summary,
        preview: `Preview for ${entry.sessionId}`
      }),
      describeTurn: (entry) => ({
        title: `Turn ${entry.nodeId}`,
        preview: entry.content,
        reply: entry.content
      }),
      describeSelectedTurn: () => ({
        title: 'Refined detail view',
        primaryLabel: 'User',
        primaryText: 'Show the source message in a readable block.',
        secondaryLabel: 'Assistant',
        secondaryText: 'Keep the answer visible and move support data aside.'
      }),
      describeBranchLane: () => ({ title: 'main' }),
      describeBodyKind: () => ({ label: '', tone: '' }),
      esc: (value) => String(value || ''),
      short: (value, max = 120) => {
        const text = String(value || '');
        return text.length > max ? `${text.slice(0, max - 3)}...` : text;
      },
      formatRelativeTime: () => '20h ago',
      renderMetaLine: (parts) => `<p>${parts.filter(Boolean).join(' · ')}</p>`,
      humanizeLabel: (value) => String(value || ''),
      commitShort: (value) => String(value || '').slice(0, 8),
      renderKnowledgeCandidates: (candidates) => candidates.map((candidate) => `<article>${candidate.key}</article>`).join(''),
      describeKnowledgePreviewSummary: () => '1 strong · 1 review · 0 weak',
      normalizeBranch: (value) => value || 'detached',
      renderReadableBody: (value) => `<p>${String(value || '')}</p>`
    }
  };

  return { getElement, state };
}

function loadScript(relativePath) {
  const resolved = require.resolve(relativePath);
  delete require.cache[resolved];
  require(relativePath);
}

afterEach(() => {
  delete global.window;
  delete global.document;
});

describe('desktop sessions redesign', () => {
  it('renders the integrated navigator, compact session metadata, and below-reader insight tools', () => {
    const { getElement } = createEnvironment({ withTurn: true, withPreview: true });
    loadScript('../src/app/render/sessions.js');

    global.window.OctxDesktop.renderSessions();

    expect(getElement('previewSessionKnowledgeBtn').disabled).toBe(false);
    expect(getElement('extractSessionKnowledgeBtn').disabled).toBe(false);
    expect(getElement('turnDetailBody').classList.contains('hidden')).toBe(false);
    expect(getElement('turnDetailEmpty').classList.contains('hidden')).toBe(true);
    expect(getElement('turnMeta').innerHTML).toContain('<article><span>Checkpoints</span>');
    expect(getElement('turnMeta').innerHTML).toContain('<article><span>Workstream</span>');
    expect(getElement('turnMeta').innerHTML).toContain('<article><span>Participants</span>');
    expect(getElement('turnSessionMeta').innerHTML).toContain('main');
    expect(getElement('sessionsPageMeta').textContent).toBe('');
    expect(getElement('sessionsPageMeta').classList.contains('hidden')).toBe(true);
    expect(getElement('sessionList').innerHTML).toContain('session-node-turns');
    expect(getElement('sessionList').innerHTML).toContain('data-turn-id="turn-1"');
    expect(getElement('sessionKnowledgePreviewPanel').classList.contains('hidden')).toBe(false);
    expect(getElement('sessionKnowledgePreviewBadge').textContent).toBe('1 selected / 2');
    expect(getElement('turnContextLead').textContent).toContain('A deliberately long session summary');
    expect(getElement('turnPrompt').innerHTML).toContain('Show the source message');
  });

  it('keeps the empty reader state readable while the context and support sections remain available', () => {
    const { getElement } = createEnvironment({ withTurn: false, withPreview: false });
    loadScript('../src/app/render/sessions.js');

    global.window.OctxDesktop.renderSessions();

    expect(getElement('previewSessionKnowledgeBtn').disabled).toBe(false);
    expect(getElement('extractSessionKnowledgeBtn').disabled).toBe(false);
    expect(getElement('turnDetailBody').classList.contains('hidden')).toBe(true);
    expect(getElement('turnDetailEmpty').classList.contains('hidden')).toBe(false);
    expect(getElement('turnMeta').innerHTML).toContain('<article><span>Checkpoints</span>');
    expect(getElement('turnMeta').innerHTML).toContain('<article><span>Workstream</span>');
    expect(getElement('sessionKnowledgePreviewPanel').classList.contains('hidden')).toBe(true);
    expect(getElement('sessionKnowledgePreviewBadge').textContent).toBe('0 selected');
    expect(getElement('turnTechnical').innerHTML).toContain('Select a message to inspect capture metadata.');
  });

  it('keeps support placeholders visible when no session is selected', () => {
    const { getElement } = createEnvironment({ withTurn: false, withPreview: false, withSession: false });
    loadScript('../src/app/render/sessions.js');

    global.window.OctxDesktop.renderSessions();

    expect(getElement('previewSessionKnowledgeBtn').disabled).toBe(true);
    expect(getElement('extractSessionKnowledgeBtn').disabled).toBe(true);
    expect(getElement('turnDetailBody').classList.contains('hidden')).toBe(true);
    expect(getElement('turnDetailEmpty').classList.contains('hidden')).toBe(false);
    expect(getElement('turnMeta').innerHTML).toContain('Select a session to inspect its summary');
    expect(getElement('turnTechnical').innerHTML).toContain('Select a message to inspect capture metadata.');
    expect(getElement('sessionList').innerHTML).toContain('No sessions are loaded for this workstream yet.');
  });

  it('keeps checkpoint ownership in the topbar and replaces the old sessions sidecar markup', () => {
    const markup = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles', 'overrides', '304-redesign.css'), 'utf8');

    expect(markup).toContain('id="heroPrimary"');
    expect(markup).toContain('id="themeDarkBtn"');
    expect(markup).toContain('id="themeLightBtn"');
    expect(markup).toContain('class="panel session-navigation-panel session-conversation-nav"');
    expect(markup).toContain('class="panel session-context-panel"');
    expect(markup).toContain('class="panel session-insights-panel"');
    expect(markup).toContain('class="sessions-main-scroll"');
    expect(markup).toContain('class="sessions-main-canvas"');
    expect(markup).toContain('id="turnSessionMeta"');
    expect(markup).toContain('class="technical-details support-details session-technical-details"');
    expect(markup).toContain('id="turnContextLead"');
    expect(markup).toContain('class="panel checkpoint-sidecar-panel"');
    expect(markup).not.toContain('class="panel session-sidecar-panel"');
    expect(markup).not.toContain('id="sessionFocusTitle"');
    expect(markup).not.toContain('id="turnList"');
    expect(markup).not.toContain('<h1>Message stream</h1>');
    expect(markup).not.toContain('id="createCheckpointBtn"');
    expect(markup).not.toContain('id="explainCheckpointBtn"');
    expect(markup).not.toContain('class="session-statusbar"');
    expect(markup).not.toContain('class="statusbar"');
    expect(css).toContain('.main-stage[data-view="sessions"] .statusbar');
    expect(css).toContain('display: none;');
    expect(css).toContain('.page-sessions .session-support-grid');
    expect(css).toContain('"context insights"');
    expect(css).toContain('"technical technical"');
    expect(css).toContain('.session-statusbar');
  });
});
