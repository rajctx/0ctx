import { describe, expect, it } from 'vitest';
import { runConnectorRuntimeCycle, type ConnectorRuntimeDependencies } from '../src/connector-runtime';
import type { ConnectorState } from '../src/connector';
import type { TokenStore } from '../src/auth';
import type { ConnectorEventPayload } from '../src/cloud';

function baseRuntimeState() {
    return {
        daemonSessionToken: null,
        eventSubscriptionId: null,
        lastEventSequence: 0,
        lastEventSyncAt: null,
        eventBridgeSupported: true,
        eventBridgeError: null,
        eventQueuePending: 0,
        eventQueueReady: 0,
        eventQueueBackoff: 0,
        lastCommandCursor: 0,
        lastCommandSyncAt: null,
        commandBridgeSupported: true,
        commandBridgeError: null
    };
}

function createBaseDeps(overrides: Partial<ConnectorRuntimeDependencies>): ConnectorRuntimeDependencies {
    const token: TokenStore = {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 60_000,
        email: 'test@example.com',
        tenantId: 'tenant-a'
    };
    const state: ConnectorState = {
        machineId: 'm-1',
        tenantId: 'tenant-a',
        uiUrl: 'https://app.0ctx.com',
        registeredAt: 1,
        updatedAt: 1,
        registrationMode: 'local',
        cloud: {
            registrationId: null,
            streamUrl: null,
            capabilities: [],
            lastHeartbeatAt: null,
            lastError: null
        },
        runtime: baseRuntimeState()
    };

    return {
        now: () => 1_700_000_000_000,
        log: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        isDaemonReachable: async () => ({ ok: true }),
        startDaemonDetached: () => undefined,
        waitForDaemon: async () => true,
        getSyncStatus: async () => ({
            enabled: true,
            running: true,
            lastError: null,
            queue: { pending: 0, inFlight: 0, failed: 0, done: 1 }
        }),
        resolveToken: () => token,
        readConnectorState: () => state,
        registerConnector: () => ({ state, created: false }),
        writeConnectorState: () => undefined,
        getDashboardUrl: () => 'https://app.0ctx.com',
        registerConnectorInCloud: async () => ({
            ok: true,
            data: {
                registrationId: 'reg-1',
                streamUrl: 'wss://stream',
                capabilities: ['sync'],
                tenantId: 'tenant-a'
            }
        }),
        fetchConnectorCapabilities: async () => ({
            ok: true,
            data: { capabilities: ['sync', 'blackboard'] }
        }),
        sendConnectorHeartbeat: async () => ({ ok: true }),
        createDaemonSession: async () => ({ sessionToken: 'sess-1' }),
        subscribeEvents: async () => ({ subscriptionId: 'sub-1', lastAckedSequence: 0 }),
        pollEvents: async () => ({ cursor: 0, events: [] as ConnectorEventPayload[] }),
        ackEvents: async () => ({ lastAckedSequence: 0 }),
        sendConnectorEvents: async () => ({ ok: true, statusCode: 200 }),
        fetchConnectorCommands: async () => ({ ok: true, statusCode: 200, data: { cursor: 0, commands: [] } }),
        ackConnectorCommand: async () => ({ ok: true, statusCode: 200 }),
        applyDaemonCommand: async () => ({}),
        getContextSyncPolicy: async () => 'full_sync',
        enqueueEvents: (_subscriptionId, events) => ({
            enqueued: events.length,
            lastSequence: events.length > 0 ? events[events.length - 1].sequence : null
        }),
        getReadyEvents: () => [],
        markEventsDelivered: () => undefined,
        markEventsFailed: () => undefined,
        getQueueStats: () => ({ pending: 0, ready: 0, backoff: 0, maxAttempts: 0, oldestEnqueuedAt: null }),
        pruneQueue: () => ({ removed: 0, remaining: 0 }),
        ...overrides
    };
}

describe('connector runtime cycle', () => {
    it('promotes local registration to cloud and reports connected posture', async () => {
        let stored: ConnectorState | null = null;
        const deps = createBaseDeps({
            readConnectorState: () => ({
                machineId: 'm-1',
                tenantId: 'tenant-a',
                uiUrl: 'https://app.0ctx.com',
                registeredAt: 1,
                updatedAt: 1,
                registrationMode: 'local',
                cloud: {
                    registrationId: null,
                    streamUrl: null,
                    capabilities: [],
                    lastHeartbeatAt: null,
                    lastError: null
                },
                runtime: baseRuntimeState()
            }),
            writeConnectorState: (state) => {
                stored = state;
            }
        });

        const summary = await runConnectorRuntimeCycle({}, deps);
        expect(summary.posture).toBe('connected');
        expect(summary.cloudConnected).toBe(true);
        expect(summary.registrationMode).toBe('cloud');
        expect(stored?.registrationMode).toBe('cloud');
        expect(stored?.cloud.registrationId).toBe('reg-1');
        expect(stored?.cloud.capabilities).toEqual(['sync', 'blackboard']);
        expect(stored?.cloud.lastHeartbeatAt).toBe(1_700_000_000_000);
        expect(stored?.runtime.daemonSessionToken).toBe('sess-1');
        expect(stored?.runtime.eventSubscriptionId).toBe('sub-1');
        expect(stored?.runtime.eventQueuePending).toBe(0);
        expect(stored?.runtime.lastCommandCursor).toBe(0);
        expect(stored?.runtime.commandBridgeError).toBeNull();
    });

    it('reports offline posture when daemon is unreachable and autostart is disabled', async () => {
        const deps = createBaseDeps({
            isDaemonReachable: async () => ({ ok: false, error: 'daemon_unreachable' }),
            resolveToken: () => null,
            readConnectorState: () => null
        });

        const summary = await runConnectorRuntimeCycle({ autoStartDaemon: false }, deps);
        expect(summary.posture).toBe('offline');
        expect(summary.auth).toBe(false);
        expect(summary.registrationMode).toBe('none');
        expect(summary.lastError).toBe('daemon_unreachable');
    });

    it('clears transient daemon unreachable error when autostart recovers daemon health', async () => {
        let checks = 0;
        let started = false;
        const deps = createBaseDeps({
            isDaemonReachable: async () => {
                checks += 1;
                return checks === 1 ? { ok: false, error: 'daemon_unreachable' } : { ok: true };
            },
            startDaemonDetached: () => {
                started = true;
            },
            waitForDaemon: async () => true,
            resolveToken: () => null,
            readConnectorState: () => null
        });

        const summary = await runConnectorRuntimeCycle({}, deps);
        expect(started).toBe(true);
        expect(summary.daemonRunning).toBe(true);
        expect(summary.posture).toBe('degraded');
        expect(summary.lastError).toBeNull();
    });

    it('keeps degraded posture when cloud checks fail for cloud registration mode', async () => {
        let stored: ConnectorState | null = null;
        const deps = createBaseDeps({
            readConnectorState: () => ({
                machineId: 'm-1',
                tenantId: 'tenant-a',
                uiUrl: 'https://app.0ctx.com',
                registeredAt: 1,
                updatedAt: 1,
                registrationMode: 'cloud',
                cloud: {
                    registrationId: 'reg-1',
                    streamUrl: 'wss://stream',
                    capabilities: ['sync'],
                    lastHeartbeatAt: null,
                    lastError: null
                },
                runtime: baseRuntimeState()
            }),
            fetchConnectorCapabilities: async () => ({ ok: false, error: 'caps_failed' }),
            sendConnectorHeartbeat: async () => ({ ok: false, error: 'heartbeat_failed' }),
            writeConnectorState: (state) => {
                stored = state;
            }
        });

        const summary = await runConnectorRuntimeCycle({}, deps);
        expect(summary.posture).toBe('degraded');
        expect(summary.cloudConnected).toBe(false);
        expect(summary.lastError).toBe('heartbeat_failed');
        expect(stored?.cloud.lastError).toBe('heartbeat_failed');
    });

    it('polls and ingests daemon blackboard events then advances cursor on success', async () => {
        let ackedSequence = -1;
        let sentEvents = 0;
        let stored: ConnectorState | null = null;
        const deps = createBaseDeps({
            readConnectorState: () => ({
                machineId: 'm-1',
                tenantId: 'tenant-a',
                uiUrl: 'https://app.0ctx.com',
                registeredAt: 1,
                updatedAt: 1,
                registrationMode: 'cloud',
                cloud: {
                    registrationId: 'reg-1',
                    streamUrl: 'wss://stream',
                    capabilities: ['sync'],
                    lastHeartbeatAt: null,
                    lastError: null
                },
                runtime: {
                    ...baseRuntimeState(),
                    daemonSessionToken: 'sess-1',
                    eventSubscriptionId: 'sub-1',
                    lastEventSequence: 10,
                }
            }),
            pollEvents: async () => ({
                cursor: 12,
                events: [
                    {
                        eventId: 'evt-11',
                        sequence: 11,
                        contextId: 'ctx-1',
                        type: 'NodeAdded',
                        timestamp: 1_700_000_000_001,
                        source: 'session:s-1',
                        payload: { method: 'addNode' }
                    },
                    {
                        eventId: 'evt-12',
                        sequence: 12,
                        contextId: 'ctx-1',
                        type: 'NodeUpdated',
                        timestamp: 1_700_000_000_002,
                        source: 'session:s-1',
                        payload: { method: 'updateNode' }
                    }
                ]
            }),
            enqueueEvents: (_subscriptionId, events) => ({
                enqueued: events.length,
                lastSequence: events.length > 0 ? events[events.length - 1].sequence : null
            }),
            getReadyEvents: () => [
                {
                    queueId: 'q-11',
                    eventId: 'evt-11',
                    subscriptionId: 'sub-1',
                    sequence: 11,
                    contextId: 'ctx-1',
                    type: 'NodeAdded',
                    timestamp: 1_700_000_000_001,
                    source: 'session:s-1',
                    payload: { method: 'addNode' }
                },
                {
                    queueId: 'q-12',
                    eventId: 'evt-12',
                    subscriptionId: 'sub-1',
                    sequence: 12,
                    contextId: 'ctx-1',
                    type: 'NodeUpdated',
                    timestamp: 1_700_000_000_002,
                    source: 'session:s-1',
                    payload: { method: 'updateNode' }
                }
            ],
            sendConnectorEvents: async (_token, payload) => {
                sentEvents = payload.events.length;
                return { ok: true, statusCode: 200 };
            },
            ackEvents: async (_sessionToken, _subscriptionId, sequence) => {
                ackedSequence = sequence;
                return { lastAckedSequence: sequence };
            },
            markEventsDelivered: () => undefined,
            getQueueStats: () => ({ pending: 0, ready: 0, backoff: 0, maxAttempts: 0, oldestEnqueuedAt: null }),
            writeConnectorState: (state) => {
                stored = state;
            }
        });

        const summary = await runConnectorRuntimeCycle({}, deps);
        expect(summary.posture).toBe('connected');
        expect(sentEvents).toBe(2);
        expect(ackedSequence).toBe(12);
        expect(stored?.runtime.lastEventSequence).toBe(12);
        expect(stored?.runtime.lastEventSyncAt).toBe(1_700_000_000_000);
        expect(stored?.runtime.eventBridgeError).toBeNull();
    });

    it('marks event bridge unsupported when cloud endpoint returns 404', async () => {
        let stored: ConnectorState | null = null;
        const deps = createBaseDeps({
            readConnectorState: () => ({
                machineId: 'm-1',
                tenantId: 'tenant-a',
                uiUrl: 'https://app.0ctx.com',
                registeredAt: 1,
                updatedAt: 1,
                registrationMode: 'cloud',
                cloud: {
                    registrationId: 'reg-1',
                    streamUrl: 'wss://stream',
                    capabilities: ['sync'],
                    lastHeartbeatAt: null,
                    lastError: null
                },
                runtime: {
                    ...baseRuntimeState(),
                    daemonSessionToken: 'sess-1',
                    eventSubscriptionId: 'sub-1',
                    lastEventSequence: 10,
                }
            }),
            pollEvents: async () => ({ cursor: 11, events: [] }),
            enqueueEvents: (_subscriptionId, events) => ({
                enqueued: events.length,
                lastSequence: events.length > 0 ? events[events.length - 1].sequence : null
            }),
            getReadyEvents: () => [
                {
                    queueId: 'q-11',
                    eventId: 'evt-11',
                    subscriptionId: 'sub-1',
                    sequence: 11,
                    contextId: 'ctx-1',
                    type: 'NodeAdded',
                    timestamp: 1_700_000_000_001,
                    source: 'session:s-1',
                    payload: { method: 'addNode' }
                }
            ],
            sendConnectorEvents: async () => ({ ok: false, statusCode: 404, error: 'not_found' }),
            markEventsFailed: () => undefined,
            writeConnectorState: (state) => {
                stored = state;
            }
        });

        const summary = await runConnectorRuntimeCycle({}, deps);
        expect(summary.posture).toBe('connected');
        expect(stored?.runtime.eventBridgeSupported).toBe(false);
        expect(stored?.runtime.eventBridgeError).toBeNull();
    });

    it('fetches and applies cloud commands, then advances command cursor', async () => {
        let appliedMethods: string[] = [];
        let acked: Array<{ commandId: string; status: string; result?: unknown }> = [];
        let stored: ConnectorState | null = null;
        const deps = createBaseDeps({
            readConnectorState: () => ({
                machineId: 'm-1',
                tenantId: 'tenant-a',
                uiUrl: 'https://app.0ctx.com',
                registeredAt: 1,
                updatedAt: 1,
                registrationMode: 'cloud',
                cloud: {
                    registrationId: 'reg-1',
                    streamUrl: 'wss://stream',
                    capabilities: ['sync'],
                    lastHeartbeatAt: null,
                    lastError: null
                },
                runtime: {
                    ...baseRuntimeState(),
                    daemonSessionToken: 'sess-1',
                    eventSubscriptionId: 'sub-1',
                    lastCommandCursor: 3
                }
            }),
            fetchConnectorCommands: async () => ({
                ok: true,
                statusCode: 200,
                data: {
                    cursor: 5,
                    commands: [
                        {
                            commandId: 'cmd-4',
                            cursor: 4,
                            contextId: 'ctx-1',
                            method: 'addNode',
                            params: { contextId: 'ctx-1', type: 'goal', content: 'x' }
                        },
                        {
                            commandId: 'cmd-5',
                            cursor: 5,
                            contextId: 'ctx-1',
                            method: 'setSyncPolicy',
                            params: { contextId: 'ctx-1', syncPolicy: 'metadata_only' }
                        }
                    ]
                }
            }),
            applyDaemonCommand: async (_session, method) => {
                appliedMethods.push(method);
                return { ok: true, method };
            },
            ackConnectorCommand: async (_token, payload) => {
                acked.push({ commandId: payload.commandId, status: payload.status, result: payload.result });
                return { ok: true, statusCode: 200 };
            },
            writeConnectorState: (state) => {
                stored = state;
            }
        });

        const summary = await runConnectorRuntimeCycle({}, deps);
        expect(summary.posture).toBe('connected');
        expect(appliedMethods).toEqual(['addNode', 'setSyncPolicy']);
        expect(acked).toEqual([
            { commandId: 'cmd-4', status: 'applied', result: { ok: true, method: 'addNode' } },
            { commandId: 'cmd-5', status: 'applied', result: { ok: true, method: 'setSyncPolicy' } }
        ]);
        expect(stored?.runtime.lastCommandCursor).toBe(5);
        expect(stored?.runtime.commandBridgeError).toBeNull();
    });

    it('marks queued events failed and keeps bridge enabled on transient ingest failure', async () => {
        let failedIds: string[] = [];
        let failedError = '';
        const deps = createBaseDeps({
            readConnectorState: () => ({
                machineId: 'm-1',
                tenantId: 'tenant-a',
                uiUrl: 'https://app.0ctx.com',
                registeredAt: 1,
                updatedAt: 1,
                registrationMode: 'cloud',
                cloud: {
                    registrationId: 'reg-1',
                    streamUrl: 'wss://stream',
                    capabilities: ['sync'],
                    lastHeartbeatAt: null,
                    lastError: null
                },
                runtime: {
                    ...baseRuntimeState(),
                    daemonSessionToken: 'sess-1',
                    eventSubscriptionId: 'sub-1'
                }
            }),
            pollEvents: async () => ({ cursor: 0, events: [] }),
            getReadyEvents: () => [
                {
                    queueId: 'q-1',
                    eventId: 'evt-1',
                    subscriptionId: 'sub-1',
                    sequence: 1,
                    contextId: 'ctx-1',
                    type: 'NodeAdded',
                    timestamp: 1_700_000_000_001,
                    source: 'session:s-1',
                    payload: { method: 'addNode' }
                }
            ],
            sendConnectorEvents: async () => ({ ok: false, statusCode: 500, error: 'server_error' }),
            markEventsFailed: (queueIds, errorText) => {
                failedIds = queueIds;
                failedError = errorText;
            }
        });

        const summary = await runConnectorRuntimeCycle({}, deps);
        expect(summary.posture).toBe('degraded');
        expect(failedIds).toEqual(['q-1']);
        expect(failedError).toBe('server_error');
    });

    it('drops local_only events before enqueue and still advances daemon cursor', async () => {
        let enqueued = 0;
        let ackedSequence = 0;
        const deps = createBaseDeps({
            readConnectorState: () => ({
                machineId: 'm-1',
                tenantId: 'tenant-a',
                uiUrl: 'https://app.0ctx.com',
                registeredAt: 1,
                updatedAt: 1,
                registrationMode: 'cloud',
                cloud: {
                    registrationId: 'reg-1',
                    streamUrl: 'wss://stream',
                    capabilities: ['sync'],
                    lastHeartbeatAt: null,
                    lastError: null
                },
                runtime: {
                    ...baseRuntimeState(),
                    daemonSessionToken: 'sess-1',
                    eventSubscriptionId: 'sub-1',
                    lastEventSequence: 10
                }
            }),
            pollEvents: async () => ({
                cursor: 11,
                events: [
                    {
                        eventId: 'evt-11',
                        sequence: 11,
                        contextId: 'ctx-1',
                        type: 'NodeAdded',
                        timestamp: 1_700_000_000_001,
                        source: 'session:s-1',
                        payload: { method: 'addNode', content: 'secret' }
                    }
                ]
            }),
            getContextSyncPolicy: async () => 'local_only',
            enqueueEvents: (_subscriptionId, events) => {
                enqueued += events.length;
                return { enqueued: events.length, lastSequence: events.length > 0 ? events[events.length - 1].sequence : null };
            },
            ackEvents: async (_sessionToken, _subscriptionId, sequence) => {
                ackedSequence = sequence;
                return { lastAckedSequence: sequence };
            },
            getReadyEvents: () => []
        });

        const summary = await runConnectorRuntimeCycle({}, deps);
        expect(summary.posture).toBe('connected');
        expect(enqueued).toBe(0);
        expect(ackedSequence).toBe(11);
    });
});
