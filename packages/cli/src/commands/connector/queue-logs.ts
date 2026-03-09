import type { FlagMap, QueueCommandDeps } from './types';

export function createQueueLogsCommand(deps: QueueCommandDeps) {
    return async function commandConnectorQueueLogs(flags: FlagMap): Promise<number> {
        const limit = deps.parsePositiveIntegerFlag(flags.limit, 50);
        const clear = Boolean(flags.clear);
        const dryRun = Boolean(flags['dry-run']);
        const confirm = Boolean(flags.confirm);
        const currentEntries = deps.readCliOpsLog(limit).map((entry: any) => ({
            ...entry,
            isoTime: new Date(entry.timestamp).toISOString()
        }));
        const filePath = deps.getCliOpsLogPath();

        if (clear) {
            if (!dryRun && !confirm) {
                console.error('connector_queue_logs_clear_requires_confirm: pass --confirm (or use --dry-run).');
                return 1;
            }

            if (dryRun) {
                const payload = { dryRun: true, path: filePath, removableEntries: currentEntries.length };
                if (Boolean(flags.json)) console.log(JSON.stringify(payload, null, 2));
                else console.log(`connector_queue_logs_clear_dry_run: path=${filePath} removable_entries=${currentEntries.length}`);
            } else {
                const result = deps.clearCliOpsLog();
                const payload = { dryRun: false, ...result };
                if (Boolean(flags.json)) console.log(JSON.stringify(payload, null, 2));
                else console.log(`connector_queue_logs_clear: cleared=${result.cleared} path=${result.path}`);
            }
            return 0;
        }

        const payload = { path: filePath, count: currentEntries.length, entries: currentEntries };
        if (Boolean(flags.json)) {
            console.log(JSON.stringify(payload, null, 2));
            return 0;
        }

        console.log('\nConnector Queue Ops Log\n');
        console.log(`  path:  ${payload.path}`);
        console.log(`  count: ${payload.count}`);
        if (currentEntries.length > 0) {
            console.log('');
            for (const entry of currentEntries) {
                const details = entry.details ? ` details=${JSON.stringify(entry.details)}` : '';
                console.log(`  ${entry.isoTime} ${entry.status} ${entry.operation}${details}`);
            }
        }
        console.log('');
        return 0;
    };
}
