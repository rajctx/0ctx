/**
 * SYNC-01: SQLite-backed persistent sync queue.
 *
 * Queue entries survive daemon restarts. Each entry represents a context
 * that needs to be pushed to the cloud. Entries progress through states:
 *   pending → in_flight → done | failed
 *
 * Failed entries are retried with exponential backoff up to MAX_RETRIES.
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type { SyncQueueEntry, SyncStatus } from '@0ctx/core';

const MAX_RETRIES = 10;

// ─── Table creation ──────────────────────────────────────────────────────────

export function createSyncQueueTable(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS sync_queue (
            id          TEXT PRIMARY KEY,
            contextId   TEXT NOT NULL,
            status      TEXT NOT NULL DEFAULT 'pending',
            retryCount  INTEGER NOT NULL DEFAULT 0,
            lastError   TEXT,
            createdAt   INTEGER NOT NULL,
            updatedAt   INTEGER NOT NULL
        )
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_sync_queue_status
        ON sync_queue (status)
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_sync_queue_context
        ON sync_queue (contextId, status)
    `);
}

// ─── Queue operations ────────────────────────────────────────────────────────

/**
 * Enqueue a context for sync. If a pending entry for the same context
 * already exists, skip (dedup). This keeps the queue lean when multiple
 * rapid mutations happen on the same context.
 */
export function enqueueSync(db: Database.Database, contextId: string): void {
    const existing = db.prepare(
        `SELECT id FROM sync_queue WHERE contextId = ? AND status IN ('pending', 'in_flight')`
    ).get(contextId) as { id: string } | undefined;

    if (existing) return; // Already queued

    const now = Date.now();
    db.prepare(`
        INSERT INTO sync_queue (id, contextId, status, retryCount, createdAt, updatedAt)
        VALUES (?, ?, 'pending', 0, ?, ?)
    `).run(randomUUID(), contextId, now, now);
}

/**
 * Dequeue up to `limit` pending entries, oldest first.
 */
export function dequeuePending(db: Database.Database, limit = 5): SyncQueueEntry[] {
    return db.prepare(`
        SELECT * FROM sync_queue
        WHERE status = 'pending'
        ORDER BY createdAt ASC
        LIMIT ?
    `).all(limit) as SyncQueueEntry[];
}

/**
 * Mark an entry as in-flight (being pushed now).
 */
export function markInFlight(db: Database.Database, id: string): void {
    db.prepare(`
        UPDATE sync_queue SET status = 'in_flight', updatedAt = ? WHERE id = ?
    `).run(Date.now(), id);
}

/**
 * Mark an entry as done (successfully pushed).
 */
export function markDone(db: Database.Database, id: string): void {
    db.prepare(`
        UPDATE sync_queue SET status = 'done', updatedAt = ? WHERE id = ?
    `).run(Date.now(), id);
}

/**
 * Mark an entry as failed. If retries exhausted, stays 'failed' permanently.
 * Otherwise, requeue as 'pending' for another attempt.
 */
export function markFailed(db: Database.Database, id: string, error: string): void {
    const entry = db.prepare(`SELECT retryCount FROM sync_queue WHERE id = ?`).get(id) as
        | { retryCount: number }
        | undefined;

    if (!entry) return;

    const newRetryCount = entry.retryCount + 1;
    const newStatus: SyncStatus = newRetryCount >= MAX_RETRIES ? 'failed' : 'pending';

    db.prepare(`
        UPDATE sync_queue
        SET status = ?, retryCount = ?, lastError = ?, updatedAt = ?
        WHERE id = ?
    `).run(newStatus, newRetryCount, error, Date.now(), id);
}

/**
 * Get aggregate queue status for health reporting.
 */
export function getQueueStatus(db: Database.Database): {
    pending: number;
    inFlight: number;
    failed: number;
    done: number;
} {
    const rows = db.prepare(`
        SELECT status, COUNT(*) as count FROM sync_queue GROUP BY status
    `).all() as Array<{ status: SyncStatus; count: number }>;

    const counts = { pending: 0, inFlight: 0, failed: 0, done: 0 };
    for (const row of rows) {
        if (row.status === 'pending') counts.pending = row.count;
        else if (row.status === 'in_flight') counts.inFlight = row.count;
        else if (row.status === 'failed') counts.failed = row.count;
        else if (row.status === 'done') counts.done = row.count;
    }
    return counts;
}

/**
 * Clean up completed entries older than `maxAgeMs` (default 24h).
 */
export function cleanupDone(db: Database.Database, maxAgeMs = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    const result = db.prepare(`
        DELETE FROM sync_queue WHERE status = 'done' AND updatedAt < ?
    `).run(cutoff);
    return result.changes;
}
