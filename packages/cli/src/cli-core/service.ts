import os from 'os';
import {
    disableService as disableServiceWindows,
    enableService as enableServiceWindows,
    installService as installServiceWindows,
    restartService as restartServiceWindows,
    startService as startServiceWindows,
    statusService as statusServiceWindows,
    stopService as stopServiceWindows,
    uninstallService as uninstallServiceWindows
} from '../service-windows';
import {
    disableService as disableServiceMac,
    enableService as enableServiceMac,
    installService as installServiceMac,
    restartService as restartServiceMac,
    startService as startServiceMac,
    statusService as statusServiceMac,
    stopService as stopServiceMac,
    uninstallService as uninstallServiceMac
} from '../service-macos';
import {
    disableService as disableServiceLinux,
    enableService as enableServiceLinux,
    installService as installServiceLinux,
    restartService as restartServiceLinux,
    startService as startServiceLinux,
    statusService as statusServiceLinux,
    stopService as stopServiceLinux,
    uninstallService as uninstallServiceLinux
} from '../service-linux';

type ServiceOps = {
    install: () => void;
    enable: () => void;
    disable: () => void;
    uninstall: () => void;
    status: () => void;
    start: () => void;
    stop: () => void;
    restart: () => void;
};

export async function commandDaemonService(action: string | undefined): Promise<number> {
    const platform = os.platform();

    const ops: ServiceOps =
        platform === 'win32' ? {
            install: installServiceWindows,
            enable: enableServiceWindows,
            disable: disableServiceWindows,
            uninstall: uninstallServiceWindows,
            status: statusServiceWindows,
            start: startServiceWindows,
            stop: stopServiceWindows,
            restart: restartServiceWindows,
        } : platform === 'darwin' ? {
            install: installServiceMac,
            enable: enableServiceMac,
            disable: disableServiceMac,
            uninstall: uninstallServiceMac,
            status: statusServiceMac,
            start: startServiceMac,
            stop: stopServiceMac,
            restart: restartServiceMac,
        } : {
            install: installServiceLinux,
            enable: enableServiceLinux,
            disable: disableServiceLinux,
            uninstall: uninstallServiceLinux,
            status: statusServiceLinux,
            start: startServiceLinux,
            stop: stopServiceLinux,
            restart: restartServiceLinux,
        };

    const validActions = ['install', 'enable', 'disable', 'uninstall', 'status', 'start', 'stop', 'restart'];
    if (!action || !validActions.includes(action)) {
        console.error(`Unknown service action: '${action ?? ''}'`);
        console.error(`Valid actions: ${validActions.join(', ')}`);
        return 1;
    }

    try {
        ops[action as keyof ServiceOps]();
        return 0;
    } catch (error) {
        console.error(`service ${action} failed:`, error instanceof Error ? error.message : String(error));
        return 1;
    }
}
