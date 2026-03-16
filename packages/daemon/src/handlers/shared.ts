import type { AuditAction, AuditMetadata, Graph } from '@0ctx/core';
import { getConnectionContext, setConnectionContext, setSessionContext } from '../resolver';
import type { DaemonRequest } from '../protocol';
import type { HandlerRuntimeContext, RequestParams } from './types';

export const CONTEXT_REQUIRED_METHODS = new Set([
    'addNode',
    'getByKey',
    'search',
    'getGraphData',
    'listChatSessions',
    'listChatTurns',
    'listBranchLanes',
    'listWorkstreamInsights',
    'getWorkstreamBrief',
    'getAgentContextPack',
    'compareWorkstreams',
    'listBranchSessions',
    'listSessionMessages',
    'listBranchCheckpoints',
    'getSessionDetail',
    'getCheckpointDetail',
    'getHandoffTimeline',
    'previewSessionKnowledge',
    'extractSessionKnowledge',
    'promoteInsight',
    'saveCheckpoint',
    'createSessionCheckpoint',
    'listCheckpoints',
    'resumeSession',
    'rewindCheckpoint',
    'explainCheckpoint',
    'createBackup',
    'getSyncPolicy',
    'setSyncPolicy'
]);

export function getParams(req: DaemonRequest): RequestParams {
    return (req.params ?? {}) as RequestParams;
}

export function getContextIdFromParams(params: RequestParams): string | null {
    return typeof params.contextId === 'string' && params.contextId.length > 0 ? params.contextId : null;
}

export function assertValidSession(req: DaemonRequest, sessionExists: boolean): void {
    if (req.method === 'createSession') return;
    if (req.sessionToken && !sessionExists) {
        throw new Error(`Invalid sessionToken '${req.sessionToken}'`);
    }
}

export function resolveContextId(connectionId: string, params: RequestParams, sessionContextId: string | null): string | null {
    return getContextIdFromParams(params) || sessionContextId || getConnectionContext(connectionId);
}

export function syncActiveContext(connectionId: string, sessionToken: string | undefined, contextId: string): void {
    setConnectionContext(connectionId, contextId);
    if (sessionToken) {
        setSessionContext(sessionToken, contextId);
    }
}

export function toAuditMetadata(connectionId: string, req: DaemonRequest, params: RequestParams): AuditMetadata {
    return {
        actor: typeof params.actor === 'string' ? params.actor : null,
        source: typeof params.source === 'string' ? params.source : null,
        sessionToken: req.sessionToken ?? null,
        connectionId,
        requestId: req.requestId ?? null,
        method: req.method
    };
}

export function recordMutationAudit(
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
    delete payload.rawPayload;

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
    delete sanitizedParams.rawPayload;
    return {
        params: sanitizedParams,
        result: result && typeof result === 'object'
            ? (result as Record<string, unknown>)
            : { value: result ?? null }
    };
}

export function recordMutationEvent(
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

export function parseSyncPolicy(value: unknown): 'local_only' | 'metadata_only' | 'full_sync' | null {
    if (value === 'local_only' || value === 'metadata_only' || value === 'full_sync') {
        return value;
    }
    return null;
}

export function parsePositiveInt(value: unknown, fallback: number, max = 500): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.max(1, Math.min(max, Math.floor(value)));
}

export function parsePositiveHours(value: unknown, fallbackHours: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallbackHours;
    return value;
}

export function parseStringArray(value: unknown): string[] | undefined {
    if (Array.isArray(value)) {
        const entries = value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
        return entries.length > 0 ? entries : [];
    }
    if (typeof value === 'string') {
        const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
        return entries.length > 0 ? entries : [];
    }
    return undefined;
}

export function parseDepth(value: unknown, fallback = 2): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.max(1, Math.min(5, Math.floor(value)));
}
