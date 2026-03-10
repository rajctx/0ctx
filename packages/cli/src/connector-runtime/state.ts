import type { TokenStore } from '../auth.js';
import type { ConnectorRuntimeDependencies } from './types.js';
import { deriveRecoveryState } from './helpers.js';

export function updateQueueMetrics(
    deps: ConnectorRuntimeDependencies,
    registration: NonNullable<ReturnType<ConnectorRuntimeDependencies['readConnectorState']>>
): void {
    const queueStats = deps.getQueueStats(deps.now());
    registration.runtime.eventQueuePending = queueStats.pending;
    registration.runtime.eventQueueReady = queueStats.ready;
    registration.runtime.eventQueueBackoff = queueStats.backoff;
}

export function persistRuntimeState(params: {
    deps: ConnectorRuntimeDependencies;
    registration: NonNullable<ReturnType<ConnectorRuntimeDependencies['readConnectorState']>>;
    daemonOk: boolean;
    token: TokenStore | null;
    cloudConnected: boolean;
    lastError: string | null;
}): void {
    const { deps, registration, daemonOk, token, cloudConnected, lastError } = params;
    const recoveryState = deriveRecoveryState({
        daemonOk,
        token,
        registration,
        cloudConnected,
        lastError
    });

    registration.runtime.recoveryState = recoveryState;
    registration.runtime.consecutiveFailures =
        recoveryState === 'healthy' ? 0 : (registration.runtime.consecutiveFailures ?? 0) + 1;
    if (recoveryState === 'healthy') registration.runtime.lastHealthyAt = deps.now();
    else registration.runtime.lastRecoveryAt = deps.now();
    registration.updatedAt = deps.now();
    registration.cloud.lastError = lastError;
    deps.writeConnectorState(registration);
}
