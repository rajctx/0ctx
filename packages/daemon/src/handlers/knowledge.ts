import { handled, NOT_HANDLED, type HandlerMethodContext, type MethodDispatchResult } from './types';
import {
    parseStringArray,
    recordMutationAudit,
    recordMutationEvent
} from './shared';

export function dispatchKnowledgeRequest(context: HandlerMethodContext): MethodDispatchResult {
    const { graph, connectionId, req, params, contextId, auditMetadata, runtime } = context;

    switch (req.method) {
        case 'previewSessionKnowledge': {
            const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null;
            if (!sessionId || sessionId.trim().length === 0) throw new Error("Missing required 'sessionId' for previewSessionKnowledge.");
            return handled(graph.previewKnowledgeFromSession(contextId!, sessionId, {
                checkpointId: typeof params.checkpointId === 'string' ? params.checkpointId : null,
                maxNodes: params.maxNodes as number | undefined,
                minConfidence: typeof params.minConfidence === 'number' ? params.minConfidence : undefined,
                source: params.source === 'checkpoint' ? 'checkpoint' : 'session'
            }));
        }
        case 'extractSessionKnowledge': {
            const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null;
            if (!sessionId || sessionId.trim().length === 0) throw new Error("Missing required 'sessionId' for extractSessionKnowledge.");
            const result = graph.extractKnowledgeFromSession(contextId!, sessionId, {
                checkpointId: typeof params.checkpointId === 'string' ? params.checkpointId : null,
                maxNodes: params.maxNodes as number | undefined,
                minConfidence: typeof params.minConfidence === 'number' ? params.minConfidence : undefined,
                source: params.source === 'checkpoint' ? 'checkpoint' : 'session',
                allowedKeys: parseStringArray(params.candidateKeys)
            });
            const auditResult = {
                sessionId,
                checkpointId: result.checkpointId,
                createdCount: result.createdCount,
                reusedCount: result.reusedCount,
                nodeCount: result.nodeCount
            };
            recordMutationAudit(graph, req, 'extract_knowledge', contextId, params, auditResult, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, auditResult);
            runtime.syncEngine?.enqueue(contextId!);
            return handled(result);
        }
        case 'promoteInsight': {
            const sourceContextId = typeof params.sourceContextId === 'string' ? params.sourceContextId : null;
            const nodeId = typeof params.nodeId === 'string' ? params.nodeId : null;
            if (!sourceContextId || sourceContextId.trim().length === 0) throw new Error("Missing required 'sourceContextId' for promoteInsight.");
            if (!nodeId || nodeId.trim().length === 0) throw new Error("Missing required 'nodeId' for promoteInsight.");
            const result = graph.promoteInsightNode(sourceContextId, nodeId, contextId!, {
                branch: typeof params.branch === 'string' ? params.branch : undefined,
                worktreePath: typeof params.worktreePath === 'string' ? params.worktreePath : undefined
            });
            const auditResult = { sourceContextId, nodeId, targetNodeId: result.targetNodeId, created: result.created, reused: result.reused };
            recordMutationAudit(graph, req, 'promote_insight', contextId, params, auditResult, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, auditResult);
            runtime.syncEngine?.enqueue(contextId!);
            return handled(result);
        }
        case 'previewCheckpointKnowledge': {
            const checkpointId = typeof params.checkpointId === 'string' ? params.checkpointId : null;
            if (!checkpointId || checkpointId.trim().length === 0) throw new Error("Missing required 'checkpointId' for previewCheckpointKnowledge.");
            return handled(graph.previewKnowledgeFromCheckpoint(checkpointId, {
                maxNodes: params.maxNodes as number | undefined,
                minConfidence: typeof params.minConfidence === 'number' ? params.minConfidence : undefined
            }));
        }
        case 'extractCheckpointKnowledge': {
            const checkpointId = typeof params.checkpointId === 'string' ? params.checkpointId : null;
            if (!checkpointId || checkpointId.trim().length === 0) throw new Error("Missing required 'checkpointId' for extractCheckpointKnowledge.");
            const result = graph.extractKnowledgeFromCheckpoint(checkpointId, {
                maxNodes: params.maxNodes as number | undefined,
                minConfidence: typeof params.minConfidence === 'number' ? params.minConfidence : undefined,
                allowedKeys: parseStringArray(params.candidateKeys)
            });
            const auditResult = {
                sessionId: result.sessionId,
                checkpointId,
                createdCount: result.createdCount,
                reusedCount: result.reusedCount,
                nodeCount: result.nodeCount
            };
            recordMutationAudit(graph, req, 'extract_knowledge', result.contextId, params, auditResult, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, result.contextId, params, auditResult);
            runtime.syncEngine?.enqueue(result.contextId);
            return handled(result);
        }
        default:
            return NOT_HANDLED;
    }
}
