import type { Checkpoint, ContextNode, NodeType } from './base';

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

export interface InsightSummary {
    contextId: string;
    nodeId: string;
    type: Exclude<NodeType, 'artifact'>;
    content: string;
    createdAt: number;
    branch: string | null;
    worktreePath: string | null;
    source: string | null;
    key: string | null;
    evidenceCount: number;
    distinctEvidenceCount: number;
    distinctSessionCount: number;
    corroboratedRoles: string[];
    trustFlags: string[];
    latestEvidenceAt: number | null;
    evidencePreview: string[];
    trustTier: 'strong' | 'review' | 'weak';
    trustSummary: string;
    promotionState: 'ready' | 'review' | 'blocked';
    promotionSummary: string;
    originContextId: string | null;
    originNodeId: string | null;
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
    distinctEvidenceCount?: number;
    evidenceSummary?: string | null;
    sourceExcerpt?: string | null;
    evidencePreview?: string[];
    corroboratedRoles?: string[];
    trustFlags?: string[];
    reviewTier?: 'strong' | 'review' | 'weak';
    reviewSummary?: string | null;
    autoPersist?: boolean;
    autoPersistSummary?: string | null;
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

export interface CheckpointSummary {
    checkpointId: string;
    contextId: string;
    branch: string | null;
    worktreePath: string | null;
    sessionId: string | null;
    commitSha: string | null;
    createdAt: number;
    summary: string;
    kind: import('./base').CheckpointKind;
    name: string;
    agentSet: string[];
}
