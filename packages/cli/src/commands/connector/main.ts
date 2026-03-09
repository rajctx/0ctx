import type { ConnectorCommandDeps, FlagMap } from './types';
import { createConnectorLogsCommand } from './logs';
import { createConnectorRegisterCommand } from './register';
import { createConnectorStatusCommand } from './status';
import { createConnectorVerifyCommand } from './verify';

export function createConnectorCommands(deps: ConnectorCommandDeps) {
    const commandVerify = createConnectorVerifyCommand(deps);
    const commandRegister = createConnectorRegisterCommand(deps);
    const commandStatus = createConnectorStatusCommand(deps);
    const commandLogs = createConnectorLogsCommand(deps);

    async function commandConnector(action: string | undefined, flags: FlagMap): Promise<number> {
        const validActions = ['install', 'enable', 'disable', 'uninstall', 'status', 'start', 'stop', 'restart', 'verify', 'register', 'run', 'logs'];
        if (!action || !validActions.includes(action)) {
            console.error(`Unknown connector action: '${action ?? ''}'`);
            console.error(`Valid actions: ${validActions.join(', ')}`);
            return 1;
        }

        if (action === 'run') {
            const intervalRaw = flags['interval-ms'];
            const intervalMs = typeof intervalRaw === 'string' ? Number(intervalRaw) : undefined;
            return deps.runConnectorRuntime({
                once: Boolean(flags.once),
                quiet: Boolean(flags.quiet),
                autoStartDaemon: !Boolean(flags['no-daemon-autostart']),
                intervalMs: Number.isFinite(intervalMs) ? intervalMs : undefined
            });
        }
        if (action === 'verify') return commandVerify(flags);
        if (action === 'register') return commandRegister(flags);
        if (action === 'status') return commandStatus(flags);
        if (action === 'logs') return commandLogs(flags);

        console.log(`connector ${action}: delegating to managed service lifecycle commands.`);
        return deps.commandDaemonService(action);
    }

    return { commandConnector };
}
