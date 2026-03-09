import type { FlagMap, QueueCommandDeps } from './types';

export function createQueueDrainCommand(deps: QueueCommandDeps) {
    return async function commandConnectorQueueDrain(flags: FlagMap): Promise<number> {
        const token = deps.resolveToken();
        if (!token) {
            console.error('connector_queue_drain_requires_auth: run `0ctx auth login` first.');
            deps.appendCliOpsLogEntry({ operation: 'connector.queue.drain', status: 'error', details: { reason: 'missing_auth', queuePath: deps.getConnectorQueuePath() } });
            return 1;
        }

        const registration = deps.readConnectorState();
        if (!registration) {
            console.error('connector_queue_drain_requires_registration: run `0ctx connector register` first.');
            deps.appendCliOpsLogEntry({ operation: 'connector.queue.drain', status: 'error', details: { reason: 'missing_registration', queuePath: deps.getConnectorQueuePath() } });
            return 1;
        }

        const maxBatches = deps.parsePositiveIntegerFlag(flags['max-batches'], 10);
        const batchSize = Math.min(500, deps.parsePositiveIntegerFlag(flags['batch-size'], 200));
        const wait = Boolean(flags.wait);
        const strict = Boolean(flags.strict) || Boolean(flags['fail-on-retry']);
        const timeoutMs = deps.parsePositiveIntegerFlag(flags['timeout-ms'], 120000);
        const pollMs = Math.max(200, deps.parsePositiveIntegerFlag(flags['poll-ms'], 1000));
        const queuePath = deps.getConnectorQueuePath();
        const drained = await deps.drainConnectorQueue({
            machineId: registration.machineId,
            tenantId: registration.tenantId,
            accessToken: token.accessToken,
            maxBatches,
            batchSize,
            wait,
            timeoutMs,
            pollMs
        }, {
            now: () => Date.now(),
            sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
            getReadyEvents: deps.getReadyConnectorEvents,
            sendEvents: deps.sendConnectorEvents,
            markEventsDelivered: deps.markConnectorEventsDelivered,
            markEventsFailed: deps.markConnectorEventsFailed,
            getQueueStats: deps.getConnectorQueueStats,
            onBridgeUnsupported: () => {
                registration.runtime.eventBridgeSupported = false;
                registration.runtime.eventBridgeError = null;
                registration.updatedAt = Date.now();
                deps.writeConnectorState(registration);
            }
        });

        registration.runtime.eventQueuePending = drained.queue.pending;
        registration.runtime.eventQueueReady = drained.queue.ready;
        registration.runtime.eventQueueBackoff = drained.queue.backoff;
        registration.runtime.eventBridgeError = drained.lastError;
        registration.updatedAt = Date.now();
        deps.writeConnectorState(registration);

        const response = {
            sent: drained.sent,
            failed: drained.failed,
            batches: drained.batches,
            queue: drained.queue,
            wait: {
                enabled: wait,
                strict,
                timeoutMs: drained.wait.timeoutMs,
                pollMs: drained.wait.pollMs,
                elapsedMs: drained.wait.elapsedMs,
                timedOut: drained.wait.timedOut,
                hitMaxBatches: drained.wait.hitMaxBatches,
                reason: drained.wait.reason
            },
            lastError: drained.lastError
        };

        const status = wait
            ? (drained.queue.pending === 0 && (!strict || drained.failed === 0) ? 'success' : 'partial')
            : (drained.failed > 0 ? 'partial' : 'success');
        deps.appendCliOpsLogEntry({ operation: 'connector.queue.drain', status, details: { queuePath, maxBatches, batchSize, wait, strict, timeoutMs: wait ? timeoutMs : null, pollMs: wait ? pollMs : null, sent: drained.sent, failed: drained.failed, batches: drained.batches, pending: drained.queue.pending, ready: drained.queue.ready, backoff: drained.queue.backoff, reason: drained.wait.reason, lastError: drained.lastError } });

        if (Boolean(flags.json)) {
            console.log(JSON.stringify(response, null, 2));
        } else {
            console.log('\nConnector Queue Drain\n');
            console.log(`  sent:         ${drained.sent}`);
            console.log(`  failed:       ${drained.failed}`);
            console.log(`  batches:      ${drained.batches}`);
            console.log(`  pending:      ${drained.queue.pending}`);
            console.log(`  ready:        ${drained.queue.ready}`);
            console.log(`  backoff:      ${drained.queue.backoff}`);
            if (wait) {
                console.log(`  wait:         true`);
                console.log(`  strict:       ${strict}`);
                console.log(`  timeout_ms:   ${drained.wait.timeoutMs}`);
                console.log(`  elapsed_ms:   ${drained.wait.elapsedMs}`);
                console.log(`  reason:       ${drained.wait.reason}`);
            }
            if (drained.lastError) console.log(`  error:        ${drained.lastError}`);
            console.log('');
        }

        if (wait) {
            if (drained.queue.pending > 0) return 1;
            return strict && drained.failed > 0 ? 1 : 0;
        }
        if (strict && drained.failed > 0) return 1;
        return drained.failed > 0 ? 1 : 0;
    };
}
