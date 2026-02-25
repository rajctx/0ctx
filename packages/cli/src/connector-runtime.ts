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
    ackConnectorCommand,
    type ConnectorCommand,
    type ConnectorEventPayload,
    fetchConnectorCommands,
    fetchConnectorCapabilities,
    registerConnectorInCloud,
    sendConnectorHeartbeat,
    sendConnectorEvents
} from './cloud';
import {
    enqueueConnectorEvents,
    getConnectorQueueStats,
    pruneConnectorQueue,
    getReadyConnectorEvents,
    markConnectorEventsDelivered,
    markConnectorEventsFailed
} from './connector-queue';

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
    fetchConnectorCommands(
        token: string,
        machineId: string,
        cursor: number
    ): Promise<{ ok: boolean; error?: string; statusCode: number; data?: { cursor?: number; commands?: ConnectorCommand[] } }>;
    ackConnectorCommand(
        token: string,
        payload: {
            machineId: string;
            tenantId: string | null;
            commandId: string;
            cursor: number;
            status: 'applied' | 'failed';
            error?: string;
        }
    ): Promise<{ ok: boolean; error?: string; statusCode: number }>;
    applyDaemonCommand(
        sessionToken: string,
        method: string,
        params: Record<string, unknown>
    ): Promise<unknown>;
    getContextSyncPolicy(
        sessionToken: string,
        contextId: string
    ): Promise<'local_only' | 'metadata_only' | 'full_sync' | null>;
    enqueueEvents(
        subscriptionId: string,
        events: ConnectorEventPayload[],
        now: number
    ): { enqueued: number; lastSequence: number | null };
    getReadyEvents(limit: number, now: number): Array<{
        queueId: string;
        eventId: string;
        subscriptionId: string;
        sequence: number;
        contextId: string | null;
        type: string;
        timestamp: number;
        source: string;
        payload: Record<string, unknown>;
    }>;
    markEventsDelivered(queueIds: string[]): void;
    markEventsFailed(queueIds: string[], error: string, now: number): void;
    getQueueStats(now: number): {
        pending: number;
        ready: number;
        backoff: number;
        maxAttempts: number;
        oldestEnqueuedAt: number | null;
    };
    pruneQueue(now: number): { removed: number; remaining: number };
}

const DEFAULT_INTERVAL_MS = 30_000;
const MIN_INTERVAL_MS = 5_000;
const CLOUD_COMMAND_METHOD_ALLOWLIST = new Set([
    'addNode',
    'updateNode',
    'deleteNode',
    'addEdge',
    'saveCheckpoint',
    'resolveGate',
    'setSyncPolicy'
]);

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

async function applyDaemonCommand(
    sessionToken: string,
    method: string,
    params: Record<string, unknown>
): Promise<unknown> {
    return sendToDaemon(method, params, { sessionToken });
}

async function getContextSyncPolicy(
    sessionToken: string,
    contextId: string
): Promise<'local_only' | 'metadata_only' | 'full_sync' | null> {
    try {
        const result = await sendToDaemon(
            'getSyncPolicy',
            { contextId },
            { sessionToken }
        ) as { syncPolicy?: string };
        if (result.syncPolicy === 'local_only' || result.syncPolicy === 'metadata_only' || result.syncPolicy === 'full_sync') {
            return result.syncPolicy;
        }
        return null;
    } catch {
        return null;
    }
}

function redactEventForMetadataOnly(event: ConnectorEventPayload): ConnectorEventPayload {
    const payload = event.payload ?? {};
    const method = typeof payload.method === 'string' ? payload.method : null;
    const result = typeof payload.result === 'object' && payload.result !== null
        ? payload.result as Record<string, unknown>
        : null;
    const contextId = typeof payload.contextId === 'string' ? payload.contextId : null;
    const id = typeof payload.id === 'string' ? payload.id : null;

    return {
        eventId: event.eventId,
        sequence: event.sequence,
        contextId: event.contextId,
        type: event.type,
        timestamp: event.timestamp,
        source: event.source,
        payload: {
            mode: 'metadata_only',
            ...(method ? { method } : {}),
            ...(contextId ? { contextId } : {}),
            ...(id ? { id } : {}),
            ...(result ? { result } : {})
        }
    };
}

function isMethodAllowedForCloudCommand(method: string): boolean {
    return CLOUD_COMMAND_METHOD_ALLOWLIST.has(method);
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
        sendConnectorEvents,
        fetchConnectorCommands,
        ackConnectorCommand,
        applyDaemonCommand,
        getContextSyncPolicy,
        enqueueEvents: (subscriptionId, events, now) => enqueueConnectorEvents(subscriptionId, events, now),
        getReadyEvents: (limit, now) => getReadyConnectorEvents(limit, now),
        markEventsDelivered: (queueIds) => markConnectorEventsDelivered(queueIds),
        markEventsFailed: (queueIds, error, now) => markConnectorEventsFailed(queueIds, error, now),
        getQueueStats: (now) => getConnectorQueueStats(now),
        pruneQueue: (now) => pruneConnectorQueue({ now })
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
        deps.pruneQueue(deps.now());

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

            let daemonSessionToken = registration.runtime.daemonSessionToken;
            if (daemon.ok && (registration.runtime.eventBridgeSupported || registration.runtime.commandBridgeSupported) && !daemonSessionToken) {
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

            if (daemon.ok && registration.runtime.eventBridgeSupported) {
                try {
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
                        const policyCache = new Map<string, 'local_only' | 'metadata_only' | 'full_sync' | null>();
                        const filteredEvents: ConnectorEventPayload[] = [];

                        for (const event of polled.events) {
                            if (!event.contextId) {
                                filteredEvents.push(event);
                                continue;
                            }
                            if (!policyCache.has(event.contextId)) {
                                policyCache.set(
                                    event.contextId,
                                    await deps.getContextSyncPolicy(daemonSessionToken, event.contextId)
                                );
                            }
                            const policy = policyCache.get(event.contextId) ?? 'metadata_only';
                            if (policy === 'local_only') {
                                continue;
                            }
                            filteredEvents.push(policy === 'metadata_only' ? redactEventForMetadataOnly(event) : event);
                        }

                        if (filteredEvents.length > 0) {
                            deps.enqueueEvents(subscriptionId, filteredEvents, deps.now());
                        }

                        const ackSequence = polled.cursor;
                        if (typeof ackSequence === 'number' && ackSequence > registration.runtime.lastEventSequence) {
                            await deps.ackEvents(daemonSessionToken, subscriptionId, ackSequence);
                            registration.runtime.lastEventSequence = ackSequence;
                        }
                    }

                    const readyEvents = deps.getReadyEvents(200, deps.now());
                    if (readyEvents.length > 0) {
                        const policyCache = new Map<string, 'local_only' | 'metadata_only' | 'full_sync' | null>();
                        const queueIdsToDrop: string[] = [];
                        const sendable = [];

                        for (const item of readyEvents) {
                            if (!item.contextId) {
                                sendable.push({
                                    queueId: item.queueId,
                                    subscriptionId: item.subscriptionId,
                                    event: {
                                        eventId: item.eventId,
                                        sequence: item.sequence,
                                        contextId: item.contextId,
                                        type: item.type,
                                        timestamp: item.timestamp,
                                        source: item.source,
                                        payload: item.payload
                                    } satisfies ConnectorEventPayload
                                });
                                continue;
                            }

                            if (!policyCache.has(item.contextId)) {
                                policyCache.set(
                                    item.contextId,
                                    await deps.getContextSyncPolicy(daemonSessionToken, item.contextId)
                                );
                            }
                            const policy = policyCache.get(item.contextId) ?? 'metadata_only';
                            if (policy === 'local_only') {
                                queueIdsToDrop.push(item.queueId);
                                continue;
                            }

                            const rawEvent: ConnectorEventPayload = {
                                eventId: item.eventId,
                                sequence: item.sequence,
                                contextId: item.contextId,
                                type: item.type,
                                timestamp: item.timestamp,
                                source: item.source,
                                payload: item.payload
                            };
                            sendable.push({
                                queueId: item.queueId,
                                subscriptionId: item.subscriptionId,
                                event: policy === 'metadata_only' ? redactEventForMetadataOnly(rawEvent) : rawEvent
                            });
                        }

                        if (queueIdsToDrop.length > 0) {
                            deps.markEventsDelivered(queueIdsToDrop);
                        }

                        if (sendable.length === 0) {
                            registration.runtime.eventBridgeError = null;
                        } else {
                            const cursor = sendable.reduce((max, item) => Math.max(max, item.event.sequence), 0);
                            const ingestResult = await deps.sendConnectorEvents(token.accessToken, {
                                machineId: registration.machineId,
                                tenantId: registration.tenantId,
                                subscriptionId: sendable[0].subscriptionId,
                                cursor,
                                events: sendable.map(item => item.event)
                            });

                            const queueIds = sendable.map(item => item.queueId);
                            if (ingestResult.ok) {
                                deps.markEventsDelivered(queueIds);
                                registration.runtime.lastEventSyncAt = deps.now();
                                registration.runtime.eventBridgeError = null;
                            } else if (ingestResult.statusCode === 404) {
                                // Control plane may not have event ingest yet; stop retrying until explicit re-enable.
                                registration.runtime.eventBridgeSupported = false;
                                registration.runtime.eventBridgeError = null;
                                deps.markEventsFailed(queueIds, 'event_ingest_unavailable', deps.now());
                            } else {
                                const errorText = ingestResult.error ?? 'event_ingest_failed';
                                deps.markEventsFailed(queueIds, errorText, deps.now());
                                registration.runtime.eventBridgeError = errorText;
                                lastError = errorText;
                            }
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
                        daemonSessionToken = null;
                    } else if (message.includes('not found')) {
                        registration.runtime.eventSubscriptionId = null;
                    }

                    lastError = message;
                }
            }

            if (daemon.ok && registration.runtime.commandBridgeSupported) {
                try {
                    if (!daemonSessionToken) {
                        throw new Error('daemon_session_unavailable');
                    }

                    const commandsResult = await deps.fetchConnectorCommands(
                        token.accessToken,
                        registration.machineId,
                        registration.runtime.lastCommandCursor
                    );

                    if (!commandsResult.ok) {
                        if (commandsResult.statusCode === 404) {
                            registration.runtime.commandBridgeSupported = false;
                            registration.runtime.commandBridgeError = null;
                        } else {
                            throw new Error(commandsResult.error ?? 'command_fetch_failed');
                        }
                    } else {
                        const commands = commandsResult.data?.commands ?? [];
                        let cursor = registration.runtime.lastCommandCursor;

                        for (const command of commands) {
                            cursor = Math.max(cursor, command.cursor ?? cursor);
                            const commandContextId =
                                command.contextId
                                ?? (typeof command.params?.contextId === 'string' ? command.params.contextId : null);
                            let status: 'applied' | 'failed' = 'applied';
                            let errorText: string | undefined;

                            if (!isMethodAllowedForCloudCommand(command.method)) {
                                status = 'failed';
                                errorText = 'command_method_not_allowed';
                            } else {
                                const policy = commandContextId
                                    ? await deps.getContextSyncPolicy(daemonSessionToken, commandContextId)
                                    : null;

                                if (policy === 'local_only') {
                                    status = 'failed';
                                    errorText = 'command_blocked_by_sync_policy_local_only';
                                } else {
                                    try {
                                        await deps.applyDaemonCommand(daemonSessionToken, command.method, command.params ?? {});
                                    } catch (error) {
                                        status = 'failed';
                                        errorText = error instanceof Error ? error.message : String(error);
                                    }
                                }
                            }

                            const ackResult = await deps.ackConnectorCommand(token.accessToken, {
                                machineId: registration.machineId,
                                tenantId: registration.tenantId,
                                commandId: command.commandId,
                                cursor: command.cursor,
                                status,
                                ...(errorText ? { error: errorText } : {})
                            });

                            if (!ackResult.ok) {
                                lastError = ackResult.error ?? 'command_ack_failed';
                            }
                        }

                        if (typeof commandsResult.data?.cursor === 'number') {
                            cursor = Math.max(cursor, commandsResult.data.cursor);
                        }

                        registration.runtime.lastCommandCursor = cursor;
                        registration.runtime.lastCommandSyncAt = deps.now();
                        registration.runtime.commandBridgeError = null;
                    }
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    registration.runtime.commandBridgeError = message;
                    if (message.includes('Invalid sessionToken')) {
                        registration.runtime.daemonSessionToken = null;
                        daemonSessionToken = null;
                    }
                    lastError = message;
                }
            }

            const queueStats = deps.getQueueStats(deps.now());
            registration.runtime.eventQueuePending = queueStats.pending;
            registration.runtime.eventQueueReady = queueStats.ready;
            registration.runtime.eventQueueBackoff = queueStats.backoff;
        }

        registration.updatedAt = deps.now();
        registration.cloud.lastError = lastError;
        deps.writeConnectorState(registration);
    } else if (registration && !token) {
        deps.pruneQueue(deps.now());
        const queueStats = deps.getQueueStats(deps.now());
        registration.runtime.eventQueuePending = queueStats.pending;
        registration.runtime.eventQueueReady = queueStats.ready;
        registration.runtime.eventQueueBackoff = queueStats.backoff;
        registration.updatedAt = deps.now();
        registration.cloud.lastError = 'auth_required';
        deps.writeConnectorState(registration);
        lastError = 'auth_required';
    }

    const posture: 'connected' | 'degraded' | 'offline' = !daemon.ok
        ? 'offline'
        : (!token || !registration)
            ? 'degraded'
            : (registration.registrationMode === 'cloud'
                && (!cloudConnected
                    || Boolean(registration.runtime.eventBridgeError)
                    || Boolean(registration.runtime.commandBridgeError)))
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
