(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
  const { state, GA_INTEGRATIONS, REQUIRED_RUNTIME_METHODS, VIEW_META, short, splitConversationText, formatTime, formatRelativeTime, humanizeLabel, chipToneForAgent, chipToneForRole, basenameFromPath, commitShort, describeWorkingTreeState, describeWorkstreamCheckout, describeWorkstreamSync, describeWorkstreamActionHint } = app;

  function bindById(id, eventName, handler) {
    const element = document.getElementById(id);
    if (!element) {
      return null;
    }
    element.addEventListener(eventName, handler);
    return element;
  }

  function matches(value) {
    if (!state.q) return true;
    return String(value ?? '').toLowerCase().includes(state.q.toLowerCase());
  }

  function activeContext() {
    return state.contexts.find((item) => item.id === state.activeContextId) || null;
  }

  function selectedTurn() {
    return state.turns.find((item) => item.nodeId === state.activeTurnId) || null;
  }

  function branchKey(branch, worktreePath) {
    return JSON.stringify([String(branch || ''), String(worktreePath || '')]);
  }

  function normalizeBranch(value) {
    const branch = String(value || '').trim();
    return branch || 'detached';
  }

  function activeBranch() {
    return state.branches.find((item) => branchKey(item.branch, item.worktreePath) === state.activeBranchKey) || null;
  }

  function comparisonTargetBranch() {
    return state.branches.find((item) => branchKey(item.branch, item.worktreePath) === state.comparisonTargetKey) || null;
  }

  function activeSession() {
    return state.sessions.find((item) => item.sessionId === state.activeSessionId)
      || state.allSessions.find((item) => item.sessionId === state.activeSessionId)
      || null;
  }

  function selectedCheckpoint() {
    return state.checkpoints.find((item) => item.checkpointId === state.activeCheckpointId)
      || state.checkpointDetail?.checkpoint
      || null;
  }

  function activeInsightNode() {
    return state.insights.find((node) => (node.nodeId || node.id) === state.activeInsightNodeId)
      || state.graphNodes.find((node) => node.id === state.activeInsightNodeId)
      || null;
  }

  function contextById(contextId) {
    return state.contexts.find((context) => context.id === contextId) || null;
  }

  function workspaceComparisonTargetContext() {
    return state.contexts.find((context) => context.id === state.workspaceComparisonTargetContextId) || null;
  }

  function extractTagValue(tags, prefix) {
    const values = Array.isArray(tags) ? tags : [];
    const tag = values.find((value) => typeof value === 'string' && value.startsWith(prefix));
    return tag ? tag.slice(prefix.length) : null;
  }

  function insightSummary(node) {
    if (!node) {
      return {
        title: 'Choose an insight',
        summary: '',
        key: '',
        type: '',
        source: '',
        branch: null,
        worktreePath: null,
        originContextId: null,
        originNodeId: null,
        createdAt: null,
        evidenceCount: 0,
        distinctEvidenceCount: 0,
        corroboratedRoles: [],
        latestEvidenceAt: null,
        trustTier: 'weak',
        trustSummary: 'No reviewed insight selected.'
      };
    }
    const nodeId = node.nodeId || node.id || '';
    const combined = cleanConversationText(node.content || '');
    return {
      title: short(node.key || combined || nodeId || 'Insight', 80),
      summary: short(combined || 'No insight text is stored for this node yet.', 220),
      key: node.key || '',
      type: node.type || 'artifact',
      source: extractTagValue(node.tags, 'source:') || node.source || 'workspace',
      branch: extractTagValue(node.tags, 'branch:'),
      worktreePath: extractTagValue(node.tags, 'worktree:'),
      originContextId: extractTagValue(node.tags, 'origin_context:'),
      originNodeId: extractTagValue(node.tags, 'origin_node:'),
      createdAt: node.createdAt || null,
      evidenceCount: Number(node.evidenceCount || 0),
      distinctEvidenceCount: Number(node.distinctEvidenceCount || node.evidenceCount || 0),
      corroboratedRoles: Array.isArray(node.corroboratedRoles) ? node.corroboratedRoles : [],
      latestEvidenceAt: node.latestEvidenceAt || null,
      trustTier: node.trustTier || 'weak',
      trustSummary: node.trustSummary || 'No linked evidence messages yet.'
    };
  }

  function insightTargetContexts() {
    return state.contexts.filter((context) => context.id !== state.activeContextId);
  }

  function syncInsightSelection(nodes) {
    const available = Array.isArray(nodes) ? nodes : [];
    if (available.length === 0) {
      state.activeInsightNodeId = null;
      return null;
    }
    const exists = available.find((node) => (node.nodeId || node.id) === state.activeInsightNodeId);
    if (exists) return exists;
    state.activeInsightNodeId = available[0].nodeId || available[0].id;
    return available[0];
  }

  function syncPromotionTargetSelection() {
    const targets = insightTargetContexts();
    if (targets.length === 0) {
      state.promotionTargetContextId = null;
      return null;
    }
    const existing = targets.find((context) => context.id === state.promotionTargetContextId);
    if (existing) return existing;
    state.promotionTargetContextId = targets[0].id;
    return targets[0];
  }

  function workspaceComparisonTargets() {
    return state.contexts.filter((context) => context.id !== state.activeContextId);
  }

  function syncWorkspaceComparisonTargetSelection() {
    const targets = workspaceComparisonTargets();
    if (targets.length === 0) {
      state.workspaceComparisonTargetContextId = null;
      state.workspaceComparison = null;
      return null;
    }
    const existing = targets.find((context) => context.id === state.workspaceComparisonTargetContextId);
    if (existing) {
      return existing;
    }
    state.workspaceComparisonTargetContextId = targets[0].id;
    return targets[0];
  }

  function installedAgents() {
    return Array.isArray(state.hook?.agents) ? state.hook.agents.filter((agent) => agent.installed) : [];
  }

  function isGaIntegration(agent) {
    return GA_INTEGRATIONS.has(String(agent || '').toLowerCase());
  }

  function installedGaAgents() {
    return installedAgents().filter((agent) => isGaIntegration(agent.agent));
  }

  function autoContextGaAgents() {
    return installedGaAgents().filter((agent) => agent.sessionStartInstalled === true);
  }

  function integrationLabel(agent) {
    return humanizeLabel(agent);
  }

  function formatIntegrationNote(note) {
    const value = String(note || '').trim().toLowerCase();
    if (!value) return '';
    if (value === 'installed') return 'Installed';
    if (value === 'supported') return 'Supported';
    if (value === 'not-selected') return 'Not selected';
    return '';
  }

  function methodSupported(method) {
    return Array.isArray(state.caps) && state.caps.includes(method);
  }

  function missingRequiredMethods() {
    return REQUIRED_RUNTIME_METHODS.filter((method) => !methodSupported(method));
  }

  function integrationListText(agents) {
    return agents.map((agent) => integrationLabel(agent.agent)).join(', ');
  }

  function hasLocalRuntimeData() {
    return state.contexts.length > 0 || state.allSessions.length > 0 || Boolean(state.storage?.dbPath);
  }

  function formatPosture(value) {
    const posture = String(value || 'offline').toLowerCase();
    if (posture === 'connected') return 'Connected';
    if (posture === 'degraded') return 'Degraded';
    if (hasLocalRuntimeData()) return 'Local';
    return 'Offline';
  }

  function postureClass(value) {
    const posture = String(value || 'offline').toLowerCase();
    if (posture === 'connected') return 'badge connected';
    if (posture === 'degraded') return 'badge degraded';
    if (hasLocalRuntimeData()) return 'badge local';
    return 'badge offline';
  }

  function formatSyncPolicyLabel(policy) {
    const value = String(policy || '').trim().toLowerCase();
    if (value === 'full_sync') return 'Full Sync (opt-in)';
    if (value === 'local_only') return 'Local Only';
    return 'Metadata Only (default)';
  }

  function formatDataPolicyPresetLabel(preset) {
    const value = String(preset || '').trim().toLowerCase();
    if (value === 'lean') return 'Lean (default)';
    if (value === 'review') return 'Review';
    if (value === 'debug') return 'Debug';
    if (value === 'shared') return 'Shared (opt-in)';
    return 'Custom';
  }

  function captureState() {
    const gaHooks = installedGaAgents();
    if (state.sessions.length > 0) {
      return {
        label: 'Live',
        className: 'badge connected',
        detail: `${state.sessions.length} captured session${state.sessions.length === 1 ? '' : 's'}`
      };
    }
    if (gaHooks.length > 0) {
      return {
        label: 'Armed',
        className: 'badge degraded',
        detail: `GA integrations installed for ${integrationListText(gaHooks)}`
      };
    }
    return {
      label: 'Not ready',
      className: 'badge offline',
      detail: 'No GA integrations installed'
    };
  }

  function zeroTouchState() {
    const context = activeContext();
    const repoBound = Array.isArray(context?.paths) && context.paths.some((value) => String(value || '').trim().length > 0);
    const gaHooks = installedGaAgents();
    const autoContextHooks = autoContextGaAgents();
    const runtimeReady = !state.runtimeIssue;
    const signedIn = state.auth.authenticated === true;
    const syncPolicy = String(state.dataPolicy?.syncPolicy || context?.syncPolicy || 'metadata_only').trim().toLowerCase();

    if (!repoBound) {
      return {
        label: 'Needs one-time setup',
        className: 'badge offline',
        detail: 'Bind this repo to a workspace first.',
        nextAction: 'Choose a repository folder and create or select the matching workspace.',
        ready: false
      };
    }

    if (!signedIn) {
      return {
        label: 'Needs one-time setup',
        className: 'badge degraded',
        detail: 'Sign in on this machine.',
        nextAction: 'Run 0ctx enable in this repo to restore the normal capture path.',
        ready: false
      };
    }

    if (!runtimeReady) {
      return {
        label: 'Needs one-time setup',
        className: 'badge degraded',
        detail: 'Local runtime needs attention.',
        nextAction: state.runtimeIssue?.detail || 'Repair or restart the local runtime, then rerun 0ctx enable in this repo.',
        ready: false
      };
    }

    if (gaHooks.length === 0) {
      return {
        label: 'Needs one-time setup',
        className: 'badge degraded',
        detail: 'No GA integration is installed for this repo.',
        nextAction: 'Run 0ctx enable in this repo to install the supported integrations you actually use.',
        ready: false
      };
    }

    if (autoContextHooks.length === 0) {
      return {
        label: 'Needs one-time setup',
        className: 'badge degraded',
        detail: 'Capture is installed, but automatic workstream context injection is missing.',
        nextAction: `Repair ${integrationListText(gaHooks)} to restore SessionStart context injection.`,
        ready: false
      };
    }

    return {
      label: 'Ready for zero-touch',
      className: 'badge connected',
      detail: `${integrationListText(autoContextHooks)} will capture and receive workstream context automatically.`,
      nextAction: syncPolicy === 'full_sync'
        ? 'This workspace is opted into richer cloud sync. Return to Lean when that is no longer needed.'
        : 'Use the supported agent normally. 0ctx will inject the current workstream and capture new sessions automatically.',
      ready: true
    };
  }

  function automaticContextState() {
    const gaHooks = autoContextGaAgents();
    if (gaHooks.length > 0) {
      return `${integrationListText(gaHooks)} inject the current workstream automatically at session start`;
    }
    return 'No supported integration is installed for automatic workstream context';
  }

  function capturePolicySummary() {
    const policy = state.dataPolicy || state.hook?.capturePolicy || {};
    const captureDays = Number.isFinite(policy.captureRetentionDays) ? policy.captureRetentionDays : 14;
    const debugDays = Number.isFinite(policy.debugRetentionDays) ? policy.debugRetentionDays : 7;
    if (policy.debugArtifactsEnabled === true) {
      return `${captureDays}d local capture kept; ${debugDays}d debug trails enabled`;
    }
    return `${captureDays}d local capture kept; debug trails off by default (${debugDays}d if enabled)`;
  }

  function dataPolicyActionHint(policyInput) {
    const policy = policyInput || state.dataPolicy || state.hook?.capturePolicy || {};
    const preset = String(policy.preset || '').trim().toLowerCase();
    const syncPolicy = String(policy.syncPolicy || '').trim().toLowerCase();
    const captureDays = Number.isFinite(policy.captureRetentionDays) ? policy.captureRetentionDays : 14;
    const debugDays = Number.isFinite(policy.debugRetentionDays) ? policy.debugRetentionDays : 7;
    const debugEnabled = policy.debugArtifactsEnabled === true;

    if (preset === 'custom') {
      return 'Choose Lean, Review, or Debug to return machine defaults to a supported path. Use Shared only when a workspace explicitly needs richer cloud sync.';
    }
    if (preset === 'shared' || syncPolicy === 'full_sync') {
      return 'Return this workspace to Lean when it no longer needs richer cloud sync.';
    }
    if (preset === 'debug' || debugEnabled) {
      return 'Return this machine to Lean when troubleshooting is complete.';
    }
    if (preset === 'review' || captureDays > 14 || debugDays > 7) {
      return 'Return this machine to Lean when the longer local review window is no longer needed.';
    }
    return '';
  }

  function debugArtifactsEnabled() {
    const policy = state.dataPolicy || state.hook?.capturePolicy || {};
    return policy.debugArtifactsEnabled === true;
  }

  function currentRepoRoot() {
    const context = activeContext();
    const fromContext = Array.isArray(context?.paths) ? context.paths.find((value) => String(value || '').trim().length > 0) : null;
    return fromContext || state.hook?.projectRoot || '<repo-root>';
  }

  function enableCommand() {
    return `0ctx enable --repo-root "${currentRepoRoot()}"`;
  }

  function describeBranchLane(lane) {
    const title = lane?.isDetachedHead && lane?.currentHeadSha
      ? `detached HEAD @ ${commitShort(lane.currentHeadSha)}`
      : lane?.worktreePath
      ? `${normalizeBranch(lane.branch)} | ${basenameFromPath(lane.worktreePath)}`
      : normalizeBranch(lane?.branch);
    const syncState = describeWorkstreamSync(lane);
    const preview = lane?.lastAgent
      ? `${lane.lastAgent} touched this workstream most recently.${syncState ? ` ${syncState}.` : ''}`
      : syncState || 'No agent activity recorded yet for this workstream.';
    return {
      title,
      preview,
      timeRange: formatTime(lane?.lastActivityAt)
    };
  }

  function syncComparisonTargetSelection() {
    const source = activeBranch();
    if (!source) {
      state.comparisonTargetKey = null;
      state.branchComparison = null;
      return;
    }
    const sourceKey = branchKey(source.branch, source.worktreePath);
    const candidates = state.branches.filter((lane) => branchKey(lane.branch, lane.worktreePath) !== sourceKey);
    if (candidates.length === 0) {
      state.comparisonTargetKey = null;
      state.branchComparison = null;
      return;
    }
    if (!state.comparisonTargetKey || !candidates.some((lane) => branchKey(lane.branch, lane.worktreePath) === state.comparisonTargetKey)) {
      const preferred = candidates.find((lane) => lane.isCurrent === true) || candidates[0];
      state.comparisonTargetKey = branchKey(preferred.branch, preferred.worktreePath);
    }
  }

  function describeCheckpoint(checkpoint) {
    return {
      title: short(checkpoint?.summary || checkpoint?.name || checkpoint?.checkpointId || 'Untitled checkpoint', 96),
      preview: checkpoint?.sessionId
        ? `Linked to session ${checkpoint.sessionId}.`
        : 'Checkpoint stored without a linked session.',
      timeRange: formatTime(checkpoint?.createdAt)
    };
  }

  function syncBranchSelectionFromSession(session) {
    if (!session) return;
    const key = branchKey(normalizeBranch(session.branch), session.worktreePath || null);
    if (state.branches.some((lane) => branchKey(lane.branch, lane.worktreePath) === key)) {
      state.activeBranchKey = key;
    }
  }

  function resetBranchScopedState() {
    state.comparisonTargetKey = null;
    state.branchComparison = null;
    state.activeSessionId = null;
    state.sessionDetail = null;
    state.sessionKnowledgePreview = null;
    state.sessionKnowledgeSelectedKeys = [];
    state.turns = [];
    state.activeTurnId = null;
    state.checkpoints = [];
    state.activeCheckpointId = null;
    state.checkpointDetail = null;
    state.checkpointSessionDetail = null;
    state.checkpointKnowledgePreview = null;
    state.checkpointKnowledgeSelectedKeys = [];
    state.activeInsightNodeId = null;
    state.promotionTargetContextId = null;
    state.lastInsightPromotion = null;
    state.handoff = [];
  }

  function setStatus(message) {
    document.getElementById('statusTxt').textContent = message;
    document.getElementById('statusTime').textContent = `Updated ${new Date().toLocaleTimeString()}`;
  }

  Object.assign(app, { bindById, matches, activeContext, selectedTurn, branchKey, normalizeBranch, activeBranch, comparisonTargetBranch, activeSession, selectedCheckpoint, activeInsightNode, contextById, workspaceComparisonTargetContext, extractTagValue, insightSummary, insightTargetContexts, syncInsightSelection, syncPromotionTargetSelection, workspaceComparisonTargets, syncWorkspaceComparisonTargetSelection, installedAgents, isGaIntegration, installedGaAgents, autoContextGaAgents, integrationLabel, formatIntegrationNote, methodSupported, missingRequiredMethods, integrationListText, hasLocalRuntimeData, formatPosture, postureClass, formatSyncPolicyLabel, formatDataPolicyPresetLabel, captureState, zeroTouchState, automaticContextState, capturePolicySummary, dataPolicyActionHint, debugArtifactsEnabled, currentRepoRoot, enableCommand, describeBranchLane, syncComparisonTargetSelection, describeCheckpoint, syncBranchSelectionFromSession, resetBranchScopedState, setStatus });
})();

