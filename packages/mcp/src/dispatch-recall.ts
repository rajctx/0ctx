import type { ToolDispatchContext, ToolResponse } from './tool-dispatch-types';
import { jsonToolResult } from './tool-results';

export async function handleRecallToolCall(
    name: string,
    args: Record<string, unknown>,
    context: ToolDispatchContext
): Promise<ToolResponse | null> {
    const contextId = context.pickContextId(args);
    switch (name) {
        case 'ctx_recall':
            return jsonToolResult(await context.callDaemon('recall', {
                contextId,
                mode: args.mode ?? 'auto',
                query: args.query,
                sinceHours: args.sinceHours,
                limit: args.limit,
                depth: args.depth,
                maxNodes: args.maxNodes
            }));
        case 'ctx_recall_temporal':
            return jsonToolResult(await context.callDaemon('recallTemporal', {
                contextId,
                sinceHours: args.sinceHours,
                limit: args.limit
            }));
        case 'ctx_recall_topic':
            return jsonToolResult(await context.callDaemon('recallTopic', {
                contextId,
                query: args.query,
                sinceHours: args.sinceHours,
                limit: args.limit
            }));
        case 'ctx_recall_graph':
            return jsonToolResult(await context.callDaemon('recallGraph', {
                contextId,
                query: args.query,
                anchorNodeIds: args.anchorNodeIds,
                sinceHours: args.sinceHours,
                limit: args.limit,
                depth: args.depth,
                maxNodes: args.maxNodes
            }));
        default:
            return null;
    }
}
