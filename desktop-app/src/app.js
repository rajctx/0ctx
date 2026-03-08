const VIEW_META = {
  branches: {
    eyebrow: 'Workstreams',
    title: 'Workstreams',
    summary: 'Track workstreams by branch or worktree, then inspect which agent touched each workstream and when.',
    primaryLabel: 'Open sessions',
    primaryAction: 'go-sessions'
  },
  sessions: {
    eyebrow: 'Captured sessions',
    title: 'Sessions and messages',
    summary: 'Choose a session, read the message stream, and open advanced capture data only when you need deeper debugging detail.',
    primaryLabel: 'Create checkpoint',
    primaryAction: 'create-checkpoint'
  },
  checkpoints: {
    eyebrow: 'Checkpoints',
    title: 'Checkpoints',
    summary: 'Use restore points to explain a branch state or rewind a workspace to a known snapshot.',
    primaryLabel: 'Explain checkpoint',
    primaryAction: 'explain-checkpoint'
  },
  workspaces: {
    eyebrow: 'Workspace library',
    title: 'Projects and repository bindings',
    summary: 'Create a project once, bind its repo, and route future capture automatically.',
    primaryLabel: 'Create workspace',
    primaryAction: 'focus-create'
  },
  knowledge: {
    eyebrow: 'Insights utility',
    title: 'Reviewed insights',
    summary: 'Inspect the visible graph and reviewed insight nodes when you need durable project memory, not the raw conversation.',
    primaryLabel: 'Toggle hidden records',
    primaryAction: 'toggle-hidden'
  },
  setup: {
    eyebrow: 'Utilities',
    title: 'Enable and repair',
    summary: 'Enable this repo, install the integrations you actually use, or repair the local runtime when something is off.',
    primaryLabel: 'Copy enable command',
    primaryAction: 'copy-enable'
  }
};

const SEARCH_HINTS = {
  branches: 'Filter workstreams, agents, or commits',
  sessions: 'Filter sessions and messages',
  checkpoints: 'Filter checkpoints, sessions, or commits',
  workspaces: 'Filter projects by name or repository path',
  knowledge: 'Filter reviewed insights and graph nodes',
  setup: 'Filter agent integrations and utility actions'
};

const REQUIRED_RUNTIME_METHODS = [
  'listBranchLanes',
  'listBranchSessions',
  'listSessionMessages',
  'listBranchCheckpoints',
  'getSessionDetail',
  'getCheckpointDetail',
  'getHandoffTimeline',
  'previewSessionKnowledge',
  'extractSessionKnowledge',
  'previewCheckpointKnowledge',
  'extractCheckpointKnowledge'
];

const MUTATION_EVENT_TYPES = new Set([
  'ContextCreated',
  'ContextDeleted',
  'ContextSwitched',
  'NodeAdded',
  'NodeUpdated',
  'NodeDeleted',
  'EdgeAdded',
  'CheckpointSaved',
  'CheckpointRewound',
  'BackupCreated',
  'BackupRestored',
  'Mutation'
]);

const EVENT_POLL_MS = 2500;
const HEALTH_REFRESH_MS = 60000;
const GA_INTEGRATIONS = new Set(['claude', 'factory', 'antigravity']);
const PREVIEW_INTEGRATIONS = new Set(['codex', 'cursor', 'windsurf']);

let eventPollTimer = null;
let healthRefreshTimer = null;
let eventPollInFlight = false;

function initialView() {
  if (typeof window === 'undefined') {
    return 'workspaces';
  }
  const params = new URLSearchParams(window.location.search || '');
  const candidate = String(params.get('view') || window.location.hash.replace(/^#/, '') || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(VIEW_META, candidate) ? candidate : 'workspaces';
}

const state = {
  view: initialView(),
  q: '',
  loading: false,
  contexts: [],
  activeContextId: null,
  branches: [],
  activeBranchKey: null,
  comparisonTargetKey: null,
  branchComparison: null,
  allSessions: [],
  sessions: [],
  activeSessionId: null,
  sessionDetail: null,
  turns: [],
  activeTurnId: null,
  checkpoints: [],
  activeCheckpointId: null,
  checkpointDetail: null,
  checkpointSessionDetail: null,
  handoff: [],
  graphNodes: [],
  graphEdges: [],
  includeHidden: false,
  health: {},
  caps: [],
  auth: { authenticated: true, provider: 'local' },
  hook: null,
  runtimeIssue: null,
  sessionKnowledgePreview: null,
  sessionKnowledgeSelectedKeys: [],
  checkpointKnowledgePreview: null,
  checkpointKnowledgeSelectedKeys: [],
  activeInsightNodeId: null,
  promotionTargetContextId: null,
  lastInsightPromotion: null,
  payload: null,
  payloadNodeId: null,
  payloadExpanded: false,
  subscriptionId: null,
  subscriptionContextId: null,
  lastSeq: 0,
  storage: {}
};

const bridge = window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function'
  ? window.__TAURI__.core.invoke.bind(window.__TAURI__.core)
  : null;

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function short(value, max = 120) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function cleanConversationText(value) {
  return String(value ?? '')
    .replace(/```/g, ' ')
    .replace(/[`*_>#]/g, ' ')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitConversationText(value) {
  const combined = cleanConversationText(value);
  if (!combined) {
    return { prompt: '', reply: '', combined: '' };
  }

  for (const marker of [' -> ', ' => ', ' → ']) {
    const index = combined.indexOf(marker);
    if (index > 0 && index < combined.length - marker.length) {
      return {
        prompt: combined.slice(0, index).trim(),
        reply: combined.slice(index + marker.length).trim(),
        combined
      };
    }
  }

  return {
    prompt: '',
    reply: combined,
    combined
  };
}

function describeSession(session) {
  const parts = splitConversationText(session?.summary || '');
  return {
    title: short(parts.prompt || parts.reply || session?.sessionId || 'Untitled session', 96),
    preview: short(parts.reply || 'Open the session to inspect the latest captured turn.', 150),
    timeRange: `${formatTime(session?.startedAt)} to ${formatTime(session?.lastTurnAt)}`
  };
}

function describeTurn(turn) {
  const parts = splitConversationText(turn?.content || '');
  return {
    title: short(parts.prompt || parts.reply || turn?.nodeId || 'Untitled turn', 96),
    preview: short(parts.reply || 'No reply summary stored for this turn yet.', 170),
    prompt: parts.prompt,
    reply: parts.reply,
    combined: parts.combined
  };
}

function findAdjacentTurn(startIndex, step, role) {
  for (let index = startIndex + step; index >= 0 && index < state.turns.length; index += step) {
    const turn = state.turns[index];
    if (!turn) continue;
    if (!role || turn.role === role) {
      return turn;
    }
  }
  return null;
}

function describeSelectedTurn(turn) {
  const summary = describeTurn(turn);
  const index = state.turns.findIndex((entry) => entry.nodeId === turn.nodeId);
  const combinedText = summary.combined || summary.reply || summary.prompt || turn.content || '';

  if (turn.role === 'assistant') {
    const priorUser = findAdjacentTurn(index, -1, 'user');
    const priorSummary = priorUser ? describeTurn(priorUser) : null;
    return {
      title: summary.title,
      primaryLabel: 'Assistant message',
      primaryText: combinedText,
      secondaryLabel: 'Previous user message',
      secondaryText: priorSummary?.combined || priorSummary?.reply || priorUser?.content || 'No earlier user message was captured for this session.'
    };
  }

  if (turn.role === 'user') {
    const nextAssistant = findAdjacentTurn(index, 1, 'assistant');
    const nextSummary = nextAssistant ? describeTurn(nextAssistant) : null;
    return {
      title: summary.title,
      primaryLabel: 'User message',
      primaryText: combinedText,
      secondaryLabel: 'Next assistant message',
      secondaryText: nextSummary?.combined || nextSummary?.reply || nextAssistant?.content || 'No later assistant message is captured yet for this session.'
    };
  }

  const previousTurn = findAdjacentTurn(index, -1, null);
  const previousSummary = previousTurn ? describeTurn(previousTurn) : null;
  return {
    title: summary.title,
    primaryLabel: 'Captured message',
    primaryText: combinedText,
    secondaryLabel: 'Previous message',
    secondaryText: previousSummary?.combined || previousTurn?.content || 'No adjacent message available.'
  };
}

function basenameFromPath(value) {
  const text = String(value ?? '').trim().replace(/[\\/]+$/, '');
  if (!text) return '';
  const parts = text.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || text;
}

function humanizeLabel(value) {
  const text = String(value ?? '').trim();
  if (!text) return '-';
  return text
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatTime(value) {
  if (!value) return '-';
  const stamp = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(stamp)) return '-';
  return new Date(stamp).toLocaleString();
}

function formatRelativeTime(value) {
  if (!value) return 'Just now';
  const stamp = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(stamp)) return 'Unknown time';
  const diffMs = Date.now() - stamp;
  const future = diffMs < 0;
  const diff = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  const suffix = future ? 'from now' : 'ago';
  if (diff < minute) return future ? 'In under a minute' : 'Just now';
  if (diff < hour) return `${Math.round(diff / minute)}m ${suffix}`;
  if (diff < day) return `${Math.round(diff / hour)}h ${suffix}`;
  if (diff < 7 * day) return `${Math.round(diff / day)}d ${suffix}`;
  return formatTime(stamp);
}

function commitShort(value) {
  const text = String(value || '').trim();
  return text ? text.slice(0, 8) : '';
}

function chipToneForAgent(agent) {
  const value = String(agent || '').toLowerCase();
  if (!value) return 'beige';
  if (value.includes('codex')) return 'blue';
  if (value.includes('antigravity')) return 'purple';
  if (value.includes('factory') || value.includes('droid')) return 'green';
  return 'beige';
}

function chipToneForRole(role) {
  const value = String(role || '').toLowerCase();
  if (value === 'assistant') return 'blue';
  if (value === 'user') return 'orange';
  if (value === 'system') return 'beige';
  return 'beige';
}

function renderChip(label, tone = 'beige', options = {}) {
  if (label == null || label === '') return '';
  const classes = ['chip', `chip-${tone}`];
  if (options.mono) classes.push('text-mono');
  if (options.compact) classes.push('chip-compact');
  return `<span class="${classes.join(' ')}">${esc(label)}</span>`;
}

function renderMetaLine(parts, options = {}) {
  const values = Array.isArray(parts)
    ? parts.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (values.length === 0) return '';
  const classes = ['item-meta-line'];
  if (options.mono) classes.push('text-mono');
  return `<p class="${classes.join(' ')}">${esc(values.join(' · '))}</p>`;
}

function summarizeCheckoutPaths(paths) {
  const values = Array.isArray(paths)
    ? [...new Set(paths.map((value) => String(value || '').trim()).filter(Boolean))]
    : [];
  if (values.length === 0) return '';
  const labels = values.slice(0, 2).map((value) => basenameFromPath(value) || value);
  return values.length > 2 ? `${labels.join(', ')}...` : labels.join(', ');
}

function describeWorkstreamCheckout(lane) {
  if (!lane) return '';
  const paths = Array.isArray(lane.checkedOutWorktreePaths) ? lane.checkedOutWorktreePaths : [];
  if (lane.checkedOutHere === true && lane.checkedOutElsewhere === true) {
    const elsewhereCount = Math.max(0, paths.length - 1);
    return elsewhereCount > 0
      ? `Checked out here + ${elsewhereCount} other worktree${elsewhereCount === 1 ? '' : 's'}`
      : 'Checked out here';
  }
  if (lane.checkedOutHere === true) {
    return 'Checked out here';
  }
  if (lane.checkedOutElsewhere === true) {
    const labels = summarizeCheckoutPaths(paths);
    return labels ? `Checked out elsewhere (${labels})` : 'Checked out elsewhere';
  }
  if (paths.length === 0) {
    return 'Not checked out in a known worktree';
  }
  return '';
}

function describeWorkstreamSync(lane) {
  if (!lane) return '';
  const localChanges = describeWorkingTreeState(lane);
  const checkout = describeWorkstreamCheckout(lane);
  let summary = '';
  if (lane.isDetachedHead === true && lane.currentHeadSha) {
    summary = `Detached HEAD at ${commitShort(lane.currentHeadSha)}`;
  } else if (lane.headDiffersFromCaptured === true && lane.lastCommitSha && lane.currentHeadSha) {
    summary = `Capture drift: ${commitShort(lane.lastCommitSha)} -> ${commitShort(lane.currentHeadSha)}`;
  } else if (lane.baseline && typeof lane.baseline.summary === 'string' && lane.baseline.summary.trim()) {
    summary = lane.baseline.summary;
  } else if (typeof lane.aheadCount === 'number' && typeof lane.behindCount === 'number' && lane.upstream) {
    if (lane.aheadCount === 0 && lane.behindCount === 0) {
      summary = `In sync with ${lane.upstream}`;
    } else if (lane.aheadCount > 0 && lane.behindCount === 0) {
      summary = `${lane.aheadCount} ahead of ${lane.upstream}`;
    } else if (lane.aheadCount === 0 && lane.behindCount > 0) {
      summary = `${lane.behindCount} behind ${lane.upstream}`;
    } else {
      summary = `${lane.aheadCount} ahead / ${lane.behindCount} behind ${lane.upstream}`;
    }
  } else if (lane.isCurrent === true) {
    summary = 'Current local workstream';
  }

  if (checkout && summary && localChanges) {
    return `${checkout} - ${summary} - ${localChanges}`;
  }
  if (checkout && summary) {
    return `${checkout} - ${summary}`;
  }
  if (checkout && localChanges) {
    return `${checkout} - ${localChanges}`;
  }
  if (checkout) {
    return checkout;
  }
  if (summary && localChanges) {
    return `${summary} - ${localChanges}`;
  }
  if (summary) {
    return summary;
  }
  return localChanges;
}

function describeWorkingTreeState(lane) {
  if (!lane || lane.hasUncommittedChanges !== true) return '';
  const parts = [];
  if (typeof lane.stagedChangeCount === 'number' && lane.stagedChangeCount > 0) {
    parts.push(`${lane.stagedChangeCount} staged`);
  }
  if (typeof lane.unstagedChangeCount === 'number' && lane.unstagedChangeCount > 0) {
    parts.push(`${lane.unstagedChangeCount} unstaged`);
  }
  if (typeof lane.untrackedCount === 'number' && lane.untrackedCount > 0) {
    parts.push(`${lane.untrackedCount} untracked`);
  }
  return parts.join(', ');
}

function renderAgentChain(agentSet, lastAgent) {
  const ordered = Array.isArray(agentSet) && agentSet.length > 0
    ? [...new Set(agentSet.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))]
    : (lastAgent ? [lastAgent] : []);
  if (ordered.length === 0) {
    return renderChip('No agent', 'beige');
  }
  return `
    <div class="agent-chain">
      ${ordered.map((agent, index) => `
        ${index > 0 ? '<span class="arrow-separator">-></span>' : ''}
        ${renderChip(agent, chipToneForAgent(agent))}
      `).join('')}
    </div>
  `;
}

function activeSessionKnowledgePreview() {
  return state.sessionKnowledgePreview
    && state.sessionKnowledgePreview.sessionId === state.activeSessionId
    ? state.sessionKnowledgePreview
    : null;
}

function activeCheckpointKnowledgePreview() {
  return state.checkpointKnowledgePreview
    && state.checkpointKnowledgePreview.checkpointId === state.activeCheckpointId
    ? state.checkpointKnowledgePreview
    : null;
}

function selectedKnowledgeKeys(scope) {
  return scope === 'checkpoint'
    ? state.checkpointKnowledgeSelectedKeys
    : state.sessionKnowledgeSelectedKeys;
}

function setSelectedKnowledgeKeys(scope, keys) {
  const normalized = Array.isArray(keys)
    ? Array.from(new Set(keys.map((value) => String(value || '').trim()).filter(Boolean)))
    : [];
  if (scope === 'checkpoint') {
    state.checkpointKnowledgeSelectedKeys = normalized;
    return;
  }
  state.sessionKnowledgeSelectedKeys = normalized;
}

function selectKnowledgeCandidates(scope, mode) {
  const preview = scope === 'checkpoint' ? activeCheckpointKnowledgePreview() : activeSessionKnowledgePreview();
  if (!preview) return;
  let keys;
  if (mode === 'none') {
    keys = [];
  } else if (mode === 'new') {
    keys = preview.candidates.filter((candidate) => candidate.action === 'create').map((candidate) => candidate.key);
  } else {
    keys = preview.candidates.map((candidate) => candidate.key);
  }
  setSelectedKnowledgeKeys(scope, keys);
}

function formatConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return `${Math.round(numeric * 100)}% confidence`;
}

function confidenceTone(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'beige';
  if (numeric >= 0.85) return 'green';
  if (numeric >= 0.72) return 'blue';
  return 'orange';
}

function formatReason(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  return text.replace(/[_-]+/g, ' ');
}

function renderKnowledgeCandidates(candidates, scope) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return '<div class="empty-state">No extractable insight candidates were found in this source.</div>';
  }
  const selected = new Set(selectedKnowledgeKeys(scope));
  return candidates.map((candidate) => `
    <article class="list-item preview-candidate">
      <div class="preview-row">
        <input
          class="preview-toggle"
          type="checkbox"
          data-preview-toggle="true"
          data-preview-scope="${esc(scope)}"
          data-candidate-key="${esc(candidate.key)}"
          ${selected.has(candidate.key) ? 'checked' : ''}
        />
          <div>
            <div class="preview-meta">
              ${renderChip(candidate.type || 'node', candidate.action === 'create' ? 'green' : 'beige')}
              ${renderChip(candidate.action === 'create' ? 'new node' : 'already in graph', candidate.action === 'create' ? 'green' : 'orange')}
              ${candidate.confidence != null ? renderChip(formatConfidence(candidate.confidence), confidenceTone(candidate.confidence)) : ''}
              ${candidate.role ? renderChip(candidate.role, chipToneForRole(candidate.role)) : ''}
              ${candidate.messageId ? renderChip(short(candidate.messageId, 24), 'beige', { mono: true }) : ''}
            </div>
          <p class="preview-content">${esc(candidate.content || '')}</p>
          <div class="preview-footnote">
            <span>${esc(formatTime(candidate.createdAt))}</span>
            ${formatReason(candidate.reason) ? `<span>Why: ${esc(formatReason(candidate.reason))}</span>` : ''}
          </div>
        </div>
      </div>
    </article>
  `).join('');
}

function jsonText(value) {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value ?? '');
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function installedAgents() {
  return Array.isArray(state.hook?.agents) ? state.hook.agents.filter((agent) => agent.installed) : [];
}

function isGaIntegration(agent) {
  return GA_INTEGRATIONS.has(String(agent || '').toLowerCase());
}

function isPreviewIntegration(agent) {
  return PREVIEW_INTEGRATIONS.has(String(agent || '').toLowerCase());
}

function installedGaAgents() {
  return installedAgents().filter((agent) => isGaIntegration(agent.agent));
}

function installedPreviewAgents() {
  return installedAgents().filter((agent) => isPreviewIntegration(agent.agent));
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
  if (value === 'preview-notify-archive') return 'Preview: notify + archive';
  if (value === 'preview-hook') return 'Preview integration';
  if (value === 'preview-installed') return 'Preview installed';
  if (value === 'preview-not-selected') return 'Preview optional';
  if (value === 'installed') return 'Installed';
  if (value === 'supported') return 'Supported';
  if (value === 'not-selected') return 'Not selected';
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

function captureState() {
  const gaHooks = installedGaAgents();
  const previewHooks = installedPreviewAgents();
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
  if (previewHooks.length > 0) {
    return {
      label: 'Not ready',
      className: 'badge offline',
      detail: 'No GA integrations installed for automatic capture'
    };
  }
  return {
    label: 'Not ready',
    className: 'badge offline',
    detail: 'No installed integrations found'
  };
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

async function loadBranchComparison() {
  const source = activeBranch();
  const target = comparisonTargetBranch();
  if (!state.activeContextId || !source || !target || !state.auth.authenticated) {
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

function setRuntimeIssue(title, detail) {
  state.runtimeIssue = {
    title: title || 'Runtime issue',
    detail: detail || 'The desktop app could not reach the local runtime.'
  };
}

async function invoke(command, payload = {}) {
  if (!bridge) {
    throw new Error('Tauri bridge unavailable. Start the desktop app with npm run dev.');
  }
  return bridge(command, payload);
}

async function daemon(method, params = {}) {
  return invoke('daemon_call', { method, params });
}

async function requestDaemonStatus(retries = 2) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await invoke('daemon_status', {});
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await delay(350 * (attempt + 1));
      }
    }
  }
  throw lastError;
}

function hasRelevantMutation(events) {
  return Array.isArray(events) && events.some((event) => {
    const type = String(event?.type || '').trim();
    if (MUTATION_EVENT_TYPES.has(type)) {
      return true;
    }
    const method = String(event?.payload?.method || '').trim();
    return method.length > 0;
  });
}

async function clearEventSubscription(options = {}) {
  const quiet = options.quiet === true;
  const subscriptionId = state.subscriptionId;
  state.subscriptionId = null;
  state.subscriptionContextId = null;
  state.lastSeq = 0;
  if (!subscriptionId || !bridge) {
    return;
  }
  try {
    await invoke('unsubscribe_events', { subscriptionId });
  } catch (error) {
    if (!quiet) {
      setStatus(`Event subscription cleanup failed: ${String(error)}`);
    }
  }
}

async function ensureEventSubscription(options = {}) {
  if (!bridge || state.runtimeIssue) {
    return;
  }
  const force = options.force === true;
  const targetContextId = state.activeContextId || null;
  if (!force && state.subscriptionId && state.subscriptionContextId === targetContextId) {
    return;
  }

  await clearEventSubscription({ quiet: true });
  const payload = {};
  if (targetContextId) {
    payload.contextId = targetContextId;
  }
  const result = await invoke('subscribe_events', payload);
  state.subscriptionId = result?.subscriptionId || null;
  state.subscriptionContextId = targetContextId;
  state.lastSeq = Number(result?.lastAckedSequence || 0) || 0;
}

async function refreshRuntimeHealth() {
  try {
    const status = await requestDaemonStatus(0);
    state.health = status?.health || {};
    state.caps = Array.isArray(status?.capabilities?.methods) ? status.capabilities.methods : [];
    state.storage = status?.storage || {};
    const contexts = Array.isArray(status?.contexts) ? status.contexts : [];
    const activeStillExists = state.activeContextId && contexts.some((context) => context.id === state.activeContextId);
    state.contexts = contexts;

    if (!activeStillExists) {
      state.activeContextId = contexts[0]?.id || null;
      state.activeBranchKey = null;
      resetBranchScopedState();
      state.branches = [];
      await ensureEventSubscription({ force: true });
      await refreshAll({ quiet: true });
      return;
    }

    const missingMethods = missingRequiredMethods();
    if (missingMethods.length > 0) {
      setRuntimeIssue(
        'Runtime update required',
        `This desktop build requires a newer local runtime. Reinstall or restart 0ctx, then reopen the app. Missing methods: ${missingMethods.join(', ')}.`
      );
    } else {
      state.runtimeIssue = null;
    }

    renderChrome();
    renderRuntimeBanner();
  } catch (error) {
    if (!state.runtimeIssue) {
      setRuntimeIssue(
        'Runtime unavailable',
        'The desktop app could not reach the local daemon. Start or repair 0ctx, then reopen the app if the issue remains.'
      );
    }
    renderChrome();
    renderRuntimeBanner();
  }
}

async function pollEventSubscription() {
  if (!bridge || state.loading || eventPollInFlight || state.runtimeIssue) {
    return;
  }
  if (!state.subscriptionId) {
    try {
      await ensureEventSubscription();
    } catch {
      return;
    }
  }
  if (!state.subscriptionId) {
    return;
  }

  eventPollInFlight = true;
  try {
    const result = await invoke('poll_events', {
      subscriptionId: state.subscriptionId,
      afterSequence: state.lastSeq,
      limit: 100
    });
    const cursor = Number(result?.cursor || state.lastSeq) || state.lastSeq;
    const events = Array.isArray(result?.events) ? result.events : [];
    if (cursor > state.lastSeq) {
      state.lastSeq = cursor;
      try {
        await invoke('ack_event', {
          subscriptionId: state.subscriptionId,
          sequence: cursor
        });
      } catch {
        // The app can continue using the local cursor even if explicit ack fails.
      }
    }
    if (hasRelevantMutation(events)) {
      await refreshAll({ quiet: true });
    }
  } catch (error) {
    const message = String(error || '');
    if (
      message.includes('Subscription')
      || message.includes('not found')
      || message.includes('No event subscription')
    ) {
      state.subscriptionId = null;
      state.subscriptionContextId = null;
      state.lastSeq = 0;
      try {
        await ensureEventSubscription({ force: true });
      } catch {
        // Leave recovery to the next poll or manual refresh.
      }
    }
  } finally {
    eventPollInFlight = false;
  }
}

function startBackgroundRefreshLoops() {
  if (!eventPollTimer) {
    eventPollTimer = setInterval(() => {
      void pollEventSubscription();
    }, EVENT_POLL_MS);
  }
  if (!healthRefreshTimer) {
    healthRefreshTimer = setInterval(() => {
      void refreshRuntimeHealth();
    }, HEALTH_REFRESH_MS);
  }
}

function setView(view) {
  state.view = view;
  renderAll();
}
function renderChrome() {
  const posture = String(state.health?.status || 'offline').toLowerCase();
  const postureText = formatPosture(posture);
  document.body.dataset.view = state.view;
  document.querySelector('.main-stage')?.setAttribute('data-view', state.view);
  const postureBadge = document.getElementById('postureBadge');
  const sidebarPosture = document.getElementById('sidebarPosture');
  postureBadge.className = postureClass(posture);
  postureBadge.textContent = postureText;
  sidebarPosture.className = postureClass(posture);
  sidebarPosture.textContent = postureText;
  document.getElementById('search').placeholder = SEARCH_HINTS[state.view] || 'Filter this screen';

  const select = document.getElementById('ctxSel');
  if (state.contexts.length === 0) {
    select.innerHTML = '<option value="">No workspaces</option>';
  } else {
    select.innerHTML = state.contexts
      .map((context) => `<option value="${esc(context.id)}">${esc(context.name || context.id)}</option>`)
      .join('');
    if (state.activeContextId) {
      select.value = state.activeContextId;
    }
  }

  document.querySelectorAll('.nav-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === state.view);
  });
  document.querySelectorAll('.view').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.view === state.view);
  });

  const context = activeContext();
  document.getElementById('sideWorkspaceName').textContent = context?.name || 'No workspace selected';
  const pathEl = document.getElementById('sideWorkspacePath');
  const workspacePath = Array.isArray(context?.paths) && context.paths.length > 0
    ? context.paths[0]
    : 'No repository folder bound.';
  pathEl.textContent = short(workspacePath, 56);
  pathEl.title = workspacePath;
  document.getElementById('sideWorkspaceBranches').textContent = String(state.branches.length);
  document.getElementById('sideWorkspaceSessions').textContent = String(state.allSessions.length);
  document.getElementById('sideBinding').textContent = Array.isArray(context?.paths) && context.paths.length > 0
    ? 'Bound to a repo path. Daily work now flows through workstreams, sessions, and checkpoints.'
    : 'Choose a repo folder to route future capture here automatically.';

  const auth = state.health?.auth;
  if (auth && typeof auth.authenticated === 'boolean') {
    state.auth = { authenticated: Boolean(auth.authenticated), provider: auth.provider || 'unknown' };
  } else {
    state.auth = { authenticated: true, provider: 'local' };
  }
  document.getElementById('authBanner').classList.toggle('hidden', state.auth.authenticated);
}

function renderHero() {
  const meta = VIEW_META[state.view] || VIEW_META.branches;
  const context = activeContext();
  document.getElementById('stageCrumbBase').textContent = state.view === 'workspaces'
    ? 'Workspace Library'
    : (context?.name || 'Workspace Library');
  document.getElementById('stageCrumbCurrent').textContent = state.view === 'workspaces'
    ? 'Overview'
    : meta.title;
  const primary = document.getElementById('heroPrimary');
  primary.textContent = meta.primaryLabel;
  primary.dataset.action = meta.primaryAction;
  primary.disabled =
    (meta.primaryAction === 'create-checkpoint' && !state.activeSessionId)
    || (meta.primaryAction === 'explain-checkpoint' && !state.activeCheckpointId);
}

function renderRuntimeBanner() {
  const banner = document.getElementById('runtimeBanner');
  if (!state.runtimeIssue) {
    banner.classList.add('hidden');
    return;
  }
  document.getElementById('runtimeBannerTitle').textContent = state.runtimeIssue.title;
  document.getElementById('runtimeBannerText').textContent = state.runtimeIssue.detail;
  banner.classList.remove('hidden');
}

  function renderBranches() {
    const branches = state.branches.filter((lane) => matches(`${lane.branch} ${lane.worktreePath || ''} ${lane.lastAgent || ''} ${lane.lastCommitSha || ''}`));
    const context = activeContext();
    document.getElementById('branchHeadline').textContent = `${branches.length} workstream${branches.length === 1 ? '' : 's'}`;
    document.getElementById('branchSessionCount').textContent = `${state.sessions.length} session${state.sessions.length === 1 ? '' : 's'}`;
  const branchesPageMeta = document.getElementById('branchesPageMeta');
  if (branchesPageMeta) {
    branchesPageMeta.textContent = state.runtimeIssue
      ? 'Update the local runtime to enable workstreams, workstream sessions, and handoff timelines.'
      : context
        ? `${context.name} has ${branches.length} tracked workstream${branches.length === 1 ? '' : 's'} in the current view.`
        : 'Choose a workspace to inspect branch-level work.';
  }

  document.getElementById('branchList').innerHTML = branches.length > 0
    ? branches.map((lane) => {
      const summary = describeBranchLane(lane);
      const key = branchKey(lane.branch, lane.worktreePath);
      return `
        <article class="list-item conversation-card branch-card ${key === state.activeBranchKey ? 'active' : ''}" data-branch-key="${esc(key)}">
          <p class="item-kicker">${esc(formatRelativeTime(lane.lastActivityAt))}</p>
          <h4 class="item-title">${esc(summary.title)}</h4>
          <p class="item-preview">${esc(summary.preview)}</p>
          ${renderMetaLine([
            `${lane.sessionCount} sessions`,
            `${lane.checkpointCount} checkpoints`,
            lane.lastAgent || '',
            lane.lastCommitSha ? `#${commitShort(lane.lastCommitSha)}` : '',
            describeWorkstreamSync(lane)
          ])}
        </article>
      `;
      }).join('')
      : state.runtimeIssue
        ? '<div class="empty-state">This desktop build needs a newer local runtime before workstreams can load.</div>'
        : '<div class="empty-state">No workstreams yet. Capture one agent session in this repo, then refresh.</div>';

  document.getElementById('branchSessionList').innerHTML = state.sessions.length > 0
    ? state.sessions.map((session) => {
      const summary = describeSession(session);
      return `
        <article class="list-item conversation-card ${session.sessionId === state.activeSessionId ? 'active' : ''}" data-session-id="${esc(session.sessionId)}" data-open-view="sessions">
          <p class="item-kicker">${esc(formatRelativeTime(session.lastTurnAt || session.startedAt))}</p>
          <h4 class="item-title">${esc(summary.title)}</h4>
          <p class="item-preview">${esc(summary.preview)}</p>
          ${renderMetaLine([
            `${session.turnCount || 0} messages`,
            session.agent || '',
            session.commitSha ? `#${commitShort(session.commitSha)}` : ''
          ])}
        </article>
      `;
      }).join('')
      : '<div class="empty-state">Select a workstream to inspect the sessions captured on it.</div>';

    if (state.runtimeIssue && branches.length === 0) {
      document.getElementById('branchDetailTitle').textContent = 'Update the local runtime';
      document.getElementById('branchLeadCopy').textContent = '';
      document.getElementById('branchMeta').innerHTML = '';
      document.getElementById('branchSessionList').innerHTML = '<div class="empty-state">Branch sessions will appear here after the local runtime is updated.</div>';
      document.getElementById('handoffList').innerHTML = '<div class="empty-state">Agent handoff history will appear here after the local runtime is updated.</div>';
      if (compareSelect) compareSelect.innerHTML = '<option value="">Unavailable</option>';
      if (compareEmpty) {
        compareEmpty.textContent = 'Workstream comparison will appear here after the local runtime is updated.';
        compareEmpty.classList.remove('hidden');
      }
      if (compareBody) compareBody.classList.add('hidden');
      document.getElementById('branchDetailEmpty').innerHTML = `
        <div class="empty-flow">
          <strong>Branch views need a newer runtime.</strong>
          <p>${esc(state.runtimeIssue.detail)}</p>
        <div class="row-actions">
          <button class="btn primary" data-banner-action="refresh">Refresh</button>
          <button class="btn tertiary" data-banner-action="setup">Open utilities</button>
        </div>
      </div>
    `;
      document.getElementById('branchDetailEmpty').classList.remove('hidden');
      document.getElementById('branchDetailBody').classList.add('hidden');
      return;
    }

    const lane = activeBranch();
    const comparisonTarget = comparisonTargetBranch();
    const detailBody = document.getElementById('branchDetailBody');
    const empty = document.getElementById('branchDetailEmpty');
    const compareSelect = document.getElementById('branchCompareSelect');
    const compareEmpty = document.getElementById('branchCompareEmpty');
    const compareBody = document.getElementById('branchCompareBody');
    if (!lane) {
      document.getElementById('branchDetailTitle').textContent = 'Choose a workstream';
      document.getElementById('branchLeadCopy').textContent = '';
      document.getElementById('branchMeta').innerHTML = '';
      document.getElementById('branchSessionList').innerHTML = '<div class="empty-state">Choose a workstream to see the captured sessions on it.</div>';
      document.getElementById('handoffList').innerHTML = '<div class="empty-state">No handoff history yet.</div>';
      if (compareSelect) compareSelect.innerHTML = '<option value="">Choose a workstream first</option>';
      if (compareEmpty) {
        compareEmpty.textContent = 'Select a workstream first, then compare it against another workstream in this workspace.';
        compareEmpty.classList.remove('hidden');
      }
      if (compareBody) compareBody.classList.add('hidden');
      empty.innerHTML = 'Select a workstream to inspect cross-agent activity and checkpoint coverage.';
      empty.classList.remove('hidden');
      detailBody.classList.add('hidden');
      return;
    }

    document.getElementById('branchDetailTitle').textContent = describeBranchLane(lane).title;
    document.getElementById('branchLeadCopy').textContent = [
      `${describeBranchLane(lane).title} carries ${lane.sessionCount} captured session${lane.sessionCount === 1 ? '' : 's'} and ${lane.checkpointCount} checkpoint${lane.checkpointCount === 1 ? '' : 's'}.`,
      lane.lastAgent ? `The most recent handoff came from ${lane.lastAgent}` : 'No agent has touched this workstream yet.',
      describeWorkstreamSync(lane) ? `${describeWorkstreamSync(lane)}.` : '',
      lane.lastActivityAt ? `${formatRelativeTime(lane.lastActivityAt)}.` : ''
    ].join(' ').trim();
    empty.classList.add('hidden');
    detailBody.classList.remove('hidden');
    const meta = [
      { label: 'Workstream', value: normalizeBranch(lane.branch) },
      { label: 'Checked-out HEAD', value: lane.currentHeadSha ? commitShort(lane.currentHeadSha) : 'unknown' },
      { label: 'HEAD ref', value: lane.currentHeadRef || (lane.isDetachedHead ? 'detached' : 'unknown') },
      { label: 'Checkout', value: describeWorkstreamCheckout(lane) || 'unknown' },
      { label: 'Last agent', value: lane.lastAgent || 'unknown' },
      { label: 'Latest commit', value: lane.lastCommitSha || 'none' },
      { label: 'Git state', value: describeWorkstreamSync(lane) || 'unknown' },
      { label: 'Capture drift', value: lane.headDiffersFromCaptured === true ? 'yes' : lane.headDiffersFromCaptured === false ? 'no' : 'unknown' },
      { label: 'Baseline', value: lane.baseline?.summary || 'No default-branch baseline available' },
      { label: 'Upstream', value: lane.upstream || 'not configured' },
      { label: 'Agents on workstream', value: lane.agentSet?.length ? lane.agentSet.join(', ') : 'none' },
      { label: 'Worktree', value: lane.worktreePath || 'Primary workspace root' }
    ];
  document.getElementById('branchMeta').innerHTML = meta.map((item) => `<article><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></article>`).join('');

  if (compareSelect) {
    const sourceKey = branchKey(lane.branch, lane.worktreePath);
    const comparisonCandidates = state.branches.filter((item) => branchKey(item.branch, item.worktreePath) !== sourceKey);
    compareSelect.innerHTML = comparisonCandidates.length > 0
      ? comparisonCandidates.map((item) => {
          const itemKey = branchKey(item.branch, item.worktreePath);
          return `<option value="${esc(itemKey)}"${itemKey === state.comparisonTargetKey ? ' selected' : ''}>${esc(describeBranchLane(item).title)}</option>`;
        }).join('')
      : '<option value="">No other workstreams yet</option>';
    compareSelect.disabled = comparisonCandidates.length === 0;
  }

  if (!comparisonTarget || !state.branchComparison) {
    if (compareEmpty) {
      compareEmpty.textContent = state.branches.length > 1
        ? 'Choose another workstream to compare git divergence, recent activity, and shared agents.'
        : 'A second workstream is needed before comparison is available.';
      compareEmpty.classList.remove('hidden');
    }
    if (compareBody) compareBody.classList.add('hidden');
  } else {
    const comparison = state.branchComparison;
    const comparisonSummary = document.getElementById('branchComparisonSummary');
    const comparisonMeta = document.getElementById('branchComparisonMeta');
    const comparisonAgents = document.getElementById('branchComparisonAgents');
    if (comparisonSummary) {
      comparisonSummary.textContent = comparison.comparisonText || 'No comparison summary is available for these workstreams.';
    }
    if (comparisonMeta) {
      const gitSummary = comparison.comparable && comparison.sameRepository
        ? [
            `source ahead ${comparison.sourceAheadCount ?? '?'}`,
            `target ahead ${comparison.targetAheadCount ?? '?'}`,
            comparison.mergeBaseSha ? `merge base #${commitShort(comparison.mergeBaseSha)}` : 'merge base unavailable',
            `newer ${comparison.newerSide}`
          ].join(' · ')
        : (comparison.sameRepository ? 'Git comparison unavailable' : 'Different repositories');
      comparisonMeta.innerHTML = [
        `<article><span>Source</span><strong>${esc(describeBranchLane(comparison.source).title)}</strong></article>`,
        `<article><span>Target</span><strong>${esc(describeBranchLane(comparison.target).title)}</strong></article>`,
        `<article><span>Git divergence</span><strong>${esc(gitSummary)}</strong></article>`,
        `<article><span>Shared agents</span><strong>${esc(comparison.sharedAgents.length > 0 ? comparison.sharedAgents.join(', ') : 'none')}</strong></article>`
      ].join('');
    }
    if (comparisonAgents) {
      comparisonAgents.innerHTML = [
        { label: 'Shared', value: comparison.sharedAgents },
        { label: 'Only on source', value: comparison.sourceOnlyAgents },
        { label: 'Only on target', value: comparison.targetOnlyAgents }
      ].map((item) => `<article><span>${esc(item.label)}</span><strong>${esc(item.value.length > 0 ? item.value.join(', ') : 'none')}</strong></article>`).join('');
    }
    if (compareEmpty) compareEmpty.classList.add('hidden');
    if (compareBody) compareBody.classList.remove('hidden');
  }

  document.getElementById('handoffList').innerHTML = state.handoff.length > 0
    ? state.handoff.map((entry) => `
        <article class="list-item conversation-card" data-session-id="${esc(entry.sessionId)}" data-open-view="sessions">
          <p class="item-kicker">${esc(formatRelativeTime(entry.lastTurnAt))}</p>
          <h4 class="item-title">${esc(entry.agent || 'unknown agent')}</h4>
          <p class="item-preview">${esc(short(entry.summary || 'No summary stored for this session.', 150))}</p>
          ${renderMetaLine([
            normalizeBranch(entry.branch),
            entry.agent || '',
            entry.commitSha ? `#${commitShort(entry.commitSha)}` : ''
          ])}
        </article>
      `).join('')
    : '<div class="empty-state">No handoff history recorded for this workstream yet.</div>';
}
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
  const toggle = document.getElementById('togglePayload');
  if (!turn) {
    document.getElementById('turnDetailTitle').textContent = 'Choose a message';
    empty.classList.remove('hidden');
    body.classList.add('hidden');
    toggle.disabled = true;
    toggle.textContent = 'Show debug payload';
    document.getElementById('payloadPanel').classList.add('hidden');
    document.getElementById('payloadText').textContent = 'Open debug mode on a selected message to inspect the stored payload.';
    document.getElementById('payloadBadge').textContent = 'none';
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
    { label: 'Debug payload', value: turn.hasPayload ? 'Available on demand' : 'No sidecar payload' },
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
    { label: 'Payload bytes', value: turn.payloadBytes != null ? String(turn.payloadBytes) : 'none' },
    { label: 'Visibility', value: turn.hidden ? 'Hidden by default' : 'Visible in insights view' }
  ];
  document.getElementById('turnTechnical').innerHTML = technical.map((item) => {
    return `<article><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></article>`;
  }).join('');

  toggle.disabled = !turn.hasPayload;
  toggle.textContent = turn.hasPayload ? (state.payloadExpanded ? 'Hide debug payload' : 'Show debug payload') : 'No debug payload';
  const payloadPanel = document.getElementById('payloadPanel');
  payloadPanel.classList.toggle('hidden', !turn.hasPayload || !state.payloadExpanded);
  document.getElementById('payloadBadge').textContent = turn.payloadBytes != null ? `${turn.payloadBytes} bytes` : 'payload';
  document.getElementById('payloadTitle').textContent = turn.hasPayload
    ? 'Captured sidecar payload'
    : 'No payload stored for this message';
  document.getElementById('payloadText').textContent = turn.hasPayload
    ? (state.payload ? jsonText(state.payload) : 'Debug payload not loaded yet.')
    : 'This message has no raw payload sidecar.';

  const preview = activeSessionKnowledgePreview();
  const previewPanel = document.getElementById('sessionKnowledgePreviewPanel');
  if (!preview) {
    previewPanel.classList.add('hidden');
    document.getElementById('sessionKnowledgePreviewBadge').textContent = '0 selected';
    document.getElementById('sessionKnowledgePreviewList').innerHTML = '';
  } else {
    previewPanel.classList.remove('hidden');
    const selectedCount = selectedKnowledgeKeys('session').length;
    document.getElementById('sessionKnowledgePreviewBadge').textContent = `${selectedCount} selected / ${preview.candidateCount}`;
    document.getElementById('sessionKnowledgePreviewList').innerHTML = renderKnowledgeCandidates(preview.candidates, 'session');
  }
}

function renderWorkspaces() {
  const contexts = state.contexts.filter((context) => matches(`${context.name || ''} ${(context.paths || []).join(' ')}`));
  const context = activeContext();
  const capture = captureState();
  document.getElementById('workspaceCount').textContent = `${contexts.length} workspace${contexts.length === 1 ? '' : 's'}`;
  const workspacesPageMeta = document.getElementById('workspacesPageMeta');
  if (workspacesPageMeta) {
    workspacesPageMeta.textContent = `${contexts.length} workspace${contexts.length === 1 ? '' : 's'} on this machine.${context ? ` Current selection: ${context.name}.` : ''}`;
  }

  document.getElementById('workspaceList').innerHTML = contexts.length > 0
    ? contexts.map((item) => {
      const pathList = Array.isArray(item.paths) ? item.paths.filter(Boolean) : [];
      const repoPath = pathList[0] || '';
      const isActive = item.id === state.activeContextId;
      const createdCopy = item.createdAt ? formatRelativeTime(item.createdAt) : 'Recently created';
      return `
        <article class="list-item conversation-card workspace-card-item ${isActive ? 'active' : ''}" data-context-id="${esc(item.id)}">
          <div class="workspace-card-head">
            <div>
              <p class="item-kicker">${esc(isActive ? 'Current workspace' : createdCopy)}</p>
              <h4 class="item-title">${esc(item.name || item.id)}</h4>
            </div>
            ${isActive ? renderChip('Selected', 'green') : ''}
          </div>
          <p class="item-preview">${esc(
            repoPath
              ? 'Repository binding is ready for automatic capture.'
              : 'Bind a repository folder to route future capture automatically.'
          )}</p>
          <div class="workspace-path text-mono">${esc(repoPath || 'No repository folder bound yet')}</div>
          ${renderMetaLine([
            repoPath ? 'Repo bound' : 'Needs repo',
            item.syncPolicy ? humanizeLabel(item.syncPolicy) : '',
            pathList.length > 1 ? `${pathList.length} paths` : ''
          ])}
        </article>
      `;
    }).join('')
    : '<div class="empty-state">No workspaces yet. Create one with a name and repository path.</div>';

  const focusItems = context
    ? [
        {
          title: 'Repository binding',
          detail: Array.isArray(context.paths) && context.paths.length > 0 ? context.paths.join(', ') : 'No repository folder bound yet',
          hint: Array.isArray(context.paths) && context.paths.length > 0
            ? 'Installed integrations resolve this workspace from the active repo path.'
            : 'Bind a repo path so capture can route here automatically.'
        },
        {
          title: 'Capture readiness',
          detail: `${capture.label} | ${capture.detail}`,
          hint: 'Capture state reflects the local runtime plus installed integrations.'
        },
        {
          title: 'Workstreams',
          detail: `${state.branches.length} tracked workstream${state.branches.length === 1 ? '' : 's'}`,
          hint: 'Branches and worktrees stay grouped as workstreams inside this workspace.'
        },
        {
          title: 'Captured sessions',
          detail: `${state.allSessions.length} session${state.allSessions.length === 1 ? '' : 's'}`,
          hint: 'All captured runs currently linked to this project.'
        },
        {
          title: 'Default sync policy',
          detail: humanizeLabel(context.syncPolicy || 'metadata_only'),
          hint: 'Local-first storage remains the source of truth.'
        }
      ]
    : [
        {
          title: 'No workspace selected',
          detail: 'Create a workspace and bind its repository path to begin automatic capture.',
          hint: 'Once a repo is bound, future sessions can route into it automatically.'
        }
      ];
  document.getElementById('workspaceFocus').innerHTML = focusItems.map((item) => {
    return `
      <article>
        <span>${esc(item.title)}</span>
        <strong>${esc(item.detail)}</strong>
        <p>${esc(item.hint || '')}</p>
      </article>
    `;
  }).join('');
}

  function renderCheckpoints() {
    const checkpoints = state.checkpoints.filter((checkpoint) => matches(`${checkpoint.summary || ''} ${checkpoint.name || ''} ${checkpoint.sessionId || ''} ${checkpoint.commitSha || ''}`));
    document.getElementById('checkpointHeadline').textContent = `${checkpoints.length} checkpoint${checkpoints.length === 1 ? '' : 's'}`;
    const checkpointsPageMeta = document.getElementById('checkpointsPageMeta');
  if (checkpointsPageMeta) {
    checkpointsPageMeta.textContent = state.activeCheckpointId
      ? 'Explain the selected checkpoint or rewind the workspace to its stored snapshot.'
      : `There are ${checkpoints.length} checkpoint${checkpoints.length === 1 ? '' : 's'} in the current view.`;
  }

  document.getElementById('checkpointList').innerHTML = checkpoints.length > 0
    ? checkpoints.map((checkpoint) => {
      const summary = describeCheckpoint(checkpoint);
      return `
        <article class="list-item conversation-card ${checkpoint.checkpointId === state.activeCheckpointId ? 'active' : ''}" data-checkpoint-id="${esc(checkpoint.checkpointId)}">
          <p class="item-kicker">${esc(formatRelativeTime(checkpoint.createdAt))}</p>
          <h4 class="item-title">${esc(summary.title)}</h4>
          <p class="item-preview">${esc(summary.preview)}</p>
          ${renderMetaLine([
            checkpoint.kind,
            checkpoint.sessionId ? 'linked session' : '',
            checkpoint.commitSha ? `#${commitShort(checkpoint.commitSha)}` : ''
          ])}
        </article>
      `;
    }).join('')
    : '<div class="empty-state">No checkpoints yet for this workstream.</div>';

  const sessionCard = document.getElementById('checkpointSessionCard');
  const linkedSession = state.checkpointSessionDetail?.session || activeSession();
  if (linkedSession && selectedCheckpoint()?.sessionId) {
    const summary = describeSession(linkedSession);
    sessionCard.innerHTML = `
      <article class="list-item conversation-card" data-session-id="${esc(linkedSession.sessionId)}" data-open-view="sessions">
        <p class="item-kicker">${esc(formatRelativeTime(linkedSession.lastTurnAt || linkedSession.startedAt))}</p>
        <h4 class="item-title">${esc(summary.title)}</h4>
        <p class="item-preview">${esc(summary.preview)}</p>
        ${renderMetaLine([
          `${linkedSession.turnCount || 0} messages`,
          linkedSession.agent || '',
          linkedSession.commitSha ? `#${commitShort(linkedSession.commitSha)}` : ''
        ])}
      </article>
    `;
  } else {
    sessionCard.innerHTML = '<div class="empty-state">This checkpoint is not linked to a captured session.</div>';
  }

  const detail = state.checkpointDetail;
  const empty = document.getElementById('checkpointDetailEmpty');
  const body = document.getElementById('checkpointDetailBody');
  const explainBtn = document.getElementById('explainCheckpointBtn');
  const previewBtn = document.getElementById('previewCheckpointKnowledgeBtn');
  const extractBtn = document.getElementById('extractCheckpointKnowledgeBtn');
  const rewindBtn = document.getElementById('rewindCheckpointBtn');
  if (explainBtn) {
    explainBtn.disabled = !state.activeCheckpointId;
  }
  if (previewBtn) {
    previewBtn.disabled = !state.activeCheckpointId;
  }
  if (extractBtn) {
    extractBtn.disabled = !state.activeCheckpointId;
  }
  if (rewindBtn) {
    rewindBtn.disabled = !state.activeCheckpointId;
  }

    if (!detail?.checkpoint) {
      document.getElementById('checkpointDetailTitle').textContent = 'Choose a checkpoint';
      document.getElementById('checkpointLeadCopy').textContent = '';
      document.getElementById('checkpointFactStrip').innerHTML = '';
      document.getElementById('checkpointMeta').innerHTML = '';
      document.getElementById('checkpointKnowledgePreviewPanel').classList.add('hidden');
      document.getElementById('checkpointKnowledgePreviewBadge').textContent = '0 candidates';
      document.getElementById('checkpointKnowledgePreviewList').innerHTML = '';
      empty.classList.remove('hidden');
    body.classList.add('hidden');
    return;
  }

    const checkpoint = detail.checkpoint;
    const checkpointSummary = describeCheckpoint(checkpoint);
    document.getElementById('checkpointDetailTitle').textContent = short(checkpoint.summary || checkpoint.name || checkpoint.id, 72);
    document.getElementById('checkpointLeadCopy').textContent = [
      checkpointSummary.title,
      checkpoint.branch
    ? `tracks the ${normalizeBranch(checkpoint.branch)} workstream`
        : 'captures a workspace snapshot',
      `from ${formatRelativeTime(checkpoint.createdAt)}.`,
      checkpoint.sessionId
        ? `It stays linked to the originating conversation so you can explain or rewind it without losing the surrounding context.`
        : `It can still be explained or rewound even without a linked captured conversation.`
    ].join(' ');
    empty.classList.add('hidden');
    body.classList.remove('hidden');
    document.getElementById('checkpointFactStrip').innerHTML = [
      { label: 'Snapshot', value: `${String(detail.snapshotNodeCount || 0)} nodes / ${String(detail.snapshotEdgeCount || 0)} edges` },
      { label: 'Linked session', value: checkpoint.sessionId ? short(checkpoint.sessionId, 28) : 'None' },
      { label: 'Commit', value: checkpoint.commitSha ? `#${commitShort(checkpoint.commitSha)}` : 'Unpinned' },
      { label: 'Agents', value: checkpoint.agentSet?.length ? checkpoint.agentSet.join(', ') : 'Unknown' }
    ].map((item) => `<article><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></article>`).join('');
    const meta = [
      { label: 'Kind', value: checkpoint.kind },
      { label: 'Branch', value: checkpoint.branch || 'none' },
      { label: 'Commit', value: checkpoint.commitSha || 'none' },
      { label: 'Created', value: formatTime(checkpoint.createdAt) },
    { label: 'Agents', value: checkpoint.agentSet?.length ? checkpoint.agentSet.join(', ') : 'none' },
    { label: 'Snapshot', value: `${String(detail.snapshotNodeCount || 0)} nodes, ${String(detail.snapshotEdgeCount || 0)} edges` },
    { label: 'Session', value: checkpoint.sessionId || 'none' },
    { label: 'Payload', value: detail.payloadAvailable ? 'Stored locally' : 'Missing' }
  ];
  document.getElementById('checkpointMeta').innerHTML = meta.map((item) => `<article><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></article>`).join('');

  const preview = activeCheckpointKnowledgePreview();
  const previewPanel = document.getElementById('checkpointKnowledgePreviewPanel');
  if (!preview) {
    previewPanel.classList.add('hidden');
    document.getElementById('checkpointKnowledgePreviewBadge').textContent = '0 selected';
    document.getElementById('checkpointKnowledgePreviewList').innerHTML = '';
  } else {
    previewPanel.classList.remove('hidden');
    const selectedCount = selectedKnowledgeKeys('checkpoint').length;
    document.getElementById('checkpointKnowledgePreviewBadge').textContent = `${selectedCount} selected / ${preview.candidateCount}`;
    document.getElementById('checkpointKnowledgePreviewList').innerHTML = renderKnowledgeCandidates(preview.candidates, 'checkpoint');
  }
}

  function renderKnowledge() {
    document.getElementById('inclHidden').checked = state.includeHidden;
    document.getElementById('knowledgeNodeCount').textContent = String(state.graphNodes.length);
    document.getElementById('knowledgeEdgeCount').textContent = String(state.graphEdges.length);
    document.getElementById('knowledgeContext').textContent = `Workspace: ${activeContext()?.name || 'none'}`;
    const nodes = state.graphNodes.filter((node) => matches(`${node.type || ''} ${node.content || ''} ${node.key || ''}`));
    const selectedNode = syncInsightSelection(nodes);
    const selectedInsight = insightSummary(selectedNode);
    const targetContexts = insightTargetContexts();
    const selectedTargetContext = syncPromotionTargetSelection();
    const promoteSupported = methodSupported('promoteInsight');
    const knowledgePageMeta = document.getElementById('knowledgePageMeta');
    if (knowledgePageMeta) {
      const context = activeContext();
      knowledgePageMeta.textContent = context
        ? `${context.name} currently exposes ${nodes.length} visible node${nodes.length === 1 ? '' : 's'} in the structured graph${state.includeHidden ? ', including hidden capture records.' : ', plus reviewed insights.'}`
        : 'Inspect the visible graph and reviewed insights stored in SQLite when you need durable project memory, not the raw conversation.';
    }

    const explainer = [
      {
        title: 'Use this for reviewed memory',
        detail: 'Insights are the durable structured layer: decisions, constraints, goals, assumptions, questions, and artifacts already written into the workspace.'
      },
      {
        title: 'Conversations stay separate by default',
        detail: 'Captured sessions and messages live in the same workspace, but stay hidden here unless you explicitly include hidden capture records.'
      },
      {
        title: 'Sessions and checkpoints feed this layer',
        detail: 'Use Sessions to read the conversation and Checkpoints to explain or rewind workspace state. Use Insights to inspect the memory that survives beyond a single run.'
      }
    ];
    document.getElementById('knowledgeExplainer').innerHTML = explainer.map((item) => {
      return `<article><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p></article>`;
    }).join('');

    const selectedInsightEmpty = document.getElementById('selectedInsightEmpty');
    const selectedInsightBody = document.getElementById('selectedInsightBody');
    if (!selectedNode) {
      selectedInsightEmpty.classList.remove('hidden');
      selectedInsightBody.classList.add('hidden');
      document.getElementById('selectedInsightTitle').textContent = 'Choose an insight';
      document.getElementById('selectedInsightCopy').textContent = '';
      document.getElementById('selectedInsightMeta').innerHTML = '';
    } else {
      selectedInsightEmpty.classList.add('hidden');
      selectedInsightBody.classList.remove('hidden');
      document.getElementById('selectedInsightTitle').textContent = selectedInsight.title;
      document.getElementById('selectedInsightCopy').textContent = selectedInsight.summary;
      const meta = [
        { label: 'Type', value: humanizeLabel(selectedInsight.type) },
        { label: 'Source', value: selectedInsight.source },
        { label: 'Created', value: formatTime(selectedInsight.createdAt) },
        { label: 'Key', value: selectedInsight.key || 'none' },
        { label: 'Branch', value: selectedInsight.branch || 'none' },
        { label: 'Worktree', value: selectedInsight.worktreePath ? basenameFromPath(selectedInsight.worktreePath) : 'none' },
        { label: 'Origin workspace', value: contextById(selectedInsight.originContextId)?.name || selectedInsight.originContextId || 'current workspace' },
        { label: 'Origin node', value: selectedInsight.originNodeId || 'local insight' }
      ];
      document.getElementById('selectedInsightMeta').innerHTML = meta
        .map((item) => `<article><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></article>`)
        .join('');
    }

    const targetSelect = document.getElementById('insightTargetContext');
    targetSelect.innerHTML = targetContexts.length > 0
      ? targetContexts.map((context) => `
          <option value="${esc(context.id)}" ${context.id === state.promotionTargetContextId ? 'selected' : ''}>
            ${esc(context.name || context.id)}
          </option>
        `).join('')
      : '<option value="">No other workspaces</option>';
    targetSelect.disabled = targetContexts.length === 0;

    const promoteButton = document.getElementById('promoteInsightBtn');
    promoteButton.disabled = !promoteSupported || !selectedNode || !selectedTargetContext;

    const promotionCopy = document.getElementById('insightPromotionCopy');
    if (!promoteSupported) {
      promotionCopy.textContent = 'Update the local runtime to promote reviewed insights across workspaces.';
    } else if (!selectedNode) {
      promotionCopy.textContent = 'Select an insight first. Promotion is always explicit and keeps project boundaries visible.';
    } else if (!selectedTargetContext) {
      promotionCopy.textContent = 'Create another workspace before promoting reviewed insights across projects.';
    } else {
      promotionCopy.textContent = `Promote this reviewed insight into ${selectedTargetContext.name}. The promoted node keeps provenance back to the source workspace and insight.`;
    }

    const promotionMeta = [];
    if (selectedTargetContext) {
      promotionMeta.push({ title: 'Target workspace', detail: selectedTargetContext.name });
    }
    if (selectedInsight.branch) {
      promotionMeta.push({ title: 'Target workstream tag', detail: selectedInsight.branch });
    }
    const promotion = state.lastInsightPromotion;
    if (promotion && promotion.sourceNodeId === selectedNode?.id) {
      promotionMeta.push({
        title: promotion.created ? 'Last promotion' : 'Last promotion reused',
        detail: `${contextById(promotion.targetContextId)?.name || promotion.targetContextId} · ${short(promotion.targetNodeId || 'target node', 18)}`
      });
    }
    document.getElementById('insightPromotionMeta').innerHTML = promotionMeta.length > 0
      ? promotionMeta.map((item) => `<article><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p></article>`).join('')
      : '<article><strong>Promotion is explicit</strong><p>Insights never cross workspaces silently. Promote only the reviewed memory you want another project to inherit.</p></article>';

    document.getElementById('knowledgeTable').innerHTML = nodes.length > 0
      ? nodes.slice(0, 400).map((node) => {
          const active = node.id === state.activeInsightNodeId ? ' class="active"' : '';
          const summary = insightSummary(node);
          const metaLine = [
            summary.source,
            summary.branch || null,
            summary.originContextId ? 'Promoted insight' : null
          ].filter(Boolean).join(' · ');
          return `
            <tr data-insight-id="${esc(node.id)}"${active}>
              <td>${renderChip(node.type || 'artifact', 'beige')}</td>
              <td>
                <strong>${esc(short(summary.title, 72))}</strong>
                ${metaLine ? `<div class="item-meta-line">${esc(metaLine)}</div>` : ''}
              </td>
              <td>${esc(node.key || '-')}</td>
              <td>${esc(formatTime(node.createdAt))}</td>
            </tr>
          `;
        }).join('')
      : '<tr><td colspan="4"><div class="empty-state">No insight nodes match the current filter.</div></td></tr>';
}

  function renderSetup() {
  document.getElementById('setupCommand').textContent = enableCommand();
  document.getElementById('hookInstallCommand').textContent = hookInstallCommand();
  document.getElementById('hookIngestCommand').textContent = hookIngestCommand();

  const hooks = Array.isArray(state.hook?.agents) ? state.hook.agents : [];
  const gaHooks = hooks.filter((hook) => isGaIntegration(hook.agent));
  const previewHooks = hooks.filter((hook) => isPreviewIntegration(hook.agent));
  const installedGa = gaHooks.filter((hook) => hook.installed);
  const installedPreview = previewHooks.filter((hook) => hook.installed);
  const filteredHooks = gaHooks.filter((hook) => matches(`${hook.agent} ${hook.status} ${hook.notes || ''} ${hook.command || ''}`));
  const setupPageMeta = document.getElementById('setupPageMeta');
  if (setupPageMeta) {
    setupPageMeta.textContent = state.runtimeIssue
      ? state.runtimeIssue.detail
      : installedGa.length > 0
        ? `${installedGa.length} GA integration${installedGa.length === 1 ? '' : 's'} ${installedGa.length === 1 ? 'is' : 'are'} installed on this machine. Use this screen only to enable another repo, add another GA agent, run a smoke test, or repair the runtime.`
        : installedPreview.length > 0
          ? 'Only preview integrations are installed on this machine. The normal product path uses Claude, Factory, or Antigravity.'
        : 'Enable the repo, install the integrations you actually use, then leave this screen. Daily work should happen in workstreams, sessions, and checkpoints.';
  }
  document.getElementById('hookSummary').textContent = `${installedGa.length} GA installed / ${gaHooks.length}`;
  document.getElementById('hookList').innerHTML = filteredHooks.length > 0
    ? filteredHooks.map((hook) => `
          <article class="list-item">
            <h4>${esc(integrationLabel(hook.agent))}</h4>
            <p>${esc(`${hook.status} | ${hook.installed ? `${integrationType(hook.agent)} installed` : `${integrationType(hook.agent)} not installed`}`)}</p>
            ${renderMetaLine([
              hook.notes ? formatIntegrationNote(hook.notes) : '',
              hook.command ? `${integrationType(hook.agent)} command ready` : ''
            ])}
            ${hook.command ? `<p>${esc(short(hook.command, 180))}</p>` : ''}
          </article>
        `).join('')
      : gaHooks.length > 0
        ? '<div class="empty-state">No GA integrations match the current filter.</div>'
      : '<div class="empty-state">GA integration health is unavailable until the daemon can read local setup state.</div>';

  const supportItems = [
    {
      title: 'Runtime posture',
      detail: formatPosture(state.health?.status || 'offline'),
      hint: state.runtimeIssue
        ? state.runtimeIssue.detail
        : 'Desktop and local runtime are aligned.'
    },
    {
      title: 'Machine session',
      detail: state.auth.authenticated ? 'Signed in' : 'Login required',
      hint: `provider: ${state.auth.provider || 'unknown'}`
    },
    {
      title: 'GA integrations',
      detail: installedGa.length > 0 ? integrationListText(installedGa) : 'No GA integrations installed',
      hint: installedPreview.length > 0
        ? 'Preview integrations are installed separately and kept out of the normal product path.'
        : 'Install only the GA agents you actually use on this machine.'
      }
    ];
    document.getElementById('setupSupportList').innerHTML = supportItems.map((item) => `
      <article>
        <strong>${esc(item.title)}</strong>
      <p>${esc(item.detail)}</p>
      <p>${esc(item.hint)}</p>
      </article>
    `).join('');
  document.getElementById('setupSupportCopy').textContent = state.runtimeIssue
      ? state.runtimeIssue.detail
      : 'Use utilities only when you need to enable a repo, install GA integrations, smoke-test capture, check updates, or repair the local runtime.';
  }

function renderAll() {
  renderChrome();
  renderHero();
  renderRuntimeBanner();
  renderBranches();
  renderSessions();
  renderWorkspaces();
  renderCheckpoints();
  renderKnowledge();
  renderSetup();
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
  if (!state.activeContextId || !state.auth.authenticated) {
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
  if (!state.activeContextId || !state.auth.authenticated) {
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
  if (!state.activeContextId || !state.activeSessionId || !state.auth.authenticated) {
    state.sessionDetail = null;
    return;
  }
  state.sessionDetail = await getSessionDetailWithFallback(state.activeSessionId);
}

async function getSessionDetailWithFallback(sessionId) {
  if (!state.activeContextId || !sessionId || !state.auth.authenticated) {
    return null;
  }
  return daemon('getSessionDetail', {
    contextId: state.activeContextId,
    sessionId
  });
}

async function loadTurns() {
  if (!state.activeContextId || !state.activeSessionId || !state.auth.authenticated) {
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

async function loadPayload(nodeId) {
  const target = nodeId || state.activeTurnId;
  state.payloadNodeId = target || null;
  if (!target) {
    state.payload = null;
    return;
  }
  const turn = state.turns.find((entry) => entry.nodeId === target);
  if (!turn || turn.hasPayload !== true) {
    state.payload = null;
    return;
  }
  const payload = await daemon('getNodePayload', { nodeId: target });
  state.payload = payload?.payload ?? payload ?? null;
}

async function loadCheckpoints() {
  if (!state.activeContextId || !state.auth.authenticated) {
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
  if (!state.activeContextId || !lane || !state.auth.authenticated) {
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

async function loadHook() {
  try {
    state.hook = await daemon('getHookHealth', {});
  } catch {
    state.hook = null;
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
    state.contexts = Array.isArray(status?.contexts) ? status.contexts : [];
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
    resetPayloadState();
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

async function createContext(event) {
  event.preventDefault();
  const nameInput = document.getElementById('ctxName');
  const pathInput = document.getElementById('ctxPath');
  const repoPath = String(pathInput.value || '').trim();
  const name = String(nameInput.value || '').trim() || basenameFromPath(repoPath);
  if (!name) {
    setStatus('Workspace name or repository folder is required.');
    return;
  }
  const params = repoPath ? { name, paths: [repoPath] } : { name };
  try {
    const created = await daemon('createContext', params);
    if (created?.id) {
      state.activeContextId = created.id;
      state.activeBranchKey = null;
      resetBranchScopedState();
    }
    nameInput.value = '';
    pathInput.value = '';
    await refreshAll();
    setView('workspaces');
  } catch (error) {
    setStatus(`Create workspace failed: ${String(error)}`);
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`Copied: ${text}`);
  } catch {
    setStatus('Clipboard copy failed.');
  }
}

async function createCheckpointFromActiveSession() {
  if (!state.activeContextId || !state.activeSessionId) {
    setStatus('Select a session before creating a checkpoint.');
    return;
  }
  try {
    const result = await daemon('createSessionCheckpoint', {
      contextId: state.activeContextId,
      sessionId: state.activeSessionId
    });
    state.activeCheckpointId = result?.id || state.activeCheckpointId;
    await loadBranches();
    await loadCheckpoints();
    await loadCheckpointDetail();
    await loadBranchComparisonSafe();
    renderAll();
    setView('checkpoints');
    const knowledge = result?.knowledge;
    const promoted = Number(knowledge?.createdCount || 0);
    const reused = Number(knowledge?.reusedCount || 0);
    const knowledgeSuffix = promoted > 0 || reused > 0
      ? ` | insights ${promoted} new, ${reused} reused`
      : '';
    setStatus(`Created checkpoint ${result?.name || result?.id || ''}${knowledgeSuffix}`.trim());
  } catch (error) {
    setStatus(`Create checkpoint failed: ${String(error)}`);
  }
}

async function previewKnowledgeFromActiveSession() {
  if (!state.activeContextId || !state.activeSessionId) {
    setStatus('Select a session before previewing insights.');
    return;
  }
  try {
    const result = await daemon('previewSessionKnowledge', {
      contextId: state.activeContextId,
      sessionId: state.activeSessionId
    });
    state.sessionKnowledgePreview = result;
    const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
    const preferred = candidates
      .filter((candidate) => candidate.action === 'create' && Number(candidate.confidence || 0) >= 0.72)
      .map((candidate) => candidate.key);
    const fallback = candidates
      .filter((candidate) => candidate.action === 'create')
      .map((candidate) => candidate.key);
    const selected = preferred.length > 0 ? preferred : fallback;
    setSelectedKnowledgeKeys('session', selected);
    renderAll();
    setStatus(`Insight preview ready: ${String(result?.candidateCount || 0)} candidates, ${String(result?.createCount || 0)} new, ${selected.length} preselected.`);
  } catch (error) {
    setStatus(`Preview insights failed: ${String(error)}`);
  }
}

async function extractKnowledgeFromActiveSession() {
  if (!state.activeContextId || !state.activeSessionId) {
    setStatus('Select a session before saving insights.');
    return;
  }
  try {
    const preview = activeSessionKnowledgePreview();
    const candidateKeys = preview ? selectedKnowledgeKeys('session') : undefined;
    if (preview && candidateKeys.length === 0) {
      setStatus('Select at least one insight candidate before saving.');
      return;
    }
    const result = await daemon('extractSessionKnowledge', {
      contextId: state.activeContextId,
      sessionId: state.activeSessionId,
      candidateKeys
    });
    state.sessionKnowledgePreview = null;
    state.sessionKnowledgeSelectedKeys = [];
    await loadGraph();
    renderAll();
    const nodeCount = Number(result?.nodeCount || 0);
    if (nodeCount > 0) {
      setView('knowledge');
    }
    setStatus(`Insights saved: ${String(result?.createdCount || 0)} created, ${String(result?.reusedCount || 0)} reused.`);
  } catch (error) {
    setStatus(`Save insights failed: ${String(error)}`);
  }
}

async function previewKnowledgeFromActiveCheckpoint() {
  if (!state.activeCheckpointId) {
    setStatus('Select a checkpoint before previewing insights.');
    return;
  }
  try {
    const result = await daemon('previewCheckpointKnowledge', {
      checkpointId: state.activeCheckpointId
    });
    state.checkpointKnowledgePreview = result;
    const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
    const preferred = candidates
      .filter((candidate) => candidate.action === 'create' && Number(candidate.confidence || 0) >= 0.72)
      .map((candidate) => candidate.key);
    const fallback = candidates
      .filter((candidate) => candidate.action === 'create')
      .map((candidate) => candidate.key);
    const selected = preferred.length > 0 ? preferred : fallback;
    setSelectedKnowledgeKeys('checkpoint', selected);
    renderAll();
    setStatus(`Checkpoint insight preview ready: ${String(result?.candidateCount || 0)} candidates, ${String(result?.createCount || 0)} new, ${selected.length} preselected.`);
  } catch (error) {
    setStatus(`Preview checkpoint insights failed: ${String(error)}`);
  }
}

async function extractKnowledgeFromActiveCheckpoint() {
  if (!state.activeCheckpointId) {
    setStatus('Select a checkpoint before saving insights.');
    return;
  }
  try {
    const preview = activeCheckpointKnowledgePreview();
    const candidateKeys = preview ? selectedKnowledgeKeys('checkpoint') : undefined;
    if (preview && candidateKeys.length === 0) {
      setStatus('Select at least one checkpoint insight candidate before saving.');
      return;
    }
    const result = await daemon('extractCheckpointKnowledge', {
      contextId: state.activeContextId,
      checkpointId: state.activeCheckpointId,
      candidateKeys
    });
    state.checkpointKnowledgePreview = null;
    state.checkpointKnowledgeSelectedKeys = [];
    await loadGraph();
    renderAll();
    const nodeCount = Number(result?.nodeCount || 0);
    if (nodeCount > 0) {
      setView('knowledge');
    }
    setStatus(`Checkpoint insights saved: ${String(result?.createdCount || 0)} created, ${String(result?.reusedCount || 0)} reused.`);
  } catch (error) {
    setStatus(`Save checkpoint insights failed: ${String(error)}`);
  }
}

async function promoteActiveInsight() {
  const sourceContext = state.activeContextId;
  const node = activeInsightNode();
  const targetContextId = state.promotionTargetContextId;
  if (!sourceContext || !node) {
    setStatus('Select an insight before promoting it.');
    return;
  }
  if (!targetContextId) {
    setStatus('Choose another workspace before promoting this insight.');
    return;
  }
  if (!methodSupported('promoteInsight')) {
    setStatus('Update the local runtime before promoting reviewed insights across workspaces.');
    return;
  }

  const activeLane = activeBranch();
  const branch = extractTagValue(node.tags, 'branch:') || activeLane?.branch || undefined;
  const worktreePath = extractTagValue(node.tags, 'worktree:') || activeLane?.worktreePath || undefined;
  const targetContext = contextById(targetContextId);

  try {
    const result = await daemon('promoteInsight', {
      contextId: targetContextId,
      sourceContextId: sourceContext,
      nodeId: node.id,
      branch,
      worktreePath
    });
    state.lastInsightPromotion = result;
    renderAll();
    setStatus(`Promoted insight to ${targetContext?.name || targetContextId} (${result?.created ? 'created' : 'reused'}).`);
  } catch (error) {
    setStatus(`Promote insight failed: ${String(error)}`);
  }
}

async function explainActiveCheckpoint() {
  if (!state.activeCheckpointId) {
    setStatus('Select a checkpoint first.');
    return;
  }
  try {
    state.checkpointDetail = await daemon('explainCheckpoint', { checkpointId: state.activeCheckpointId });
    await loadCheckpointDetail();
    renderAll();
    setView('checkpoints');
    setStatus(`Loaded checkpoint detail ${state.activeCheckpointId}`);
  } catch (error) {
    setStatus(`Explain checkpoint failed: ${String(error)}`);
  }
}

async function rewindActiveCheckpoint() {
  if (!state.activeCheckpointId) {
    setStatus('Select a checkpoint first.');
    return;
  }
  try {
    const result = await daemon('rewindCheckpoint', { checkpointId: state.activeCheckpointId });
    await refreshAll();
    state.activeCheckpointId = result?.checkpoint?.id || state.activeCheckpointId;
    setView('checkpoints');
    setStatus(`Rewound workspace to checkpoint ${state.activeCheckpointId}`);
  } catch (error) {
    setStatus(`Rewind failed: ${String(error)}`);
  }
}

async function performHeroAction(action) {
  switch (action) {
    case 'go-branches':
      setView('branches');
      return;
    case 'go-sessions':
      setView('sessions');
      return;
    case 'go-setup':
      setView('setup');
      return;
    case 'refresh':
      await refreshAll();
      return;
    case 'focus-create':
      setView('workspaces');
      document.getElementById('ctxName').focus();
      return;
    case 'toggle-hidden':
      state.includeHidden = !state.includeHidden;
      await loadGraph();
      renderAll();
      return;
      case 'copy-enable':
        await copyText(enableCommand());
        return;
      case 'copy-install':
        await copyText(hookInstallCommand());
        return;
    case 'create-checkpoint':
      await createCheckpointFromActiveSession();
      return;
    case 'explain-checkpoint':
      await explainActiveCheckpoint();
      return;
    default:
      return;
  }
}
function wire() {
  document.querySelectorAll('.nav-btn').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view || 'branches'));
  });

  bindById('search', 'input', (event) => {
    state.q = String(event.target.value || '').trim();
    renderAll();
  });

  bindById('ctxSel', 'change', async (event) => {
    const nextId = String(event.target.value || '');
    if (!nextId) return;
    await selectContext(nextId);
    state.activeBranchKey = null;
    resetBranchScopedState();
    await loadBranches();
    await loadSessions();
    await loadSessionDetail();
    await loadTurns();
    resetPayloadState();
    await loadCheckpoints();
    await loadCheckpointDetail();
    await loadHandoff();
    await loadGraph();
    renderAll();
  });

  bindById('refresh', 'click', () => void refreshAll());
  bindById('restart', 'click', async () => {
    try {
      const result = await invoke('restart_connector', {});
      setStatus(String(result || 'Connector restarted.'));
      await refreshAll();
    } catch (error) {
      setStatus(`Restart failed: ${String(error)}`);
    }
  });

  bindById('copyLogin', 'click', () => void copyText('0ctx shell'));
  bindById('runtimeBannerRefresh', 'click', () => void refreshAll());
  bindById('runtimeBannerSetup', 'click', () => setView('setup'));
  bindById('heroPrimary', 'click', (event) => void performHeroAction(event.currentTarget.dataset.action));
  bindById('ctxForm', 'submit', createContext);
  bindById('pickFolder', 'click', async () => {
    try {
      const selected = await invoke('pick_workspace_folder', {});
      if (!selected) {
        setStatus('Folder selection cancelled.');
        return;
      }
      const pathInput = document.getElementById('ctxPath');
      const nameInput = document.getElementById('ctxName');
      pathInput.value = String(selected);
      if (!String(nameInput.value || '').trim()) {
        nameInput.value = basenameFromPath(selected);
      }
      setStatus(`Selected workspace folder ${selected}`);
    } catch (error) {
      setStatus(`Folder picker failed: ${String(error)}`);
    }
  });
  bindById('inclHidden', 'change', async (event) => {
    state.includeHidden = Boolean(event.target.checked);
    await loadGraph();
    renderAll();
  });
  bindById('togglePayload', 'click', () => {
    void (async () => {
      const turn = selectedTurn();
      if (!turn || !turn.hasPayload) return;
      const nextExpanded = !state.payloadExpanded;
      state.payloadExpanded = nextExpanded;
      if (nextExpanded && state.payloadNodeId !== turn.nodeId) {
        await loadPayload(turn.nodeId);
      }
      if (!nextExpanded) {
        state.payload = null;
        state.payloadNodeId = turn.nodeId;
      }
      renderSessions();
    })();
  });

  const createCheckpointBtn = document.getElementById('createCheckpointBtn');
  if (createCheckpointBtn) {
    createCheckpointBtn.addEventListener('click', () => void createCheckpointFromActiveSession());
  }
  const previewSessionKnowledgeBtn = document.getElementById('previewSessionKnowledgeBtn');
  if (previewSessionKnowledgeBtn) {
    previewSessionKnowledgeBtn.addEventListener('click', () => void previewKnowledgeFromActiveSession());
  }
  const extractSessionKnowledgeBtn = document.getElementById('extractSessionKnowledgeBtn');
  if (extractSessionKnowledgeBtn) {
    extractSessionKnowledgeBtn.addEventListener('click', () => void extractKnowledgeFromActiveSession());
  }
  const previewCheckpointKnowledgeBtn = document.getElementById('previewCheckpointKnowledgeBtn');
  if (previewCheckpointKnowledgeBtn) {
    previewCheckpointKnowledgeBtn.addEventListener('click', () => void previewKnowledgeFromActiveCheckpoint());
  }
  const extractCheckpointKnowledgeBtn = document.getElementById('extractCheckpointKnowledgeBtn');
  if (extractCheckpointKnowledgeBtn) {
    extractCheckpointKnowledgeBtn.addEventListener('click', () => void extractKnowledgeFromActiveCheckpoint());
  }
  bindById('promoteInsightBtn', 'click', () => void promoteActiveInsight());
  bindById('rewindCheckpointBtn', 'click', () => void rewindActiveCheckpoint());
  bindById('explainCheckpointBtn', 'click', () => void explainActiveCheckpoint());

  bindById('copyHookInstall', 'click', () => void copyText(hookInstallCommand()));
  bindById('copyIngest', 'click', () => void copyText(hookIngestCommand()));
  bindById('copyShell', 'click', () => void copyText('0ctx shell'));
  bindById('copyRepair', 'click', () => void copyText('0ctx repair'));
  bindById('copyDoctor', 'click', () => void copyText('0ctx doctor'));
  bindById('checkUpdates', 'click', async () => {
    try {
      const result = await invoke('check_for_updates', {});
      setStatus(String(result || 'Update check completed.'));
    } catch (error) {
      setStatus(`Update check failed: ${String(error)}`);
    }
  });

  document.body.addEventListener('click', async (event) => {
    const previewAction = event.target.closest('[data-preview-action]');
    if (previewAction) {
      const scope = String(previewAction.getAttribute('data-preview-scope') || 'session');
      const action = String(previewAction.getAttribute('data-preview-action') || 'all');
      selectKnowledgeCandidates(scope, action);
      renderAll();
      return;
    }

    const bannerAction = event.target.closest('[data-banner-action]');
    if (bannerAction) {
      const action = bannerAction.getAttribute('data-banner-action');
      if (action === 'refresh') {
        await refreshAll();
      } else if (action === 'setup') {
        setView('setup');
      }
      return;
    }

    const navTarget = event.target.closest('[data-nav]');
    if (navTarget) {
      setView(navTarget.dataset.nav || 'branches');
      return;
    }

    const branchTarget = event.target.closest('[data-branch-key]');
      if (branchTarget) {
        state.activeBranchKey = String(branchTarget.getAttribute('data-branch-key'));
        state.activeSessionId = null;
        state.sessionDetail = null;
        state.sessionKnowledgePreview = null;
        state.sessionKnowledgeSelectedKeys = [];
        state.activeTurnId = null;
      resetPayloadState();
        state.activeCheckpointId = null;
        state.checkpointDetail = null;
        state.checkpointSessionDetail = null;
        state.checkpointKnowledgePreview = null;
        state.checkpointKnowledgeSelectedKeys = [];
      await loadSessions();
      await loadSessionDetail();
      await loadTurns();
      resetPayloadState();
      await loadCheckpoints();
      await loadCheckpointDetail();
      await loadHandoff();
      await loadBranchComparisonSafe();
      renderAll();
      return;
    }

    const sessionTarget = event.target.closest('[data-session-id]');
    if (sessionTarget) {
      const nextSessionId = String(sessionTarget.getAttribute('data-session-id'));
      const session = state.allSessions.find((item) => item.sessionId === nextSessionId)
        || state.sessions.find((item) => item.sessionId === nextSessionId)
        || null;
      syncBranchSelectionFromSession(session);
        await loadSessions();
        state.activeSessionId = nextSessionId;
        state.sessionKnowledgePreview = null;
        state.sessionKnowledgeSelectedKeys = [];
        state.activeTurnId = null;
      resetPayloadState();
      await loadSessionDetail();
      await loadTurns();
      resetPayloadState();
      await loadCheckpoints();
      await loadCheckpointDetail();
      await loadHandoff();
      await loadBranchComparisonSafe();
      if (sessionTarget.dataset.openView) {
        setView(sessionTarget.dataset.openView);
      }
      renderAll();
      return;
    }

    const turnTarget = event.target.closest('[data-turn-id]');
    if (turnTarget) {
      state.activeTurnId = String(turnTarget.getAttribute('data-turn-id'));
      resetPayloadState();
      if (turnTarget.dataset.openView) {
        setView(turnTarget.dataset.openView);
      }
      renderAll();
      return;
    }

    const checkpointTarget = event.target.closest('[data-checkpoint-id]');
      if (checkpointTarget) {
        state.activeCheckpointId = String(checkpointTarget.getAttribute('data-checkpoint-id'));
        state.checkpointKnowledgePreview = null;
        state.checkpointKnowledgeSelectedKeys = [];
        await loadCheckpointDetail();
        setView('checkpoints');
        renderAll();
      return;
    }

    const insightTarget = event.target.closest('[data-insight-id]');
    if (insightTarget) {
      state.activeInsightNodeId = String(insightTarget.getAttribute('data-insight-id'));
      renderAll();
      return;
    }

    const contextTarget = event.target.closest('[data-context-id]');
    if (contextTarget) {
      const contextId = String(contextTarget.getAttribute('data-context-id'));
      await selectContext(contextId);
      state.activeBranchKey = null;
      resetBranchScopedState();
      await loadBranches();
      await loadSessions();
      await loadSessionDetail();
      await loadTurns();
      resetPayloadState();
      await loadCheckpoints();
      await loadCheckpointDetail();
      await loadHandoff();
      await loadBranchComparisonSafe();
      await loadGraph();
      renderAll();
    }
  });

  document.body.addEventListener('change', (event) => {
    const compareSelect = event.target.closest('#branchCompareSelect');
    if (compareSelect) {
      state.comparisonTargetKey = String(compareSelect.value || '').trim() || null;
      void (async () => {
        await loadBranchComparisonSafe();
        renderAll();
      })();
      return;
    }
    const promotionTarget = event.target.closest('#insightTargetContext');
    if (promotionTarget) {
      state.promotionTargetContextId = String(promotionTarget.value || '').trim() || null;
      renderAll();
      return;
    }
    const toggle = event.target.closest('[data-preview-toggle]');
    if (!toggle) return;
    const scope = String(toggle.getAttribute('data-preview-scope') || 'session');
    const key = String(toggle.getAttribute('data-candidate-key') || '').trim();
    if (!key) return;
    const current = new Set(selectedKnowledgeKeys(scope));
    if (toggle.checked) {
      current.add(key);
    } else {
      current.delete(key);
    }
    setSelectedKnowledgeKeys(scope, Array.from(current));
    renderAll();
  });

  if (window.__TAURI__ && window.__TAURI__.event && typeof window.__TAURI__.event.listen === 'function') {
    window.__TAURI__.event.listen('posture-changed', (event) => {
      const posture = String(event?.payload || 'offline');
      const badge = document.getElementById('postureBadge');
      const sidebarBadge = document.getElementById('sidebarPosture');
      badge.className = postureClass(posture);
      badge.textContent = formatPosture(posture);
      sidebarBadge.className = postureClass(posture);
      sidebarBadge.textContent = formatPosture(posture);
    });
  }
}

async function boot() {
  wire();
  renderAll();
  setStatus('Booting desktop dashboard...');
  await refreshAll();
  startBackgroundRefreshLoops();
}

void boot();
