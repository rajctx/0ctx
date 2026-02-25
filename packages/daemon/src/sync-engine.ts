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
import type { ContextDump, Graph, SyncEnvelope, SyncPolicy } from '@0ctx/core';
import { encryptJson, getConfigValue } from '@0ctx/core';
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
}

/**
 * Read raw access token for sync transport.
 * Checks env var first (CTX_AUTH_TOKEN), then file.
 */
function getRawToken(): { token: string; tenantId: string } | null {
    // SEC-01: Env var takes priority
    const envToken = process.env.CTX_AUTH_TOKEN;
    if (envToken) {
        return { token: envToken, tenantId: process.env.CTX_TENANT_ID ?? '' };
    }

    try {
        if (!fs.existsSync(TOKEN_FILE)) return null;
        const raw = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')) as RawTokenStore;
        if (!raw.accessToken) return null;
        return { token: raw.accessToken, tenantId: raw.tenantId ?? '' };
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
                    const built = this.buildEnvelope(entry.contextId, auth.tenantId);
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

            // TODO: merge pulled envelopes into graph
            if (pullResult.envelopes.length > 0) {
                log('info', 'sync_pull_received', { count: pullResult.envelopes.length });
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

    private buildEnvelope(contextId: string, tenantId: string): EnvelopeBuildResult {
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
