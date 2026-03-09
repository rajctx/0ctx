import type { FlagMap, QueueCommandDeps } from './types';

export function createQueueStatusCommand(deps: QueueCommandDeps) {
    return async function commandConnectorQueueStatus(flags: FlagMap): Promise<number> {
        const stats = deps.getConnectorQueueStats(Date.now());
        const sample = deps.listQueuedConnectorEvents().slice(0, 5).map(item => ({
            queueId: item.queueId,
            eventId: item.eventId,
            sequence: item.sequence,
            attempts: item.attempts,
            nextAttemptAt: new Date(item.nextAttemptAt).toISOString(),
            lastError: item.lastError
        }));

        const payload = {
            path: deps.getConnectorQueuePath(),
            stats: {
                ...stats,
                oldestEnqueuedAt: stats.oldestEnqueuedAt ? new Date(stats.oldestEnqueuedAt).toISOString() : null
            },
            sample
        };

        if (Boolean(flags.json)) {
            console.log(JSON.stringify(payload, null, 2));
            return 0;
        }

        console.log('\nConnector Queue\n');
        console.log(`  path:         ${payload.path}`);
        console.log(`  pending:      ${payload.stats.pending}`);
        console.log(`  ready:        ${payload.stats.ready}`);
        console.log(`  backoff:      ${payload.stats.backoff}`);
        console.log(`  max_attempts: ${payload.stats.maxAttempts}`);
        if (payload.stats.oldestEnqueuedAt) {
            console.log(`  oldest:       ${payload.stats.oldestEnqueuedAt}`);
        }
        if (payload.sample.length > 0) {
            console.log('\n  sample:');
            for (const row of payload.sample) {
                console.log(
                    `    seq=${row.sequence} attempts=${row.attempts} next=${row.nextAttemptAt}` +
                    `${row.lastError ? ` error=${row.lastError}` : ''}`
                );
            }
        }
        console.log('');
        return 0;
    };
}
