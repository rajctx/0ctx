import type { SyncPolicy } from './base';
import type {
    AgentSessionSummary,
    CheckpointSummary,
    HandoffTimelineEntry,
    InsightSummary
} from './runtime';

export interface BranchLaneSummary {
    contextId: string;
    branch: string;
    worktreePath: string | null;
    repositoryRoot: string | null;
    currentHeadSha: string | null;
    currentHeadRef: string | null;
    isDetachedHead: boolean | null;
    headDiffersFromCaptured: boolean | null;
    lastAgent: string | null;
    lastCommitSha: string | null;
    lastActivityAt: number;
    sessionCount: number;
    checkpointCount: number;
    agentSet: string[];
    upstream: string | null;
    aheadCount: number | null;
    behindCount: number | null;
    mergeBaseSha: string | null;
    isCurrent: boolean | null;
    checkedOutWorktreePaths?: string[];
    checkedOutHere?: boolean | null;
    checkedOutElsewhere?: boolean | null;
    captureDrift: WorkstreamCaptureDrift | null;
    hasUncommittedChanges: boolean | null;
    hasMergeConflicts?: boolean | null;
    unmergedCount?: number | null;
    stagedChangeCount: number | null;
    unstagedChangeCount: number | null;
    untrackedCount: number | null;
    baseline?: WorkstreamBaselineComparison | null;
    stateKind?: 'current' | 'ahead' | 'behind' | 'diverged' | 'detached' | 'drifted' | 'dirty' | 'conflicted' | 'elsewhere' | 'isolated' | 'unknown';
    stateSummary?: string | null;
    stateActionHint?: string | null;
    handoffReadiness?: 'ready' | 'review' | 'blocked';
    handoffSummary?: string | null;
    handoffBlockers?: string[];
    handoffReviewItems?: string[];
}

export interface WorkstreamBaselineComparison {
    branch: string | null;
    repositoryRoot: string | null;
    comparable: boolean;
    sameBranch: boolean;
    aheadCount: number | null;
    behindCount: number | null;
    mergeBaseSha: string | null;
    summary: string;
}

export interface WorkstreamCaptureDrift {
    comparable: boolean;
    kind: 'same' | 'ahead' | 'behind' | 'diverged' | 'unknown';
    currentAheadCount: number | null;
    currentBehindCount: number | null;
    mergeBaseSha: string | null;
    summary: string | null;
    actionHint: string | null;
}

export interface WorkstreamBrief {
    contextId: string;
    workspaceName: string;
    branch: string | null;
    worktreePath: string | null;
    repositoryRoot: string | null;
    currentHeadSha: string | null;
    currentHeadRef: string | null;
    isDetachedHead: boolean | null;
    headDiffersFromCaptured: boolean | null;
    tracked: boolean;
    sessionCount: number;
    checkpointCount: number;
    lastAgent: string | null;
    lastCommitSha: string | null;
    lastActivityAt: number | null;
    upstream: string | null;
    aheadCount: number | null;
    behindCount: number | null;
    mergeBaseSha: string | null;
    isCurrent: boolean | null;
    checkedOutWorktreePaths?: string[];
    checkedOutHere?: boolean | null;
    checkedOutElsewhere?: boolean | null;
    captureDrift: WorkstreamCaptureDrift | null;
    hasUncommittedChanges: boolean | null;
    hasMergeConflicts?: boolean | null;
    unmergedCount?: number | null;
    stagedChangeCount: number | null;
    unstagedChangeCount: number | null;
    untrackedCount: number | null;
    baseline: WorkstreamBaselineComparison | null;
    stateKind?: 'current' | 'ahead' | 'behind' | 'diverged' | 'detached' | 'drifted' | 'dirty' | 'conflicted' | 'elsewhere' | 'isolated' | 'unknown';
    stateSummary?: string | null;
    stateActionHint?: string | null;
    handoffReadiness?: 'ready' | 'review' | 'blocked';
    handoffSummary?: string | null;
    handoffBlockers?: string[];
    handoffReviewItems?: string[];
    recentSessions: AgentSessionSummary[];
    latestCheckpoints: CheckpointSummary[];
    insights: InsightSummary[];
    contextText: string;
}

export interface WorkstreamComparison {
    contextId: string;
    workspaceName: string;
    source: WorkstreamBrief;
    target: WorkstreamBrief;
    comparable: boolean;
    sameRepository: boolean;
    sourceAheadCount: number | null;
    targetAheadCount: number | null;
    mergeBaseSha: string | null;
    newerSide: 'source' | 'target' | 'same' | 'unknown';
    comparisonKind: 'aligned' | 'source_ahead' | 'target_ahead' | 'diverged' | 'different_repository' | 'not_comparable';
    comparisonReadiness: 'ready' | 'review' | 'blocked';
    comparisonSummary: string;
    comparisonActionHint: string | null;
    reconcileStrategy:
        | 'none'
        | 'fast_forward_target_to_source'
        | 'fast_forward_source_to_target'
        | 'rebase_source_on_target'
        | 'rebase_target_on_source'
        | 'manual_conflict_resolution'
        | 'blocked'
        | 'unknown';
    reconcileStrategySummary: string;
    reconcileSteps: string[];
    comparisonBlockers: string[];
    comparisonReviewItems: string[];
    sharedAgents: string[];
    sourceOnlyAgents: string[];
    targetOnlyAgents: string[];
    sourceChangedFileCount: number | null;
    targetChangedFileCount: number | null;
    sharedChangedFileCount: number | null;
    sharedChangedFiles: string[];
    sharedChangedAreas: string[];
    sourceOnlyChangedFiles: string[];
    targetOnlyChangedFiles: string[];
    changeOverlapKind: 'none' | 'partial' | 'high' | 'unknown';
    changeOverlapSummary: string;
    sharedConflictLikelyCount: number | null;
    sharedConflictLikelyFiles: string[];
    lineOverlapKind: 'none' | 'partial' | 'high' | 'unknown';
    lineOverlapSummary: string;
    changeHotspotSummary: string;
    mergeRisk: 'low' | 'medium' | 'high' | 'blocked' | 'unknown';
    mergeRiskSummary: string;
    comparisonText: string;
}

export interface WorkspaceComparisonSide {
    contextId: string;
    workspaceName: string;
    paths: string[];
    syncPolicy: SyncPolicy;
    workstreamCount: number;
    sessionCount: number;
    checkpointCount: number;
    insightCount: number;
    latestActivityAt: number | null;
    agents: string[];
    workstreams: Array<{
        branch: string;
        worktreePath: string | null;
        stateKind: BranchLaneSummary['stateKind'];
        lastActivityAt: number;
    }>;
    recentInsights: InsightSummary[];
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
    comparisonKind: 'same_repository' | 'shared_insights' | 'shared_workstreams' | 'shared_agents' | 'isolated';
    comparisonSummary: string;
    comparisonActionHint: string | null;
    comparisonText: string;
}

export interface AgentContextPack {
    contextId: string;
    workspaceName: string;
    branch: string | null;
    worktreePath: string | null;
    repositoryRoot: string | null;
    workstream: WorkstreamBrief;
    baseline: WorkstreamBaselineComparison | null;
    recentSessions: AgentSessionSummary[];
    latestCheckpoints: CheckpointSummary[];
    insights: InsightSummary[];
    handoffTimeline: HandoffTimelineEntry[];
    promptText: string;
}

export type DataPolicyPreset = 'lean' | 'review' | 'debug' | 'shared' | 'custom';

export interface DataPolicySummary {
    contextId: string | null;
    workspaceResolved: boolean;
    syncScope: 'workspace';
    captureScope: 'machine';
    debugScope: 'machine';
    syncPolicy: SyncPolicy;
    captureRetentionDays: number;
    debugRetentionDays: number;
    debugArtifactsEnabled: boolean;
    preset: DataPolicyPreset;
}

export interface RepoReadinessSummary {
    repoRoot: string;
    contextId: string | null;
    workspaceName: string | null;
    workstream: string | null;
    sessionCount: number | null;
    checkpointCount: number | null;
    syncPolicy: SyncPolicy | null;
    syncScope: 'workspace';
    captureScope: 'machine';
    debugScope: 'machine';
    captureReadyAgents: string[];
    autoContextAgents: string[];
    autoContextMissingAgents: string[];
    sessionStartMissingAgents: string[];
    mcpRegistrationMissingAgents: string[];
    captureMissingAgents: string[];
    captureManagedForRepo: boolean;
    zeroTouchReady: boolean;
    nextActionHint: string | null;
    dataPolicyPreset: DataPolicyPreset | string | null;
    dataPolicyActionHint: string | null;
    captureRetentionDays: number;
    debugRetentionDays: number;
    debugArtifactsEnabled: boolean;
}
