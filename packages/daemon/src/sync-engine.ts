import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type { Graph, SyncQueueEntry, SyncStatusSnapshot, SyncEntityType, SyncAction } from '@0ctx/core';
import { isAuthenticated, getUserId, getTenantId } from './auth';
import { pushSyncBatch, pushFullContextSync } from './cloud-client';
import { log } from './logger';

const DEFAULT_SYNC_INTERVAL_MS = 30_000;
const MAX_BATCH_SIZE = 50;
const MAX_RETRY_ATTEMPTS = 10;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 300_000; // 5 minutes

export class SyncEngine {
    private db: Database.Database;
    private graph: Graph;
    private timer: ReturnType<typeof setInterval> | null = null;
    private running = false;
    private lastError: string | null = null;
    private lastSyncAt: number | null = null;

    constructor(db: Database.Database, graph: Graph) {
        this.db = db;
        this.graph = graph;
    }

    // ── Lifecycle ────────────────────────────────────────────────

    start(intervalMs: number = DEFAULT_SYNC_INTERVAL_MS): void {
        if (this.timer) return;

        this.timer = setInterval(() => {
            void this.tick();
        }, intervalMs);

        log('info', 'sync_engine_started', { intervalMs });
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.running = false;
        log('info', 'sync_engine_stopped', {});
    }

    // ── Sync queue write ────────────────────────────────────────

    enqueue(entityType: SyncEntityType, entityId: string, action: SyncAction, payload: Record<string, unknown>): void {
        const userId = getUserId();
        const tenantId = getTenantId();

        if (!userId || !tenantId) {
            // Not authenticated — skip sync queue but don't fail the local operation
            return;
        }

        this.db.prepare(`
      INSERT INTO sync_queue (id, entityType, entityId, action, payload, userId, tenantId, createdAt, attempts, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending')
    `).run(randomUUID(), entityType, entityId, action, JSON.stringify(payload), userId, tenantId, Date.now());
    }

    // ── Status ──────────────────────────────────────────────────

    getStatus(): SyncStatusSnapshot {
        const pendingRow = this.db.prepare(
            "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'pending'"
        ).get() as { count: number };

        const failedRow = this.db.prepare(
            "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'failed'"
        ).get() as { count: number };

        return {
            enabled: this.timer !== null,
            authenticated: isAuthenticated(),
            lastSyncAt: this.lastSyncAt,
            pendingItems: pendingRow.count,
            failedItems: failedRow.count,
            lastError: this.lastError
        };
    }

    // ── Background tick ─────────────────────────────────────────

    async tick(): Promise<void> {
        if (this.running) return;
        if (!isAuthenticated()) return;

        this.running = true;
        try {
            await this.processPendingQueue();
            this.lastSyncAt = Date.now();
            this.lastError = null;
        } catch (error) {
            this.lastError = error instanceof Error ? error.message : String(error);
            log('warn', 'sync_tick_error', { error: this.lastError });
        } finally {
            this.running = false;
        }
    }

    // ── Full sync (all contexts) ────────────────────────────────

    async triggerFullSync(): Promise<{ ok: boolean; contextsSynced: number; error?: string }> {
        if (!isAuthenticated()) {
            return { ok: false, contextsSynced: 0, error: 'Not authenticated.' };
        }

        const contexts = this.graph.listContexts();
        let synced = 0;

        for (const ctx of contexts) {
            const dump = this.graph.exportContextDump(ctx.id);
            const result = await pushFullContextSync(dump);
            if (result.ok) {
                synced += 1;
            } else {
                log('warn', 'full_sync_context_failed', { contextId: ctx.id, error: result.error });
            }
        }

        if (synced === contexts.length) {
            this.lastSyncAt = Date.now();
            this.lastError = null;
            log('info', 'full_sync_complete', { contextsSynced: synced });
            return { ok: true, contextsSynced: synced };
        }

        const errorMsg = `Synced ${synced}/${contexts.length} contexts.`;
        this.lastError = errorMsg;
        return { ok: synced > 0, contextsSynced: synced, error: errorMsg };
    }

    // ── Queue processing ────────────────────────────────────────

    private async processPendingQueue(): Promise<void> {
        const items = this.db.prepare(`
      SELECT * FROM sync_queue
      WHERE status = 'pending'
        AND (lastAttemptAt IS NULL OR lastAttemptAt < ?)
      ORDER BY createdAt ASC
      LIMIT ?
    `).all(Date.now(), MAX_BATCH_SIZE) as Array<{
            id: string;
            entityType: string;
            entityId: string;
            action: string;
            payload: string;
            userId: string;
            tenantId: string;
            createdAt: number;
            attempts: number;
            lastAttemptAt: number | null;
            status: string;
        }>;

        if (items.length === 0) return;

        // Filter out items that are in backoff
        const readyItems = items.filter(item => {
            if (item.attempts === 0) return true;
            const backoffMs = Math.min(BASE_BACKOFF_MS * Math.pow(2, item.attempts - 1), MAX_BACKOFF_MS);
            const readyAt = (item.lastAttemptAt ?? 0) + backoffMs;
            return Date.now() >= readyAt;
        });

        if (readyItems.length === 0) return;

        const queueEntries: SyncQueueEntry[] = readyItems.map(item => ({
            id: item.id,
            entityType: item.entityType as SyncEntityType,
            entityId: item.entityId,
            action: item.action as SyncAction,
            payload: JSON.parse(item.payload),
            userId: item.userId,
            tenantId: item.tenantId,
            createdAt: item.createdAt,
            attempts: item.attempts,
            lastAttemptAt: item.lastAttemptAt,
            status: item.status as 'pending'
        }));

        const result = await pushSyncBatch(queueEntries);

        if (result.ok) {
            // Mark all as synced
            const markSynced = this.db.prepare(
                "UPDATE sync_queue SET status = 'synced', lastAttemptAt = ? WHERE id = ?"
            );
            const now = Date.now();
            for (const entry of queueEntries) {
                markSynced.run(now, entry.id);
            }
            log('info', 'sync_push_success', { count: queueEntries.length });
        } else {
            // Increment attempts, mark as failed if max reached
            const incrementAttempts = this.db.prepare(
                'UPDATE sync_queue SET attempts = attempts + 1, lastAttemptAt = ?, status = CASE WHEN attempts + 1 >= ? THEN \'failed\' ELSE \'pending\' END WHERE id = ?'
            );
            const now = Date.now();
            for (const entry of queueEntries) {
                incrementAttempts.run(now, MAX_RETRY_ATTEMPTS, entry.id);
            }
            log('warn', 'sync_push_batch_failed', { count: queueEntries.length, error: result.error });
        }
    }
}
