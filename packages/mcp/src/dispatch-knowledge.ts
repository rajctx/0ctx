import type { ToolDispatchContext, ToolResponse } from './tool-dispatch-types';
import { jsonToolResult } from './tool-results';

export async function handleKnowledgeToolCall(
    name: string,
    args: Record<string, unknown>,
    context: ToolDispatchContext
): Promise<ToolResponse | null> {
    const contextId = context.pickContextId(args);
    switch (name) {
        case 'ctx_list_workstream_insights':
            return jsonToolResult(await context.callDaemon('listWorkstreamInsights', {
                contextId,
                branch: args.branch,
                worktreePath: args.worktreePath,
                limit: args.limit ?? 5
            }));
        case 'ctx_preview_insights':
            return jsonToolResult(await previewInsights(args, contextId, context));
        case 'ctx_extract_insights':
            return jsonToolResult(await extractInsights(args, contextId, context));
        case 'ctx_promote_insight':
            return jsonToolResult(await context.callDaemon('promoteInsight', {
                contextId,
                sourceContextId: args.sourceContextId,
                nodeId: args.nodeId,
                branch: typeof args.branch === 'string' ? args.branch : undefined,
                worktreePath: typeof args.worktreePath === 'string' ? args.worktreePath : undefined
            }));
        default:
            return null;
    }
}

async function previewInsights(
    args: Record<string, unknown>,
    contextId: string | undefined,
    context: ToolDispatchContext
): Promise<unknown> {
    if (typeof args.checkpointId === 'string' && args.checkpointId.length > 0) {
        return context.callDaemon('previewCheckpointKnowledge', {
            checkpointId: args.checkpointId,
            maxNodes: args.maxNodes,
            minConfidence: args.minConfidence
        });
    }
    if (typeof args.sessionId === 'string' && args.sessionId.length > 0) {
        return context.callDaemon('previewSessionKnowledge', {
            contextId,
            sessionId: args.sessionId,
            maxNodes: args.maxNodes,
            minConfidence: args.minConfidence
        });
    }
    throw new Error("ctx_preview_insights requires either 'sessionId' or 'checkpointId'.");
}

async function extractInsights(
    args: Record<string, unknown>,
    contextId: string | undefined,
    context: ToolDispatchContext
): Promise<unknown> {
    if (typeof args.checkpointId === 'string' && args.checkpointId.length > 0) {
        return context.callDaemon('extractCheckpointKnowledge', {
            checkpointId: args.checkpointId,
            maxNodes: args.maxNodes,
            minConfidence: args.minConfidence,
            candidateKeys: args.candidateKeys
        });
    }
    if (typeof args.sessionId === 'string' && args.sessionId.length > 0) {
        return context.callDaemon('extractSessionKnowledge', {
            contextId,
            sessionId: args.sessionId,
            maxNodes: args.maxNodes,
            minConfidence: args.minConfidence,
            candidateKeys: args.candidateKeys
        });
    }
    throw new Error("ctx_extract_insights requires either 'sessionId' or 'checkpointId'.");
}
