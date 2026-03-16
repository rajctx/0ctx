import { getRuntimeDependencies } from './deps.js';
import { normalizeIntervalMs, sleep } from './helpers.js';
import type {
    ConnectorRuntimeDependencies,
    ConnectorRuntimeOptions,
    ConnectorRuntimeSummary,
    ConnectorRuntimeSyncStatus
} from './types.js';

async function ensureDaemonHealth(
    options: ConnectorRuntimeOptions,
    deps: ConnectorRuntimeDependencies
): Promise<{ daemon: { ok: boolean; error?: string }; lastError: string | null }> {
    const autoStartDaemon = options.autoStartDaemon !== false;
    let daemon = await deps.isDaemonReachable();
    let lastError: string | null = daemon.ok ? null : (daemon.error ?? 'daemon_unreachable');

    if (!daemon.ok && autoStartDaemon) {
        try {
            deps.startDaemonDetached();
            const ready = await deps.waitForDaemon(8_000);
            daemon = ready ? await deps.isDaemonReachable() : { ok: false, error: 'daemon_start_timeout' };
            lastError = daemon.ok ? null : (daemon.error ?? 'daemon_start_failed');
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }
    }

    return { daemon, lastError };
}

async function getSyncStatusIfAvailable(
    daemonOk: boolean,
    deps: ConnectorRuntimeDependencies
): Promise<ConnectorRuntimeSyncStatus | null> {
    return daemonOk ? deps.getSyncStatus() : null;
}

function ensureLocalRegistration(deps: ConnectorRuntimeDependencies, hostedUiUrl: string) {
    return deps.registerConnector({ uiUrl: hostedUiUrl }).state;
}

function persistLocalRuntimeState(params: {
    deps: ConnectorRuntimeDependencies;
    registration: NonNullable<ReturnType<ConnectorRuntimeDependencies['readConnectorState']>>;
    daemonOk: boolean;
    lastError: string | null;
}): void {
    const { deps, registration, daemonOk, lastError } = params;
    const recoveryState = !daemonOk
        ? 'blocked'
        : (registration.runtime.eventQueueBackoff > 0 || Boolean(lastError))
            ? 'backoff'
            : 'healthy';

    registration.runtime.recoveryState = recoveryState;
    registration.runtime.consecutiveFailures =
        recoveryState === 'healthy' ? 0 : (registration.runtime.consecutiveFailures ?? 0) + 1;
    if (recoveryState === 'healthy') registration.runtime.lastHealthyAt = deps.now();
    else registration.runtime.lastRecoveryAt = deps.now();
    registration.updatedAt = deps.now();
    deps.writeConnectorState(registration);
}

export async function runConnectorRuntimeCycle(
    options: ConnectorRuntimeOptions = {},
    deps: ConnectorRuntimeDependencies = getRuntimeDependencies()
): Promise<ConnectorRuntimeSummary> {
    const { daemon, lastError } = await ensureDaemonHealth(options, deps);
    const hostedUiUrl = deps.getHostedUiUrl();
    const registration = deps.readConnectorState() ?? ensureLocalRegistration(deps, hostedUiUrl);
    const sync = await getSyncStatusIfAvailable(daemon.ok, deps);

    const queueStats = deps.getQueueStats(deps.now());
    registration.runtime.eventQueuePending = queueStats.pending;
    registration.runtime.eventQueueReady = queueStats.ready;
    registration.runtime.eventQueueBackoff = queueStats.backoff;
    persistLocalRuntimeState({
        deps,
        registration,
        daemonOk: daemon.ok,
        lastError
    });

    const posture: 'connected' | 'degraded' | 'offline' = !daemon.ok
        ? 'offline'
        : ((sync?.enabled === false || sync == null || sync?.running) ? 'connected' : 'degraded');
    const recoveryState = registration.runtime.recoveryState ?? (daemon.ok ? 'healthy' : 'blocked');

    return {
        posture,
        recoveryState,
        daemonRunning: daemon.ok,
        machineId: registration.machineId,
        lastError,
        consecutiveFailures: registration.runtime.consecutiveFailures ?? (recoveryState === 'healthy' ? 0 : 1)
    };
}

export async function runConnectorRuntime(
    options: ConnectorRuntimeOptions = {},
    deps: ConnectorRuntimeDependencies = getRuntimeDependencies()
): Promise<number> {
    const intervalMs = normalizeIntervalMs(options.intervalMs);
    let stopping = false;
    const onSignal = () => {
        stopping = true;
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);

    try {
        do {
            try {
                const summary = await runConnectorRuntimeCycle(options, deps);
                if (!options.quiet) {
                    deps.log(
                        `connector_runtime_tick posture=${summary.posture} daemon=${summary.daemonRunning} ` +
                            `machine_id=${summary.machineId ?? 'n/a'}`
                    );
                    if (summary.lastError) {
                        deps.warn(`connector_runtime_error ${summary.lastError}`);
                    }
                }
                if (options.once) {
                    return summary.posture === 'offline' ? 1 : 0;
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                deps.error(`connector_runtime_tick_failed ${message}`);
                if (options.once) return 1;
            }

            if (stopping || options.once) break;
            await sleep(intervalMs);
        } while (!stopping);
        return 0;
    } finally {
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);
    }
}
