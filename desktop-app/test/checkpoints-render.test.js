function createElement(initialClasses = []) {
  const classSet = new Set(initialClasses);
  return {
    textContent: '',
    innerHTML: '',
    disabled: false,
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
    }
  };
}

function createEnvironment({ withActiveCheckpoint, withPreview }) {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) {
      const hiddenByDefault = new Set(['checkpointDetailBody', 'checkpointKnowledgePreviewPanel']);
      elements.set(id, createElement(hiddenByDefault.has(id) ? ['hidden'] : []));
    }
    return elements.get(id);
  };

  global.document = {
    getElementById: getElement
  };

  const checkpoint = {
    checkpointId: 'checkpoint-1',
    summary: 'Session milestone before extracting durable insights',
    kind: 'session',
    sessionId: 'session-1',
    branch: 'main',
    commitSha: 'abcdef123456',
    createdAt: '2026-03-10T12:00:00.000Z'
  };
  const session = {
    sessionId: 'session-1',
    summary: 'Reader flow polish',
    lastTurnAt: '2026-03-10T11:00:00.000Z',
    startedAt: '2026-03-10T10:00:00.000Z',
    agent: 'factory',
    commitSha: 'abcdef123456',
    turnCount: 4
  };

  const state = {
    checkpoints: [checkpoint],
    activeCheckpointId: withActiveCheckpoint ? 'checkpoint-1' : null,
    checkpointDetail: withActiveCheckpoint
      ? {
          checkpoint,
          snapshotNodeCount: 14,
          snapshotEdgeCount: 9
        }
      : null,
    checkpointSessionDetail: withActiveCheckpoint ? { session } : null,
    checkpointKnowledgePreview: withPreview
      ? {
          candidateCount: 2,
          summary: { strong: 1, review: 1, weak: 0 },
          candidates: [{ key: 'decision-1' }, { key: 'constraint-1' }]
        }
      : null,
    checkpointKnowledgeSelectedKeys: withPreview ? ['decision-1'] : []
  };

  global.window = {
    OctxDesktop: {
      state,
      matches: () => true,
      activeSession: () => null,
      selectedCheckpoint: () => (withActiveCheckpoint ? checkpoint : null),
      activeCheckpointKnowledgePreview: () => state.checkpointKnowledgePreview,
      selectedKnowledgeKeys: () => state.checkpointKnowledgeSelectedKeys,
      describeCheckpoint: (entry) => ({
        title: entry.summary,
        preview: `Preview for ${entry.checkpointId}`
      }),
      describeSession: (entry) => ({
        title: entry.summary,
        preview: `Session ${entry.sessionId}`
      }),
      esc: (value) => String(value || ''),
      formatRelativeTime: () => '20h ago',
      renderMetaLine: (parts) => `<p>${parts.filter(Boolean).join(' · ')}</p>`,
      commitShort: (value) => String(value || '').slice(0, 8),
      renderKnowledgeCandidates: (candidates) => candidates.map((candidate) => `<article>${candidate.key}</article>`).join(''),
      describeKnowledgePreviewSummary: () => '1 strong · 1 review · 0 weak',
      short: (value) => String(value || ''),
      normalizeBranch: (value) => value || 'detached'
    }
  };

  return { getElement };
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

describe('desktop checkpoints support rail', () => {
  it('keeps checkpoint support actions disabled until a checkpoint is selected', () => {
    const { getElement } = createEnvironment({ withActiveCheckpoint: false, withPreview: false });
    loadScript('../src/app/render/checkpoints.js');

    global.window.OctxDesktop.renderCheckpoints();

    expect(getElement('previewCheckpointKnowledgeBtn').disabled).toBe(true);
    expect(getElement('extractCheckpointKnowledgeBtn').disabled).toBe(true);
    expect(getElement('rewindCheckpointBtn').disabled).toBe(true);
    expect(getElement('checkpointDetailBody').classList.contains('hidden')).toBe(true);
    expect(getElement('checkpointDetailEmpty').classList.contains('hidden')).toBe(false);
    expect(getElement('checkpointKnowledgePreviewPanel').classList.contains('hidden')).toBe(true);
  });

  it('renders checkpoint facts and preview state in the support rail when selected', () => {
    const { getElement } = createEnvironment({ withActiveCheckpoint: true, withPreview: true });
    loadScript('../src/app/render/checkpoints.js');

    global.window.OctxDesktop.renderCheckpoints();

    expect(getElement('previewCheckpointKnowledgeBtn').disabled).toBe(false);
    expect(getElement('extractCheckpointKnowledgeBtn').disabled).toBe(false);
    expect(getElement('rewindCheckpointBtn').disabled).toBe(false);
    expect(getElement('checkpointDetailBody').classList.contains('hidden')).toBe(false);
    expect(getElement('checkpointFactStrip').innerHTML).toContain('<article><span>Created</span>');
    expect(getElement('checkpointMeta').innerHTML).toContain('<article><span>Commit</span>');
    expect(getElement('checkpointSessionCard').innerHTML).toContain('Reader flow polish');
    expect(getElement('checkpointKnowledgePreviewPanel').classList.contains('hidden')).toBe(false);
    expect(getElement('checkpointKnowledgePreviewBadge').textContent).toBe('1 selected / 2');
  });
});
