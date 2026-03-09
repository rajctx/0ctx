import type { FlagMap, QueueCommandDeps } from './types';

export function createQueuePurgeCommand(deps: QueueCommandDeps) {
    return async function commandConnectorQueuePurge(flags: FlagMap): Promise<number> {
        const dryRun = Boolean(flags['dry-run']);
        const confirm = Boolean(flags.confirm);
        const all = Boolean(flags.all);
        const olderThanHours = deps.parsePositiveNumberFlag(flags['older-than-hours'], 0);
        const minAttempts = deps.parsePositiveNumberFlag(flags['min-attempts'], 0);
        const queuePath = deps.getConnectorQueuePath();

        if (!dryRun && !confirm) {
            console.error('connector_queue_purge_requires_confirm: pass --confirm (or use --dry-run).');
            deps.appendCliOpsLogEntry({ operation: 'connector.queue.purge', status: 'error', details: { reason: 'missing_confirm', dryRun, all, olderThanHours, minAttempts, queuePath } });
            return 1;
        }

        if (!all && olderThanHours <= 0 && minAttempts <= 0) {
            console.error('connector_queue_purge_requires_filter: use --all or --older-than-hours or --min-attempts.');
            deps.appendCliOpsLogEntry({ operation: 'connector.queue.purge', status: 'error', details: { reason: 'missing_filter', dryRun, all, olderThanHours, minAttempts, queuePath } });
            return 1;
        }

        if (dryRun) {
            const now = Date.now();
            const candidates = deps.listQueuedConnectorEvents();
            const removable = candidates.filter(item => {
                if (all) return true;
                const olderMatch = olderThanHours > 0 ? (now - item.enqueuedAt) >= olderThanHours * 60 * 60 * 1000 : false;
                const attemptsMatch = minAttempts > 0 ? item.attempts >= minAttempts : false;
                return olderMatch || attemptsMatch;
            }).length;

            deps.appendCliOpsLogEntry({ operation: 'connector.queue.purge', status: 'dry_run', details: { all, olderThanHours, minAttempts, removable, total: candidates.length, queuePath } });
            const payload = { dryRun: true, removable, total: candidates.length };
            if (Boolean(flags.json)) console.log(JSON.stringify(payload, null, 2));
            else console.log(`connector_queue_purge_dry_run: removable=${removable} total=${candidates.length}`);
            return 0;
        }

        const result = deps.purgeConnectorQueue({
            all,
            olderThanHours: olderThanHours > 0 ? olderThanHours : undefined,
            minAttempts: minAttempts > 0 ? minAttempts : undefined
        });

        deps.appendCliOpsLogEntry({ operation: 'connector.queue.purge', status: 'success', details: { all, olderThanHours: olderThanHours > 0 ? olderThanHours : null, minAttempts: minAttempts > 0 ? minAttempts : null, removed: result.removed, remaining: result.remaining, queuePath } });
        const payload = { removed: result.removed, remaining: result.remaining };
        if (Boolean(flags.json)) console.log(JSON.stringify(payload, null, 2));
        else console.log(`connector_queue_purge: removed=${result.removed} remaining=${result.remaining}`);
        return 0;
    };
}
