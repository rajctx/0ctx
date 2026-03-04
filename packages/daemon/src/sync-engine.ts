/**
 * SYNC-01: Sync engine orchestrator.
 *
 * Runs a background timer that periodically:
 *   1. Processes the sync queue (push encrypted context dumps to cloud)
 *   2. Pulls remote changes (from other devices/users)
 *
 * Never blocks local graph operations. Failures are logged and retried
 * with exponential backoff via the sync queue.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import type {
    ContextDump,
    ContextNode,
    EncryptedPayload,
    Graph,
    SyncEnvelope,
    SyncPolicy
} from '@0ctx/core';
import { encryptJson, decryptJson, getConfigValue } from '@0ctx/core';
import {
    createSyncQueueTable,
    enqueueSync,
    dequeuePending,
    markInFlight,
    markDone,
    markFailed,
    getQueueStatus,
    cleanupDone
} from './sync-queue';
import { pushEnvelope, pullEnvelopes } from './sync-transport';
import { log } from './logger';

// ─── Token access ────────────────────────────────────────────────────────────

const TOKEN_FILE = path.join(os.homedir(), '.0ctx', 'auth.json');

interface RawTokenStore {
    accessToken?: string;
    tenantId?: string;
    email?: string;
}

/**
 * Read raw access token for sync transport.
 * Checks env var first (CTX_AUTH_TOKEN), then file.
 */
function getRawToken(): { token: string; tenantId: string; userId: string } | null {
    // SEC-01: Env var takes priority
    const envToken = process.env.CTX_AUTH_TOKEN;
    if (envToken) {
        return { token: envToken, tenantId: process.env.CTX_TENANT_ID ?? '', userId: process.env.CTX_USER_ID ?? 'env:CTX_AUTH_TOKEN' };
    }

    try {
        if (!fs.existsSync(TOKEN_FILE)) return null;
        const raw = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')) as RawTokenStore;
        if (!raw.accessToken) return null;
        return { token: raw.accessToken, tenantId: raw.tenantId ?? '', userId: raw.email ?? '' };
    } catch {
        return null;
    }
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface SyncConfig {
    /** Sync loop interval in milliseconds (default 30s) */
    intervalMs?: number;
    /** Maximum queue entries to process per cycle */
    batchSize?: number;
    /** Enable sync (default false — must be explicitly enabled) */
    enabled?: boolean;
}

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 5;
const MAX_SYNC_AUDIT_NODE_DIFFS = 25;
const MERGE_MUTATION_AUDIT_ACTIONS = [
    'create_context',
    'delete_context',
    'switch_context',
    'add_node',
    'update_node',
    'delete_node',
    'add_edge',
    'save_checkpoint',
    'rewind',
    'create_backup',
    'restore_backup',
    'set_sync_policy'
] as const;

interface SyncContextSummary {
    contextId: string;
    name: string;
    syncPolicy: SyncPolicy;
    createdAt: number;
    nodeCount: number;
    edgeCount: number;
    checkpointCount: number;
}

interface SyncNodeDiff {
    nodeId: string;
    before: {
        content: string;
        tags: string[];
        type: string;
        key: string | null;
        source: string | null;
    };
    after: {
        content: string;
        tags: string[];
        type: string;
        key: string | null;
        source: string | null;
    };
}

interface SyncMergeDelta {
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

function createSyncMergeStateTable(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_merge_state (
        contextId            TEXT PRIMARY KEY,
        lastRemoteTimestamp  INTEGER NOT NULL DEFAULT 0,
        updatedAt            INTEGER NOT NULL
      )
    `);
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export interface SyncEngineStatus {
    enabled: boolean;
    running: boolean;
    lastPushAt: number | null;
    lastPullAt: number | null;
    lastError: string | null;
    queue: { pending: number; inFlight: number; failed: number; done: number };
}

type EnvelopeBuildResult =
    | { kind: 'send'; envelope: SyncEnvelope }
    | { kind: 'skip'; reason: string }
    | { kind: 'missing'; reason: string };

export class SyncEngine {
    private timer: ReturnType<typeof setInterval> | null = null;
    private pushing = false;
    private pulling = false;
    private lastPushAt: number | null = null;
    private lastPullAt: number | null = null;
    private lastError: string | null = null;
    private readonly intervalMs: number;
    private readonly batchSize: number;
    private readonly enabled: boolean;

    constructor(
        private graph: Graph,
        private db: Database.Database,
        config: SyncConfig = {}
    ) {
        this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
        this.batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
        this.enabled = config.enabled ?? getConfigValue('sync.enabled');

        // Ensure sync_queue table exists
        createSyncQueueTable(this.db);
        createSyncMergeStateTable(this.db);
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    start(): void {
        if (!this.enabled) {
            log('info', 'sync_disabled', { reason: 'CTX_SYNC_ENABLED not set' });
            return;
        }

        if (this.timer) return;

        log('info', 'sync_started', { intervalMs: this.intervalMs });

        this.timer = setInterval(() => {
            void this.cycle();
        }, this.intervalMs);

        // Don't block startup — fire first cycle after a short delay
        setTimeout(() => void this.cycle(), 2000);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            log('info', 'sync_stopped', {});
        }
    }

    // ── Queue ────────────────────────────────────────────────────────────────

    enqueue(contextId: string): void {
        if (!this.enabled) return;
        const policy = this.graph.getContextSyncPolicy(contextId);
        if (policy === 'local_only') {
            log('debug', 'sync_enqueue_skip', { contextId, reason: 'local_only' });
            return;
        }
        enqueueSync(this.db, contextId);
    }

    // ── Sync cycle ───────────────────────────────────────────────────────────

    private async cycle(): Promise<void> {
        try {
            await this.push();
            await this.pull();
            cleanupDone(this.db);
            // Clear sticky error on successful cycle so stale errors don't persist
            this.lastError = null;
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            this.lastError = msg;
            log('error', 'sync_cycle_error', { error: msg });
        }
    }

    async push(): Promise<{ processed: number; succeeded: number; failed: number }> {
        if (this.pushing) return { processed: 0, succeeded: 0, failed: 0 };
        this.pushing = true;

        const result = { processed: 0, succeeded: 0, failed: 0 };

        try {
            const auth = getRawToken();
            if (!auth) {
                log('debug', 'sync_push_skip', { reason: 'no_token' });
                return result;
            }

            const entries = dequeuePending(this.db, this.batchSize);
            if (entries.length === 0) return result;

            for (const entry of entries) {
                result.processed++;
                markInFlight(this.db, entry.id);

                try {
                    const built = this.buildEnvelope(entry.contextId, auth.tenantId, auth.userId);
                    if (built.kind === 'skip') {
                        markDone(this.db, entry.id);
                        result.succeeded++;
                        log('debug', 'sync_push_skip_context', {
                            contextId: entry.contextId,
                            reason: built.reason
                        });
                        continue;
                    }

                    if (built.kind === 'missing') {
                        markFailed(this.db, entry.id, built.reason);
                        result.failed++;
                        continue;
                    }

                    const pushResult = await pushEnvelope(auth.token, built.envelope);
                    if (pushResult.ok) {
                        markDone(this.db, entry.id);
                        result.succeeded++;
                    } else {
                        markFailed(this.db, entry.id, pushResult.error ?? 'Unknown push error');
                        result.failed++;
                        this.lastError = pushResult.error ?? null;
                    }
                } catch (e: unknown) {
                    const msg = e instanceof Error ? e.message : String(e);
                    markFailed(this.db, entry.id, msg);
                    result.failed++;
                    this.lastError = msg;
                }
            }

            this.lastPushAt = Date.now();
        } finally {
            this.pushing = false;
        }

        return result;
    }

    async pull(): Promise<{ received: number }> {
        if (this.pulling) return { received: 0 };
        this.pulling = true;

        try {
            const auth = getRawToken();
            if (!auth) return { received: 0 };

            const since = this.lastPullAt ?? 0;
            const pullResult = await pullEnvelopes(auth.token, since);

            if (!pullResult.ok) {
                this.lastError = pullResult.error ?? null;
                log('warn', 'sync_pull_error', { error: pullResult.error ?? 'Unknown' });
                return { received: 0 };
            }

            if (pullResult.envelopes.length > 0) {
                log('info', 'sync_pull_received', { count: pullResult.envelopes.length });
                for (const envelope of pullResult.envelopes) {
                    this.mergeEnvelope(envelope);
                }
            }

            this.lastPullAt = Date.now();
            return { received: pullResult.envelopes.length };
        } finally {
            this.pulling = false;
        }
    }

    // ── Status ───────────────────────────────────────────────────────────────

    getStatus(): SyncEngineStatus {
        return {
            enabled: this.enabled,
            running: this.timer !== null,
            lastPushAt: this.lastPushAt,
            lastPullAt: this.lastPullAt,
            lastError: this.lastError,
            queue: getQueueStatus(this.db)
        };
    }

    async syncNow(): Promise<{
        push: { processed: number; succeeded: number; failed: number };
        pull: { received: number };
    }> {
        const pushResult = await this.push();
        const pullResult = await this.pull();
        return { push: pushResult, pull: pullResult };
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private buildEnvelope(contextId: string, tenantId: string, userId: string): EnvelopeBuildResult {
        const policy = this.graph.getContextSyncPolicy(contextId);
        if (!policy) {
            return { kind: 'missing', reason: 'Context not found' };
        }

        if (policy === 'local_only') {
            return { kind: 'skip', reason: 'sync policy local_only' };
        }

        try {
            const dump = this.graph.exportContextDump(contextId);
            const payload = policy === 'full_sync'
                ? dump
                : this.buildMetadataOnlyPayload(dump);

            return {
                kind: 'send',
                envelope: {
                    version: 1,
                    contextId,
                    tenantId,
                    userId,
                    timestamp: Date.now(),
                    encrypted: true,
                    syncPolicy: policy,
                    payload: encryptJson(payload)
                }
            };
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            return { kind: 'missing', reason: message };
        }
    }

    private mergeEnvelope(envelope: SyncEnvelope): void {
        try {
            if (envelope.syncPolicy !== 'full_sync') {
                log('debug', 'sync_pull_skip_policy', { contextId: envelope.contextId, policy: envelope.syncPolicy });
                return;
            }

            const remoteTimestamp = Number.isFinite(envelope.timestamp)
                ? Math.max(0, Math.floor(envelope.timestamp))
                : Date.now();
            const lastRemoteTimestamp = this.getLastRemoteTimestamp(envelope.contextId);
            if (remoteTimestamp <= lastRemoteTimestamp) {
                log('debug', 'sync_pull_skip_stale', {
                    contextId: envelope.contextId,
                    envelopeTimestamp: remoteTimestamp,
                    lastRemoteTimestamp
                });
                return;
            }

            const dump = this.decodeFullSyncDump(envelope);
            if (!dump) return;

            const existingContext = this.graph.getContext(envelope.contextId);
            const beforeDump = existingContext ? this.graph.exportContextDump(envelope.contextId) : null;
            const latestLocalMutationAt = existingContext
                ? this.getLatestLocalMutationAt(envelope.contextId)
                : 0;

            if (existingContext && latestLocalMutationAt > remoteTimestamp) {
                this.graph.recordAuditEvent({
                    action: 'sync_merge',
                    contextId: envelope.contextId,
                    payload: {
                        decision: 'kept_local',
                        reason: 'local_newer_than_remote',
                        envelope: {
                            timestamp: remoteTimestamp,
                            tenantId: envelope.tenantId,
                            userId: envelope.userId
                        },
                        local: {
                            latestMutationAt: latestLocalMutationAt
                        },
                        before: beforeDump ? this.summarizeContextDump(beforeDump) : null,
                        incoming: this.summarizeContextDump(dump)
                    },
                    result: {
                        applied: false
                    },
                    metadata: {
                        actor: envelope.userId || null,
                        source: 'sync_pull'
                    }
                });
                this.setLastRemoteTimestamp(envelope.contextId, remoteTimestamp);
                log('warn', 'sync_pull_conflict_local_newer', {
                    contextId: envelope.contextId,
                    envelopeTimestamp: remoteTimestamp,
                    latestLocalMutationAt
                });
                return;
            }

            this.replaceContextFromDump(envelope.contextId, dump);
            const afterDump = this.graph.exportContextDump(envelope.contextId);
            const mergeDelta = this.buildMergeDelta(beforeDump, afterDump);
            this.setLastRemoteTimestamp(envelope.contextId, remoteTimestamp);

            this.graph.recordAuditEvent({
                action: 'sync_merge',
                contextId: envelope.contextId,
                payload: {
                    decision: existingContext ? 'remote_overwrite' : 'remote_create',
                    envelope: {
                        timestamp: remoteTimestamp,
                        tenantId: envelope.tenantId,
                        userId: envelope.userId
                    },
                    local: {
                        latestMutationAt: latestLocalMutationAt || null
                    },
                    before: mergeDelta.before,
                    after: mergeDelta.after,
                    changes: mergeDelta.changes
                },
                result: {
                    applied: true
                },
                metadata: {
                    actor: envelope.userId || null,
                    source: 'sync_pull'
                }
            });

            log('info', 'sync_pull_merged', {
                contextId: envelope.contextId,
                name: dump.context.name,
                envelopeTimestamp: remoteTimestamp,
                decision: existingContext ? 'remote_overwrite' : 'remote_create',
                nodeCount: dump.nodes.length
            });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            log('warn', 'sync_pull_merge_error', { contextId: envelope.contextId, error: msg });
        }
    }

    private decodeFullSyncDump(envelope: SyncEnvelope): ContextDump | null {
        const dump = envelope.encrypted
            ? decryptJson<ContextDump>(envelope.payload as EncryptedPayload)
            : envelope.payload as ContextDump;

        if (
            !dump
            || dump.version !== 1
            || !dump.context
            || !Array.isArray(dump.nodes)
            || !Array.isArray(dump.edges)
            || !Array.isArray(dump.checkpoints)
        ) {
            log('warn', 'sync_pull_invalid_dump', { contextId: envelope.contextId });
            return null;
        }

        if (dump.context.id !== envelope.contextId) {
            log('warn', 'sync_pull_context_mismatch', {
                envelopeContextId: envelope.contextId,
                dumpContextId: dump.context.id
            });
            return null;
        }

        return dump;
    }

    private getLastRemoteTimestamp(contextId: string): number {
        const row = this.db
            .prepare('SELECT lastRemoteTimestamp FROM sync_merge_state WHERE contextId = ?')
            .get(contextId) as { lastRemoteTimestamp?: number } | undefined;
        return typeof row?.lastRemoteTimestamp === 'number' ? row.lastRemoteTimestamp : 0;
    }

    private setLastRemoteTimestamp(contextId: string, lastRemoteTimestamp: number): void {
        this.db.prepare(`
          INSERT INTO sync_merge_state (contextId, lastRemoteTimestamp, updatedAt)
          VALUES (?, ?, ?)
          ON CONFLICT(contextId) DO UPDATE SET
            lastRemoteTimestamp = excluded.lastRemoteTimestamp,
            updatedAt = excluded.updatedAt
        `).run(contextId, lastRemoteTimestamp, Date.now());
    }

    private getLatestLocalMutationAt(contextId: string): number {
        try {
            const placeholders = MERGE_MUTATION_AUDIT_ACTIONS.map(() => '?').join(', ');
            const row = this.db.prepare(`
              SELECT MAX(createdAt) AS maxCreatedAt
              FROM audit_logs
              WHERE contextId = ?
                AND action IN (${placeholders})
            `).get(contextId, ...MERGE_MUTATION_AUDIT_ACTIONS) as { maxCreatedAt?: number } | undefined;
            return typeof row?.maxCreatedAt === 'number' ? row.maxCreatedAt : 0;
        } catch {
            return 0;
        }
    }

    private replaceContextFromDump(contextId: string, dump: ContextDump): void {
        const tx = this.db.transaction(() => {
            if (this.graph.getContext(contextId)) {
                this.graph.deleteContext(contextId);
            }

            const syncPolicy: SyncPolicy =
                dump.context.syncPolicy === 'local_only'
                    || dump.context.syncPolicy === 'metadata_only'
                    || dump.context.syncPolicy === 'full_sync'
                    ? dump.context.syncPolicy
                    : 'metadata_only';

            this.db.prepare(`
              INSERT INTO contexts (id, name, paths, syncPolicy, createdAt)
              VALUES (@id, @name, @paths, @syncPolicy, @createdAt)
            `).run({
                id: contextId,
                name: dump.context.name,
                paths: JSON.stringify(dump.context.paths ?? []),
                syncPolicy,
                createdAt: dump.context.createdAt
            });

            const insertNode = this.db.prepare(`
              INSERT INTO nodes (id, contextId, thread, type, content, key, tags, source, createdAt, checkpointId)
              VALUES (@id, @contextId, @thread, @type, @content, @key, @tags, @source, @createdAt, @checkpointId)
            `);
            const insertNodeFts = this.db.prepare(`
              INSERT INTO nodes_fts (id, content, tags) VALUES (?, ?, ?)
            `);
            const nodeIds = new Set<string>();
            for (const node of dump.nodes) {
                if (typeof node.id !== 'string' || node.id.length === 0) continue;
                const tags = Array.isArray(node.tags)
                    ? node.tags.filter((tag): tag is string => typeof tag === 'string')
                    : [];
                insertNode.run({
                    id: node.id,
                    contextId,
                    thread: node.thread ?? null,
                    type: node.type,
                    content: node.content,
                    key: node.key ?? null,
                    tags: JSON.stringify(tags),
                    source: node.source ?? null,
                    createdAt: node.createdAt,
                    checkpointId: node.checkpointId ?? null
                });
                insertNodeFts.run(node.id, node.content, tags.join(' '));
                nodeIds.add(node.id);
            }

            const insertEdge = this.db.prepare(`
              INSERT INTO edges (id, fromId, toId, relation, createdAt)
              VALUES (@id, @fromId, @toId, @relation, @createdAt)
            `);
            for (const edge of dump.edges) {
                if (!nodeIds.has(edge.fromId) || !nodeIds.has(edge.toId)) continue;
                insertEdge.run({
                    id: edge.id,
                    fromId: edge.fromId,
                    toId: edge.toId,
                    relation: edge.relation,
                    createdAt: edge.createdAt
                });
            }

            const insertCheckpoint = this.db.prepare(`
              INSERT INTO checkpoints (id, contextId, name, nodeIds, createdAt)
              VALUES (@id, @contextId, @name, @nodeIds, @createdAt)
            `);
            for (const checkpoint of dump.checkpoints) {
                const checkpointNodeIds = Array.isArray(checkpoint.nodeIds)
                    ? checkpoint.nodeIds.filter((nodeId): nodeId is string => typeof nodeId === 'string' && nodeIds.has(nodeId))
                    : [];
                insertCheckpoint.run({
                    id: checkpoint.id,
                    contextId,
                    name: checkpoint.name,
                    nodeIds: JSON.stringify(checkpointNodeIds),
                    createdAt: checkpoint.createdAt
                });
            }
        });

        tx();
    }

    private summarizeContextDump(dump: ContextDump): SyncContextSummary {
        return {
            contextId: dump.context.id,
            name: dump.context.name,
            syncPolicy: dump.context.syncPolicy,
            createdAt: dump.context.createdAt,
            nodeCount: dump.nodes.length,
            edgeCount: dump.edges.length,
            checkpointCount: dump.checkpoints.length
        };
    }

    private buildMergeDelta(beforeDump: ContextDump | null, afterDump: ContextDump): SyncMergeDelta {
        const afterSummary = this.summarizeContextDump(afterDump);
        if (!beforeDump) {
            return {
                before: null,
                after: afterSummary,
                changes: {
                    addedNodeCount: afterDump.nodes.length,
                    removedNodeCount: 0,
                    updatedNodeCount: 0,
                    addedEdgeCount: afterDump.edges.length,
                    removedEdgeCount: 0,
                    addedCheckpointCount: afterDump.checkpoints.length,
                    removedCheckpointCount: 0,
                    overwrittenNodes: []
                }
            };
        }

        const beforeNodes = new Map(beforeDump.nodes.map(node => [node.id, node]));
        const afterNodes = new Map(afterDump.nodes.map(node => [node.id, node]));
        const overwrittenNodes: SyncNodeDiff[] = [];
        let addedNodeCount = 0;
        let removedNodeCount = 0;
        let updatedNodeCount = 0;

        for (const [nodeId, afterNode] of afterNodes) {
            const beforeNode = beforeNodes.get(nodeId);
            if (!beforeNode) {
                addedNodeCount += 1;
                continue;
            }
            if (!this.nodeEquivalent(beforeNode, afterNode)) {
                updatedNodeCount += 1;
                if (overwrittenNodes.length < MAX_SYNC_AUDIT_NODE_DIFFS) {
                    overwrittenNodes.push({
                        nodeId,
                        before: this.projectNodeForAudit(beforeNode),
                        after: this.projectNodeForAudit(afterNode)
                    });
                }
            }
        }
        for (const nodeId of beforeNodes.keys()) {
            if (!afterNodes.has(nodeId)) {
                removedNodeCount += 1;
            }
        }

        const beforeEdgeIds = new Set(beforeDump.edges.map(edge => edge.id));
        const afterEdgeIds = new Set(afterDump.edges.map(edge => edge.id));
        let addedEdgeCount = 0;
        let removedEdgeCount = 0;
        for (const edgeId of afterEdgeIds) {
            if (!beforeEdgeIds.has(edgeId)) addedEdgeCount += 1;
        }
        for (const edgeId of beforeEdgeIds) {
            if (!afterEdgeIds.has(edgeId)) removedEdgeCount += 1;
        }

        const beforeCheckpointIds = new Set(beforeDump.checkpoints.map(checkpoint => checkpoint.id));
        const afterCheckpointIds = new Set(afterDump.checkpoints.map(checkpoint => checkpoint.id));
        let addedCheckpointCount = 0;
        let removedCheckpointCount = 0;
        for (const checkpointId of afterCheckpointIds) {
            if (!beforeCheckpointIds.has(checkpointId)) addedCheckpointCount += 1;
        }
        for (const checkpointId of beforeCheckpointIds) {
            if (!afterCheckpointIds.has(checkpointId)) removedCheckpointCount += 1;
        }

        return {
            before: this.summarizeContextDump(beforeDump),
            after: afterSummary,
            changes: {
                addedNodeCount,
                removedNodeCount,
                updatedNodeCount,
                addedEdgeCount,
                removedEdgeCount,
                addedCheckpointCount,
                removedCheckpointCount,
                overwrittenNodes
            }
        };
    }

    private nodeEquivalent(a: ContextNode, b: ContextNode): boolean {
        if (a.content !== b.content) return false;
        if (a.type !== b.type) return false;
        if ((a.key ?? null) !== (b.key ?? null)) return false;
        if ((a.source ?? null) !== (b.source ?? null)) return false;
        if ((a.thread ?? null) !== (b.thread ?? null)) return false;

        const aTags = Array.isArray(a.tags) ? a.tags : [];
        const bTags = Array.isArray(b.tags) ? b.tags : [];
        if (aTags.length !== bTags.length) return false;
        for (let i = 0; i < aTags.length; i += 1) {
            if (aTags[i] !== bTags[i]) return false;
        }
        return true;
    }

    private projectNodeForAudit(node: ContextNode): {
        content: string;
        tags: string[];
        type: string;
        key: string | null;
        source: string | null;
    } {
        return {
            content: node.content,
            tags: Array.isArray(node.tags) ? node.tags : [],
            type: node.type,
            key: node.key ?? null,
            source: node.source ?? null
        };
    }

    private buildMetadataOnlyPayload(dump: ContextDump): Record<string, unknown> {
        const nodeTypeCounts: Record<string, number> = {};
        for (const node of dump.nodes) {
            nodeTypeCounts[node.type] = (nodeTypeCounts[node.type] ?? 0) + 1;
        }

        const latestNode = dump.nodes[dump.nodes.length - 1] ?? null;
        const latestCheckpoint = dump.checkpoints[dump.checkpoints.length - 1] ?? null;

        return {
            version: 1,
            mode: 'metadata_only',
            exportedAt: dump.exportedAt,
            context: {
                id: dump.context.id,
                name: dump.context.name,
                createdAt: dump.context.createdAt,
                syncPolicy: 'metadata_only' as SyncPolicy
            },
            graph: {
                nodeCount: dump.nodes.length,
                edgeCount: dump.edges.length,
                checkpointCount: dump.checkpoints.length,
                nodeTypes: nodeTypeCounts
            },
            pointers: {
                latestNodeId: latestNode?.id ?? null,
                latestNodeAt: latestNode?.createdAt ?? null,
                latestCheckpointId: latestCheckpoint?.id ?? null,
                latestCheckpointAt: latestCheckpoint?.createdAt ?? null
            }
        };
    }
}
