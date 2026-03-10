import type { ToolDispatchContext, ToolResponse } from './tool-dispatch-types';
import { jsonToolResult, textToolResult } from './tool-results';

export async function handleCoreToolCall(
    name: string,
    args: Record<string, unknown>,
    context: ToolDispatchContext
): Promise<ToolResponse | null> {
    switch (name) {
        case 'ctx_list_contexts':
            return jsonToolResult(await context.callDaemon('listContexts', {}));
        case 'ctx_create_context': {
            const created = await context.callDaemon('createContext', { name: args.name, paths: args.paths });
            return textToolResult(`Created and switched to context: ${created.id} (${created.name})`);
        }
        case 'ctx_switch_context': {
            await context.switchSessionContext(String(args.contextId));
            const switched = await context.callDaemon('getActiveContext', {});
            return textToolResult(`Switched to active context: ${switched.name}`);
        }
        case 'ctx_set': {
            const contextId = context.pickContextId(args);
            const node = await context.callDaemon('addNode', { ...args, contextId, source: '0ctx-mcp' });
            if (args.relatesTo && args.relation) {
                await context.callDaemon('addEdge', {
                    fromId: node.id,
                    toId: args.relatesTo as string,
                    relation: args.relation as string
                });
            }
            return textToolResult(`Saved: ${node.id}`);
        }
        default:
            return handleCoreLookup(name, args, context);
    }
}

async function handleCoreLookup(
    name: string,
    args: Record<string, unknown>,
    context: ToolDispatchContext
): Promise<ToolResponse | null> {
    const contextId = context.pickContextId(args);
    switch (name) {
        case 'ctx_get': {
            const node = await context.callDaemon('getByKey', { contextId, key: args.key });
            return textToolResult(node ? JSON.stringify(node, null, 2) : 'Not found');
        }
        case 'ctx_query':
            return jsonToolResult(await context.callDaemon('getSubgraph', {
                rootId: args.nodeId,
                depth: args.depth ?? 2,
                maxNodes: args.maxNodes ?? 20
            }));
        case 'ctx_search':
            return jsonToolResult(await context.callDaemon('search', {
                contextId,
                query: args.query,
                limit: args.limit ?? 10
            }));
        case 'ctx_supersede':
            await context.callDaemon('addEdge', { fromId: args.newNodeId, toId: args.oldNodeId, relation: 'supersedes' });
            return textToolResult(`Node ${args.oldNodeId} successfully superseded.`);
        case 'ctx_checkpoint': {
            const checkpoint = await context.callDaemon('saveCheckpoint', { contextId, name: args.name });
            return textToolResult(`Checkpoint saved: ${checkpoint.id}`);
        }
        case 'ctx_rewind':
            await context.callDaemon('rewind', { checkpointId: args.checkpointId });
            return textToolResult('Rewound to checkpoint.');
        default:
            return null;
    }
}
