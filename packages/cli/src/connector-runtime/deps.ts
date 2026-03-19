import { readConnectorState, registerConnector, writeConnectorState } from '../connector.js';
import { getConnectorQueueStats } from '../connector-queue.js';
import {
    getUiUrl,
    getSyncStatus,
    isDaemonReachable,
    startDaemonDetached,
    waitForDaemon
} from './daemon.js';
import type { ConnectorRuntimeDependencies } from './types.js';

export function getRuntimeDependencies(): ConnectorRuntimeDependencies {
    return {
        now: () => Date.now(),
        log: message => console.log(message),
        warn: message => console.warn(message),
        error: message => console.error(message),
        isDaemonReachable,
        startDaemonDetached,
        waitForDaemon,
        getSyncStatus,
        readConnectorState,
        registerConnector,
        writeConnectorState,
        getUiUrl,
        getQueueStats: now => getConnectorQueueStats(now)
    };
}
