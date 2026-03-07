const VIEW_META = {
  home: {
    eyebrow: 'Workspace overview',
    title: 'Workspace overview',
    summary: 'Readiness, storage, and recent activity for the selected workspace.',
    primaryLabel: 'Open branches',
    primaryAction: 'go-branches',
    secondaryLabel: 'Open setup',
    secondaryAction: 'go-setup'
  },
  branches: {
    eyebrow: 'Branch lanes',
    title: 'Branch lanes',
    summary: 'Track workstreams by branch or worktree, then inspect which agent touched each lane and when.',
    primaryLabel: 'Open sessions',
    primaryAction: 'go-sessions',
    secondaryLabel: 'Refresh',
    secondaryAction: 'refresh'
  },
  sessions: {
    eyebrow: 'Captured sessions',
    title: 'Sessions and messages',
    summary: 'Choose a session, read the message stream, and inspect raw payload only when you need more detail.',
    primaryLabel: 'Create checkpoint',
    primaryAction: 'create-checkpoint',
    secondaryLabel: 'Refresh capture',
    secondaryAction: 'refresh'
  },
  checkpoints: {
    eyebrow: 'Checkpoints',
    title: 'Checkpoints',
    summary: 'Use restore points to explain a branch state or rewind a workspace to a known snapshot.',
    primaryLabel: 'Explain checkpoint',
    primaryAction: 'explain-checkpoint',
    secondaryLabel: 'Refresh',
    secondaryAction: 'refresh'
  },
  workspaces: {
    eyebrow: 'Workspace library',
    title: 'Projects and repository bindings',
    summary: 'Create a project once, bind its repo, and route future capture automatically.',
    primaryLabel: 'Create workspace',
    primaryAction: 'focus-create',
    secondaryLabel: 'Open setup',
    secondaryAction: 'go-setup'
  },
  knowledge: {
    eyebrow: 'Project graph',
    title: 'Project graph',
    summary: 'Inspect the visible graph stored in SQLite. Captured chats stay hidden unless you explicitly include them.',
    primaryLabel: 'Toggle hidden nodes',
    primaryAction: 'toggle-hidden',
    secondaryLabel: 'Open sessions',
    secondaryAction: 'go-sessions'
  },
  setup: {
    eyebrow: 'Machine setup',
    title: 'Setup and support',
    summary: 'Use this screen for machine setup, agent integration status, and recovery actions.',
    primaryLabel: 'Copy install command',
    primaryAction: 'copy-install',
    secondaryLabel: 'Refresh',
    secondaryAction: 'refresh'
  }
};

const SEARCH_HINTS = {
  home: 'Filter current workspace activity',
  branches: 'Filter branches, agents, or commits',
  sessions: 'Filter sessions and messages',
  checkpoints: 'Filter checkpoints, sessions, or commits',
  workspaces: 'Filter projects by name or repository path',
  knowledge: 'Filter visible graph nodes',
  setup: 'Filter agent integrations and setup state'
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

function initialView() {
  if (typeof window === 'undefined') {
    return 'branches';
  }
  const params = new URLSearchParams(window.location.search || '');
  const candidate = String(params.get('view') || window.location.hash.replace(/^#/, '') || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(VIEW_META, candidate) ? candidate : 'branches';
}

const state = {
  view: initialView(),
  q: '',
  loading: false,
  contexts: [],
  activeContextId: null,
  branches: [],
  activeBranchKey: null,
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
  payload: null,
  payloadNodeId: null,
  payloadExpanded: false,
  subscriptionId: null,
  lastSeq: 0,
  events: [],
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
    return '<div class="empty-state">No extractable knowledge candidates were found in this source.</div>';
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

function selectedPayloadMeta() {
  const payload = state.payload;
  if (!payload || typeof payload !== 'object') return {};
  const meta = payload.meta;
  return meta && typeof meta === 'object' ? meta : {};
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

function installedAgents() {
  return Array.isArray(state.hook?.agents) ? state.hook.agents.filter((agent) => agent.installed) : [];
}

function integrationType(agent) {
  return agent === 'codex' ? 'notify' : 'hook';
}

function integrationLabel(agent) {
  const base = humanizeLabel(agent);
  return agent === 'codex' ? `${base} notify` : `${base} hook`;
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

function totalTurnCount() {
  return state.allSessions.reduce((sum, session) => sum + Number(session.turnCount || 0), 0);
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
  const hooks = installedAgents();
  if (state.sessions.length > 0) {
    return {
      label: 'Live',
      className: 'badge connected',
      detail: `${state.sessions.length} captured session${state.sessions.length === 1 ? '' : 's'}`
    };
  }
  if (hooks.length > 0) {
    return {
      label: 'Armed',
      className: 'badge degraded',
      detail: `Integrations installed for ${integrationListText(hooks)}`
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
  const agents = installedAgents().map((agent) => agent.agent);
  if (agents.length > 0) {
    return [...new Set(agents)].join(',');
  }
  return 'factory,antigravity,claude,codex';
}

function preferredAgent() {
  const installed = installedAgents();
  const nonCodex = installed.find((agent) => agent.agent !== 'codex');
  return (nonCodex || installed[0] || { agent: 'factory' }).agent;
}

function hookInstallCommand() {
  return `0ctx connector hook install --clients=${preferredClients()} --repo-root "${currentRepoRoot()}"`;
}

function hookIngestCommand() {
  return `0ctx connector hook ingest --agent=${preferredAgent()} --repo-root "${currentRepoRoot()}" --payload '{"session":{"id":"demo-session"},"turn":{"id":"demo-turn-1"},"role":"assistant","content":"hello"}' --json`;
}

function describeBranchLane(lane) {
  const title = lane?.worktreePath
    ? `${normalizeBranch(lane.branch)} | ${basenameFromPath(lane.worktreePath)}`
    : normalizeBranch(lane?.branch);
  const preview = lane?.lastAgent
    ? `${lane.lastAgent} touched this lane most recently.`
    : 'No agent activity recorded yet for this lane.';
  return {
    title,
    preview,
    timeRange: formatTime(lane?.lastActivityAt)
  };
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
  state.activeSessionId = null;
  state.sessionDetail = null;
  state.sessionKnowledgePreview = null;
  state.sessionKnowledgeSelectedKeys = [];
  state.turns = [];
  state.activeTurnId = null;
  state.payload = null;
  state.payloadNodeId = null;
  state.payloadExpanded = false;
  state.checkpoints = [];
  state.activeCheckpointId = null;
  state.checkpointDetail = null;
  state.checkpointSessionDetail = null;
  state.checkpointKnowledgePreview = null;
  state.checkpointKnowledgeSelectedKeys = [];
  state.handoff = [];
}

function storageEntries() {
  return [
    { label: 'Data directory', value: state.storage?.dataDir || 'Unavailable' },
    { label: 'SQLite database', value: state.storage?.dbPath || 'Unavailable' },
    { label: 'Daemon socket', value: state.storage?.socketPath || 'Unavailable' },
    { label: 'Integration state', value: state.storage?.hookStatePath || 'Unavailable' }
  ];
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

function setView(view) {
  state.view = view;
  renderAll();
}
function renderChrome() {
  const posture = String(state.health?.status || 'offline').toLowerCase();
  const postureText = formatPosture(posture);
  const viewMeta = VIEW_META[state.view] || VIEW_META.branches;
  const postureBadge = document.getElementById('postureBadge');
  const sidebarPosture = document.getElementById('sidebarPosture');
  postureBadge.className = postureClass(posture);
  postureBadge.textContent = postureText;
  sidebarPosture.className = postureClass(posture);
  sidebarPosture.textContent = postureText;
  document.getElementById('search').placeholder = SEARCH_HINTS[state.view] || 'Filter this screen';
  document.getElementById('viewCrumb').textContent = viewMeta.title;

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
  document.getElementById('sideWorkspaceCapture').textContent = String(state.allSessions.length);
  document.getElementById('sideWorkspaceHooks').textContent = String(installedAgents().length);
  document.getElementById('sideBinding').textContent = Array.isArray(context?.paths) && context.paths.length > 0
    ? 'Bound to a repo path. Installed integrations resolve workspaces from the running repo.'
    : 'Choose a repo folder to arm capture.';

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
  document.getElementById('heroEyebrow').textContent = meta.eyebrow;
  document.getElementById('heroTitle').textContent = meta.title;
  let detail = 'Choose a workspace to begin.';
  if (context) {
    if (state.view === 'branches') {
      detail = state.runtimeIssue
        ? `${context.name} | Update the local runtime to enable branch-first views.`
        : `${context.name} | ${state.branches.length} branch lane${state.branches.length === 1 ? '' : 's'} tracked.`;
    } else if (state.view === 'sessions') {
      const lane = activeBranch();
      const session = activeSession();
      detail = session
        ? `${context.name} | ${session.agent || 'agent'} on ${normalizeBranch(session.branch)}.`
        : lane
          ? `${context.name} | Reading sessions for ${describeBranchLane(lane).title}.`
          : `${context.name} | Choose a branch lane, then open a session.`;
    } else if (state.view === 'checkpoints') {
      detail = `${context.name} | ${state.checkpoints.length} checkpoint${state.checkpoints.length === 1 ? '' : 's'} in the current view.`;
    } else if (state.view === 'knowledge') {
      detail = `${context.name} | ${state.graphNodes.length} visible node${state.graphNodes.length === 1 ? '' : 's'} in the graph.`;
    } else if (state.view === 'setup') {
      detail = `${context.name} | ${installedAgents().length} integration${installedAgents().length === 1 ? '' : 's'} installed.`;
    } else if (state.view === 'workspaces') {
      detail = `${state.contexts.length} workspace${state.contexts.length === 1 ? '' : 's'} on this machine.`;
    } else {
      const capture = captureState();
      detail = `${context.name} | ${capture.detail}`;
    }
  }
  document.getElementById('heroMeta').textContent = detail;

  const primary = document.getElementById('heroPrimary');
  const secondary = document.getElementById('heroSecondary');
  primary.textContent = meta.primaryLabel;
  primary.dataset.action = meta.primaryAction;
  secondary.textContent = meta.secondaryLabel;
  secondary.dataset.action = meta.secondaryAction;
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

function renderHome() {
  const capture = captureState();
  const setupBadge = document.getElementById('captureStateBadge');
  setupBadge.className = capture.className;
  setupBadge.textContent = capture.label;

  const context = activeContext();
  const installed = installedAgents();
  const checklist = [
    {
      state: Array.isArray(context?.paths) && context.paths.length > 0 ? 'done' : 'todo',
      title: 'Workspace bound to a repository path',
      detail: Array.isArray(context?.paths) && context.paths.length > 0
        ? `Current path: ${context.paths.join(', ')}`
        : 'Create or update a workspace with the repo path so integrations can resolve it automatically.'
    },
    {
      state: installed.length > 0 ? 'done' : 'warn',
      title: 'Integrations installed for one or more agents',
      detail: installed.length > 0
        ? `Installed agents: ${integrationListText(installed)}`
        : 'Use the Setup screen to install the integrations for the agents you actually use.'
    },
    {
      state: state.allSessions.length > 0 ? 'done' : 'warn',
      title: 'At least one session captured',
      detail: state.allSessions.length > 0
        ? `${state.allSessions.length} session${state.allSessions.length === 1 ? '' : 's'} already captured for this workspace.`
        : 'After integrations are installed, complete one agent turn in this repo and refresh the desktop app.'
    },
    {
      state: String(state.health?.status || '').toLowerCase() === 'connected' ? 'done' : 'warn',
      title: 'Connector and daemon reachable',
      detail: String(state.health?.status || '').toLowerCase() === 'connected'
        ? 'The local runtime is responding to desktop queries.'
        : 'The UI can load only when the local runtime is reachable. Use Restart connector if posture stays offline.'
    }
  ];
  document.getElementById('setupChecklist').innerHTML = checklist.map((item) => {
    const symbol = item.state === 'done' ? 'OK' : item.state === 'warn' ? '!' : '...';
    return `<li><span class="checkmark ${item.state}">${symbol}</span><div><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p></div></li>`;
  }).join('');

  document.getElementById('homeSessionCount').textContent = String(state.allSessions.length);
  document.getElementById('homeTurnCount').textContent = String(totalTurnCount());
  document.getElementById('homeNodeCount').textContent = String(state.graphNodes.length);
  document.getElementById('homeStorageState').textContent = state.storage?.dbPath ? 'Local only' : 'Unknown';
  document.getElementById('homeStorageCopy').textContent = state.storage?.dbPath
    ? `Primary database: ${short(state.storage.dbPath, 70)}`
    : 'Storage path becomes visible when the daemon reports machine status.';

  const storageExplainer = [
    {
      title: 'Graph summaries stay small',
      detail: 'Session summaries, messages, checkpoints, and derived knowledge live in query-friendly rows so recall stays fast.'
    },
    {
      title: 'Raw dumps stay off the hot path',
      detail: 'Full transcript payloads are stored in sidecar rows and only fetched when you open a message detail.'
    },
    {
      title: 'Branch lanes stay explicit',
      detail: 'A workspace contains multiple branch or worktree lanes, each with its own agent activity and checkpoints.'
    }
  ];
  document.getElementById('storageExplainer').innerHTML = storageExplainer.map((item) => {
    return `<article><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p></article>`;
  }).join('');

  const recentSessions = state.allSessions.filter((session) => matches(`${session.sessionId} ${session.summary || ''}`));
  document.getElementById('recentSessions').innerHTML = recentSessions.length > 0
    ? recentSessions.slice(0, 8).map((session) => {
      const summary = describeSession(session);
      return `
        <article class="list-item conversation-card" data-session-id="${esc(session.sessionId)}" data-open-view="sessions">
          <p class="item-kicker">${esc(formatRelativeTime(session.lastTurnAt || session.startedAt))}</p>
          <h4 class="item-title">${esc(summary.title)}</h4>
          <p class="item-preview">${esc(summary.preview)}</p>
          <div class="list-row">
            ${renderChip(`${session.turnCount || 0} messages`, 'beige')}
            ${session.branch ? renderChip(session.branch, 'green') : ''}
            ${session.agent ? renderChip(session.agent, chipToneForAgent(session.agent)) : ''}
          </div>
        </article>
      `;
    }).join('')
    : '<div class="empty-state">No captured sessions yet for this workspace.</div>';

  const recentTurns = state.turns.filter((turn) => matches(`${turn.content || ''} ${turn.role || ''}`));
  document.getElementById('recentTurns').innerHTML = recentTurns.length > 0
    ? recentTurns.slice(0, 10).map((turn) => {
      const summary = describeTurn(turn);
      return `
        <article class="list-item conversation-card ${turn.nodeId === state.activeTurnId ? 'active' : ''}" data-turn-id="${esc(turn.nodeId)}" data-open-view="sessions">
          <p class="item-kicker">${esc(formatRelativeTime(turn.createdAt))}</p>
          <h4 class="item-title">${esc(summary.title)}</h4>
          <p class="item-preview">${esc(summary.preview)}</p>
          <div class="list-row">
            ${renderChip(turn.role || 'message', chipToneForRole(turn.role))}
            ${renderChip(turn.hasPayload ? 'raw available' : 'summary only', turn.hasPayload ? 'blue' : 'beige')}
            ${turn.commitSha ? renderChip(`#${commitShort(turn.commitSha)}`, 'beige', { mono: true }) : ''}
          </div>
        </article>
      `;
    }).join('')
    : '<div class="empty-state">Select or capture a session to see its messages here.</div>';

  document.getElementById('homeStoragePaths').innerHTML = storageEntries().map((entry) => {
    return `<article><span>${esc(entry.label)}</span><code>${esc(entry.value)}</code></article>`;
  }).join('');
}

function renderBranches() {
  const branches = state.branches.filter((lane) => matches(`${lane.branch} ${lane.worktreePath || ''} ${lane.lastAgent || ''} ${lane.lastCommitSha || ''}`));
  const branchDetailPanel = document.getElementById('branchDetailPanel');
  document.getElementById('branchHeadline').textContent = `${branches.length} lane${branches.length === 1 ? '' : 's'}`;
  document.getElementById('branchSessionCount').textContent = `${state.sessions.length} session${state.sessions.length === 1 ? '' : 's'}`;

  document.getElementById('branchList').innerHTML = branches.length > 0
    ? branches.map((lane) => {
      const summary = describeBranchLane(lane);
      const key = branchKey(lane.branch, lane.worktreePath);
      return `
        <article class="list-item conversation-card branch-card ${key === state.activeBranchKey ? 'active' : ''}" data-branch-key="${esc(key)}">
          <p class="item-kicker">${esc(formatRelativeTime(lane.lastActivityAt))}</p>
          <h4 class="item-title">${esc(summary.title)}</h4>
          <p class="item-preview">${esc(summary.preview)}</p>
          <div class="list-row">
            ${renderChip(normalizeBranch(lane.branch), lane.lastAgent ? 'green' : 'beige')}
            ${renderChip(`${lane.sessionCount} sessions`, 'beige')}
            ${renderChip(`${lane.checkpointCount} checkpoints`, 'orange')}
            ${lane.lastCommitSha ? renderChip(`#${commitShort(lane.lastCommitSha)}`, 'beige', { mono: true }) : ''}
          </div>
          <div class="item-footer">
            ${renderAgentChain(lane.agentSet, lane.lastAgent)}
            <span class="item-meta">${esc(summary.timeRange)}</span>
          </div>
        </article>
      `;
    }).join('')
    : state.runtimeIssue
      ? '<div class="empty-state">This desktop build needs a newer local runtime before branch lanes can load.</div>'
      : '<div class="empty-state">No branch lanes yet. Capture one agent session in this repo, then refresh.</div>';

  document.getElementById('branchSessionList').innerHTML = state.sessions.length > 0
    ? state.sessions.map((session) => {
      const summary = describeSession(session);
      return `
        <article class="list-item conversation-card ${session.sessionId === state.activeSessionId ? 'active' : ''}" data-session-id="${esc(session.sessionId)}" data-open-view="sessions">
          <p class="item-kicker">${esc(formatRelativeTime(session.lastTurnAt || session.startedAt))}</p>
          <h4 class="item-title">${esc(summary.title)}</h4>
          <p class="item-preview">${esc(summary.preview)}</p>
          <div class="list-row">
            ${renderChip(`${session.turnCount || 0} messages`, 'beige')}
            ${session.agent ? renderChip(session.agent, chipToneForAgent(session.agent)) : ''}
            ${session.commitSha ? renderChip(`#${commitShort(session.commitSha)}`, 'beige', { mono: true }) : ''}
          </div>
        </article>
      `;
    }).join('')
    : '<div class="empty-state">Select a branch lane to inspect the sessions captured on it.</div>';

  if (state.runtimeIssue && branches.length === 0) {
    branchDetailPanel.classList.add('wide-panel');
    document.getElementById('branchDetailTitle').textContent = 'Update the local runtime';
    document.getElementById('branchMeta').innerHTML = '';
    document.getElementById('branchSessionList').innerHTML = '';
    document.getElementById('handoffList').innerHTML = '';
    document.getElementById('branchDetailEmpty').innerHTML = `
      <div class="empty-flow">
        <strong>Branch views need a newer runtime.</strong>
        <p>${esc(state.runtimeIssue.detail)}</p>
        <div class="row-actions">
          <button class="btn primary" data-banner-action="refresh">Refresh</button>
          <button class="btn tertiary" data-banner-action="setup">Open setup</button>
        </div>
      </div>
    `;
    document.getElementById('branchDetailEmpty').classList.remove('hidden');
    document.getElementById('branchDetailBody').classList.add('hidden');
    return;
  }

  branchDetailPanel.classList.remove('wide-panel');

  const lane = activeBranch();
  const detailBody = document.getElementById('branchDetailBody');
  const empty = document.getElementById('branchDetailEmpty');
  if (!lane) {
    document.getElementById('branchDetailTitle').textContent = 'Choose a branch lane';
    document.getElementById('branchMeta').innerHTML = '';
    document.getElementById('handoffList').innerHTML = '<div class="empty-state">No handoff history yet.</div>';
    empty.innerHTML = 'Select a branch lane to inspect cross-agent activity and checkpoint coverage.';
    empty.classList.remove('hidden');
    detailBody.classList.add('hidden');
    return;
  }

  document.getElementById('branchDetailTitle').textContent = describeBranchLane(lane).title;
  empty.classList.add('hidden');
  detailBody.classList.remove('hidden');
  const meta = [
    { label: 'Branch', value: normalizeBranch(lane.branch) },
    { label: 'Worktree', value: lane.worktreePath || 'Primary repo path' },
    { label: 'Last agent', value: lane.lastAgent || 'unknown' },
    { label: 'Last commit', value: lane.lastCommitSha || 'none' },
    { label: 'Last activity', value: formatTime(lane.lastActivityAt) },
    { label: 'Sessions', value: String(lane.sessionCount) },
    { label: 'Checkpoints', value: String(lane.checkpointCount) },
    { label: 'Agents', value: lane.agentSet?.length ? lane.agentSet.join(', ') : 'none' }
  ];
  document.getElementById('branchMeta').innerHTML = meta.map((item) => `<article><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></article>`).join('');

  document.getElementById('handoffList').innerHTML = state.handoff.length > 0
    ? state.handoff.map((entry) => `
        <article class="list-item conversation-card" data-session-id="${esc(entry.sessionId)}" data-open-view="sessions">
          <p class="item-kicker">${esc(formatRelativeTime(entry.lastTurnAt))}</p>
          <h4 class="item-title">${esc(entry.agent || 'unknown agent')}</h4>
          <p class="item-preview">${esc(short(entry.summary || 'No summary stored for this session.', 150))}</p>
          <div class="list-row">
            ${entry.commitSha ? renderChip(`#${commitShort(entry.commitSha)}`, 'beige', { mono: true }) : ''}
            ${renderChip(normalizeBranch(entry.branch), 'green')}
            ${renderChip(entry.agent || 'agent', chipToneForAgent(entry.agent))}
          </div>
        </article>
      `).join('')
    : '<div class="empty-state">No handoff history recorded for this branch lane yet.</div>';
}
function renderSessions() {
  const sessions = state.sessions.filter((session) => matches(`${session.sessionId} ${session.summary || ''} ${session.branch || ''} ${session.commitSha || ''} ${session.agent || ''}`));
  const turns = state.turns.filter((turn) => matches(`${turn.content || ''} ${turn.role || ''} ${turn.commitSha || ''} ${turn.agent || ''}`));
  const lane = activeBranch();
  const session = activeSession();
  const sessionSummary = session ? describeSession(session) : null;
  document.getElementById('sessionHeadline').textContent = `${sessions.length} session${sessions.length === 1 ? '' : 's'}`;
  document.getElementById('turnCount').textContent = `${turns.length} message${turns.length === 1 ? '' : 's'}`;
  document.getElementById('sessionFocusTitle').textContent = sessionSummary?.title || (lane ? describeBranchLane(lane).title : 'Choose a session');
  document.getElementById('sessionFocusMeta').textContent = session
    ? `${sessionSummary?.preview || 'Read the stream below.'} ${session.branch ? `Branch: ${session.branch}.` : ''} ${session.agent ? `Agent: ${session.agent}.` : ''}`.trim()
    : lane
      ? `Selected lane: ${describeBranchLane(lane).title}. Choose a session to read its message stream and create a checkpoint.`
      : 'Pick a branch lane, then choose a session to read the message stream and capture a checkpoint.';

  document.getElementById('sessionList').innerHTML = sessions.length > 0
    ? sessions.map((session) => {
      const summary = describeSession(session);
      return `
        <article class="list-item conversation-card ${session.sessionId === state.activeSessionId ? 'active' : ''}" data-session-id="${esc(session.sessionId)}">
          <p class="item-kicker">${esc(formatRelativeTime(session.lastTurnAt || session.startedAt))}</p>
          <h4 class="item-title">${esc(summary.title)}</h4>
          <p class="item-preview">${esc(summary.preview)}</p>
          <div class="list-row">
            ${renderChip(`${session.turnCount || 0} messages`, 'beige')}
            ${session.agent ? renderChip(session.agent, chipToneForAgent(session.agent)) : ''}
            ${session.branch ? renderChip(session.branch, 'green') : ''}
            ${session.commitSha ? renderChip(`#${commitShort(session.commitSha)}`, 'beige', { mono: true }) : ''}
          </div>
        </article>
      `;
    }).join('')
    : '<div class="empty-state">No sessions are loaded for this branch lane yet.</div>';

  document.getElementById('turnList').innerHTML = turns.length > 0
    ? turns.map((turn) => {
      const summary = describeTurn(turn);
      return `
        <article class="list-item conversation-card ${turn.nodeId === state.activeTurnId ? 'active' : ''}" data-turn-id="${esc(turn.nodeId)}">
          <p class="item-kicker">${esc(formatRelativeTime(turn.createdAt))}</p>
          <h4 class="item-title">${esc(summary.title)}</h4>
          <p class="item-preview">${esc(summary.preview)}</p>
          <div class="list-row">
            ${renderChip(turn.role || 'message', chipToneForRole(turn.role))}
            ${renderChip(turn.hasPayload ? 'raw available' : 'summary only', turn.hasPayload ? 'blue' : 'beige')}
            ${turn.agent ? renderChip(turn.agent, chipToneForAgent(turn.agent)) : ''}
            ${turn.commitSha ? renderChip(`#${commitShort(turn.commitSha)}`, 'beige', { mono: true }) : ''}
          </div>
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
    toggle.textContent = 'Show raw payload';
    document.getElementById('payloadPanel').classList.add('hidden');
    document.getElementById('payloadText').textContent = 'Select a message in Sessions to inspect payload.';
    document.getElementById('payloadBadge').textContent = 'none';
    document.getElementById('turnPrimaryLabel').textContent = 'Message';
    document.getElementById('turnSecondaryLabel').textContent = 'Related context';
    document.getElementById('turnPrompt').textContent = '';
    document.getElementById('turnReply').textContent = '';
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

  const meta = [
    { label: 'Speaker', value: turn.role || 'unknown' },
    { label: 'Captured', value: formatTime(turn.createdAt) },
    { label: 'Agent', value: turn.agent || activeSession()?.agent || 'unknown' },
    { label: 'Git', value: turn.commitSha ? `${turn.branch || 'detached'} @ ${String(turn.commitSha).slice(0, 8)}` : (turn.branch || 'No git link') },
    { label: 'Session checkpoints', value: String(state.sessionDetail?.checkpointCount || 0) },
    { label: 'Raw data', value: turn.hasPayload ? 'Available on demand' : 'No sidecar payload' }
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
    { label: 'Visibility', value: turn.hidden ? 'Hidden by default' : 'Visible in knowledge view' }
  ];
  document.getElementById('turnTechnical').innerHTML = technical.map((item) => {
    return `<article><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></article>`;
  }).join('');

  toggle.disabled = !turn.hasPayload;
  toggle.textContent = turn.hasPayload ? (state.payloadExpanded ? 'Hide raw payload' : 'Show raw payload') : 'No raw payload';
  const payloadPanel = document.getElementById('payloadPanel');
  payloadPanel.classList.toggle('hidden', !turn.hasPayload || !state.payloadExpanded);
  document.getElementById('payloadBadge').textContent = turn.payloadBytes != null ? `${turn.payloadBytes} bytes` : 'payload';
  document.getElementById('payloadTitle').textContent = turn.hasPayload
    ? 'Captured sidecar payload'
    : 'No payload stored for this message';
  document.getElementById('payloadText').textContent = turn.hasPayload
    ? (state.payload ? jsonText(state.payload) : 'Payload not loaded yet.')
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
  const hooks = installedAgents();
  document.getElementById('workspaceCount').textContent = `${contexts.length} workspace${contexts.length === 1 ? '' : 's'}`;

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
          <div class="list-row">
            ${renderChip(repoPath ? 'Repo bound' : 'Needs repo', repoPath ? 'green' : 'orange')}
            ${item.syncPolicy ? renderChip(humanizeLabel(item.syncPolicy), 'blue') : ''}
            ${pathList.length > 1 ? renderChip(`${pathList.length} paths`, 'beige') : ''}
          </div>
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
          title: 'Branch lanes',
          detail: `${state.branches.length} tracked lane${state.branches.length === 1 ? '' : 's'}`,
          hint: 'Branches and worktrees stay grouped inside this workspace.'
        },
        {
          title: 'Captured sessions',
          detail: `${state.allSessions.length} session${state.allSessions.length === 1 ? '' : 's'}`,
          hint: 'All captured runs currently linked to this project.'
        },
        {
          title: 'Installed integrations',
          detail: `${hooks.length} agent integration${hooks.length === 1 ? '' : 's'} ready`,
          hint: hooks.length > 0 ? integrationListText(hooks) : 'No agent integrations detected yet.'
        },
        {
          title: 'Default sync policy',
          detail: humanizeLabel(context.syncPolicy || 'full_sync'),
          hint: 'Local-first storage remains the source of truth.'
        },
        {
          title: 'Workspace id',
          detail: context.id,
          hint: 'Stable identifier for tooling and support operations.'
        },
        {
          title: 'Local storage',
          detail: state.storage?.dbPath || 'SQLite path unavailable',
          hint: 'Primary database backing this desktop workspace.'
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

  const bindingGuide = [
    {
      title: '1. Create one workspace per project',
      detail: 'A workspace represents the repo. Branches and worktrees stay inside that workspace instead of becoming separate projects.'
    },
    {
      title: '2. Install integrations once per repo',
      detail: 'Hook-based agents route by repo path, and Codex uses notify plus repo-path routing. None of them depend on a baked context id that can go stale after resets.'
    },
    {
      title: '3. Future sessions capture without prompting',
      detail: 'As long as the agent runs inside the bound repo and its integration is installed, new sessions land in the correct workspace automatically.'
    }
  ];
  document.getElementById('workspaceBindingGuide').innerHTML = bindingGuide.map((item) => {
    return `<article><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p></article>`;
  }).join('');
}

function renderCheckpoints() {
  const checkpoints = state.checkpoints.filter((checkpoint) => matches(`${checkpoint.summary || ''} ${checkpoint.name || ''} ${checkpoint.sessionId || ''} ${checkpoint.commitSha || ''}`));
  document.getElementById('checkpointHeadline').textContent = `${checkpoints.length} checkpoint${checkpoints.length === 1 ? '' : 's'}`;

  document.getElementById('checkpointList').innerHTML = checkpoints.length > 0
    ? checkpoints.map((checkpoint) => {
      const summary = describeCheckpoint(checkpoint);
      return `
        <article class="list-item conversation-card ${checkpoint.checkpointId === state.activeCheckpointId ? 'active' : ''}" data-checkpoint-id="${esc(checkpoint.checkpointId)}">
          <p class="item-kicker">${esc(formatRelativeTime(checkpoint.createdAt))}</p>
          <h4 class="item-title">${esc(summary.title)}</h4>
          <p class="item-preview">${esc(summary.preview)}</p>
          <div class="list-row">
            ${renderChip(checkpoint.kind, 'orange')}
            ${checkpoint.branch ? renderChip(checkpoint.branch, 'green') : ''}
            ${checkpoint.commitSha ? renderChip(`#${commitShort(checkpoint.commitSha)}`, 'beige', { mono: true }) : ''}
          </div>
        </article>
      `;
    }).join('')
    : '<div class="empty-state">No checkpoints yet for this branch lane.</div>';

  const sessionCard = document.getElementById('checkpointSessionCard');
  const linkedSession = state.checkpointSessionDetail?.session || activeSession();
  if (linkedSession && selectedCheckpoint()?.sessionId) {
    const summary = describeSession(linkedSession);
    sessionCard.innerHTML = `
      <article class="list-item conversation-card" data-session-id="${esc(linkedSession.sessionId)}" data-open-view="sessions">
        <p class="item-kicker">${esc(formatRelativeTime(linkedSession.lastTurnAt || linkedSession.startedAt))}</p>
        <h4 class="item-title">${esc(summary.title)}</h4>
        <p class="item-preview">${esc(summary.preview)}</p>
        <div class="list-row">
          ${renderChip(`${linkedSession.turnCount || 0} messages`, 'beige')}
          ${linkedSession.agent ? renderChip(linkedSession.agent, chipToneForAgent(linkedSession.agent)) : ''}
          ${linkedSession.commitSha ? renderChip(`#${commitShort(linkedSession.commitSha)}`, 'beige', { mono: true }) : ''}
        </div>
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
  explainBtn.disabled = !state.activeCheckpointId;
  previewBtn.disabled = !state.activeCheckpointId;
  extractBtn.disabled = !state.activeCheckpointId;
  rewindBtn.disabled = !state.activeCheckpointId;

  if (!detail?.checkpoint) {
    document.getElementById('checkpointDetailTitle').textContent = 'Choose a checkpoint';
    document.getElementById('checkpointMeta').innerHTML = '';
    document.getElementById('checkpointKnowledgePreviewPanel').classList.add('hidden');
    document.getElementById('checkpointKnowledgePreviewBadge').textContent = '0 candidates';
    document.getElementById('checkpointKnowledgePreviewList').innerHTML = '';
    empty.classList.remove('hidden');
    body.classList.add('hidden');
    return;
  }

  const checkpoint = detail.checkpoint;
  document.getElementById('checkpointDetailTitle').textContent = short(checkpoint.summary || checkpoint.name || checkpoint.id, 72);
  empty.classList.add('hidden');
  body.classList.remove('hidden');
  const meta = [
    { label: 'Kind', value: checkpoint.kind },
    { label: 'Name', value: checkpoint.name },
    { label: 'Branch', value: checkpoint.branch || 'none' },
    { label: 'Worktree', value: checkpoint.worktreePath || 'Primary repo path' },
    { label: 'Session', value: checkpoint.sessionId || 'none' },
    { label: 'Commit', value: checkpoint.commitSha || 'none' },
    { label: 'Created', value: formatTime(checkpoint.createdAt) },
    { label: 'Agents', value: checkpoint.agentSet?.length ? checkpoint.agentSet.join(', ') : 'none' },
    { label: 'Snapshot nodes', value: String(detail.snapshotNodeCount || 0) },
    { label: 'Snapshot edges', value: String(detail.snapshotEdgeCount || 0) },
    { label: 'Snapshot checkpoints', value: String(detail.snapshotCheckpointCount || 0) },
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

  const explainer = [
    {
      title: 'This is the stored graph',
      detail: 'This screen shows nodes and edges already written into the workspace graph. It is not a full automatic extraction of every chat.'
    },
    {
      title: 'Captured sessions are separate by default',
      detail: 'Session and message records live in the same workspace, but stay hidden here unless you explicitly include hidden capture nodes.'
    },
    {
      title: 'Use Sessions for conversations',
      detail: 'If you want to read what happened in a conversation, use Sessions. Use Graph when you want the current structured project memory.'
    }
  ];
  document.getElementById('knowledgeExplainer').innerHTML = explainer.map((item) => {
    return `<article><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p></article>`;
  }).join('');

  const nodes = state.graphNodes.filter((node) => matches(`${node.type || ''} ${node.content || ''} ${node.key || ''}`));
  document.getElementById('knowledgeTable').innerHTML = nodes.length > 0
    ? nodes.slice(0, 400).map((node) => `
        <tr>
          <td>${renderChip(node.type || 'artifact', 'beige')}</td>
          <td>${esc(short(node.content || '', 140))}</td>
          <td>${esc(node.key || '-')}</td>
          <td>${esc(formatTime(node.createdAt))}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="4"><div class="empty-state">No knowledge nodes match the current filter.</div></td></tr>';
}

function renderSetup() {
  document.getElementById('setupCommand').textContent = '0ctx setup';
  document.getElementById('hookInstallCommand').textContent = hookInstallCommand();
  document.getElementById('hookIngestCommand').textContent = hookIngestCommand();

  const hooks = Array.isArray(state.hook?.agents) ? state.hook.agents : [];
  const installed = hooks.filter((hook) => hook.installed);
  document.getElementById('hookSummary').textContent = `${installed.length} installed / ${hooks.length}`;
  document.getElementById('hookList').innerHTML = hooks.length > 0
    ? hooks.filter((hook) => matches(`${hook.agent} ${hook.status} ${hook.notes || ''} ${hook.command || ''}`)).map((hook) => `
        <article class="list-item">
          <h4>${esc(integrationLabel(hook.agent))}</h4>
          <p>${esc(`${hook.status} | ${hook.installed ? `${integrationType(hook.agent)} installed` : `${integrationType(hook.agent)} not installed`}`)}</p>
          <div class="list-row">
            ${hook.notes ? renderChip(hook.notes, 'beige') : ''}
            ${hook.command ? renderChip(`${integrationType(hook.agent)} command ready`, hook.installed ? 'green' : 'orange') : ''}
          </div>
          ${hook.command ? `<p>${esc(short(hook.command, 180))}</p>` : ''}
        </article>
      `).join('')
    : '<div class="empty-state">Integration health is unavailable until the daemon can read local setup state.</div>';

  const queue = state.health?.sync?.queue || {};
  document.getElementById('setupAuth').textContent = state.auth.authenticated ? 'YES' : 'NO';
  document.getElementById('setupAuthMeta').textContent = `provider:${state.auth.provider}`;
  document.getElementById('setupQueue').textContent = `${queue.pending || 0}/${queue.done || 0}`;
  document.getElementById('setupMethods').textContent = String(state.caps.length);
  document.getElementById('setupPosture').textContent = formatPosture(state.health?.status || 'offline');
  document.getElementById('setupSupportCopy').textContent = state.runtimeIssue
    ? state.runtimeIssue.detail
    : 'Use setup for commands and machine recovery. Runtime JSON, event feeds, and storage internals are intentionally out of the daily workflow.';
}

function renderAll() {
  renderChrome();
  renderHero();
  renderRuntimeBanner();
  renderHome();
  renderBranches();
  renderSessions();
  renderWorkspaces();
  renderCheckpoints();
  renderKnowledge();
  renderSetup();
}
async function selectContext(id, silent = false) {
  if (!id) return;
  state.activeContextId = id;
  await daemon('switchContext', { contextId: id });
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

async function refreshAll() {
  if (state.loading) return;
  state.loading = true;
  try {
    state.runtimeIssue = null;
    const status = await invoke('daemon_status', {});
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
      renderAll();
      setStatus(`Runtime contract mismatch: ${missingMethods.join(', ')}`);
      return;
    }
    await loadBranches();
    await loadSessions();
    await loadSessionDetail();
    await loadTurns();
    await loadPayload(state.turns[0]?.nodeId || null);
    await loadCheckpoints();
    await loadCheckpointDetail();
    await loadHandoff();
    await loadGraph();
    renderAll();
    setStatus('Refreshed local desktop data.');
  } catch (error) {
    if (!state.runtimeIssue) {
      setRuntimeIssue(
        'Runtime unavailable',
        'The desktop app could not load the local runtime. Restart connector, then reopen the app if the issue remains.'
      );
    }
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
    renderAll();
    setView('checkpoints');
    const knowledge = result?.knowledge;
    const promoted = Number(knowledge?.createdCount || 0);
    const reused = Number(knowledge?.reusedCount || 0);
    const knowledgeSuffix = promoted > 0 || reused > 0
      ? ` | knowledge ${promoted} new, ${reused} reused`
      : '';
    setStatus(`Created checkpoint ${result?.name || result?.id || ''}${knowledgeSuffix}`.trim());
  } catch (error) {
    setStatus(`Create checkpoint failed: ${String(error)}`);
  }
}

async function previewKnowledgeFromActiveSession() {
  if (!state.activeContextId || !state.activeSessionId) {
    setStatus('Select a session before previewing knowledge.');
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
    setStatus(`Knowledge preview ready: ${String(result?.candidateCount || 0)} candidates, ${String(result?.createCount || 0)} new, ${selected.length} preselected.`);
  } catch (error) {
    setStatus(`Preview knowledge failed: ${String(error)}`);
  }
}

async function extractKnowledgeFromActiveSession() {
  if (!state.activeContextId || !state.activeSessionId) {
    setStatus('Select a session before extracting knowledge.');
    return;
  }
  try {
    const preview = activeSessionKnowledgePreview();
    const candidateKeys = preview ? selectedKnowledgeKeys('session') : undefined;
    if (preview && candidateKeys.length === 0) {
      setStatus('Select at least one knowledge candidate before extracting.');
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
    setStatus(`Knowledge extraction completed: ${String(result?.createdCount || 0)} created, ${String(result?.reusedCount || 0)} reused.`);
  } catch (error) {
    setStatus(`Extract knowledge failed: ${String(error)}`);
  }
}

async function previewKnowledgeFromActiveCheckpoint() {
  if (!state.activeCheckpointId) {
    setStatus('Select a checkpoint before previewing knowledge.');
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
    setStatus(`Checkpoint preview ready: ${String(result?.candidateCount || 0)} candidates, ${String(result?.createCount || 0)} new, ${selected.length} preselected.`);
  } catch (error) {
    setStatus(`Preview checkpoint knowledge failed: ${String(error)}`);
  }
}

async function extractKnowledgeFromActiveCheckpoint() {
  if (!state.activeCheckpointId) {
    setStatus('Select a checkpoint before extracting knowledge.');
    return;
  }
  try {
    const preview = activeCheckpointKnowledgePreview();
    const candidateKeys = preview ? selectedKnowledgeKeys('checkpoint') : undefined;
    if (preview && candidateKeys.length === 0) {
      setStatus('Select at least one checkpoint knowledge candidate before extracting.');
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
    setStatus(`Checkpoint extraction completed: ${String(result?.createdCount || 0)} created, ${String(result?.reusedCount || 0)} reused.`);
  } catch (error) {
    setStatus(`Extract checkpoint knowledge failed: ${String(error)}`);
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

  document.getElementById('search').addEventListener('input', (event) => {
    state.q = String(event.target.value || '').trim();
    renderAll();
  });

  document.getElementById('ctxSel').addEventListener('change', async (event) => {
    const nextId = String(event.target.value || '');
    if (!nextId) return;
    await selectContext(nextId);
    state.activeBranchKey = null;
    resetBranchScopedState();
    await loadBranches();
    await loadSessions();
    await loadSessionDetail();
    await loadTurns();
    await loadPayload(state.turns[0]?.nodeId || null);
    await loadCheckpoints();
    await loadCheckpointDetail();
    await loadHandoff();
    await loadGraph();
    renderAll();
  });

  document.getElementById('refresh').addEventListener('click', () => void refreshAll());
  document.getElementById('restart').addEventListener('click', async () => {
    try {
      const result = await invoke('restart_connector', {});
      setStatus(String(result || 'Connector restarted.'));
      await refreshAll();
    } catch (error) {
      setStatus(`Restart failed: ${String(error)}`);
    }
  });

  document.getElementById('copyLogin').addEventListener('click', () => void copyText('0ctx shell'));
  document.getElementById('runtimeBannerRefresh').addEventListener('click', () => void refreshAll());
  document.getElementById('runtimeBannerSetup').addEventListener('click', () => setView('setup'));
  document.getElementById('heroPrimary').addEventListener('click', (event) => void performHeroAction(event.currentTarget.dataset.action));
  document.getElementById('heroSecondary').addEventListener('click', (event) => void performHeroAction(event.currentTarget.dataset.action));
  document.getElementById('ctxForm').addEventListener('submit', createContext);
  document.getElementById('pickFolder').addEventListener('click', async () => {
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
  document.getElementById('inclHidden').addEventListener('change', async (event) => {
    state.includeHidden = Boolean(event.target.checked);
    await loadGraph();
    renderAll();
  });
  document.getElementById('togglePayload').addEventListener('click', () => {
    const turn = selectedTurn();
    if (!turn || !turn.hasPayload) return;
    state.payloadExpanded = !state.payloadExpanded;
    renderSessions();
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
  document.getElementById('rewindCheckpointBtn').addEventListener('click', () => void rewindActiveCheckpoint());
  document.getElementById('explainCheckpointBtn').addEventListener('click', () => void explainActiveCheckpoint());

  document.getElementById('copyHookInstall').addEventListener('click', () => void copyText(hookInstallCommand()));
  document.getElementById('copyIngest').addEventListener('click', () => void copyText(hookIngestCommand()));
  document.getElementById('copyShell').addEventListener('click', () => void copyText('0ctx shell'));
  document.getElementById('copyRepair').addEventListener('click', () => void copyText('0ctx repair'));
  document.getElementById('copyDoctor').addEventListener('click', () => void copyText('0ctx doctor'));
  document.getElementById('checkUpdates').addEventListener('click', async () => {
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
      state.payload = null;
      state.payloadExpanded = false;
        state.activeCheckpointId = null;
        state.checkpointDetail = null;
        state.checkpointSessionDetail = null;
        state.checkpointKnowledgePreview = null;
        state.checkpointKnowledgeSelectedKeys = [];
      await loadSessions();
      await loadSessionDetail();
      await loadTurns();
      await loadPayload(state.turns[0]?.nodeId || null);
      await loadCheckpoints();
      await loadCheckpointDetail();
      await loadHandoff();
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
      state.payload = null;
      state.payloadExpanded = false;
      await loadSessionDetail();
      await loadTurns();
      await loadPayload(state.turns[0]?.nodeId || null);
      await loadCheckpoints();
      await loadCheckpointDetail();
      await loadHandoff();
      if (sessionTarget.dataset.openView) {
        setView(sessionTarget.dataset.openView);
      }
      renderAll();
      return;
    }

    const turnTarget = event.target.closest('[data-turn-id]');
    if (turnTarget) {
      state.activeTurnId = String(turnTarget.getAttribute('data-turn-id'));
      state.payloadExpanded = false;
      await loadPayload(state.activeTurnId);
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
      await loadPayload(state.turns[0]?.nodeId || null);
      await loadCheckpoints();
      await loadCheckpointDetail();
      await loadHandoff();
      await loadGraph();
      renderAll();
    }
  });

  document.body.addEventListener('change', (event) => {
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
  setInterval(() => {
    void refreshAll();
  }, 15000);
}

void boot();
