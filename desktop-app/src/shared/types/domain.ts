export type DesktopPosture = 'Connected' | 'Degraded' | 'Offline';

export type ThemeMode = 'midnight' | 'dawn';

export interface WorkspaceContext {
  id: string;
  name: string;
  paths: string[];
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface WorkstreamSummary {
  branch: string;
  worktreePath?: string | null;
  repositoryRoot?: string | null;
  currentHeadSha?: string | null;
  currentHeadRef?: string | null;
  lastCommitSha?: string | null;
  lastAgent?: string | null;
  isCurrent?: boolean;
  checkedOutHere?: boolean | null;
  checkedOutElsewhere?: boolean | null;
  sessionCount?: number;
  checkpointCount?: number;
  lastActivityAt?: string | number | null;
  summary?: string | null;
  stateKind?: string | null;
  stateSummary?: string | null;
  stateActionHint?: string | null;
  handoffReadiness?: 'ready' | 'review' | 'blocked' | null;
  handoffSummary?: string | null;
  agentSet?: string[];
}

export interface ChatSessionSummary {
  sessionId: string;
  title?: string | null;
  summary?: string | null;
  branch?: string | null;
  worktreePath?: string | null;
  repositoryRoot?: string | null;
  startedAt?: string | number | null;
  lastTurnAt?: string | number | null;
  createdAt?: string | number | null;
  updatedAt?: string | number | null;
  messageCount?: number;
  turnCount?: number;
  commitSha?: string | null;
  agent?: string | null;
  captureSource?: string | null;
}

export interface ChatSessionDetail {
  session: ChatSessionSummary | null;
  messages: ChatMessage[];
  checkpointCount: number;
  latestCheckpoint: CheckpointSummary | null;
}

export interface ChatMessage {
  nodeId: string;
  role?: string | null;
  kind?: string | null;
  content?: string | null;
  prompt?: string | null;
  reply?: string | null;
  createdAt?: string | number | null;
  commitSha?: string | null;
  agent?: string | null;
  worktreePath?: string | null;
  repositoryRoot?: string | null;
  sessionTitle?: string | null;
}

export interface CheckpointSummary {
  checkpointId: string;
  summary?: string | null;
  kind?: string | null;
  branch?: string | null;
  worktreePath?: string | null;
  sessionId?: string | null;
  commitSha?: string | null;
  createdAt?: string | null;
  agentSet?: string[];
}

export interface CheckpointDetail {
  checkpoint: Record<string, unknown> & {
    checkpointId?: string;
    sessionId?: string | null;
    summary?: string | null;
  };
  metadata?: Record<string, unknown> | null;
}

export interface InsightSummary {
  nodeId: string;
  type?: string | null;
  key?: string | null;
  title?: string | null;
  content?: string | null;
  branch?: string | null;
  worktreePath?: string | null;
  createdAt?: string | number | null;
  trustSummary?: string | null;
  promotionSummary?: string | null;
}

export interface DataPolicy {
  syncPolicy?: string | null;
  captureRetentionDays?: number | null;
  debugRetentionDays?: number | null;
  debugArtifacts?: boolean | null;
  debugArtifactsEnabled?: boolean | null;
  preset?: string | null;
  normalPathSummary?: string | null;
  workspaceSyncSummary?: string | null;
  workspaceSyncHint?: string | null;
  machineCaptureSummary?: string | null;
  debugUtilitySummary?: string | null;
  policyActionHint?: string | null;
}

export interface RepoReadiness {
  repoRoot?: string | null;
  workspaceName?: string | null;
  workstream?: string | null;
  ready?: boolean | null;
  zeroTouchReady?: boolean | null;
  summary?: string | null;
  syncPolicy?: string | null;
  captureRetentionDays?: number | null;
  debugRetentionDays?: number | null;
  debugArtifactsEnabled?: boolean | null;
  dataPolicyPreset?: string | null;
  captureReadyAgents?: string[];
  autoContextAgents?: string[];
}

export interface WorkspaceComparisonSide {
  contextId: string;
  workspaceName: string;
  paths: string[];
  syncPolicy?: string | null;
  workstreamCount: number;
  sessionCount: number;
  checkpointCount: number;
  insightCount: number;
  latestActivityAt?: number | null;
  agents: string[];
}

export interface WorkspaceComparison {
  source: WorkspaceComparisonSide;
  target: WorkspaceComparisonSide;
  sharedRepositoryPaths: string[];
  sharedAgents: string[];
  sourceOnlyAgents: string[];
  targetOnlyAgents: string[];
  sharedWorkstreams: string[];
  sharedInsights: string[];
  comparisonKind: 'isolated' | 'same_repository' | 'shared_workstreams' | 'shared_insights' | 'shared_agents';
  comparisonSummary: string;
  comparisonActionHint?: string | null;
  comparisonText: string;
}

export interface HookHealth {
  statePath?: string | null;
  projectRoot?: string | null;
  contextId?: string | null;
  projectConfigPath?: string | null;
  updatedAt?: string | number | null;
  readyCount?: number;
  capturePolicy?: {
    captureRetentionDays?: number | null;
    debugRetentionDays?: number | null;
    debugArtifactsEnabled?: boolean | null;
  };
  agents?: Array<{
    agent?: string | null;
    status?: 'Supported' | 'Planned' | 'Skipped' | null;
    installed?: boolean | null;
    command?: string | null;
    sessionStartInstalled?: boolean | null;
    updatedAt?: string | number | null;
    notes?: string | null;
  }>;
  previewAgents?: Array<Record<string, unknown>>;
}

export interface DaemonCapabilities {
  methods: string[];
}

export interface DaemonStatus {
  health: Record<string, unknown>;
  contexts: WorkspaceContext[];
  capabilities: DaemonCapabilities;
  storage: {
    dataDir?: string;
    dbPath?: string;
    socketPath?: string;
    hookStatePath?: string;
  };
}

export interface ConnectorStatus {
  running: boolean;
  pid: number | null;
  restartCount: number;
  command: string | null;
  lastError: string | null;
}

export interface UpdateStatus {
  state: 'idle' | 'available' | 'downloaded' | 'error';
  message: string;
  version?: string | null;
}

export interface WorkstreamComparison {
  contextId: string;
  workspaceName: string;
  source: WorkstreamSummary;
  target: WorkstreamSummary;
  comparisonKind: string;
  comparisonReadiness?: string | null;
  comparisonSummary: string;
  comparisonActionHint?: string | null;
  comparisonText: string;
  sharedAgents: string[];
  sourceOnlyAgents: string[];
  targetOnlyAgents: string[];
  mergeRisk?: string | null;
  mergeRiskSummary?: string | null;
}

export interface DesktopPreferences {
  theme: ThemeMode;
  lastRoute: string;
}

export interface DesktopEventMessage {
  kind: 'daemon-event' | 'posture';
  posture?: DesktopPosture;
  payload?: Record<string, unknown>;
}
