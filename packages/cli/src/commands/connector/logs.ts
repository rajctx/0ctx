import os from 'os';
import type { ConnectorCommandDeps, FlagMap } from './types';

export function createConnectorLogsCommand(deps: ConnectorCommandDeps) {
    return async function commandConnectorLogs(flags: FlagMap): Promise<number> {
        if (!Boolean(flags.service) && !Boolean(flags.system)) {
            return deps.commandLogs(flags);
        }

        const platform = os.platform();
        if (platform === 'win32') {
            console.log('Use Windows Event Viewer (Application logs) for service diagnostics.');
        } else if (platform === 'darwin') {
            console.log('Use: log stream --process 0ctx-daemon');
        } else if (platform === 'linux') {
            console.log('Use: systemctl --user status 0ctx-daemon && journalctl --user -u 0ctx-daemon -f');
        } else {
            console.log('No log helper available for this platform.');
        }
        return 0;
    };
}
