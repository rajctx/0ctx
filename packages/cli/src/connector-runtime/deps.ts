import { resolveToken } from '../auth.js';
import { readConnectorState, registerConnector, writeConnectorState } from '../connector.js';
import {
    ackConnectorCommand,
    fetchConnectorCapabilities,
    fetchConnectorCommands,
    registerConnectorInCloud,
    sendConnectorHeartbeat,
    sendConnectorEvents
} from '../cloud.js';
import {
    enqueueConnectorEvents,
    getConnectorQueueStats,
    getReadyConnectorEvents,
    markConnectorEventsDelivered,
    markConnectorEventsFailed,
    pruneConnectorQueue
} from '../connector-queue.js';
import {
    ackEvents,
    applyDaemonCommand,
    createDaemonSession,
    getContextSyncPolicy,
    getHostedDashboardUrl,
    getSyncStatus,
    isDaemonReachable,
    pollEvents,
    startDaemonDetached,
    subscribeEvents,
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
        resolveToken,
        readConnectorState,
        registerConnector,
        writeConnectorState,
        getDashboardUrl: getHostedDashboardUrl,
        registerConnectorInCloud,
        fetchConnectorCapabilities,
        sendConnectorHeartbeat,
        createDaemonSession,
        subscribeEvents,
        pollEvents,
        ackEvents,
        sendConnectorEvents,
        fetchConnectorCommands,
        ackConnectorCommand,
        applyDaemonCommand,
        getContextSyncPolicy,
        enqueueEvents: (subscriptionId, events, now) => enqueueConnectorEvents(subscriptionId, events, now),
        getReadyEvents: (limit, now) => getReadyConnectorEvents(limit, now),
        markEventsDelivered: queueIds => markConnectorEventsDelivered(queueIds),
        markEventsFailed: (queueIds, error, now) => markConnectorEventsFailed(queueIds, error, now),
        getQueueStats: now => getConnectorQueueStats(now),
        pruneQueue: now => pruneConnectorQueue({ now })
    };
}
