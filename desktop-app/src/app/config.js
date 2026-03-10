(() => {
  window.OctxDesktop = window.OctxDesktop || {};
  const app = window.OctxDesktop;
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
      summary: 'Choose a session, read the message stream, and capture a checkpoint when the work becomes worth preserving.',
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
    'getDataPolicy',
    'listBranchLanes',
    'listBranchSessions',
    'listSessionMessages',
    'listBranchCheckpoints',
    'listWorkstreamInsights',
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
    insights: [],
    graphNodes: [],
    graphEdges: [],
    includeHidden: false,
    workspaceComparisonTargetContextId: null,
    workspaceComparison: null,
    health: {},
    caps: [],
    auth: { authenticated: true, provider: 'local' },
    hook: null,
    dataPolicy: null,
    runtimeIssue: null,
    sessionKnowledgePreview: null,
    sessionKnowledgeSelectedKeys: [],
    checkpointKnowledgePreview: null,
    checkpointKnowledgeSelectedKeys: [],
    activeInsightNodeId: null,
    promotionTargetContextId: null,
    lastInsightPromotion: null,
    subscriptionId: null,
    subscriptionContextId: null,
    lastSeq: 0,
    storage: {}
  };

  const bridge = window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function'
    ? window.__TAURI__.core.invoke.bind(window.__TAURI__.core)
    : null;

  Object.assign(app, { VIEW_META, SEARCH_HINTS, REQUIRED_RUNTIME_METHODS, MUTATION_EVENT_TYPES, EVENT_POLL_MS, HEALTH_REFRESH_MS, GA_INTEGRATIONS, state, bridge });
})();
