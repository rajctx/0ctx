import type { Graph } from '@0ctx/core';
import { touchSession } from './resolver';
import type { DaemonRequest } from './protocol';
import { dispatchCheckpointRequest } from './handlers/checkpoints';
import { dispatchEventRequest } from './handlers/events';
import { dispatchGraphRequest } from './handlers/graph';
import { dispatchKnowledgeRequest } from './handlers/knowledge';
import { dispatchOpsRequest } from './handlers/ops';
import { dispatchRecallRequest } from './handlers/recall';
import { dispatchRuntimeRequest } from './handlers/runtime';
import {
    assertValidSession,
    CONTEXT_REQUIRED_METHODS,
    getParams,
    resolveContextId,
    toAuditMetadata
} from './handlers/shared';
import type { HandlerRuntimeContext } from './handlers/types';
import { dispatchWorkstreamRequest } from './handlers/workstreams';

export type { HandlerRuntimeContext } from './handlers/types';

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

    const contextId = resolveContextId(connectionId, params, sessionContextId);
    const baseContext = {
        graph,
        connectionId,
        req,
        params,
        runtime,
        sessionContextId,
        contextId,
        auditMetadata: toAuditMetadata(connectionId, req, params)
    };

    for (const dispatch of [
        dispatchRuntimeRequest,
        dispatchEventRequest,
        dispatchRecallRequest
    ]) {
        const result = dispatch(baseContext);
        if (result.handled) {
            return result.result;
        }
    }

    if (CONTEXT_REQUIRED_METHODS.has(req.method) && !contextId) {
        throw new Error("No active context set! Call 'switchContext' or 'createContext' first, or provide contextId in params.");
    }

    for (const dispatch of [
        dispatchGraphRequest,
        dispatchWorkstreamRequest,
        dispatchKnowledgeRequest,
        dispatchCheckpointRequest,
        dispatchOpsRequest
    ]) {
        const result = dispatch(baseContext);
        if (result.handled) {
            return result.result;
        }
    }

    throw new Error(`Unknown method: ${req.method}`);
}
