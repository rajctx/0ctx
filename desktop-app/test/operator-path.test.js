function createElement() {
  return {
    textContent: '',
    innerHTML: '',
    disabled: false,
    title: '',
    value: '',
    checked: false,
    dataset: {},
    className: '',
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    setAttribute(name, value) {
      this[name] = value;
    },
    getAttribute() {
      return '';
    }
  };
}

function createEnvironment() {
  const elements = new Map();
  const selectorMap = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) {
      elements.set(id, createElement());
    }
    return elements.get(id);
  };
  const setSelector = (selector, value) => {
    selectorMap.set(selector, value);
    return value;
  };

  global.document = {
    body: { dataset: {} },
    getElementById: getElement,
    querySelector(selector) {
      const value = selectorMap.get(selector);
      if (Array.isArray(value)) {
        return value[0] || null;
      }
      return value || null;
    },
    querySelectorAll(selector) {
      const value = selectorMap.get(selector);
      if (Array.isArray(value)) {
        return value;
      }
      return value ? [value] : [];
    }
  };

  const state = {
    view: 'setup',
    q: '',
    runtimeIssue: null,
    health: { status: 'ready' },
    hook: {
      agents: [
        {
          agent: 'claude',
          installed: true,
          status: 'healthy',
          notes: '',
          command: '0ctx bootstrap'
        }
      ]
    },
    dataPolicy: {
      contextId: null,
      workspaceResolved: false,
      syncPolicy: 'local_only',
      preset: 'lean',
      captureRetentionDays: 14,
      debugRetentionDays: 7,
      debugArtifactsEnabled: false
    },
    contexts: [],
    activeContextId: null,
    branches: [],
    allSessions: [],
    insights: [],
    graphNodes: [],
    graphEdges: [],
    includeHidden: false,
    promotionTargetContextId: null,
    lastInsightPromotion: null
  };

  global.window = {
    OctxDesktop: {
      state,
      VIEW_META: {
        setup: { title: 'Repo setup and support', primaryLabel: 'Copy enable command', primaryAction: 'copy-enable' },
        branches: { title: 'Workstreams', primaryLabel: 'Open sessions', primaryAction: 'go-sessions' }
      },
      SEARCH_HINTS: { setup: 'Filter repo setup, integrations, or utility actions' },
      activeContext: () => null,
      activeInsightNode: () => null,
      syncInsightSelection: () => null,
      insightSummary: () => ({
        title: 'Insight',
        summary: 'Summary',
        type: 'decision',
        trustTier: 'trusted',
        evidenceCount: 0,
        distinctEvidenceCount: 0,
        corroboratedRoles: [],
        latestEvidenceAt: null,
        source: 'local',
        createdAt: '2026-03-10T00:00:00.000Z',
        key: null,
        branch: null,
        worktreePath: null,
        originContextId: null,
        originNodeId: null
      }),
      insightTargetContexts: () => [],
      syncPromotionTargetSelection: () => null,
      contextById: () => null,
      methodSupported: () => true,
      matches: () => true,
      esc: (value) => String(value || ''),
      formatTime: (value) => String(value || ''),
      renderChip: () => '',
      basenameFromPath: (value) => String(value || ''),
      humanizeLabel: (value) => String(value || ''),
      short: (value) => String(value || ''),
      isGaIntegration: () => true,
      integrationLabel: (value) => String(value || ''),
      integrationListText: () => 'none',
      formatIntegrationNote: (value) => value || '',
      zeroTouchState: () => ({ ready: true, label: 'Ready', detail: 'Repo-first path active', nextAction: 'None' }),
      formatPosture: (value) => String(value || ''),
      postureClass: () => 'ready',
      renderMetaLine: () => '',
      formatSyncPolicyLabel: (policy) => {
        const value = String(policy || '').trim().toLowerCase();
        if (value === 'full_sync') return 'Full Sync (opt-in)';
        if (value === 'metadata_only') return 'Metadata Only (opt-in)';
        return 'Local Only (default)';
      },
      formatDataPolicyPresetLabel: (preset) => String(preset || '').trim().toLowerCase() === 'shared' ? 'Shared' : 'Lean',
      describeWorkspaceSyncDisplay: () => ({
        workspaceResolved: false,
        detail: 'No active workspace yet',
        hint: 'Local Only (default) becomes the workspace default after a workspace is active.'
      }),
      describeDesktopPolicyHint: () => 'No active workspace yet. Metadata-only and full sync are available only after a workspace is active.',
      enableCommand: () => '0ctx enable',
      capturePolicySummary: () => '14-day capture retention, debug artifacts off',
      dataPolicyActionHint: () => 'Keep workspace sync metadata-only until full sync is explicitly needed.'
    }
  };

  return { getElement, setSelector };
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

describe('desktop operator-first cleanup', () => {
  it('relabels setup navigation and runtime CTA away from utilities', () => {
    const { setSelector } = createEnvironment();
    const navLabel = setSelector('.nav-btn[data-view="setup"] span:last-child', createElement());
    const runtimeButton = setSelector('#runtimeBannerSetup', createElement());

    loadScript('../src/app/render/shell.js');
    global.window.OctxDesktop.applyShellCopy();

    expect(navLabel.textContent).toBe('Setup');
    expect(runtimeButton.textContent).toBe('Open setup');
  });

  it('keeps setup copy focused on repo enablement with support secondary', () => {
    const { getElement, setSelector } = createEnvironment();
    const labels = [createElement(), createElement(), createElement(), createElement()];
    const headings = [createElement(), createElement(), createElement()];
    setSelector('section[data-view="setup"] .page-kicker', createElement());
    setSelector('section[data-view="setup"] h1', createElement());
    setSelector('section[data-view="setup"] .section-label', labels);
    setSelector('section[data-view="setup"] h4', headings);
    setSelector('#dataPolicyForm [data-policy-preset]', []);

    loadScript('../src/app/render/setup.js');
    global.window.OctxDesktop.renderSetup();

    expect(global.document.querySelector('section[data-view="setup"] .page-kicker').textContent).toBe('Setup');
    expect(global.document.querySelector('section[data-view="setup"] h1').textContent).toBe('Enable repo and agents');
    expect(labels[0].textContent).toBe('Setup commands');
    expect(labels[3].textContent).toBe('Utility actions');
    expect(headings[2].textContent).toBe('Runtime utilities');
    expect(getElement('setupPageMeta').textContent).toContain('open runtime support when something is off');
    expect(getElement('setupSupportCopy').textContent).toContain('Use setup only when enabling another repo');
  });

  it('removes utility framing from the reviewed insights screen', () => {
    const { getElement, setSelector } = createEnvironment();
    const kicker = setSelector('section[data-view="knowledge"] .page-kicker', createElement());

    loadScript('../src/app/render/knowledge.js');
    global.window.OctxDesktop.renderKnowledge();

    expect(kicker.textContent).toBe('Reviewed memory');
    expect(getElement('knowledgePageMeta').textContent).toContain('broader graph view');
    expect(getElement('knowledgePageMeta').textContent).not.toContain('utility');
  });
});
