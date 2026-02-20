import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { tools } from './tools';
import { sendToDaemon } from './client';

const server = new Server(
    { name: '0ctx', version: '0.1.0' },
    { capabilities: { tools: {} } }
);

import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (req: any) => {
    const { name, arguments: args } = req.params;

    try {
        switch (name) {
            case 'ctx_list_contexts': {
                const contexts = await sendToDaemon('listContexts', {});
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(contexts, null, 2) }] } };
            }
            case 'ctx_create_context': {
                const ctx = await sendToDaemon('createContext', { name: args.name, paths: args.paths });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: `Created and switched to context: ${ctx.id} (${ctx.name})` }] } };
            }
            case 'ctx_switch_context': {
                const ctx = await sendToDaemon('switchContext', { contextId: args.contextId });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: `Switched to active context: ${ctx.name}` }] } };
            }
            case 'ctx_set': {
                const node = await sendToDaemon('addNode', { ...args, source: '0ctx-mcp' });
                if (args.relatesTo && args.relation) {
                    await sendToDaemon('addEdge', { fromId: node.id, toId: args.relatesTo, relation: args.relation });
                }
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: `Saved: ${node.id}` }] } };
            }
            case 'ctx_get': {
                const node = await sendToDaemon('getByKey', { key: args.key });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: node ? JSON.stringify(node, null, 2) : 'Not found' }] } };
            }
            case 'ctx_query': {
                const subgraph = await sendToDaemon('getSubgraph', { rootId: args.nodeId, depth: args.depth ?? 2, maxNodes: args.maxNodes ?? 20 });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(subgraph, null, 2) }] } };
            }
            case 'ctx_search': {
                const results = await sendToDaemon('search', { query: args.query, limit: args.limit ?? 10 });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] } };
            }
            case 'ctx_supersede': {
                const edge = await sendToDaemon('addEdge', { fromId: args.newNodeId, toId: args.oldNodeId, relation: 'supersedes' });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: `Node ${args.oldNodeId} successfully superseded.` }] } };
            }
            case 'ctx_checkpoint': {
                const cp = await sendToDaemon('saveCheckpoint', { name: args.name });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: `Checkpoint saved: ${cp.id}` }] } };
            }
            case 'ctx_rewind': {
                await sendToDaemon('rewind', { checkpointId: args.checkpointId });
                return { _meta: {}, toolResult: { content: [{ type: 'text', text: 'Rewound to checkpoint.' }] } };
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (e: any) {
        return { _meta: {}, toolResult: { content: [{ type: 'text', text: `Error: ${e.message}. Ensure you have an active context.` }], isError: true } };
    }
});

const transport = new StdioServerTransport();
server.connect(transport);
