import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { sendToDaemon } from '@0ctx/mcp/dist/client';
import { getConfigValue } from '@0ctx/core';
import { resolveToken, type TokenStore } from './auth';
import {
    type ConnectorState,
    readConnectorState,
    registerConnector,
    writeConnectorState
} from './connector';
import {
    type ConnectorEventPayload,
    fetchConnectorCapabilities,
    registerConnectorInCloud,
    sendConnectorHeartbeat,
    sendConnectorEvents
} from './cloud';

export interface ConnectorRuntimeSyncStatus {
    enabled: boolean;
    running: boolean;
    lastError: string | null;
    queue?: {
        pending: number;
        inFlight: number;
        failed: number;
        done: number;
    };
}

export interface ConnectorRuntimeOptions {
    intervalMs?: number;
    once?: boolean;
    autoStartDaemon?: boolean;
    quiet?: boolean;
}

export interface ConnectorRuntimeSummary {
    posture: 'connected' | 'degraded' | 'offline';
    daemonRunning: boolean;
    cloudConnected: boolean;
    registrationMode: 'none' | 'local' | 'cloud';
    auth: boolean;
    machineId: string | null;
    lastError: string | null;
}

export interface ConnectorRuntimeDependencies {
    now(): number;
    log(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    isDaemonReachable(): Promise<{ ok: boolean; error?: string }>;
    startDaemonDetached(): void;
    waitForDaemon(timeoutMs?: number): Promise<boolean>;
    getSyncStatus(): Promise<ConnectorRuntimeSyncStatus | null>;
    resolveToken(): TokenStore | null;
    readConnectorState(): ConnectorState | null;
    registerConnector(options: {
        tenantId?: string | null;
        uiUrl: string;
        force?: boolean;
        registrationMode?: 'local' | 'cloud';
        cloud?: {
            registrationId?: string | null;
            streamUrl?: string | null;
            capabilities?: string[];
        };
    }): { state: ConnectorState; created: boolean };
    writeConnectorState(state: ConnectorState): void;
    getDashboardUrl(): string;
    registerConnectorInCloud(
        token: string,
        payload: {
            machineId: string;
            tenantId: string | null;
            uiUrl: string;
            platform: string;
        }
    ): Promise<{
        ok: boolean;
        error?: string;
        data?: { registrationId?: string; streamUrl?: string; capabilities?: string[]; tenantId?: string };
    }>;
    fetchConnectorCapabilities(
        token: string,
        machineId: string
    ): Promise<{ ok: boolean; error?: string; data?: { capabilities?: string[]; features?: string[] } }>;
    sendConnectorHeartbeat(
        token: string,
        payload: {
            machineId: string;
            tenantId: string | null;
            posture: 'connected' | 'degraded' | 'offline';
            daemonRunning: boolean;
            syncEnabled: boolean;
            syncRunning: boolean;
            queue?: { pending: number; inFlight: number; failed: number; done: number };
        }
    ): Promise<{ ok: boolean; error?: string }>;
    createDaemonSession(): Promise<{ sessionToken: string }>;
    subscribeEvents(
        sessionToken: string,
        afterSequence?: number
    ): Promise<{ subscriptionId: string; lastAckedSequence?: number }>;
    pollEvents(
        sessionToken: string,
        subscriptionId: string,
        afterSequence: number,
        limit?: number
    ): Promise<{ cursor: number; events: ConnectorEventPayload[]; hasMore?: boolean }>;
    ackEvents(
        sessionToken: string,
        subscriptionId: string,
        sequence: number
    ): Promise<{ lastAckedSequence?: number }>;
    sendConnectorEvents(
        token: string,
        payload: {
            machineId: string;
            tenantId: string | null;
            subscriptionId: string;
            cursor: number;
            events: ConnectorEventPayload[];
        }
    ): Promise<{ ok: boolean; error?: string; statusCode: number }>;
}

const DEFAULT_INTERVAL_MS = 30_000;
const MIN_INTERVAL_MS = 5_000;

function resolveDaemonEntrypoint(): string {
    const candidates = [
        path.resolve(process.cwd(), 'packages', 'daemon', 'dist', 'index.js'),
        path.resolve(__dirname, '..', '..', 'daemon', 'dist', 'index.js'),
        (() => {
            try {
                return require.resolve('@0ctx/daemon/dist/index.js');
            } catch {
                return '';
            }
        })()
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }

    throw new Error('Could not resolve daemon entrypoint. Run `npm run build` first.');
}

export function getHostedDashboardUrl(): string {
    const configured = getConfigValue('ui.url');
    if (typeof configured === 'string' && configured.trim().length > 0) {
        return configured.trim();
    }
    return 'https://app.0ctx.com';
}

export function startDaemonDetached(): void {
    const entry = resolveDaemonEntrypoint();
    const child = spawn(process.execPath, [entry], {
        detached: true,
        stdio: 'ignore'
    });
    child.unref();
}

export async function isDaemonReachable(): Promise<{ ok: boolean; error?: string }> {
    try {
        await sendToDaemon('health', {});
        return { ok: true };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

export async function waitForDaemon(timeoutMs = 10_000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const status = await isDaemonReachable();
        if (status.ok) return true;
        await sleep(300);
    }
    return false;
}

async function getSyncStatus(): Promise<ConnectorRuntimeSyncStatus | null> {
    try {
        const sync = await sendToDaemon('syncStatus', {}) as ConnectorRuntimeSyncStatus;
        return sync;
    } catch {
        return null;
    }
}

async function createDaemonSession(): Promise<{ sessionToken: string }> {
    const session = await sendToDaemon('createSession', {}) as { sessionToken?: string };
    if (!session?.sessionToken) {
        throw new Error('createSession returned no sessionToken');
    }
    return { sessionToken: session.sessionToken };
}

async function subscribeEvents(
    sessionToken: string,
    afterSequence = 0
): Promise<{ subscriptionId: string; lastAckedSequence?: number }> {
    const subscription = await sendToDaemon(
        'subscribeEvents',
        { afterSequence },
        { sessionToken }
    ) as { subscriptionId?: string; lastAckedSequence?: number };
    if (!subscription?.subscriptionId) {
        throw new Error('subscribeEvents returned no subscriptionId');
    }
    return {
        subscriptionId: subscription.subscriptionId,
        lastAckedSequence: subscription.lastAckedSequence
    };
}

async function pollEvents(
    sessionToken: string,
    subscriptionId: string,
    afterSequence: number,
    limit = 200
): Promise<{ cursor: number; events: ConnectorEventPayload[]; hasMore?: boolean }> {
    const result = await sendToDaemon(
        'pollEvents',
        { subscriptionId, afterSequence, limit },
        { sessionToken }
    ) as { cursor?: number; events?: ConnectorEventPayload[]; hasMore?: boolean };
    return {
        cursor: typeof result?.cursor === 'number' ? result.cursor : afterSequence,
        events: Array.isArray(result?.events) ? result.events : [],
        hasMore: result?.hasMore
    };
}

async function ackEvents(
    sessionToken: string,
    subscriptionId: string,
    sequence: number
): Promise<{ lastAckedSequence?: number }> {
    const result = await sendToDaemon(
        'ackEvent',
        { subscriptionId, sequence },
        { sessionToken }
    ) as { lastAckedSequence?: number };
    return result ?? {};
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeIntervalMs(intervalMs: number | undefined): number {
    if (!intervalMs || !Number.isFinite(intervalMs)) return DEFAULT_INTERVAL_MS;
    return Math.max(MIN_INTERVAL_MS, intervalMs);
}

function getRuntimeDependencies(): ConnectorRuntimeDependencies {
    return {
        now: () => Date.now(),
        log: (message) => console.log(message),
        warn: (message) => console.warn(message),
        error: (message) => console.error(message),
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
        sendConnectorEvents
    };
}

export async function runConnectorRuntimeCycle(
    options: ConnectorRuntimeOptions = {},
    deps: ConnectorRuntimeDependencies = getRuntimeDependencies()
): Promise<ConnectorRuntimeSummary> {
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

    const token = deps.resolveToken();
    let registration = deps.readConnectorState();
    const dashboardUrl = deps.getDashboardUrl();

    if (token && !registration) {
        const created = deps.registerConnector({
            tenantId: token.tenantId || null,
            uiUrl: dashboardUrl
        });
        registration = created.state;
    }

    let sync: ConnectorRuntimeSyncStatus | null = null;
    if (daemon.ok) {
        sync = await deps.getSyncStatus();
    }

    let cloudConnected = false;
    if (registration && token) {
        if (registration.registrationMode !== 'cloud') {
            const cloudRegistration = await deps.registerConnectorInCloud(token.accessToken, {
                machineId: registration.machineId,
                tenantId: registration.tenantId,
                uiUrl: registration.uiUrl || dashboardUrl,
                platform: os.platform()
            });

            if (cloudRegistration.ok) {
                registration = {
                    ...registration,
                    tenantId: cloudRegistration.data?.tenantId ?? registration.tenantId,
                    registrationMode: 'cloud',
                    cloud: {
                        registrationId: cloudRegistration.data?.registrationId ?? registration.cloud.registrationId,
                        streamUrl: cloudRegistration.data?.streamUrl ?? registration.cloud.streamUrl,
                        capabilities: cloudRegistration.data?.capabilities ?? registration.cloud.capabilities,
                        lastHeartbeatAt: registration.cloud.lastHeartbeatAt,
                        lastError: null
                    }
                };
            } else {
                lastError = cloudRegistration.error ?? 'cloud_registration_failed';
                registration = {
                    ...registration,
                    registrationMode: 'local',
                    cloud: {
                        ...registration.cloud,
                        lastError
                    }
                };
            }
        }

        if (registration.registrationMode === 'cloud') {
            const capabilitiesResult = await deps.fetchConnectorCapabilities(token.accessToken, registration.machineId);
            if (capabilitiesResult.ok) {
                registration.cloud.capabilities = capabilitiesResult.data?.capabilities
                    ?? capabilitiesResult.data?.features
                    ?? registration.cloud.capabilities;
                cloudConnected = true;
                lastError = null;
            } else {
                lastError = capabilitiesResult.error ?? 'cloud_capabilities_failed';
            }

            const postureForHeartbeat: 'connected' | 'degraded' | 'offline' = daemon.ok ? 'connected' : 'offline';
            const heartbeatResult = await deps.sendConnectorHeartbeat(token.accessToken, {
                machineId: registration.machineId,
                tenantId: registration.tenantId,
                posture: postureForHeartbeat,
                daemonRunning: daemon.ok,
                syncEnabled: Boolean(sync?.enabled),
                syncRunning: Boolean(sync?.running),
                queue: sync?.queue
            });

            if (heartbeatResult.ok) {
                cloudConnected = true;
                registration.cloud.lastHeartbeatAt = deps.now();
                if (lastError === 'cloud_capabilities_failed') {
                    lastError = null;
                }
            } else {
                lastError = heartbeatResult.error ?? lastError ?? 'cloud_heartbeat_failed';
                cloudConnected = false;
            }

            if (daemon.ok && registration.runtime.eventBridgeSupported) {
                try {
                    if (!registration.runtime.daemonSessionToken) {
                        const session = await deps.createDaemonSession();
                        registration.runtime.daemonSessionToken = session.sessionToken;
                        registration.runtime.eventSubscriptionId = null;
                    }

                    const daemonSessionToken = registration.runtime.daemonSessionToken;
                    if (!daemonSessionToken) {
                        throw new Error('daemon_session_unavailable');
                    }

                    if (!registration.runtime.eventSubscriptionId) {
                        const subscription = await deps.subscribeEvents(
                            daemonSessionToken,
                            registration.runtime.lastEventSequence
                        );
                        registration.runtime.eventSubscriptionId = subscription.subscriptionId;
                        if (typeof subscription.lastAckedSequence === 'number') {
                            registration.runtime.lastEventSequence = subscription.lastAckedSequence;
                        }
                    }

                    const subscriptionId = registration.runtime.eventSubscriptionId;
                    if (!subscriptionId) {
                        throw new Error('event_subscription_unavailable');
                    }

                    const polled = await deps.pollEvents(
                        daemonSessionToken,
                        subscriptionId,
                        registration.runtime.lastEventSequence,
                        200
                    );

                    if (polled.events.length > 0) {
                        const ingestResult = await deps.sendConnectorEvents(token.accessToken, {
                            machineId: registration.machineId,
                            tenantId: registration.tenantId,
                            subscriptionId,
                            cursor: polled.cursor,
                            events: polled.events
                        });

                        if (ingestResult.ok) {
                            await deps.ackEvents(daemonSessionToken, subscriptionId, polled.cursor);
                            registration.runtime.lastEventSequence = polled.cursor;
                            registration.runtime.lastEventSyncAt = deps.now();
                            registration.runtime.eventBridgeError = null;
                        } else if (ingestResult.statusCode === 404) {
                            // Control plane may not have event ingest yet; stop retrying until re-registration.
                            registration.runtime.eventBridgeSupported = false;
                            registration.runtime.eventBridgeError = null;
                        } else {
                            registration.runtime.eventBridgeError = ingestResult.error ?? 'event_ingest_failed';
                            lastError = registration.runtime.eventBridgeError;
                        }
                    } else {
                        registration.runtime.eventBridgeError = null;
                    }
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    registration.runtime.eventBridgeError = message;

                    if (message.includes('Invalid sessionToken')) {
                        registration.runtime.daemonSessionToken = null;
                        registration.runtime.eventSubscriptionId = null;
                    } else if (message.includes('not found')) {
                        registration.runtime.eventSubscriptionId = null;
                    }

                    lastError = message;
                }
            }
        }

        registration.updatedAt = deps.now();
        registration.cloud.lastError = lastError;
        deps.writeConnectorState(registration);
    } else if (registration && !token) {
        registration.updatedAt = deps.now();
        registration.cloud.lastError = 'auth_required';
        deps.writeConnectorState(registration);
        lastError = 'auth_required';
    }

    const posture: 'connected' | 'degraded' | 'offline' = !daemon.ok
        ? 'offline'
        : (!token || !registration)
            ? 'degraded'
            : (registration.registrationMode === 'cloud' && !cloudConnected)
                ? 'degraded'
                : (sync?.enabled && sync?.running ? 'connected' : 'degraded');

    return {
        posture,
        daemonRunning: daemon.ok,
        cloudConnected,
        registrationMode: registration ? registration.registrationMode : 'none',
        auth: Boolean(token),
        machineId: registration?.machineId ?? null,
        lastError
    };
}

export async function runConnectorRuntime(
    options: ConnectorRuntimeOptions = {},
    deps: ConnectorRuntimeDependencies = getRuntimeDependencies()
): Promise<number> {
    const intervalMs = normalizeIntervalMs(options.intervalMs);
    let stopping = false;
    const onSignal = () => { stopping = true; };
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
