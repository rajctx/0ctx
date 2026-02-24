import os from 'os';
import path from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
    enqueueConnectorEvents,
    getConnectorQueuePath,
    getConnectorQueueStats,
    getReadyConnectorEvents,
    listQueuedConnectorEvents,
    markConnectorEventsDelivered,
    markConnectorEventsFailed,
    purgeConnectorQueue,
    pruneConnectorQueue
} from '../src/connector-queue';

const tempDirs: string[] = [];

function createTempDir(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), '0ctx-cli-queue-test-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    delete process.env.CTX_CONNECTOR_QUEUE_PATH;
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('connector event queue', () => {
    it('enqueues events with dedupe and returns last sequence', () => {
        const tempDir = createTempDir();
        process.env.CTX_CONNECTOR_QUEUE_PATH = path.join(tempDir, 'queue.json');
        const now = 1_700_000_000_000;

        const first = enqueueConnectorEvents('sub-1', [
            {
                eventId: 'evt-1',
                sequence: 1,
                contextId: 'ctx-1',
                type: 'NodeAdded',
                timestamp: now,
                source: 'session:s-1',
                payload: { method: 'addNode' }
            },
            {
                eventId: 'evt-2',
                sequence: 2,
                contextId: 'ctx-1',
                type: 'NodeUpdated',
                timestamp: now,
                source: 'session:s-1',
                payload: { method: 'updateNode' }
            }
        ], now);

        expect(first.enqueued).toBe(2);
        expect(first.lastSequence).toBe(2);
        expect(getConnectorQueuePath().endsWith('queue.json')).toBe(true);

        const second = enqueueConnectorEvents('sub-1', [
            {
                eventId: 'evt-2',
                sequence: 2,
                contextId: 'ctx-1',
                type: 'NodeUpdated',
                timestamp: now,
                source: 'session:s-1',
                payload: { method: 'updateNode' }
            }
        ], now);
        expect(second.enqueued).toBe(0);
        expect(second.lastSequence).toBe(2);
    });

    it('supports delivery removal and failure backoff', () => {
        const tempDir = createTempDir();
        process.env.CTX_CONNECTOR_QUEUE_PATH = path.join(tempDir, 'queue.json');
        const now = 1_700_000_000_000;

        enqueueConnectorEvents('sub-1', [
            {
                eventId: 'evt-1',
                sequence: 1,
                contextId: 'ctx-1',
                type: 'NodeAdded',
                timestamp: now,
                source: 'session:s-1',
                payload: { method: 'addNode' }
            }
        ], now);

        const ready = getReadyConnectorEvents(10, now);
        expect(ready.length).toBe(1);
        const queueId = ready[0].queueId;

        markConnectorEventsFailed([queueId], 'server_error', now);
        const afterFailure = getReadyConnectorEvents(10, now);
        expect(afterFailure.length).toBe(0);
        const later = getReadyConnectorEvents(10, now + 2_001);
        expect(later.length).toBe(1);
        expect(later[0].attempts).toBe(1);
        expect(later[0].lastError).toBe('server_error');

        markConnectorEventsDelivered([queueId]);
        expect(getReadyConnectorEvents(10, now + 5_000).length).toBe(0);
    });

    it('reports queue stats accurately', () => {
        const tempDir = createTempDir();
        process.env.CTX_CONNECTOR_QUEUE_PATH = path.join(tempDir, 'queue.json');
        const now = 1_700_000_000_000;

        enqueueConnectorEvents('sub-1', [
            {
                eventId: 'evt-1',
                sequence: 1,
                contextId: 'ctx-1',
                type: 'NodeAdded',
                timestamp: now,
                source: 'session:s-1',
                payload: { method: 'addNode' }
            },
            {
                eventId: 'evt-2',
                sequence: 2,
                contextId: 'ctx-1',
                type: 'NodeUpdated',
                timestamp: now,
                source: 'session:s-1',
                payload: { method: 'updateNode' }
            }
        ], now);

        const ready = getReadyConnectorEvents(10, now);
        markConnectorEventsFailed([ready[0].queueId], 'retry_error', now);

        const stats = getConnectorQueueStats(now);
        expect(stats.pending).toBe(2);
        expect(stats.ready).toBe(1);
        expect(stats.backoff).toBe(1);
        expect(stats.maxAttempts).toBe(1);
        expect(stats.oldestEnqueuedAt).toBe(now);
    });

    it('supports purge filters and prune controls', () => {
        const tempDir = createTempDir();
        process.env.CTX_CONNECTOR_QUEUE_PATH = path.join(tempDir, 'queue.json');
        const now = 1_700_000_000_000;

        enqueueConnectorEvents('sub-1', [
            {
                eventId: 'evt-1',
                sequence: 1,
                contextId: 'ctx-1',
                type: 'NodeAdded',
                timestamp: now - 10_000,
                source: 'session:s-1',
                payload: { method: 'addNode' }
            },
            {
                eventId: 'evt-2',
                sequence: 2,
                contextId: 'ctx-1',
                type: 'NodeUpdated',
                timestamp: now - 5_000,
                source: 'session:s-1',
                payload: { method: 'updateNode' }
            }
        ], now - 2 * 60 * 60 * 1000);

        const queued = listQueuedConnectorEvents();
        markConnectorEventsFailed([queued[0].queueId], 'retry_error', now);

        const purgeByAttempts = purgeConnectorQueue({ minAttempts: 1 });
        expect(purgeByAttempts.removed).toBe(1);
        expect(purgeByAttempts.remaining).toBe(1);

        const pruneByAge = pruneConnectorQueue({ now, maxAgeMs: 1, maxItems: 100 });
        expect(pruneByAge.removed).toBe(1);
        expect(pruneByAge.remaining).toBe(0);
    });
});
