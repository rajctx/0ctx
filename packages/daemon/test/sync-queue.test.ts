import { describe, it, expect, beforeEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import {
    createSyncQueueTable,
    enqueueSync,
    dequeuePending,
    markInFlight,
    markDone,
    markFailed,
    getQueueStatus,
    cleanupDone
} from '../src/sync-queue';

describe('sync-queue', () => {
    let db: BetterSqlite3.Database;

    beforeEach(() => {
        db = new BetterSqlite3(':memory:');
        createSyncQueueTable(db);
    });

    it('creates table without error', () => {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_queue'").all();
        expect(tables).toHaveLength(1);
    });

    it('enqueues a context', () => {
        enqueueSync(db, 'ctx-1');
        const entries = dequeuePending(db);
        expect(entries).toHaveLength(1);
        expect(entries[0].contextId).toBe('ctx-1');
        expect(entries[0].status).toBe('pending');
        expect(entries[0].retryCount).toBe(0);
    });

    it('deduplicates pending entries for same context', () => {
        enqueueSync(db, 'ctx-1');
        enqueueSync(db, 'ctx-1');
        enqueueSync(db, 'ctx-1');
        const entries = dequeuePending(db);
        expect(entries).toHaveLength(1);
    });

    it('allows separate entries for different contexts', () => {
        enqueueSync(db, 'ctx-1');
        enqueueSync(db, 'ctx-2');
        const entries = dequeuePending(db);
        expect(entries).toHaveLength(2);
    });

    it('marks entry in_flight', () => {
        enqueueSync(db, 'ctx-1');
        const [entry] = dequeuePending(db);
        markInFlight(db, entry.id);

        // Should not appear in pending anymore
        const pending = dequeuePending(db);
        expect(pending).toHaveLength(0);

        const status = getQueueStatus(db);
        expect(status.inFlight).toBe(1);
        expect(status.pending).toBe(0);
    });

    it('marks entry done', () => {
        enqueueSync(db, 'ctx-1');
        const [entry] = dequeuePending(db);
        markInFlight(db, entry.id);
        markDone(db, entry.id);

        const status = getQueueStatus(db);
        expect(status.done).toBe(1);
        expect(status.inFlight).toBe(0);
    });

    it('marks entry failed and requeues for retry', () => {
        enqueueSync(db, 'ctx-1');
        const [entry] = dequeuePending(db);
        markInFlight(db, entry.id);
        markFailed(db, entry.id, 'connection refused');

        // Should requeue as pending (retryCount < 10)
        const pending = dequeuePending(db);
        expect(pending).toHaveLength(1);
        expect(pending[0].retryCount).toBe(1);
        expect(pending[0].lastError).toBe('connection refused');
    });

    it('marks permanently failed after 10 retries', () => {
        enqueueSync(db, 'ctx-1');
        const [entry] = dequeuePending(db);

        // Simulate 10 retries
        for (let i = 0; i < 10; i++) {
            markInFlight(db, entry.id);
            markFailed(db, entry.id, `error ${i}`);
        }

        const status = getQueueStatus(db);
        expect(status.failed).toBe(1);
        expect(status.pending).toBe(0);
    });

    it('cleans up old done entries', () => {
        enqueueSync(db, 'ctx-1');
        const [entry] = dequeuePending(db);
        markDone(db, entry.id);

        // Set updatedAt to 2 days ago
        db.prepare('UPDATE sync_queue SET updatedAt = ? WHERE id = ?')
            .run(Date.now() - 2 * 24 * 60 * 60 * 1000, entry.id);

        const cleaned = cleanupDone(db);
        expect(cleaned).toBe(1);

        const status = getQueueStatus(db);
        expect(status.done).toBe(0);
    });

    it('respects limit in dequeuePending', () => {
        for (let i = 0; i < 10; i++) {
            enqueueSync(db, `ctx-${i}`);
        }
        const entries = dequeuePending(db, 3);
        expect(entries).toHaveLength(3);
    });
});
