// Node types — universal, works for any domain (legal, design, research, dev, etc.)
export type NodeType =
    | 'background'      // essential context about who/what/why
    | 'decision'        // a choice made, with reasoning
    | 'constraint'      // a hard limit or requirement
    | 'goal'            // what is being achieved
    | 'assumption'      // believed true, not yet verified
    | 'open_question'   // unresolved issue still in flight
    | 'artifact';       // canonical content, document, or reference

// Edge types
export type EdgeType = 'caused_by' | 'constrains' | 'supersedes' | 'depends_on' | 'contradicts';

export interface ContextNode {
    id: string;              // uuid
    contextId: string;       // Foreign key to Context
    thread?: string;         // optional thread within a context
    type: NodeType;
    content: string;
    key?: string;            // optional named key for direct lookup
    tags?: string[];
    source?: string;         // which tool created this
    hidden?: boolean;        // hidden nodes are excluded from default graph/search views
    createdAt: number;       // unix ms
    checkpointId?: string;   // which checkpoint this belongs to
}

export interface ContextEdge {
    id: string;
    fromId: string;
    toId: string;
    relation: EdgeType;
    createdAt: number;
}

export interface Checkpoint {
    id: string;
    contextId: string;
    name: string;
    nodeIds: string[];        // snapshot of which nodes existed
    kind: CheckpointKind;
    sessionId?: string | null;
    branch?: string | null;
    worktreePath?: string | null;
    commitSha?: string | null;
    summary?: string | null;
    agentSet: string[];
    createdAt: number;
}

// A context is universal — could be a legal case, design brief, research project, codebase, etc.
// This allows non-devs to group nodes logically without needing directories.
export interface Context {
    id: string;               // uuid
    name: string;             // Human readable name (e.g. "Acme Corp Legal Case")
    paths: string[];          // mapped local paths (optional — many contexts are not tied to a directory)
    syncPolicy: SyncPolicy;   // per-context sync egress policy
    createdAt: number;
}

export type AuditAction =
    | 'create_context'
    | 'delete_context'
    | 'switch_context'
    | 'add_node'
    | 'update_node'
    | 'delete_node'
    | 'add_edge'
    | 'save_checkpoint'
    | 'rewind'
    | 'create_backup'
    | 'restore_backup'
    | 'set_sync_policy'
    | 'set_data_policy'
    | 'resume_session'
    | 'explain_checkpoint'
    | 'extract_knowledge'
    | 'promote_insight'
    | 'sync_upload'
    | 'sync_merge'
    | 'recall_feedback';

export interface AuditMetadata {
    actor?: string | null;
    source?: string | null;
    sessionToken?: string | null;
    connectionId?: string | null;
    requestId?: string | null;
    method?: string | null;
}

export interface AuditEntry {
    id: string;
    action: AuditAction;
    contextId?: string | null;
    payload: Record<string, unknown>;
    result?: Record<string, unknown> | null;
    actor?: string | null;
    source?: string | null;
    sessionToken?: string | null;
    connectionId?: string | null;
    requestId?: string | null;
    createdAt: number;
}

export interface ContextDump {
    version: 1;
    exportedAt: number;
    context: Context;
    nodes: ContextNode[];
    edges: ContextEdge[];
    checkpoints: Checkpoint[];
    nodePayloads?: NodePayloadRecord[];
    checkpointPayloads?: CheckpointPayloadRecord[];
}

export type SearchMatchReason =
    | 'exact_term'
    | 'tag_match'
    | 'recent_mutation'
    | 'connected_to_hot_node';

export interface SearchAdvancedOptions {
    limit?: number;
    sinceMs?: number;
    includeSuperseded?: boolean;
    includeHidden?: boolean;
}

export interface SearchResult {
    node: ContextNode;
    score: number;
    matchReason: SearchMatchReason;
    matchedTerms: string[];
}

export type NodePayloadCompression = 'gzip' | 'none';

export interface NodePayloadRecord {
    nodeId: string;
    contextId: string;
    contentType: string;
    compression: NodePayloadCompression;
    byteLength: number;
    payload: unknown;
    createdAt: number;
    updatedAt: number;
}

export type CheckpointKind = 'manual' | 'session' | 'legacy';

export interface CheckpointPayloadRecord {
    checkpointId: string;
    contextId: string;
    contentType: string;
    compression: NodePayloadCompression;
    byteLength: number;
    payload: unknown;
    createdAt: number;
    updatedAt: number;
}

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
    hasUncommittedChanges: boolean | null;
    stagedChangeCount: number | null;
    unstagedChangeCount: number | null;
    untrackedCount: number | null;
    baseline?: WorkstreamBaselineComparison | null;
    stateKind?: 'current' | 'ahead' | 'behind' | 'diverged' | 'detached' | 'drifted' | 'dirty' | 'elsewhere' | 'isolated' | 'unknown';
    stateSummary?: string | null;
    stateActionHint?: string | null;
    handoffReadiness?: 'ready' | 'review' | 'blocked';
    handoffSummary?: string | null;
    handoffBlockers?: string[];
    handoffReviewItems?: string[];
}

export interface AgentSessionSummary extends ChatSessionSummary {
    agent: string | null;
    worktreePath: string | null;
    repositoryRoot: string | null;
    captureSource: string | null;
}

export interface SessionMessage extends ChatTurnSummary {
    messageId: string;
    parentId: string | null;
    agent: string | null;
    worktreePath: string | null;
    repositoryRoot: string | null;
    captureSource: string | null;
    sessionTitle: string | null;
}

export interface CheckpointSummary {
    checkpointId: string;
    contextId: string;
    branch: string | null;
    worktreePath: string | null;
    sessionId: string | null;
    commitSha: string | null;
    createdAt: number;
    summary: string;
    kind: CheckpointKind;
    name: string;
    agentSet: string[];
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
    hasUncommittedChanges: boolean | null;
    stagedChangeCount: number | null;
    unstagedChangeCount: number | null;
    untrackedCount: number | null;
    baseline: WorkstreamBaselineComparison | null;
    stateKind?: 'current' | 'ahead' | 'behind' | 'diverged' | 'detached' | 'drifted' | 'dirty' | 'elsewhere' | 'isolated' | 'unknown';
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
    syncPolicy: SyncPolicy;
    captureRetentionDays: number;
    debugRetentionDays: number;
    debugArtifactsEnabled: boolean;
    preset: DataPolicyPreset;
}

export interface InsightSummary {
    contextId: string;
    nodeId: string;
    type: Exclude<NodeType, 'artifact'>;
    content: string;
    createdAt: number;
    branch: string | null;
    worktreePath: string | null;
    source: string | null;
}

export interface SessionDetail {
    session: AgentSessionSummary | null;
    messages: SessionMessage[];
    checkpointCount: number;
    latestCheckpoint: CheckpointSummary | null;
}

export interface CheckpointDetail {
    checkpoint: Checkpoint;
    snapshotNodeCount: number;
    snapshotEdgeCount: number;
    snapshotCheckpointCount: number;
    payloadAvailable: boolean;
}

export interface HandoffTimelineEntry {
    branch: string;
    worktreePath: string | null;
    sessionId: string;
    agent: string | null;
    summary: string;
    startedAt: number;
    lastTurnAt: number;
    commitSha: string | null;
}

export interface KnowledgeCandidate {
    contextId: string;
    source: 'session' | 'checkpoint';
    sessionId: string | null;
    checkpointId: string | null;
    type: Exclude<NodeType, 'artifact'>;
    content: string;
    key: string;
    action: 'create' | 'reuse';
    existingNodeId: string | null;
    sourceNodeId: string | null;
    messageId: string | null;
    role: string | null;
    createdAt: number;
    confidence?: number;
    reason?: string | null;
    evidenceCount?: number;
}

export interface KnowledgePreviewResult {
    contextId: string;
    source: 'session' | 'checkpoint';
    sessionId: string | null;
    checkpointId: string | null;
    candidateCount: number;
    createCount: number;
    reuseCount: number;
    candidates: KnowledgeCandidate[];
}

export interface KnowledgeExtractionResult {
    contextId: string;
    source: 'session' | 'checkpoint';
    sessionId: string | null;
    checkpointId: string | null;
    createdCount: number;
    reusedCount: number;
    nodeCount: number;
    nodes: ContextNode[];
}

export interface InsightPromotionResult {
    sourceContextId: string;
    targetContextId: string;
    sourceNodeId: string;
    targetNodeId: string;
    type: Exclude<NodeType, 'artifact'>;
    content: string;
    branch: string | null;
    worktreePath: string | null;
    key: string;
    created: boolean;
    reused: boolean;
}

export interface ChatSessionSummary {
    sessionId: string;
    sessionNodeId: string | null;
    summary: string;
    startedAt: number;
    lastTurnAt: number;
    turnCount: number;
    branch: string | null;
    commitSha: string | null;
    agent?: string | null;
    worktreePath?: string | null;
    repositoryRoot?: string | null;
    captureSource?: string | null;
}

export interface ChatTurnSummary {
    nodeId: string;
    contextId: string;
    sessionId: string;
    key: string | null;
    type: NodeType;
    content: string;
    tags: string[];
    source: string | null;
    hidden: boolean;
    createdAt: number;
    role: string | null;
    branch: string | null;
    commitSha: string | null;
    messageId?: string | null;
    parentId?: string | null;
    agent?: string | null;
    worktreePath?: string | null;
    repositoryRoot?: string | null;
    captureSource?: string | null;
    sessionTitle?: string | null;
    hasPayload: boolean;
    payloadBytes: number | null;
}

// ── SYNC-01: Sync types ────────────────────────────────────────

export type SyncStatus = 'pending' | 'in_flight' | 'done' | 'failed';

export interface SyncQueueEntry {
    id: string;
    contextId: string;
    status: SyncStatus;
    retryCount: number;
    lastError?: string | null;
    createdAt: number;       // unix ms
    updatedAt: number;       // unix ms
}

export interface SyncEnvelope {
    version: 1;
    contextId: string;
    tenantId: string;
    userId: string;          // user email or identifier from auth
    timestamp: number;       // unix ms
    encrypted: boolean;
    syncPolicy?: SyncPolicy;
    payload: unknown;        // EncryptedPayload or raw ContextDump
}

export type SyncPolicy = 'local_only' | 'metadata_only' | 'full_sync';

