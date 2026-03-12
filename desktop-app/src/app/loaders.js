(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
  const { state, activeBranch, activeContext, activeSession, branchKey, comparisonTargetBranch, resetBranchScopedState, syncComparisonTargetSelection, syncWorkspaceComparisonTargetSelection, setRuntimeIssue, setStatus, missingRequiredMethods, ensureEventSubscription, clearEventSubscription, renderAll, requestDaemonStatus, daemon, methodSupported } = app;

  async function resolveContexts(status) {
    const statusContexts = Array.isArray(status?.contexts) ? status.contexts : [];
    if (statusContexts.length > 0) {
      return statusContexts;
    }
    try {
      const contexts = await daemon('listContexts', {});
      return Array.isArray(contexts) ? contexts : [];
    } catch {
      return statusContexts;
    }
  }

  async function loadBranchComparison() {
    const source = activeBranch();
    const target = comparisonTargetBranch();
    if (!state.activeContextId || !source || !target) {
      state.branchComparison = null;
      return;
    }
    state.branchComparison = await daemon('compareWorkstreams', {
      contextId: state.activeContextId,
      sourceBranch: source.branch,
      sourceWorktreePath: source.worktreePath,
      targetBranch: target.branch,
      targetWorktreePath: target.worktreePath,
      sessionLimit: 3,
      checkpointLimit: 2
    });
  }

  async function selectContext(id, silent = false) {
    if (!id) return;
    const changed = state.activeContextId !== id;
    state.activeContextId = id;
    await daemon('switchContext', { contextId: id });
    if (changed) {
      await ensureEventSubscription({ force: true });
    }
    if (!silent) {
      setStatus(`Switched workspace ${id}`);
    }
  }

  async function loadBranches() {
    if (!state.activeContextId) {
      state.branches = [];
      state.activeBranchKey = null;
      return;
    }
    const branches = await daemon('listBranchLanes', { contextId: state.activeContextId, limit: 300 });
    state.branches = Array.isArray(branches) ? branches : [];
    if (!state.activeBranchKey || !state.branches.some((lane) => branchKey(lane.branch, lane.worktreePath) === state.activeBranchKey)) {
      const first = state.branches[0] || null;
      state.activeBranchKey = first ? branchKey(first.branch, first.worktreePath) : null;
    }
    syncComparisonTargetSelection();
  }

  async function loadSessions() {
    if (!state.activeContextId) {
      state.allSessions = [];
      state.sessions = [];
      state.activeSessionId = null;
      state.sessionDetail = null;
      return;
    }

    const allSessions = await daemon('listChatSessions', { contextId: state.activeContextId, limit: 400 });
    state.allSessions = Array.isArray(allSessions) ? allSessions : [];
    const lane = activeBranch();
    if (lane) {
      const branchSessions = await daemon('listBranchSessions', {
        contextId: state.activeContextId,
        branch: lane.branch,
        worktreePath: lane.worktreePath,
        limit: 250
      });
      state.sessions = Array.isArray(branchSessions) ? branchSessions : [];
    } else {
      state.sessions = [...state.allSessions];
    }

    if (!state.activeSessionId || !state.sessions.some((session) => session.sessionId === state.activeSessionId)) {
      state.activeSessionId = state.sessions[0]?.sessionId || null;
      state.sessionKnowledgePreview = null;
      state.sessionKnowledgeSelectedKeys = [];
    }
  }

  async function loadSessionDetail() {
    if (!state.activeContextId || !state.activeSessionId) {
      state.sessionDetail = null;
      return;
    }
    state.sessionDetail = await getSessionDetailWithFallback(state.activeSessionId);
  }

  async function getSessionDetailWithFallback(sessionId) {
    if (!state.activeContextId || !sessionId) {
      return null;
    }
    return daemon('getSessionDetail', {
      contextId: state.activeContextId,
      sessionId
    });
  }

  async function loadTurns() {
    if (!state.activeContextId || !state.activeSessionId) {
      state.turns = [];
      state.activeTurnId = null;
      return;
    }
    const turns = await daemon('listSessionMessages', {
      contextId: state.activeContextId,
      sessionId: state.activeSessionId,
      limit: 500
    });
    state.turns = Array.isArray(turns) ? turns : [];
    if (!state.activeTurnId || !state.turns.some((turn) => turn.nodeId === state.activeTurnId)) {
      state.activeTurnId = state.turns[0]?.nodeId || null;
    }
  }

  async function loadCheckpoints() {
    if (!state.activeContextId) {
      state.checkpoints = [];
      state.activeCheckpointId = null;
      state.checkpointDetail = null;
      state.checkpointSessionDetail = null;
      return;
    }

    const lane = activeBranch();
    if (lane) {
      const checkpoints = await daemon('listBranchCheckpoints', {
        contextId: state.activeContextId,
        branch: lane.branch,
        worktreePath: lane.worktreePath,
        limit: 300
      });
      state.checkpoints = Array.isArray(checkpoints) ? checkpoints : [];
    } else {
      const checkpoints = await daemon('listCheckpoints', { contextId: state.activeContextId });
      state.checkpoints = Array.isArray(checkpoints)
        ? checkpoints.map((item) => ({
          checkpointId: item.id,
          contextId: item.contextId,
          branch: item.branch || null,
          worktreePath: item.worktreePath || null,
          sessionId: item.sessionId || null,
          commitSha: item.commitSha || null,
          createdAt: item.createdAt,
          summary: item.summary || item.name || item.id,
          kind: item.kind || 'legacy',
          name: item.name,
          agentSet: Array.isArray(item.agentSet) ? item.agentSet : []
        }))
        : [];
    }

    if (!state.activeCheckpointId || !state.checkpoints.some((checkpoint) => checkpoint.checkpointId === state.activeCheckpointId)) {
      state.activeCheckpointId = state.checkpoints[0]?.checkpointId || null;
      state.checkpointKnowledgePreview = null;
      state.checkpointKnowledgeSelectedKeys = [];
    }
  }

  async function loadCheckpointDetail() {
    if (!state.activeCheckpointId) {
      state.checkpointDetail = null;
      state.checkpointSessionDetail = null;
      return;
    }
    state.checkpointDetail = await daemon('getCheckpointDetail', { checkpointId: state.activeCheckpointId });
    const sessionId = state.checkpointDetail?.checkpoint?.sessionId || null;
    if (state.activeContextId && sessionId) {
      state.checkpointSessionDetail = await getSessionDetailWithFallback(sessionId);
    } else {
      state.checkpointSessionDetail = null;
    }
  }

  async function loadHandoff() {
    const lane = activeBranch();
    if (!state.activeContextId || !lane) {
      state.handoff = [];
      return;
    }
    const handoff = await daemon('getHandoffTimeline', {
      contextId: state.activeContextId,
      branch: lane.branch,
      worktreePath: lane.worktreePath,
      limit: 80
    });
    state.handoff = Array.isArray(handoff) ? handoff : [];
  }

  async function loadBranchComparisonSafe() {
    syncComparisonTargetSelection();
    await loadBranchComparison();
  }

  async function loadWorkspaceComparison() {
    if (!state.activeContextId || !methodSupported('compareWorkspaces')) {
      state.workspaceComparison = null;
      return;
    }
    const target = syncWorkspaceComparisonTargetSelection();
    if (!target?.id) {
      state.workspaceComparison = null;
      return;
    }
    state.workspaceComparison = await daemon('compareWorkspaces', {
      sourceContextId: state.activeContextId,
      targetContextId: target.id
    });
  }

  async function loadGraph() {
    if (!state.activeContextId) {
      state.graphNodes = [];
      state.graphEdges = [];
      return;
    }
    const graph = await daemon('getGraphData', {
      contextId: state.activeContextId,
      includeHidden: state.includeHidden
    });
    state.graphNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    state.graphEdges = Array.isArray(graph?.edges) ? graph.edges : [];
  }

  async function loadInsights() {
    if (!state.activeContextId) {
      state.insights = [];
      return;
    }
    const lane = activeBranch();
    const insights = await daemon('listWorkstreamInsights', {
      contextId: state.activeContextId,
      branch: lane?.branch || null,
      worktreePath: lane?.worktreePath || null,
      limit: 400
    });
    state.insights = Array.isArray(insights) ? insights : [];
  }

  async function loadHook() {
    try {
      state.hook = await daemon('getHookHealth', {});
    } catch {
      state.hook = null;
    }
  }

  async function loadDataPolicy() {
    try {
      state.dataPolicy = await daemon('getDataPolicy', state.activeContextId ? { contextId: state.activeContextId } : {});
    } catch {
      state.dataPolicy = null;
    }
  }

  async function loadRepoReadiness() {
    const context = activeContext();
    const repoRoot = Array.isArray(context?.paths) ? context.paths.find((value) => String(value || '').trim().length > 0) : null;
    if (!repoRoot && !state.activeContextId) {
      state.repoReadiness = null;
      return;
    }
    try {
      state.repoReadiness = await daemon('getRepoReadiness', {
        ...(repoRoot ? { repoRoot } : {}),
        ...(state.activeContextId ? { contextId: state.activeContextId } : {})
      });
    } catch {
      state.repoReadiness = null;
    }
  }

  async function refreshAll(options = {}) {
    const quiet = options.quiet === true;
    if (state.loading) return;
    state.loading = true;
    try {
      state.runtimeIssue = null;
      const status = await requestDaemonStatus();
      state.health = status?.health || {};
      state.contexts = await resolveContexts(status);
      state.caps = Array.isArray(status?.capabilities?.methods) ? status.capabilities.methods : [];
      state.storage = status?.storage || {};
      if (!state.activeContextId || !state.contexts.some((context) => context.id === state.activeContextId)) {
        state.activeContextId = state.contexts[0]?.id || null;
        resetBranchScopedState();
        state.branches = [];
        state.activeBranchKey = null;
      }
      if (state.activeContextId) {
        await selectContext(state.activeContextId, true);
      }
      await loadHook();
      const missingMethods = missingRequiredMethods();
      if (missingMethods.length > 0) {
        resetBranchScopedState();
        state.branches = [];
        state.allSessions = [];
        state.sessions = [];
        state.turns = [];
        state.checkpoints = [];
        state.graphNodes = [];
        state.graphEdges = [];
        state.dataPolicy = null;
        setRuntimeIssue(
          'Runtime update required',
          `This desktop build requires a newer local runtime. Reinstall or restart 0ctx, then reopen the app. Missing methods: ${missingMethods.join(', ')}.`
        );
        await clearEventSubscription({ quiet: true });
        renderAll();
        if (!quiet) {
          setStatus(`Runtime contract mismatch: ${missingMethods.join(', ')}`);
        }
        return;
      }
      const issues = [];

      const safeLoad = async (label, loader, onError) => {
        try {
          await loader();
        } catch (error) {
          if (typeof onError === 'function') onError();
          issues.push(`${label}: ${String(error)}`);
        }
      };

      await safeLoad('integrations', loadHook, () => {
        state.hook = null;
      });
      await safeLoad('data policy', loadDataPolicy, () => {
        state.dataPolicy = null;
      });
      await safeLoad('repo readiness', loadRepoReadiness, () => {
        state.repoReadiness = null;
      });
      await safeLoad('workspace comparison', loadWorkspaceComparison, () => {
        state.workspaceComparison = null;
      });
      await safeLoad('branches', loadBranches, () => {
        state.branches = [];
        state.activeBranchKey = null;
      });
      await safeLoad('sessions', loadSessions, () => {
        state.allSessions = [];
        state.sessions = [];
        state.activeSessionId = null;
        state.sessionDetail = null;
      });
      await safeLoad('session detail', loadSessionDetail, () => {
        state.sessionDetail = null;
      });
      await safeLoad('messages', loadTurns, () => {
        state.turns = [];
        state.activeTurnId = null;
      });
      await safeLoad('checkpoints', loadCheckpoints, () => {
        state.checkpoints = [];
        state.activeCheckpointId = null;
        state.checkpointDetail = null;
        state.checkpointSessionDetail = null;
      });
      await safeLoad('checkpoint detail', loadCheckpointDetail, () => {
        state.checkpointDetail = null;
        state.checkpointSessionDetail = null;
      });
      await safeLoad('handoff', loadHandoff, () => {
        state.handoff = [];
      });
      await safeLoad('workstream comparison', loadBranchComparisonSafe, () => {
        state.branchComparison = null;
      });
      await safeLoad('graph', loadGraph, () => {
        state.graphNodes = [];
        state.graphEdges = [];
      });
      await safeLoad('insights', loadInsights, () => {
        state.insights = [];
      });
      await ensureEventSubscription();
      renderAll();
      if (issues.length > 0) {
        if (!quiet) {
          setStatus(`Loaded with partial data: ${issues[0]}`);
        }
      } else if (!quiet) {
        setStatus('Refreshed local desktop data.');
      }
    } catch (error) {
      state.dataPolicy = null;
      if (!state.runtimeIssue) {
        setRuntimeIssue(
          'Runtime unavailable',
          'The desktop app could not reach the local daemon. Start or repair 0ctx, then reopen the app if the issue remains.'
        );
      }
      await clearEventSubscription({ quiet: true });
      renderAll();
      setStatus(`Bridge error: ${String(error)}`);
    } finally {
      state.loading = false;
    }
  }

  Object.assign(app, { resolveContexts, loadBranchComparison, selectContext, loadBranches, loadSessions, loadSessionDetail, getSessionDetailWithFallback, loadTurns, loadCheckpoints, loadCheckpointDetail, loadHandoff, loadBranchComparisonSafe, loadWorkspaceComparison, loadGraph, loadInsights, loadHook, loadDataPolicy, loadRepoReadiness, refreshAll });
})();
