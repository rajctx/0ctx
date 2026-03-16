export type NodeType =
    | 'background'
    | 'decision'
    | 'constraint'
    | 'goal'
    | 'assumption'
    | 'open_question'
    | 'artifact';

export type EdgeType = 'caused_by' | 'constrains' | 'supersedes' | 'depends_on' | 'contradicts';
export type CheckpointKind = 'manual' | 'session' | 'legacy';
export type SyncPolicy = 'local_only' | 'metadata_only' | 'full_sync';
export type NodePayloadCompression = 'gzip' | 'none';
export type SyncStatus = 'pending' | 'in_flight' | 'done' | 'failed';

export interface ContextNode {
    id: string;
    contextId: string;
    thread?: string;
    type: NodeType;
    content: string;
    key?: string;
    tags?: string[];
    source?: string;
    hidden?: boolean;
    createdAt: number;
    checkpointId?: string;
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
    nodeIds: string[];
    kind: CheckpointKind;
    sessionId?: string | null;
    branch?: string | null;
    worktreePath?: string | null;
    commitSha?: string | null;
    summary?: string | null;
    agentSet: string[];
    createdAt: number;
}

export interface Context {
    id: string;
    name: string;
    paths: string[];
    syncPolicy: SyncPolicy;
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

export interface SyncQueueEntry {
    id: string;
    contextId: string;
    status: SyncStatus;
    retryCount: number;
    lastError?: string | null;
    createdAt: number;
    updatedAt: number;
}

export interface SyncEnvelope {
    version: 1;
    contextId: string;
    tenantId: string;
    userId: string;
    timestamp: number;
    encrypted: boolean;
    syncPolicy?: SyncPolicy;
    payload: unknown;
}
