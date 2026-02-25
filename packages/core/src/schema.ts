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
    createdAt: number;
}

// A context is universal — could be a legal case, design brief, research project, codebase, etc.
// This allows non-devs to group nodes logically without needing directories.
export interface Context {
    id: string;               // uuid
    name: string;             // Human readable name (e.g. "Acme Corp Legal Case")
    paths: string[];          // mapped local paths (optional — many contexts are not tied to a directory)
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
    | 'restore_backup';

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
}

// ── Auth ──────────────────────────────────────────────────────────

export interface AuthState {
    userId: string | null;
    tenantId: string | null;
    tenantUrl: string | null;
    deviceId: string | null;
    tokenExpiresAt: number | null;
    authenticated: boolean;
}

// ── Sync ──────────────────────────────────────────────────────────

export type SyncQueueStatus = 'pending' | 'synced' | 'failed';

export type SyncEntityType = 'context' | 'node' | 'edge' | 'checkpoint';

export type SyncAction = 'create' | 'update' | 'delete';

export interface SyncQueueEntry {
    id: string;
    entityType: SyncEntityType;
    entityId: string;
    action: SyncAction;
    payload: Record<string, unknown>;
    userId: string;
    tenantId: string;
    createdAt: number;
    attempts: number;
    lastAttemptAt: number | null;
    status: SyncQueueStatus;
}

export interface SyncStatusSnapshot {
    enabled: boolean;
    authenticated: boolean;
    lastSyncAt: number | null;
    pendingItems: number;
    failedItems: number;
    lastError: string | null;
}

export interface SyncEnvelope {
    version: 1;
    userId: string;
    tenantId: string;
    deviceId: string;
    syncedAt: number;
    encrypted: boolean;
    payload: unknown;
}
