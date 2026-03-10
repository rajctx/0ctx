import { defineTool } from './define';

export const graphTools = [
    defineTool('ctx_list_contexts', 'List all available abstract workspaces or projects. Use this to find the ID of the workspace you need to work in.'),
    defineTool('ctx_create_context', 'Creates a new abstract workspace/project (e.g. "Acme Corp Legal Case"). This will automatically set it as the active context for this session.', {
        name: { type: 'string', description: 'Human readable name for the project or context.' },
        paths: { type: 'array', items: { type: 'string' }, description: 'Optional list of local directory paths associated with this context.' }
    }, ['name']),
    defineTool('ctx_switch_context', 'Sets the specified context ID as the active workspace for this session. You MUST do this before calling ctx_set, ctx_query, or ctx_search if you haven\'t already created one this session.', {
        contextId: { type: 'string', description: 'The UUID of the context to switch to.' }
    }, ['contextId']),
    defineTool('ctx_set', 'Write a context node to the active graph. Works for any domain (legal, design, research, development, etc.)', {
        type: { type: 'string', enum: ['background', 'decision', 'constraint', 'goal', 'assumption', 'open_question', 'artifact'] },
        content: { type: 'string', description: 'The content of the context entry' },
        key: { type: 'string', description: 'Optional named key for direct lookup (e.g. auth-strategy)' },
        tags: { type: 'array', items: { type: 'string' } },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
        relatesTo: { type: 'string', description: 'Optional node ID this relates to' },
        relation: { type: 'string', enum: ['caused_by', 'constrains', 'supersedes', 'depends_on', 'contradicts'] }
    }, ['type', 'content']),
    defineTool('ctx_get', 'Retrieve a context node by named key from the active context.', {
        key: { type: 'string' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }, ['key']),
    defineTool('ctx_query', 'Traverse the graph from a node. Returns a subgraph pruned by relevance and temporal decay to protect the context window.', {
        nodeId: { type: 'string', description: 'The root node ID to start the traversal from.' },
        depth: { type: 'number', description: 'Traversal depth (default 2)' },
        maxNodes: { type: 'number', description: 'Maximum number of nodes to return, sorted by relevance (default 20)' }
    }, ['nodeId']),
    defineTool('ctx_search', 'Full-text search across all context nodes in the active project.', {
        query: { type: 'string', description: 'The search query string.' },
        limit: { type: 'number', description: 'Max results (default 10)' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }, ['query']),
    defineTool('ctx_supersede', 'Specifically mark an older decision, assumption, or goal as superseded by a new one. This drastically lowers the older node\'s relevance score so it gets pruned from future queries.', {
        oldNodeId: { type: 'string', description: 'The ID of the node being superseded.' },
        newNodeId: { type: 'string', description: 'The ID of the new node replacing it.' }
    }, ['oldNodeId', 'newNodeId']),
    defineTool('ctx_checkpoint', 'Save a named checkpoint of the active graph state.', {
        name: { type: 'string' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }, ['name']),
    defineTool('ctx_rewind', 'Restore the graph to a previously saved checkpoint.', {
        checkpointId: { type: 'string' }
    }, ['checkpointId']),
    defineTool('ctx_runtime_status', 'Get the runtime posture of the 0ctx daemon. Returns connected/degraded/offline status, auth state, sync health, and available capabilities. Use this to adapt behavior based on whether the daemon is fully operational.')
];
