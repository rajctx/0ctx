import { clearConnectionContext, clearSessionContext } from '../resolver';
import { handled, NOT_HANDLED, type HandlerMethodContext, type MethodDispatchResult } from './types';
import {
    recordMutationAudit,
    recordMutationEvent,
    parseSyncPolicy,
    syncActiveContext
} from './shared';

export function dispatchGraphRequest(context: HandlerMethodContext): MethodDispatchResult {
    const { graph, connectionId, req, params, contextId, auditMetadata, runtime, sessionContextId } = context;

    switch (req.method) {
        case 'createContext': {
            const name = typeof params.name === 'string' ? params.name : null;
            if (!name) throw new Error("Missing required 'name' for createContext.");
            const paths = Array.isArray(params.paths) ? params.paths.filter((p): p is string => typeof p === 'string') : [];
            const syncPolicy = parseSyncPolicy(params.syncPolicy) ?? 'metadata_only';
            const created = graph.createContext(name, paths, syncPolicy);
            syncActiveContext(connectionId, req.sessionToken, created.id);
            recordMutationAudit(graph, req, 'create_context', created.id, params, { contextId: created.id }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, created.id, params, { contextId: created.id });
            return handled(created);
        }
        case 'deleteContext': {
            const id = typeof params.id === 'string' ? params.id : null;
            if (!id) throw new Error("Missing required 'id' for deleteContext.");
            graph.deleteContext(id);
            if (req.sessionToken && sessionContextId === id) clearSessionContext(req.sessionToken);
            if (id === contextId) clearConnectionContext(connectionId);
            const result = { success: true };
            recordMutationAudit(graph, req, 'delete_context', id, params, result, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, id, params, result);
            return handled(result);
        }
        case 'switchContext': {
            const targetContextId = typeof params.contextId === 'string' ? params.contextId : null;
            if (!targetContextId) throw new Error("Missing required 'contextId' for switchContext.");
            const next = graph.getContext(targetContextId);
            if (!next) throw new Error(`Context ${targetContextId} not found`);
            syncActiveContext(connectionId, req.sessionToken, next.id);
            recordMutationAudit(graph, req, 'switch_context', next.id, params, { contextId: next.id }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, next.id, params, { contextId: next.id });
            return handled(next);
        }
        case 'addNode': {
            const result = graph.addNode({ ...params, contextId: contextId! } as Parameters<typeof graph.addNode>[0]);
            recordMutationAudit(graph, req, 'add_node', contextId, params, { id: result.id, contextId: result.contextId }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, { id: result.id, contextId: result.contextId });
            runtime.syncEngine?.enqueue(contextId!);
            return handled(result);
        }
        case 'getNode':
            return handled(graph.getNode(params.id as string));
        case 'updateNode': {
            const result = graph.updateNode(params.id as string, params.updates as Parameters<typeof graph.updateNode>[1]);
            recordMutationAudit(graph, req, 'update_node', contextId, params, { id: params.id as string, updated: Boolean(result) }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, { id: params.id as string, updated: Boolean(result) });
            if (contextId) runtime.syncEngine?.enqueue(contextId);
            return handled(result);
        }
        case 'getByKey':
            return handled(graph.getByKey(contextId!, params.key as string, { includeHidden: params.includeHidden === true }));
        case 'deleteNode': {
            graph.deleteNode(params.id as string);
            const result = { success: true };
            recordMutationAudit(graph, req, 'delete_node', contextId, params, result, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, result);
            if (contextId) runtime.syncEngine?.enqueue(contextId);
            return handled(result);
        }
        case 'addEdge': {
            const result = graph.addEdge(params.fromId as string, params.toId as string, params.relation as Parameters<typeof graph.addEdge>[2]);
            recordMutationAudit(graph, req, 'add_edge', contextId, params, { id: result.id }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, { id: result.id });
            if (contextId) runtime.syncEngine?.enqueue(contextId);
            return handled(result);
        }
        case 'getSubgraph':
            return handled(graph.getSubgraph(params.rootId as string, params.depth as number | undefined, params.maxNodes as number | undefined));
        case 'search':
            return handled(graph.search(contextId!, params.query as string, params.limit as number | undefined, { includeHidden: params.includeHidden === true }));
        case 'getGraphData':
            return handled(graph.getGraphData(contextId!, { includeHidden: params.includeHidden === true }));
        case 'listChatSessions':
            return handled(graph.listChatSessions(contextId!, params.limit as number | undefined));
        case 'listChatTurns': {
            const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null;
            if (!sessionId || sessionId.trim().length === 0) {
                throw new Error("Missing required 'sessionId' for listChatTurns.");
            }
            return handled(graph.listChatTurns(contextId!, sessionId, params.limit as number | undefined));
        }
        case 'getNodePayload': {
            const nodeId = typeof params.nodeId === 'string' ? params.nodeId : null;
            if (!nodeId || nodeId.trim().length === 0) {
                throw new Error("Missing required 'nodeId' for getNodePayload.");
            }
            return handled(graph.getNodePayload(nodeId));
        }
        default:
            return NOT_HANDLED;
    }
}
