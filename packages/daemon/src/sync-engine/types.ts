import type { SyncEnvelope, SyncPolicy } from '@0ctx/core';

export interface SyncConfig {
    intervalMs?: number;
    batchSize?: number;
    enabled?: boolean;
}

export interface SyncEngineStatus {
    enabled: boolean;
    running: boolean;
    lastPushAt: number | null;
    lastPullAt: number | null;
    lastError: string | null;
    queue: { pending: number; inFlight: number; failed: number; done: number };
}

export interface RawSyncAuth {
    token: string;
    tenantId: string;
    userId: string;
}

export interface SyncContextSummary {
    contextId: string;
    name: string;
    syncPolicy: SyncPolicy;
    createdAt: number;
    nodeCount: number;
    edgeCount: number;
    checkpointCount: number;
}

export interface SyncNodeAuditProjection {
    content: string;
    tags: string[];
    type: string;
    key: string | null;
    source: string | null;
    hidden: boolean;
}

export interface SyncNodeDiff {
    nodeId: string;
    before: SyncNodeAuditProjection;
    after: SyncNodeAuditProjection;
}

export interface SyncMergeDelta {
    before: SyncContextSummary | null;
    after: SyncContextSummary;
    changes: {
        addedNodeCount: number;
        removedNodeCount: number;
        updatedNodeCount: number;
        addedEdgeCount: number;
        removedEdgeCount: number;
        addedCheckpointCount: number;
        removedCheckpointCount: number;
        overwrittenNodes: SyncNodeDiff[];
    };
}

export type EnvelopeBuildResult =
    | { kind: 'send'; envelope: SyncEnvelope; summary: SyncContextSummary }
    | { kind: 'skip'; reason: string }
    | { kind: 'missing'; reason: string };
