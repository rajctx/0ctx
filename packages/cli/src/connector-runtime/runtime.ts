import os from 'os';
import { syncCommandBridge } from './command-bridge.js';
import { getRuntimeDependencies } from './deps.js';
import { deriveRecoveryState, normalizeIntervalMs, sleep } from './helpers.js';
import { syncEventBridge } from './event-bridge.js';
import { persistRuntimeState, updateQueueMetrics } from './state.js';
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

function ensureLocalRegistration(deps: ConnectorRuntimeDependencies, tenantId: string | null, dashboardUrl: string) {
    return deps.registerConnector({
        tenantId,
        uiUrl: dashboardUrl
    }).state;
}

async function promoteRegistrationToCloud(
    deps: ConnectorRuntimeDependencies,
    accessToken: string,
    dashboardUrl: string,
    registration: NonNullable<ReturnType<ConnectorRuntimeDependencies['readConnectorState']>>
): Promise<string | null> {
    const cloudRegistration = await deps.registerConnectorInCloud(accessToken, {
        machineId: registration.machineId,
        tenantId: registration.tenantId,
        uiUrl: registration.uiUrl || dashboardUrl,
        platform: os.platform()
    });

    if (cloudRegistration.ok) {
        Object.assign(registration, {
            tenantId: cloudRegistration.data?.tenantId ?? registration.tenantId,
            registrationMode: 'cloud',
            cloud: {
                registrationId: cloudRegistration.data?.registrationId ?? registration.cloud.registrationId,
                streamUrl: cloudRegistration.data?.streamUrl ?? registration.cloud.streamUrl,
                capabilities: cloudRegistration.data?.capabilities ?? registration.cloud.capabilities,
                lastHeartbeatAt: registration.cloud.lastHeartbeatAt,
                lastError: null
            }
        });
        return null;
    }

    const lastError = cloudRegistration.error ?? 'cloud_registration_failed';
    registration.registrationMode = 'local';
    registration.cloud.lastError = lastError;
    return lastError;
}

async function refreshCloudCapabilitiesAndHeartbeat(params: {
    deps: ConnectorRuntimeDependencies;
    registration: NonNullable<ReturnType<ConnectorRuntimeDependencies['readConnectorState']>>;
    accessToken: string;
    daemonOk: boolean;
    sync: ConnectorRuntimeSyncStatus | null;
    lastError: string | null;
}): Promise<{ cloudConnected: boolean; lastError: string | null }> {
    const { deps, registration, accessToken, daemonOk, sync } = params;
    let { lastError } = params;
    let cloudConnected = false;

    const capabilitiesResult = await deps.fetchConnectorCapabilities(accessToken, registration.machineId);
    if (capabilitiesResult.ok) {
        registration.cloud.capabilities =
            capabilitiesResult.data?.capabilities ??
            capabilitiesResult.data?.features ??
            registration.cloud.capabilities;
        cloudConnected = true;
        lastError = null;
    } else if (capabilitiesResult.statusCode === 404) {
        registration.registrationMode = 'local';
        registration.cloud.registrationId = null;
        registration.cloud.streamUrl = null;
        registration.cloud.capabilities = [];
        lastError = 'connector_not_found_in_cloud';
    } else {
        lastError = capabilitiesResult.error ?? 'cloud_capabilities_failed';
    }

    const postureForHeartbeat: 'connected' | 'degraded' | 'offline' = daemonOk ? 'connected' : 'offline';
    const heartbeatResult =
        registration.registrationMode === 'cloud'
            ? await deps.sendConnectorHeartbeat(accessToken, {
                  machineId: registration.machineId,
                  tenantId: registration.tenantId,
                  posture: postureForHeartbeat,
                  daemonRunning: daemonOk,
                  syncEnabled: Boolean(sync?.enabled),
                  syncRunning: Boolean(sync?.running),
                  queue: sync?.queue
              })
            : { ok: false as const, error: 'connector_not_found_in_cloud' };

    if (heartbeatResult.ok) {
        cloudConnected = true;
        registration.cloud.lastHeartbeatAt = deps.now();
        if (lastError === 'cloud_capabilities_failed') lastError = null;
    } else {
        lastError = heartbeatResult.error ?? lastError ?? 'cloud_heartbeat_failed';
        cloudConnected = false;
    }

    return { cloudConnected, lastError };
}

async function ensureDaemonSession(
    deps: ConnectorRuntimeDependencies,
    registration: NonNullable<ReturnType<ConnectorRuntimeDependencies['readConnectorState']>>,
    daemonOk: boolean,
    lastError: string | null
): Promise<{ daemonSessionToken: string | null; lastError: string | null }> {
    let daemonSessionToken = registration.runtime.daemonSessionToken;
    if (
        daemonOk &&
        registration.registrationMode === 'cloud' &&
        (registration.runtime.eventBridgeSupported || registration.runtime.commandBridgeSupported) &&
        !daemonSessionToken
    ) {
        try {
            const session = await deps.createDaemonSession();
            daemonSessionToken = session.sessionToken;
            registration.runtime.daemonSessionToken = daemonSessionToken;
            registration.runtime.eventSubscriptionId = null;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            registration.runtime.eventBridgeError = message;
            registration.runtime.commandBridgeError = message;
            lastError = message;
        }
    }
    return { daemonSessionToken, lastError };
}

export async function runConnectorRuntimeCycle(
    options: ConnectorRuntimeOptions = {},
    deps: ConnectorRuntimeDependencies = getRuntimeDependencies()
): Promise<ConnectorRuntimeSummary> {
    const { daemon, lastError: initialError } = await ensureDaemonHealth(options, deps);
    let lastError = initialError;
    const token = deps.resolveToken();
    let registration = deps.readConnectorState();
    const dashboardUrl = deps.getDashboardUrl();

    if (token && !registration) {
        registration = ensureLocalRegistration(deps, token.tenantId || null, dashboardUrl);
    }

    const sync = await getSyncStatusIfAvailable(daemon.ok, deps);
    let cloudConnected = false;

    if (registration && token) {
        deps.pruneQueue(deps.now());

        if (registration.registrationMode !== 'cloud') {
            lastError = await promoteRegistrationToCloud(deps, token.accessToken, dashboardUrl, registration);
        }

        if (registration.registrationMode === 'cloud') {
            ({ cloudConnected, lastError } = await refreshCloudCapabilitiesAndHeartbeat({
                deps,
                registration,
                accessToken: token.accessToken,
                daemonOk: daemon.ok,
                sync,
                lastError
            }));

            let daemonSessionToken: string | null;
            ({ daemonSessionToken, lastError } = await ensureDaemonSession(deps, registration, daemon.ok, lastError));

            if (daemon.ok && registration.runtime.eventBridgeSupported) {
                ({ daemonSessionToken, lastError } = await syncEventBridge({
                    deps,
                    registration,
                    accessToken: token.accessToken,
                    daemonSessionToken,
                    lastError
                }));
            }

            if (daemon.ok && registration.runtime.commandBridgeSupported) {
                ({ daemonSessionToken, lastError } = await syncCommandBridge({
                    deps,
                    registration,
                    accessToken: token.accessToken,
                    daemonSessionToken,
                    lastError
                }));
            }

            registration.runtime.daemonSessionToken = daemonSessionToken;
            updateQueueMetrics(deps, registration);
        }

        persistRuntimeState({
            deps,
            registration,
            daemonOk: daemon.ok,
            token,
            cloudConnected,
            lastError
        });
    } else if (registration && !token) {
        deps.pruneQueue(deps.now());
        updateQueueMetrics(deps, registration);
        registration.cloud.lastError = 'auth_required';
        persistRuntimeState({
            deps,
            registration,
            daemonOk: daemon.ok,
            token: null,
            cloudConnected,
            lastError
        });
        lastError = 'auth_required';
    }

    const posture: 'connected' | 'degraded' | 'offline' = !daemon.ok
        ? 'offline'
        : (!token || !registration)
            ? 'degraded'
            : (registration.registrationMode === 'cloud' &&
               (!cloudConnected ||
                Boolean(registration.runtime.eventBridgeError) ||
                Boolean(registration.runtime.commandBridgeError)))
                ? 'degraded'
                : ((sync?.enabled === false || sync == null || sync?.running) ? 'connected' : 'degraded');

    const recoveryState = deriveRecoveryState({
        daemonOk: daemon.ok,
        token,
        registration,
        cloudConnected,
        lastError
    });

    return {
        posture,
        recoveryState,
        daemonRunning: daemon.ok,
        cloudConnected,
        registrationMode: registration ? registration.registrationMode : 'none',
        auth: Boolean(token),
        machineId: registration?.machineId ?? null,
        lastError,
        consecutiveFailures: registration?.runtime.consecutiveFailures ?? (recoveryState === 'healthy' ? 0 : 1)
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
                            `cloud=${summary.cloudConnected} mode=${summary.registrationMode} ` +
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
