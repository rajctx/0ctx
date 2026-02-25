import { describe, expect, it } from 'vitest';
import { drainConnectorQueue } from '../src/connector-queue-drain';
import type { QueuedConnectorEvent } from '../src/connector-queue';

function createEvent(sequence: number, queueId = `q-${sequence}`): QueuedConnectorEvent {
    return {
        queueId,
        eventId: `evt-${sequence}`,
        subscriptionId: 'sub-1',
        sequence,
        contextId: 'ctx-1',
        type: 'NodeAdded',
        timestamp: 1_700_000_000_000 + sequence,
        source: 'session:s-1',
        payload: { method: 'addNode' },
        enqueuedAt: 1_700_000_000_000,
        attempts: 0,
        nextAttemptAt: 1_700_000_000_000,
        lastError: null
    };
}

describe('drainConnectorQueue', () => {
    it('returns timeout reason in wait mode when pending never drains', async () => {
        let now = 1_700_000_000_000;
        const result = await drainConnectorQueue({
            machineId: 'm-1',
            tenantId: 'tenant-a',
            accessToken: 'token',
            maxBatches: 10,
            batchSize: 100,
            wait: true,
            timeoutMs: 50,
            pollMs: 10
        }, {
            now: () => now,
            sleep: async (ms) => { now += ms; },
            getReadyEvents: () => [],
            sendEvents: async () => ({ ok: true, statusCode: 200 }),
            markEventsDelivered: () => undefined,
            markEventsFailed: () => undefined,
            getQueueStats: () => ({
                pending: 1,
                ready: 0,
                backoff: 1,
                maxAttempts: 0,
                oldestEnqueuedAt: 1_700_000_000_000
            }),
            onBridgeUnsupported: () => undefined
        });

        expect(result.wait.reason).toBe('timeout');
        expect(result.wait.timedOut).toBe(true);
        expect(result.batches).toBe(0);
        expect(result.failed).toBe(0);
    });

    it('marks bridge unsupported on 404 ingest response', async () => {
        let bridgeUnsupportedCalls = 0;
        let queue = [createEvent(11)];
        const failedQueueIds: string[][] = [];

        const result = await drainConnectorQueue({
            machineId: 'm-1',
            tenantId: 'tenant-a',
            accessToken: 'token',
            maxBatches: 10,
            batchSize: 100,
            wait: true,
            timeoutMs: 5_000,
            pollMs: 200
        }, {
            now: () => 1_700_000_000_000,
            sleep: async () => undefined,
            getReadyEvents: () => [...queue],
            sendEvents: async () => ({ ok: false, statusCode: 404, error: 'not_found' }),
            markEventsDelivered: () => undefined,
            markEventsFailed: (queueIds) => {
                failedQueueIds.push(queueIds);
            },
            getQueueStats: () => ({
                pending: queue.length,
                ready: queue.length,
                backoff: 0,
                maxAttempts: 1,
                oldestEnqueuedAt: 1_700_000_000_000
            }),
            onBridgeUnsupported: () => {
                bridgeUnsupportedCalls += 1;
            }
        });

        expect(result.wait.reason).toBe('bridge_unsupported');
        expect(result.failed).toBe(1);
        expect(result.batches).toBe(1);
        expect(result.lastError).toBe('not_found');
        expect(bridgeUnsupportedCalls).toBe(1);
        expect(failedQueueIds).toEqual([['q-11']]);
    });

    it('drains successfully when cloud accepts queued events', async () => {
        let queue = [createEvent(1), createEvent(2)];
        const deliveredQueueIds: string[][] = [];

        const result = await drainConnectorQueue({
            machineId: 'm-1',
            tenantId: 'tenant-a',
            accessToken: 'token',
            maxBatches: 10,
            batchSize: 100,
            wait: true,
            timeoutMs: 5_000,
            pollMs: 200
        }, {
            now: () => 1_700_000_000_000,
            sleep: async () => undefined,
            getReadyEvents: () => [...queue],
            sendEvents: async () => ({ ok: true, statusCode: 200 }),
            markEventsDelivered: (queueIds) => {
                deliveredQueueIds.push(queueIds);
                queue = [];
            },
            markEventsFailed: () => undefined,
            getQueueStats: () => ({
                pending: queue.length,
                ready: queue.length,
                backoff: 0,
                maxAttempts: 0,
                oldestEnqueuedAt: queue.length > 0 ? 1_700_000_000_000 : null
            }),
            onBridgeUnsupported: () => undefined
        });

        expect(result.wait.reason).toBe('drained');
        expect(result.sent).toBe(2);
        expect(result.failed).toBe(0);
        expect(deliveredQueueIds).toEqual([['q-1', 'q-2']]);
    });
});
