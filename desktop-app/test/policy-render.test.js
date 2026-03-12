const {
  describeWorkspaceSyncDisplay,
  describeDesktopPolicyHint
} = require('../src/app/policy-view.js');

function createElement() {
  return {
    textContent: '',
    innerHTML: '',
    disabled: false,
    title: '',
    value: '',
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    getAttribute() {
      return '';
    }
  };
}

function createEnvironment() {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) {
      elements.set(id, createElement());
    }
    return elements.get(id);
  };

  global.document = {
    getElementById: getElement,
    querySelectorAll: () => []
  };

  const state = {
        runtimeIssue: null,
        health: { status: 'ready' },
        hook: { agents: [] },
        dataPolicy: {
          contextId: null,
          workspaceResolved: false,
          syncPolicy: 'metadata_only',
          preset: 'lean',
          captureRetentionDays: 14,
          debugRetentionDays: 7,
          debugArtifactsEnabled: false,
          normalPathSummary: 'No active workspace yet. Machine capture defaults are ready, and workspace sync stays metadata_only once a workspace is active.',
          workspaceSyncSummary: 'No active workspace yet',
          workspaceSyncHint: 'Metadata Only (default) becomes the workspace default after a workspace is active.',
          machineCaptureSummary: '14d local capture; debug trails off by default (7d if enabled)',
          debugUtilitySummary: 'Off in the normal path (7d retention if enabled)',
          policyActionHint: 'Full sync is available only after a workspace is active.'
        },
        contexts: [
          { id: 'ctx-1', name: 'Repo One', paths: ['C:/repo-one'], syncPolicy: 'metadata_only', createdAt: Date.now() - 1_000 },
          { id: 'ctx-2', name: 'Repo Two', paths: ['C:/repo-two'], syncPolicy: 'full_sync', createdAt: Date.now() - 2_000 }
        ],
        activeContextId: 'ctx-1',
        workspaceComparison: null,
        workspaceComparisonTargetContextId: '',
        branches: [{ branch: 'main' }],
        allSessions: [{ sessionId: 'session-1' }]
      };

  global.window = {
    OctxDesktop: {
      state,
      activeContext: () => state.contexts.find((item) => item.id === state.activeContextId) || null,
      isGaIntegration: () => true,
      integrationLabel: (value) => String(value || ''),
      integrationListText: () => 'none',
      formatIntegrationNote: (value) => value || '',
      zeroTouchState: () => ({ ready: true, label: 'Ready', detail: 'Repo-first path active', nextAction: 'None' }),
      formatPosture: (value) => value,
      formatSyncPolicyLabel: (policy) => String(policy || '').trim().toLowerCase() === 'full_sync' ? 'Full Sync (opt-in)' : 'Metadata Only (default)',
      formatDataPolicyPresetLabel: (preset) => String(preset || '').trim().toLowerCase() === 'shared' ? 'Shared' : 'Lean',
      describeWorkspaceSyncDisplay,
      describeDesktopPolicyHint,
      enableCommand: () => '0ctx enable',
      capturePolicySummary: () => '14-day capture retention, debug artifacts off',
      dataPolicyActionHint: () => 'Keep workspace sync metadata-only until full sync is explicitly needed.',
      matches: () => true,
      esc: (value) => String(value || ''),
      renderMetaLine: () => '',
      renderChip: () => '',
      short: (value) => String(value || ''),
      humanizeLabel: (value) => String(value || ''),
      formatRelativeTime: () => 'just now',
      methodSupported: () => true,
      contextById: (id) => state.contexts.find((item) => item.id === id) || null,
      syncWorkspaceComparisonTargetSelection: () => state.contexts.find((item) => item.id === state.workspaceComparisonTargetContextId) || null,
      workspaceComparisonTargetContext: () => state.contexts.find((item) => item.id === state.workspaceComparisonTargetContextId) || null
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

describe('desktop policy renderers', () => {
  it('shows policy mode and unresolved workspace sync on setup', () => {
    const { getElement } = createEnvironment();
    loadScript('../src/app/render/setup.js');

    global.window.OctxDesktop.renderSetup();

    expect(getElement('policySummaryBadge').textContent).toBe('Lean');
    expect(getElement('policyDetailList').innerHTML).toContain('Policy mode');
    expect(getElement('policyDetailList').innerHTML).toContain('No active workspace yet');
    expect(getElement('policyDetailList').innerHTML).toContain('Off in the normal path');
    expect(getElement('policyHint').textContent).toContain('No active workspace yet.');
    expect(getElement('policyHint').textContent).toContain('Full sync is available only after a workspace is active.');
  });

  it('shows the same honest workspace-sync copy on the workspaces screen', () => {
    const { getElement } = createEnvironment();
    loadScript('../src/app/render/workspaces.js');

    global.window.OctxDesktop.renderWorkspaces();

    expect(getElement('workspacePolicySummaryBadge').textContent).toBe('Lean');
    expect(getElement('workspacePolicyDetailList').innerHTML).toContain('Policy mode');
    expect(getElement('workspacePolicyDetailList').innerHTML).toContain('No active workspace yet');
    expect(getElement('workspacePolicyDetailList').innerHTML).toContain('Off in the normal path');
    expect(getElement('workspacePolicyHint').textContent).toContain('No active workspace yet.');
    expect(getElement('workspacePolicyHint').textContent).toContain('Full sync is available only after a workspace is active.');
  });
});
