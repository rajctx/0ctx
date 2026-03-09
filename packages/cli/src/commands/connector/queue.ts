import type { FlagMap, QueueCommandDeps } from './types';
import { createQueueStatusCommand } from './queue-status';
import { createQueueLogsCommand } from './queue-logs';
import { createQueuePurgeCommand } from './queue-purge';
import { createQueueDrainCommand } from './queue-drain';

export function createQueueCommands(deps: QueueCommandDeps) {
    const commandStatus = createQueueStatusCommand(deps);
    const commandLogs = createQueueLogsCommand(deps);
    const commandPurge = createQueuePurgeCommand(deps);
    const commandDrain = createQueueDrainCommand(deps);

    async function commandConnectorQueue(action: string | undefined, flags: FlagMap): Promise<number> {
        const validActions = ['status', 'drain', 'purge', 'logs'];
        const safeAction = action || 'status';

        if (!validActions.includes(safeAction)) {
            console.error(`Unknown connector queue action: '${action ?? ''}'`);
            console.error(`Valid actions: ${validActions.join(', ')}`);
            return 1;
        }

        if (safeAction === 'status') return commandStatus(flags);
        if (safeAction === 'logs') return commandLogs(flags);
        if (safeAction === 'purge') return commandPurge(flags);
        return commandDrain(flags);
    }

    return { commandConnectorQueue };
}
