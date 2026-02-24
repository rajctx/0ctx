import type { Graph, AuditAction, AuditMetadata } from '@0ctx/core';
import type { DaemonRequest } from './protocol';
import {
    clearConnectionContext,
    clearSessionContext,
    createSession,
    getConnectionContext,
    setConnectionContext,
    setSessionContext,
    touchSession
} from './resolver';
import { listBackups, readContextBackup, writeContextBackup } from './backup';
import { readAuthState } from './auth';
import type { MetricsSnapshot } from './metrics';
import type { SyncEngine } from './sync-engine';
import type { EventRuntime } from './events';

const CONTEXT_REQUIRED_METHODS = new Set([
    'addNode',
    'getByKey',
    'search',
    'getGraphData',
    'saveCheckpoint',
    'listCheckpoints',
    'createBackup'
]);

type RequestParams = Record<string, unknown>;

export interface HandlerRuntimeContext {
    startedAt: number;
    getMetricsSnapshot?: () => MetricsSnapshot;
    syncEngine?: SyncEngine;
    eventRuntime?: EventRuntime;
}

const MUTATING_ACTIONS: Record<string, AuditAction> = {
    createContext: 'create_context',
    deleteContext: 'delete_context',
    switchContext: 'switch_context',
    addNode: 'add_node',
    updateNode: 'update_node',
    deleteNode: 'delete_node',
    addEdge: 'add_edge',
    saveCheckpoint: 'save_checkpoint',
    rewind: 'rewind',
    createBackup: 'create_backup',
    restoreBackup: 'restore_backup'
};

function getParams(req: DaemonRequest): RequestParams {
    return (req.params ?? {}) as RequestParams;
}

function getContextIdFromParams(params: RequestParams): string | null {
    return typeof params.contextId === 'string' && params.contextId.length > 0 ? params.contextId : null;
}

function assertValidSession(req: DaemonRequest, sessionExists: boolean): void {
    if (req.method === 'createSession') return;
    if (req.sessionToken && !sessionExists) {
        throw new Error(`Invalid sessionToken '${req.sessionToken}'`);
    }
}

function resolveContextId(connectionId: string, params: RequestParams, sessionContextId: string | null): string | null {
    return getContextIdFromParams(params) || sessionContextId || getConnectionContext(connectionId);
}

function syncActiveContext(connectionId: string, sessionToken: string | undefined, contextId: string): void {
    setConnectionContext(connectionId, contextId);
    if (sessionToken) {
        setSessionContext(sessionToken, contextId);
    }
}

function toAuditMetadata(connectionId: string, req: DaemonRequest, params: RequestParams): AuditMetadata {
    return {
        actor: typeof params.actor === 'string' ? params.actor : null,
        source: typeof params.source === 'string' ? params.source : null,
        sessionToken: req.sessionToken ?? null,
        connectionId,
        requestId: req.requestId ?? null,
        method: req.method
    };
}

function recordMutationAudit(
    graph: Graph,
    req: DaemonRequest,
    action: AuditAction,
    contextId: string | null,
    params: RequestParams,
    result: unknown,
    metadata: AuditMetadata
): void {
    const payload = { ...params };
    delete payload.content;

    graph.recordAuditEvent({
        action,
        contextId,
        payload: {
            method: req.method,
            params: payload
        },
        result: result && typeof result === 'object'
            ? (result as Record<string, unknown>)
            : { value: result ?? null },
        metadata
    });
}

function toEventSource(connectionId: string, req: DaemonRequest): string {
    return req.sessionToken ? `session:${req.sessionToken}` : `connection:${connectionId}`;
}

function toEventPayload(params: RequestParams, result: unknown): Record<string, unknown> {
    const sanitizedParams = { ...params };
    delete sanitizedParams.content;
    return {
        params: sanitizedParams,
        result: result && typeof result === 'object'
            ? (result as Record<string, unknown>)
            : { value: result ?? null }
    };
}

function recordMutationEvent(
    runtime: HandlerRuntimeContext,
    connectionId: string,
    req: DaemonRequest,
    contextId: string | null,
    params: RequestParams,
    result: unknown
): void {
    runtime.eventRuntime?.emitMutation({
        method: req.method,
        contextId,
        source: toEventSource(connectionId, req),
        payload: toEventPayload(params, result)
    });
}

export function handleRequest(
    graph: Graph,
    connectionId: string,
    req: DaemonRequest,
    runtime: HandlerRuntimeContext
): unknown {
    const params = getParams(req);
    const session = req.sessionToken ? touchSession(req.sessionToken) : null;
    const sessionContextId = session?.contextId ?? null;

    assertValidSession(req, Boolean(session));

    if (req.method === 'health') {
        const auth = readAuthState();
        return {
            status: 'ok',
            timestamp: Date.now(),
            uptimeMs: Date.now() - runtime.startedAt,
            metrics: runtime.getMetricsSnapshot ? runtime.getMetricsSnapshot() : null,
            auth: {
                authenticated: auth.authenticated,
                email: auth.email,
                tenantId: auth.tenantId,
                tokenExpired: auth.tokenExpired
            },
            sync: runtime.syncEngine ? runtime.syncEngine.getStatus() : null
        };
    }

    if (req.method === 'metricsSnapshot') {
        return runtime.getMetricsSnapshot ? runtime.getMetricsSnapshot() : null;
    }

    if (req.method === 'getCapabilities') {
        return {
            apiVersion: '2',
            features: ['sessions', 'health', 'capabilities', 'audit_logs', 'metrics', 'backup_restore', 'auth', 'sync', 'blackboard_events', 'task_leases', 'quality_gates'],
            methods: [
                'listContexts', 'createContext', 'deleteContext', 'switchContext', 'getActiveContext',
                'addNode', 'getNode', 'updateNode', 'getByKey', 'deleteNode',
                'addEdge', 'getSubgraph', 'search', 'getGraphData',
                'saveCheckpoint', 'rewind', 'listCheckpoints',
                'createSession', 'refreshSession', 'health', 'getCapabilities', 'metricsSnapshot',
                'listAuditEvents', 'createBackup', 'listBackups', 'restoreBackup',
                'auth/status', 'syncStatus', 'syncNow',
                'subscribeEvents', 'unsubscribeEvents', 'listSubscriptions', 'pollEvents', 'ackEvent',
                'getBlackboardState', 'claimTask', 'releaseTask', 'resolveGate'
            ]
        };
    }

    if (req.method === 'subscribeEvents') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }

        const subscription = runtime.eventRuntime.subscribe({
            contextId: typeof params.contextId === 'string' && params.contextId.length > 0 ? params.contextId : resolveContextId(connectionId, params, sessionContextId) ?? undefined,
            types: params.types,
            afterSequence: typeof params.afterSequence === 'number' ? params.afterSequence : undefined
        }, {
            connectionId,
            sessionToken: req.sessionToken
        });
        return subscription;
    }

    if (req.method === 'listSubscriptions') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }

        return runtime.eventRuntime.listSubscriptions({
            connectionId,
            sessionToken: req.sessionToken
        });
    }

    if (req.method === 'unsubscribeEvents') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }

        const subscriptionId = typeof params.subscriptionId === 'string' ? params.subscriptionId : null;
        if (!subscriptionId) {
            throw new Error("Missing required 'subscriptionId' for unsubscribeEvents.");
        }

        return runtime.eventRuntime.unsubscribe(subscriptionId, {
            connectionId,
            sessionToken: req.sessionToken
        });
    }

    if (req.method === 'pollEvents') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }

        const subscriptionId = typeof params.subscriptionId === 'string' ? params.subscriptionId : null;
        if (!subscriptionId) {
            throw new Error("Missing required 'subscriptionId' for pollEvents.");
        }

        return runtime.eventRuntime.poll({
            subscriptionId,
            afterSequence: typeof params.afterSequence === 'number' ? params.afterSequence : undefined,
            limit: typeof params.limit === 'number' ? params.limit : undefined
        }, {
            connectionId,
            sessionToken: req.sessionToken
        });
    }

    if (req.method === 'ackEvent') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }

        const subscriptionId = typeof params.subscriptionId === 'string' ? params.subscriptionId : null;
        if (!subscriptionId) {
            throw new Error("Missing required 'subscriptionId' for ackEvent.");
        }

        return runtime.eventRuntime.ack({
            subscriptionId,
            eventId: typeof params.eventId === 'string' ? params.eventId : undefined,
            sequence: typeof params.sequence === 'number' ? params.sequence : undefined
        }, {
            connectionId,
            sessionToken: req.sessionToken
        });
    }

    if (req.method === 'getBlackboardState') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }
        return runtime.eventRuntime.getBlackboardState({
            contextId: typeof params.contextId === 'string' ? params.contextId : undefined,
            limit: typeof params.limit === 'number' ? params.limit : undefined
        });
    }

    if (req.method === 'claimTask') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }
        const taskId = typeof params.taskId === 'string' ? params.taskId : null;
        if (!taskId) {
            throw new Error("Missing required 'taskId' for claimTask.");
        }
        const resolvedContextId = resolveContextId(connectionId, params, sessionContextId) ?? undefined;
        return runtime.eventRuntime.claimTask({
            taskId,
            contextId: resolvedContextId,
            leaseMs: typeof params.leaseMs === 'number' ? params.leaseMs : undefined
        }, {
            connectionId,
            sessionToken: req.sessionToken
        });
    }

    if (req.method === 'releaseTask') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }
        const taskId = typeof params.taskId === 'string' ? params.taskId : null;
        if (!taskId) {
            throw new Error("Missing required 'taskId' for releaseTask.");
        }
        return runtime.eventRuntime.releaseTask({ taskId }, {
            connectionId,
            sessionToken: req.sessionToken
        });
    }

    if (req.method === 'resolveGate') {
        if (!runtime.eventRuntime) {
            throw new Error('Event runtime not available');
        }
        const gateId = typeof params.gateId === 'string' ? params.gateId : null;
        if (!gateId) {
            throw new Error("Missing required 'gateId' for resolveGate.");
        }
        const resolvedContextId = resolveContextId(connectionId, params, sessionContextId) ?? undefined;
        return runtime.eventRuntime.resolveGate({
            gateId,
            contextId: resolvedContextId,
            severity: typeof params.severity === 'string' ? params.severity : undefined,
            status: params.status === 'open' ? 'open' : 'resolved',
            message: typeof params.message === 'string' ? params.message : undefined
        }, {
            connectionId,
            sessionToken: req.sessionToken
        });
    }

    if (req.method === 'syncStatus') {
        return runtime.syncEngine ? runtime.syncEngine.getStatus() : { enabled: false, running: false, lastPushAt: null, lastPullAt: null, lastError: null, queue: { pending: 0, inFlight: 0, failed: 0, done: 0 } };
    }

    if (req.method === 'syncNow') {
        if (!runtime.syncEngine) {
            throw new Error('Sync engine not available');
        }
        // syncNow is async but handleRequest is sync — fire and return status
        void runtime.syncEngine.syncNow();
        return runtime.syncEngine.getStatus();
    }

    if (req.method === 'createSession') {
        const contextId = getContextIdFromParams(params) || getConnectionContext(connectionId);
        if (contextId && !graph.getContext(contextId)) {
            throw new Error(`Context ${contextId} not found`);
        }

        return createSession(contextId);
    }

    if (req.method === 'refreshSession') {
        if (!req.sessionToken) {
            throw new Error("Missing required 'sessionToken'.");
        }

        const refreshed = touchSession(req.sessionToken);
        if (!refreshed) {
            throw new Error(`Invalid sessionToken '${req.sessionToken}'`);
        }

        return refreshed;
    }

    if (req.method === 'auth/status') {
        return readAuthState();
    }

    if (req.method === 'listContexts') {
        return graph.listContexts();
    }

    const contextId = resolveContextId(connectionId, params, sessionContextId);

    if (CONTEXT_REQUIRED_METHODS.has(req.method) && !contextId) {
        throw new Error("No active context set! Call 'switchContext' or 'createContext' first, or provide contextId in params.");
    }

    if (req.method === 'getActiveContext') {
        return contextId ? graph.getContext(contextId) : null;
    }

    if (req.method === 'listAuditEvents') {
        const explicitContextId = getContextIdFromParams(params);
        const limit = typeof params.limit === 'number' ? params.limit : undefined;
        return graph.listAuditEvents(explicitContextId ?? undefined, limit);
    }

    if (req.method === 'listBackups') {
        return listBackups();
    }

    const auditMetadata = toAuditMetadata(connectionId, req, params);

    switch (req.method) {
        case 'createContext': {
            const name = typeof params.name === 'string' ? params.name : null;
            if (!name) throw new Error("Missing required 'name' for createContext.");

            const paths = Array.isArray(params.paths) ? params.paths.filter((p): p is string => typeof p === 'string') : [];
            const ctx = graph.createContext(name, paths);
            syncActiveContext(connectionId, req.sessionToken, ctx.id);

            recordMutationAudit(graph, req, 'create_context', ctx.id, params, { contextId: ctx.id }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, ctx.id, params, { contextId: ctx.id });
            return ctx;
        }
        case 'deleteContext': {
            const id = typeof params.id === 'string' ? params.id : null;
            if (!id) throw new Error("Missing required 'id' for deleteContext.");

            graph.deleteContext(id);

            if (getConnectionContext(connectionId) === id) {
                clearConnectionContext(connectionId);
            }

            if (req.sessionToken && sessionContextId === id) {
                clearSessionContext(req.sessionToken);
            }

            const result = { success: true };
            recordMutationAudit(graph, req, 'delete_context', id, params, result, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, id, params, result);
            return result;
        }
        case 'switchContext': {
            const targetContextId = typeof params.contextId === 'string' ? params.contextId : null;
            if (!targetContextId) throw new Error("Missing required 'contextId' for switchContext.");

            const ctx = graph.getContext(targetContextId);
            if (!ctx) throw new Error(`Context ${targetContextId} not found`);

            syncActiveContext(connectionId, req.sessionToken, ctx.id);
            recordMutationAudit(graph, req, 'switch_context', ctx.id, params, { contextId: ctx.id }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, ctx.id, params, { contextId: ctx.id });
            return ctx;
        }
        case 'addNode': {
            const result = graph.addNode({ ...params, contextId: contextId! } as Parameters<Graph['addNode']>[0]);
            recordMutationAudit(graph, req, 'add_node', contextId, params, { id: result.id, contextId: result.contextId }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, { id: result.id, contextId: result.contextId });
            runtime.syncEngine?.enqueue(contextId!);
            return result;
        }
        case 'getNode':
            return graph.getNode(params.id as string);
        case 'updateNode': {
            const result = graph.updateNode(params.id as string, params.updates as Parameters<Graph['updateNode']>[1]);
            recordMutationAudit(graph, req, 'update_node', contextId, params, { id: params.id as string, updated: Boolean(result) }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, { id: params.id as string, updated: Boolean(result) });
            if (contextId) runtime.syncEngine?.enqueue(contextId);
            return result;
        }
        case 'getByKey':
            return graph.getByKey(contextId!, params.key as string);
        case 'deleteNode': {
            graph.deleteNode(params.id as string);
            const result = { success: true };
            recordMutationAudit(graph, req, 'delete_node', contextId, params, result, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, result);
            if (contextId) runtime.syncEngine?.enqueue(contextId);
            return result;
        }
        case 'addEdge': {
            const result = graph.addEdge(params.fromId as string, params.toId as string, params.relation as Parameters<Graph['addEdge']>[2]);
            recordMutationAudit(graph, req, 'add_edge', contextId, params, { id: result.id }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, { id: result.id });
            if (contextId) runtime.syncEngine?.enqueue(contextId);
            return result;
        }
        case 'getSubgraph':
            return graph.getSubgraph(params.rootId as string, params.depth as number | undefined, params.maxNodes as number | undefined);
        case 'search':
            return graph.search(contextId!, params.query as string, params.limit as number | undefined);
        case 'getGraphData':
            return graph.getGraphData(contextId!);
        case 'saveCheckpoint': {
            const result = graph.saveCheckpoint(contextId!, params.name as string);
            recordMutationAudit(graph, req, 'save_checkpoint', contextId, params, { id: result.id }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, { id: result.id });
            runtime.syncEngine?.enqueue(contextId!);
            return result;
        }
        case 'rewind': {
            graph.rewind(params.checkpointId as string);
            const result = { success: true };
            recordMutationAudit(graph, req, 'rewind', contextId, params, result, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, result);
            if (contextId) runtime.syncEngine?.enqueue(contextId);
            return result;
        }
        case 'listCheckpoints':
            return graph.listCheckpoints(contextId!);
        case 'createBackup': {
            const dump = graph.exportContextDump(contextId!);
            const backup = writeContextBackup({
                dump,
                backupName: typeof params.name === 'string' ? params.name : undefined,
                encrypted: typeof params.encrypted === 'boolean' ? params.encrypted : true
            });
            recordMutationAudit(graph, req, 'create_backup', contextId, params, { fileName: backup.fileName }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, { fileName: backup.fileName });
            return backup;
        }
        case 'restoreBackup': {
            const fileName = typeof params.fileName === 'string' ? params.fileName : null;
            if (!fileName) {
                throw new Error("Missing required 'fileName' for restoreBackup.");
            }

            const dump = readContextBackup(fileName);
            const restoredContext = graph.importContextDump(dump, {
                name: typeof params.name === 'string' ? params.name : undefined
            });
            recordMutationAudit(graph, req, 'restore_backup', restoredContext.id, params, { contextId: restoredContext.id }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, restoredContext.id, params, { contextId: restoredContext.id });
            return restoredContext;
        }
        default:
            throw new Error(`Unknown method: ${req.method}`);
    }
}
