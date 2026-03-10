import { handled, NOT_HANDLED, type HandlerMethodContext, type MethodDispatchResult } from './types';
import { recordMutationAudit, recordMutationEvent } from './shared';

export function dispatchCheckpointRequest(context: HandlerMethodContext): MethodDispatchResult {
    const { graph, connectionId, req, params, contextId, auditMetadata, runtime } = context;

    switch (req.method) {
        case 'saveCheckpoint': {
            const result = graph.saveCheckpoint(contextId!, params.name as string);
            recordMutationAudit(graph, req, 'save_checkpoint', contextId, params, { id: result.id }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, { id: result.id });
            const extracted = graph.extractKnowledgeFromCheckpoint(result.id, { minConfidence: 0.84 });
            if (extracted.nodeCount > 0) {
                const autoParams = { checkpointId: result.id, source: 'checkpoint:auto' };
                const autoResult = {
                    sessionId: extracted.sessionId,
                    checkpointId: result.id,
                    createdCount: extracted.createdCount,
                    reusedCount: extracted.reusedCount,
                    nodeCount: extracted.nodeCount
                };
                recordMutationAudit(graph, req, 'extract_knowledge', contextId, autoParams, autoResult, auditMetadata);
                recordMutationEvent(runtime, connectionId, req, contextId, autoParams, autoResult);
            }
            runtime.syncEngine?.enqueue(contextId!);
            return handled({ ...result, knowledge: extracted });
        }
        case 'createSessionCheckpoint': {
            const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null;
            if (!sessionId || sessionId.trim().length === 0) throw new Error("Missing required 'sessionId' for createSessionCheckpoint.");
            const result = graph.createSessionCheckpoint(contextId!, sessionId, {
                name: typeof params.name === 'string' ? params.name : undefined,
                summary: typeof params.summary === 'string' ? params.summary : undefined,
                kind: params.kind === 'manual' || params.kind === 'session' || params.kind === 'legacy' ? params.kind : undefined
            });
            recordMutationAudit(graph, req, 'save_checkpoint', contextId, params, { id: result.id }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, { id: result.id });
            const extracted = graph.extractKnowledgeFromCheckpoint(result.id, { minConfidence: 0.84 });
            if (extracted.nodeCount > 0) {
                const autoParams = { checkpointId: result.id, sessionId, source: 'checkpoint:auto' };
                const autoResult = {
                    sessionId: extracted.sessionId,
                    checkpointId: result.id,
                    createdCount: extracted.createdCount,
                    reusedCount: extracted.reusedCount,
                    nodeCount: extracted.nodeCount
                };
                recordMutationAudit(graph, req, 'extract_knowledge', contextId, autoParams, autoResult, auditMetadata);
                recordMutationEvent(runtime, connectionId, req, contextId, autoParams, autoResult);
            }
            runtime.syncEngine?.enqueue(contextId!);
            return handled({ ...result, knowledge: extracted });
        }
        case 'rewind': {
            graph.rewind(params.checkpointId as string);
            const result = { success: true };
            recordMutationAudit(graph, req, 'rewind', contextId, params, result, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, result);
            if (contextId) runtime.syncEngine?.enqueue(contextId);
            return handled(result);
        }
        case 'rewindCheckpoint': {
            const checkpointId = typeof params.checkpointId === 'string' ? params.checkpointId : null;
            if (!checkpointId || checkpointId.trim().length === 0) throw new Error("Missing required 'checkpointId' for rewindCheckpoint.");
            const detail = graph.rewindCheckpoint(checkpointId);
            recordMutationAudit(graph, req, 'rewind', detail.checkpoint.contextId, params, { checkpointId }, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, detail.checkpoint.contextId, params, { checkpointId });
            runtime.syncEngine?.enqueue(detail.checkpoint.contextId);
            return handled(detail);
        }
        case 'listCheckpoints':
            return handled(graph.listCheckpoints(contextId!));
        case 'resumeSession': {
            const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null;
            if (!sessionId || sessionId.trim().length === 0) throw new Error("Missing required 'sessionId' for resumeSession.");
            const detail = graph.resumeSession(contextId!, sessionId);
            const result = { sessionId, checkpointCount: detail.checkpointCount };
            recordMutationAudit(graph, req, 'resume_session', contextId, params, result, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, result);
            return handled(detail);
        }
        case 'explainCheckpoint': {
            const checkpointId = typeof params.checkpointId === 'string' ? params.checkpointId : null;
            if (!checkpointId || checkpointId.trim().length === 0) throw new Error("Missing required 'checkpointId' for explainCheckpoint.");
            const detail = graph.explainCheckpoint(checkpointId);
            const result = { checkpointId, found: Boolean(detail) };
            recordMutationAudit(graph, req, 'explain_checkpoint', detail?.checkpoint.contextId ?? contextId, params, result, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, detail?.checkpoint.contextId ?? contextId, params, result);
            return handled(detail);
        }
        default:
            return NOT_HANDLED;
    }
}
