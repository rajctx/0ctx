function createEnvironment({ activeBranchKey, branchSelectionMode = 'auto', repoReadinessWorkstream = null, branches = [] }) {
  const daemonCalls = [];
  const state = {
    activeContextId: 'ctx-1',
    branches: [],
    activeBranchKey,
    branchSelectionMode,
    repoReadiness: {
      workstream: repoReadinessWorkstream
    }
  };

  global.window = {
    OctxDesktop: {
      state,
      branchKey: (branch, worktreePath) => JSON.stringify([String(branch || ''), String(worktreePath || '')]),
      activeBranch: () => state.branches.find((lane) => JSON.stringify([String(lane.branch || ''), String(lane.worktreePath || '')]) === state.activeBranchKey) || null,
      activeContext: () => ({ id: 'ctx-1', name: 'Inbox Agent' }),
      activeSession: () => null,
      comparisonTargetBranch: () => null,
      resetBranchScopedState: () => {},
      syncComparisonTargetSelection: () => {},
      syncWorkspaceComparisonTargetSelection: () => null,
      setRuntimeIssue: () => {},
      setStatus: () => {},
      missingRequiredMethods: () => [],
      ensureEventSubscription: async () => {},
      clearEventSubscription: async () => {},
      renderAll: () => {},
      requestDaemonStatus: async () => ({}),
      methodSupported: () => true,
      daemon: async (method) => {
        daemonCalls.push(method);
        if (method === 'listBranchLanes') {
          return branches;
        }
        return [];
      }
    }
  };

  return { state, daemonCalls };
}

function loadScript(relativePath) {
  const resolved = require.resolve(relativePath);
  delete require.cache[resolved];
  require(relativePath);
}

afterEach(() => {
  delete global.window;
});

describe('desktop branch follow behavior', () => {
  it('follows the repo readiness workstream while branch selection remains automatic', async () => {
    const { state } = createEnvironment({
      activeBranchKey: JSON.stringify(['main', '']),
      branchSelectionMode: 'auto',
      repoReadinessWorkstream: 'feature/redesign',
      branches: [
        { branch: 'feature/redesign', worktreePath: null },
        { branch: 'main', worktreePath: null }
      ]
    });

    loadScript('../src/app/loaders.js');
    await global.window.OctxDesktop.loadBranches();

    expect(state.activeBranchKey).toBe(JSON.stringify(['feature/redesign', '']));
    expect(state.branchSelectionMode).toBe('auto');
  });

  it('preserves manual branch selection even when repo readiness points at another workstream', async () => {
    const { state } = createEnvironment({
      activeBranchKey: JSON.stringify(['main', '']),
      branchSelectionMode: 'manual',
      repoReadinessWorkstream: 'feature/redesign',
      branches: [
        { branch: 'feature/redesign', worktreePath: null },
        { branch: 'main', worktreePath: null }
      ]
    });

    loadScript('../src/app/loaders.js');
    await global.window.OctxDesktop.loadBranches();

    expect(state.activeBranchKey).toBe(JSON.stringify(['main', '']));
    expect(state.branchSelectionMode).toBe('manual');
  });
});
