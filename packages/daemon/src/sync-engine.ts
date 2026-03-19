/**
 * SYNC-01: Sync engine orchestrator.
 *
 * Runs a background timer that periodically:
 *   1. Processes the sync queue (push encrypted context dumps to an optional remote endpoint)
 *   2. Pulls remote changes (from other devices or environments)
 *
 * Never blocks local graph operations. Failures are logged and retried
 * with exponential backoff via the sync queue.
 */

import type Database from 'better-sqlite3';
import type { Graph } from '@0ctx/core';
import { getConfigValue } from '@0ctx/core';
import { log } from './logger';
import {
    cleanupDone,
    createSyncQueueTable,
    dequeuePending,
    enqueueSync,
    getQueueStatus,
    markDone,
    markFailed,
    markInFlight
} from './sync-queue';
import { pullEnvelopes, pushEnvelope } from './sync-transport';
import { getRawToken } from './sync-engine/auth';
import { DEFAULT_BATCH_SIZE, DEFAULT_INTERVAL_MS } from './sync-engine/constants';
import { mergeRemoteEnvelope } from './sync-engine/inbound';
import { createSyncMergeStateTable } from './sync-engine/merge-state';
import { buildEnvelope, recordUploadAudit } from './sync-engine/outbound';
import type { SyncConfig, SyncEngineStatus } from './sync-engine/types';

export type { SyncConfig, SyncEngineStatus } from './sync-engine/types';

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

        createSyncQueueTable(this.db);
        createSyncMergeStateTable(this.db);
    }

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

        setTimeout(() => void this.cycle(), 2000);
    }

    stop(): void {
        if (!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
        log('info', 'sync_stopped', {});
    }

    enqueue(contextId: string): void {
        if (!this.enabled) return;
        const policy = this.graph.getContextSyncPolicy(contextId);
        if (policy === 'local_only') {
            log('debug', 'sync_enqueue_skip', { contextId, reason: 'local_only' });
            return;
        }
        enqueueSync(this.db, contextId);
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
                result.processed += 1;
                markInFlight(this.db, entry.id);

                try {
                    const built = buildEnvelope(this.graph, entry.contextId, auth.tenantId, auth.userId);
                    if (built.kind === 'skip') {
                        markDone(this.db, entry.id);
                        result.succeeded += 1;
                        log('debug', 'sync_push_skip_context', {
                            contextId: entry.contextId,
                            reason: built.reason
                        });
                        continue;
                    }

                    if (built.kind === 'missing') {
                        markFailed(this.db, entry.id, built.reason);
                        result.failed += 1;
                        continue;
                    }

                    const pushResult = await pushEnvelope(auth.token, built.envelope);
                    if (!pushResult.ok) {
                        markFailed(this.db, entry.id, pushResult.error ?? 'Unknown push error');
                        result.failed += 1;
                        this.lastError = pushResult.error ?? null;
                        continue;
                    }

                    markDone(this.db, entry.id);
                    result.succeeded += 1;
                    recordUploadAudit(this.graph, entry.id, entry.contextId, auth.userId, built);
                } catch (error: unknown) {
                    const message = error instanceof Error ? error.message : String(error);
                    markFailed(this.db, entry.id, message);
                    result.failed += 1;
                    this.lastError = message;
                }
            }

            this.lastPushAt = Date.now();
            return result;
        } finally {
            this.pushing = false;
        }
    }

    async pull(): Promise<{ received: number }> {
        if (this.pulling) return { received: 0 };
        this.pulling = true;

        try {
            const auth = getRawToken();
            if (!auth) return { received: 0 };

            const pullResult = await pullEnvelopes(auth.token, this.lastPullAt ?? 0);
            if (!pullResult.ok) {
                this.lastError = pullResult.error ?? null;
                log('warn', 'sync_pull_error', { error: pullResult.error ?? 'Unknown' });
                return { received: 0 };
            }

            if (pullResult.envelopes.length > 0) {
                log('info', 'sync_pull_received', { count: pullResult.envelopes.length });
                for (const envelope of pullResult.envelopes) {
                    mergeRemoteEnvelope(this.graph, this.db, envelope);
                }
            }

            this.lastPullAt = Date.now();
            return { received: pullResult.envelopes.length };
        } finally {
            this.pulling = false;
        }
    }

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
        return {
            push: await this.push(),
            pull: await this.pull()
        };
    }

    private async cycle(): Promise<void> {
        try {
            await this.push();
            await this.pull();
            cleanupDone(this.db);
            this.lastError = null;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            this.lastError = message;
            log('error', 'sync_cycle_error', { error: message });
        }
    }
}
