import type { ConnectorQueueStats, QueuedConnectorEvent } from './connector-queue';
import type { ConnectorEventPayload } from './cloud';

export type ConnectorQueueDrainReason =
    | 'drained'
    | 'bridge_unsupported'
    | 'timeout'
    | 'max_batches'
    | 'pending'
    | 'single_pass';

export interface ConnectorQueueDrainOptions {
    machineId: string;
    tenantId: string | null;
    accessToken: string;
    maxBatches: number;
    batchSize: number;
    wait: boolean;
    timeoutMs: number;
    pollMs: number;
}

export interface ConnectorQueueDrainDependencies {
    now(): number;
    sleep(ms: number): Promise<void>;
    getReadyEvents(limit: number, now: number): QueuedConnectorEvent[];
    sendEvents(
        accessToken: string,
        payload: {
            machineId: string;
            tenantId: string | null;
            subscriptionId: string;
            cursor: number;
            events: ConnectorEventPayload[];
        }
    ): Promise<{ ok: boolean; error?: string; statusCode: number }>;
    markEventsDelivered(queueIds: string[]): void;
    markEventsFailed(queueIds: string[], error: string, now: number): void;
    getQueueStats(now: number): ConnectorQueueStats;
    onBridgeUnsupported(): void | Promise<void>;
}

export interface ConnectorQueueDrainResult {
    sent: number;
    failed: number;
    batches: number;
    queue: ConnectorQueueStats;
    lastError: string | null;
    wait: {
        enabled: boolean;
        timeoutMs: number;
        pollMs: number;
        elapsedMs: number;
        timedOut: boolean;
        hitMaxBatches: boolean;
        reason: ConnectorQueueDrainReason;
    };
}

function toCloudEvents(batch: QueuedConnectorEvent[]): ConnectorEventPayload[] {
    return batch.map(item => ({
        eventId: item.eventId,
        sequence: item.sequence,
        contextId: item.contextId,
        type: item.type,
        timestamp: item.timestamp,
        source: item.source,
        payload: item.payload
    }));
}

export async function drainConnectorQueue(
    options: ConnectorQueueDrainOptions,
    deps: ConnectorQueueDrainDependencies
): Promise<ConnectorQueueDrainResult> {
    const startedAt = deps.now();
    const deadline = options.wait ? startedAt + options.timeoutMs : startedAt;
    let sent = 0;
    let failed = 0;
    let batches = 0;
    let lastError: string | null = null;
    let timedOut = false;
    let hitMaxBatches = false;
    let bridgeUnsupported = false;

    while (true) {
        while (batches < options.maxBatches) {
            const batch = deps.getReadyEvents(options.batchSize, deps.now());
            if (batch.length === 0) break;
            batches += 1;

            const cursor = batch.reduce((max, item) => Math.max(max, item.sequence), 0);
            const payload = {
                machineId: options.machineId,
                tenantId: options.tenantId,
                subscriptionId: batch[0].subscriptionId,
                cursor,
                events: toCloudEvents(batch)
            };

            const result = await deps.sendEvents(options.accessToken, payload);
            const queueIds = batch.map(item => item.queueId);

            if (result.ok) {
                deps.markEventsDelivered(queueIds);
                sent += batch.length;
                continue;
            }

            const errorText = result.error ?? 'connector_queue_drain_failed';
            deps.markEventsFailed(queueIds, errorText, deps.now());
            failed += batch.length;
            lastError = errorText;

            if (result.statusCode === 404) {
                bridgeUnsupported = true;
                await deps.onBridgeUnsupported();
                break;
            }
            break;
        }

        if (!options.wait) break;

        const snapshot = deps.getQueueStats(deps.now());
        if (snapshot.pending === 0 || bridgeUnsupported) break;
        if (batches >= options.maxBatches) {
            hitMaxBatches = true;
            break;
        }
        if (deps.now() >= deadline) {
            timedOut = true;
            break;
        }

        const remaining = deadline - deps.now();
        if (remaining <= 0) {
            timedOut = true;
            break;
        }
        const sleepFor = Math.max(1, Math.min(options.pollMs, remaining));
        await deps.sleep(sleepFor);
    }

    const queue = deps.getQueueStats(deps.now());
    const reason: ConnectorQueueDrainReason = options.wait
        ? (queue.pending === 0
            ? 'drained'
            : bridgeUnsupported
                ? 'bridge_unsupported'
                : timedOut
                    ? 'timeout'
                    : hitMaxBatches
                        ? 'max_batches'
                        : 'pending')
        : 'single_pass';

    return {
        sent,
        failed,
        batches,
        queue,
        lastError,
        wait: {
            enabled: options.wait,
            timeoutMs: options.timeoutMs,
            pollMs: options.pollMs,
            elapsedMs: deps.now() - startedAt,
            timedOut,
            hitMaxBatches,
            reason
        }
    };
}
