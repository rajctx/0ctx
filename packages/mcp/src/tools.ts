export const tools = [
    {
        name: 'ctx_list_contexts',
        description: 'List all available abstract workspaces or projects. Use this to find the ID of the workspace you need to work in.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'ctx_create_context',
        description: 'Creates a new abstract workspace/project (e.g. "Acme Corp Legal Case"). This will automatically set it as the active context for this session.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Human readable name for the project or context.' },
                paths: { type: 'array', items: { type: 'string' }, description: 'Optional list of local directory paths associated with this context.' }
            },
            required: ['name'],
        },
    },
    {
        name: 'ctx_switch_context',
        description: 'Sets the specified context ID as the active workspace for this session. You MUST do this before calling ctx_set, ctx_query, or ctx_search if you haven\'t already created one this session.',
        inputSchema: {
            type: 'object',
            properties: {
                contextId: { type: 'string', description: 'The UUID of the context to switch to.' }
            },
            required: ['contextId'],
        },
    },
    {
        name: 'ctx_set',
        description: 'Write a context node to the active graph. Works for any domain (legal, design, research, development, etc.)',
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: ['background', 'decision', 'constraint', 'goal', 'assumption', 'open_question', 'artifact'] },
                content: { type: 'string', description: 'The content of the context entry' },
                key: { type: 'string', description: 'Optional named key for direct lookup (e.g. auth-strategy)' },
                tags: { type: 'array', items: { type: 'string' } },
                relatesTo: { type: 'string', description: 'Optional node ID this relates to' },
                relation: { type: 'string', enum: ['caused_by', 'constrains', 'supersedes', 'depends_on', 'contradicts'] },
            },
            required: ['type', 'content'],
        },
    },
    {
        name: 'ctx_get',
        description: 'Retrieve a context node by named key from the active context.',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string' },
            },
            required: ['key'],
        },
    },
    {
        name: 'ctx_query',
        description: 'Traverse the graph from a node. Returns a subgraph pruned by relevance and temporal decay to protect the context window.',
        inputSchema: {
            type: 'object',
            properties: {
                nodeId: { type: 'string', description: 'The root node ID to start the traversal from.' },
                depth: { type: 'number', description: 'Traversal depth (default 2)' },
                maxNodes: { type: 'number', description: 'Maximum number of nodes to return, sorted by relevance (default 20)' }
            },
            required: ['nodeId'],
        },
    },
    {
        name: 'ctx_search',
        description: 'Full-text search across all context nodes in the active project.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'The search query string.' },
                limit: { type: 'number', description: 'Max results (default 10)' },
            },
            required: ['query'],
        },
    },
    {
        name: 'ctx_supersede',
        description: 'Specifically mark an older decision, assumption, or goal as superseded by a new one. This drastically lowers the older node\'s relevance score so it gets pruned from future queries.',
        inputSchema: {
            type: 'object',
            properties: {
                oldNodeId: { type: 'string', description: 'The ID of the node being superseded.' },
                newNodeId: { type: 'string', description: 'The ID of the new node replacing it.' }
            },
            required: ['oldNodeId', 'newNodeId']
        }
    },
    {
        name: 'ctx_checkpoint',
        description: 'Save a named checkpoint of the active graph state.',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
            },
            required: ['name'],
        },
    },
    {
        name: 'ctx_rewind',
        description: 'Restore the graph to a previously saved checkpoint.',
        inputSchema: {
            type: 'object',
            properties: {
                checkpointId: { type: 'string' },
            },
            required: ['checkpointId'],
        },
    }
];
