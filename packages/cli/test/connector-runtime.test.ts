import { describe, expect, it } from 'vitest';
import { runConnectorRuntimeCycle, type ConnectorRuntimeDependencies } from '../src/connector-runtime';
import type { ConnectorState } from '../src/connector';
import type { TokenStore } from '../src/auth';
import type { ConnectorEventPayload } from '../src/cloud';

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
        runtime: {
            daemonSessionToken: null,
            eventSubscriptionId: null,
            lastEventSequence: 0,
            lastEventSyncAt: null,
            eventBridgeSupported: true,
            eventBridgeError: null
        }
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
                runtime: {
                    daemonSessionToken: null,
                    eventSubscriptionId: null,
                    lastEventSequence: 0,
                    lastEventSyncAt: null,
                    eventBridgeSupported: true,
                    eventBridgeError: null
                }
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
                runtime: {
                    daemonSessionToken: null,
                    eventSubscriptionId: null,
                    lastEventSequence: 0,
                    lastEventSyncAt: null,
                    eventBridgeSupported: true,
                    eventBridgeError: null
                }
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
                    daemonSessionToken: 'sess-1',
                    eventSubscriptionId: 'sub-1',
                    lastEventSequence: 10,
                    lastEventSyncAt: null,
                    eventBridgeSupported: true,
                    eventBridgeError: null
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
            sendConnectorEvents: async (_token, payload) => {
                sentEvents = payload.events.length;
                return { ok: true, statusCode: 200 };
            },
            ackEvents: async (_sessionToken, _subscriptionId, sequence) => {
                ackedSequence = sequence;
                return { lastAckedSequence: sequence };
            },
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
                    daemonSessionToken: 'sess-1',
                    eventSubscriptionId: 'sub-1',
                    lastEventSequence: 10,
                    lastEventSyncAt: null,
                    eventBridgeSupported: true,
                    eventBridgeError: null
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
                        payload: { method: 'addNode' }
                    }
                ]
            }),
            sendConnectorEvents: async () => ({ ok: false, statusCode: 404, error: 'not_found' }),
            writeConnectorState: (state) => {
                stored = state;
            }
        });

        const summary = await runConnectorRuntimeCycle({}, deps);
        expect(summary.posture).toBe('connected');
        expect(stored?.runtime.eventBridgeSupported).toBe(false);
        expect(stored?.runtime.eventBridgeError).toBeNull();
    });
});
