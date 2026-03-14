import type {
  ChatSessionDetail,
  CheckpointDetail,
  DataPolicy,
  HookHealth,
  RepoReadiness,
  WorkstreamComparison,
  WorkspaceComparison
} from '../../shared/types/domain';

function readString(params: Record<string, unknown>, key: string) {
  const value = params[key];
  return typeof value === 'string' ? value : null;
}

function buildDefaultDataPolicy(): DataPolicy {
  return {
    syncPolicy: 'local_only',
    captureRetentionDays: 14,
    debugRetentionDays: 7,
    debugArtifacts: false,
    debugArtifactsEnabled: false,
    preset: 'lean',
    normalPathSummary: 'Lean is the normal default. Workspace sync stays local_only and machine capture defaults stay local.',
    workspaceSyncSummary: 'local_only (default)',
    workspaceSyncHint: '',
    machineCaptureSummary: '14d local capture; debug trails off by default (7d if enabled)',
    debugUtilitySummary: 'Off in the normal path (7d retention if enabled)',
    policyActionHint: 'Start the local daemon to inspect current workspace policy values.'
  };
}

function buildDefaultHookHealth(): HookHealth {
  return {
    readyCount: 0,
    capturePolicy: {
      captureRetentionDays: 14,
      debugRetentionDays: 7,
      debugArtifactsEnabled: false
    },
    agents: [
      { agent: 'claude', status: 'Skipped', installed: false, sessionStartInstalled: false, command: null, updatedAt: null, notes: 'supported' },
      { agent: 'factory', status: 'Skipped', installed: false, sessionStartInstalled: false, command: null, updatedAt: null, notes: 'supported' },
      { agent: 'antigravity', status: 'Skipped', installed: false, sessionStartInstalled: false, command: null, updatedAt: null, notes: 'supported' }
    ],
    previewAgents: []
  };
}

function buildDefaultRepoReadiness(params: Record<string, unknown>): RepoReadiness {
  return {
    repoRoot: readString(params, 'repoRoot'),
    workspaceName: null,
    workstream: null,
    ready: false,
    zeroTouchReady: false,
    summary: 'Local daemon is unavailable.',
    syncPolicy: 'local_only',
    captureRetentionDays: 14,
    debugRetentionDays: 7,
    debugArtifactsEnabled: false,
    dataPolicyPreset: 'lean',
    captureReadyAgents: [],
    autoContextAgents: []
  };
}

function buildDefaultSessionDetail(): ChatSessionDetail {
  return {
    session: null,
    messages: [],
    checkpointCount: 0,
    latestCheckpoint: null
  };
}

function buildDefaultCheckpointDetail(): CheckpointDetail {
  return {
    checkpoint: {},
    metadata: null
  };
}

function buildDefaultWorkspaceComparison(params: Record<string, unknown>): WorkspaceComparison {
  const sourceContextId = readString(params, 'sourceContextId') ?? 'source';
  const targetContextId = readString(params, 'targetContextId') ?? 'target';
  return {
    source: {
      contextId: sourceContextId,
      workspaceName: 'Source workspace',
      paths: [],
      syncPolicy: 'local_only',
      workstreamCount: 0,
      sessionCount: 0,
      checkpointCount: 0,
      insightCount: 0,
      latestActivityAt: null,
      agents: []
    },
    target: {
      contextId: targetContextId,
      workspaceName: 'Target workspace',
      paths: [],
      syncPolicy: 'local_only',
      workstreamCount: 0,
      sessionCount: 0,
      checkpointCount: 0,
      insightCount: 0,
      latestActivityAt: null,
      agents: []
    },
    sharedRepositoryPaths: [],
    sharedAgents: [],
    sourceOnlyAgents: [],
    targetOnlyAgents: [],
    sharedWorkstreams: [],
    sharedInsights: [],
    comparisonKind: 'isolated',
    comparisonSummary: 'Local daemon unavailable, so workspace comparison data is not loaded.',
    comparisonActionHint: 'Start the local daemon to compare workspace state.',
    comparisonText: 'Local daemon unavailable.'
  };
}

function buildDefaultWorkstreamComparison(params: Record<string, unknown>): WorkstreamComparison {
  const sourceBranch = readString(params, 'sourceBranch') ?? 'source';
  const sourceWorktreePath = readString(params, 'sourceWorktreePath');
  const targetBranch = readString(params, 'targetBranch') ?? 'target';
  const targetWorktreePath = readString(params, 'targetWorktreePath');

  return {
    contextId: readString(params, 'contextId') ?? 'unknown',
    workspaceName: 'Unavailable',
    source: {
      branch: sourceBranch,
      worktreePath: sourceWorktreePath,
      repositoryRoot: null,
      sessionCount: 0,
      checkpointCount: 0,
      agentSet: []
    },
    target: {
      branch: targetBranch,
      worktreePath: targetWorktreePath,
      repositoryRoot: null,
      sessionCount: 0,
      checkpointCount: 0,
      agentSet: []
    },
    comparisonKind: 'not_comparable',
    comparisonReadiness: 'blocked',
    comparisonSummary: 'Local daemon unavailable, so workstream comparison data is not loaded.',
    comparisonActionHint: 'Start the local daemon to compare workstream state.',
    comparisonText: 'Local daemon unavailable.',
    sharedAgents: [],
    sourceOnlyAgents: [],
    targetOnlyAgents: [],
    mergeRisk: 'unknown',
    mergeRiskSummary: 'Local daemon unavailable.'
  };
}

export function buildOfflineDaemonFallback(method: string, params: Record<string, unknown> = {}): unknown | undefined {
  switch (method) {
    case 'listContexts':
    case 'listBranchLanes':
    case 'listBranchSessions':
    case 'listChatSessions':
    case 'listSessionMessages':
    case 'listBranchCheckpoints':
    case 'listCheckpoints':
    case 'listWorkstreamInsights':
    case 'getHandoffTimeline':
    case 'pollEvents':
      return [];
    case 'getSessionDetail':
      return buildDefaultSessionDetail();
    case 'getCheckpointDetail':
      return buildDefaultCheckpointDetail();
    case 'getDataPolicy':
      return buildDefaultDataPolicy();
    case 'getRepoReadiness':
      return buildDefaultRepoReadiness(params);
    case 'compareWorkspaces':
      return buildDefaultWorkspaceComparison(params);
    case 'compareWorkstreams':
      return buildDefaultWorkstreamComparison(params);
    case 'getHookHealth':
      return buildDefaultHookHealth();
    case 'subscribeEvents':
      return { subscriptionId: null, lastAckedSequence: 0 };
    case 'unsubscribeEvents':
    case 'ackEvent':
      return { ok: true };
    default:
      return undefined;
  }
}
