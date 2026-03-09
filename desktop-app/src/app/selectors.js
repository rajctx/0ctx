(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
  const { state, GA_INTEGRATIONS, REQUIRED_RUNTIME_METHODS, VIEW_META, short, splitConversationText, formatTime, formatRelativeTime, humanizeLabel, chipToneForAgent, chipToneForRole, basenameFromPath, commitShort, describeWorkingTreeState, describeWorkstreamCheckout, describeWorkstreamSync, describeWorkstreamActionHint } = app;

  function resetPayloadState() {
    state.payload = null;
    state.payloadNodeId = null;
    state.payloadExpanded = false;
  }

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
    return state.graphNodes.find((node) => node.id === state.activeInsightNodeId) || null;
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
        createdAt: null
      };
    }
    const combined = cleanConversationText(node.content || '');
    return {
      title: short(node.key || combined || node.id || 'Insight', 80),
      summary: short(combined || 'No insight text is stored for this node yet.', 220),
      key: node.key || '',
      type: node.type || 'artifact',
      source: extractTagValue(node.tags, 'source:') || node.source || 'workspace',
      branch: extractTagValue(node.tags, 'branch:'),
      worktreePath: extractTagValue(node.tags, 'worktree:'),
      originContextId: extractTagValue(node.tags, 'origin_context:'),
      originNodeId: extractTagValue(node.tags, 'origin_node:'),
      createdAt: node.createdAt || null
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
    const exists = available.find((node) => node.id === state.activeInsightNodeId);
    if (exists) return exists;
    state.activeInsightNodeId = available[0].id;
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

  function integrationType(agent) {
    return agent === 'codex' ? 'notify' : 'hook';
  }

  function integrationLabel(agent) {
    const base = humanizeLabel(agent);
    return agent === 'codex' ? `${base} notify` : `${base} hook`;
  }

  function formatIntegrationNote(note) {
    const value = String(note || '').trim().toLowerCase();
    if (!value) return '';
    if (value === 'installed') return 'Installed';
    if (value === 'supported') return 'Supported';
    if (value === 'not-selected') return 'Not selected';
    if (value === 'preview-installed') return 'Installed explicitly';
    if (value === 'preview-not-selected') return 'Not in the normal path';
    if (value === 'preview-hook') return 'Preview hook';
    if (value === 'preview-notify-archive') return 'Preview notify/archive';
    return humanizeLabel(value);
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
    }    return {
      label: 'Not ready',
      className: 'badge offline',
      detail: 'No installed integrations found'
    };
  }

  function automaticContextState() {
    const gaHooks = installedGaAgents();
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

  function debugArtifactsEnabled() {
    const policy = state.dataPolicy || state.hook?.capturePolicy || {};
    return policy.debugArtifactsEnabled === true;
  }

  function currentRepoRoot() {
    const context = activeContext();
    const fromContext = Array.isArray(context?.paths) ? context.paths.find((value) => String(value || '').trim().length > 0) : null;
    return fromContext || state.hook?.projectRoot || '<repo-root>';
  }

  function preferredClients() {
    const agents = installedGaAgents().map((agent) => agent.agent);
    if (agents.length > 0) {
      return [...new Set(agents)].join(',');
    }
    return 'factory,antigravity,claude';
  }

  function preferredAgent() {
    const installed = installedGaAgents();
    return (installed[0] || { agent: 'factory' }).agent;
  }

  function hookInstallCommand() {
    return `0ctx connector hook install --clients=${preferredClients()} --repo-root "${currentRepoRoot()}"`;
  }

  function enableCommand() {
    return `0ctx enable --repo-root "${currentRepoRoot()}"`;
  }

  function hookIngestCommand() {
    return `0ctx connector hook ingest --agent=${preferredAgent()} --repo-root "${currentRepoRoot()}" --payload '{"session":{"id":"demo-session"},"turn":{"id":"demo-turn-1"},"role":"assistant","content":"hello"}' --json`;
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
    resetPayloadState();
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

  Object.assign(app, { resetPayloadState, bindById, matches, activeContext, selectedTurn, branchKey, normalizeBranch, activeBranch, comparisonTargetBranch, activeSession, selectedCheckpoint, activeInsightNode, contextById, workspaceComparisonTargetContext, extractTagValue, insightSummary, insightTargetContexts, syncInsightSelection, syncPromotionTargetSelection, workspaceComparisonTargets, syncWorkspaceComparisonTargetSelection, installedAgents, isGaIntegration, installedGaAgents, integrationType, integrationLabel, formatIntegrationNote, methodSupported, missingRequiredMethods, integrationListText, hasLocalRuntimeData, formatPosture, postureClass, formatSyncPolicyLabel, formatDataPolicyPresetLabel, captureState, automaticContextState, capturePolicySummary, debugArtifactsEnabled, currentRepoRoot, preferredClients, preferredAgent, hookInstallCommand, enableCommand, hookIngestCommand, describeBranchLane, syncComparisonTargetSelection, describeCheckpoint, syncBranchSelectionFromSession, resetBranchScopedState, setStatus });
})();

