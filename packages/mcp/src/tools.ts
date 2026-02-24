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
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
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
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
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
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
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
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
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
    },
    {
        name: 'ctx_health',
        description: 'Check local daemon health and protocol status.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'ctx_metrics',
        description: 'Get daemon request metrics snapshot for operations and latency trends.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'ctx_sync_policy_get',
        description: 'Get the active context sync policy (`local_only`, `metadata_only`, `full_sync`).',
        inputSchema: {
            type: 'object',
            properties: {
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
            },
            required: [],
        },
    },
    {
        name: 'ctx_sync_policy_set',
        description: 'Set the active context sync policy (`local_only`, `metadata_only`, `full_sync`).',
        inputSchema: {
            type: 'object',
            properties: {
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
                syncPolicy: { type: 'string', enum: ['local_only', 'metadata_only', 'full_sync'] }
            },
            required: ['syncPolicy'],
        },
    },
    {
        name: 'ctx_audit_recent',
        description: 'List recent audit events for the active context (or a specific contextId).',
        inputSchema: {
            type: 'object',
            properties: {
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
                limit: { type: 'number', description: 'Max results (default 25).' },
            },
            required: [],
        },
    },
    {
        name: 'ctx_backup_create',
        description: 'Create an encrypted local backup file for the active context.',
        inputSchema: {
            type: 'object',
            properties: {
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
                name: { type: 'string', description: 'Optional backup name.' },
                encrypted: { type: 'boolean', description: 'Whether to encrypt the backup payload (default true).' }
            },
            required: [],
        },
    },
    {
        name: 'ctx_backup_list',
        description: 'List available local backup files.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'ctx_backup_restore',
        description: 'Restore a context from a local backup file. Creates a new context.',
        inputSchema: {
            type: 'object',
            properties: {
                fileName: { type: 'string', description: 'Backup filename from ctx_backup_list.' },
                name: { type: 'string', description: 'Optional name override for the restored context.' }
            },
            required: ['fileName'],
        },
    },
    {
        name: 'ctx_runtime_status',
        description: 'Get the runtime posture of the 0ctx daemon. Returns connected/degraded/offline status, auth state, sync health, and available capabilities. Use this to adapt behavior based on whether the daemon is fully operational.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'ctx_blackboard_subscribe',
        description: 'Create a blackboard event subscription for this session. Optionally scope to contextId and event types.',
        inputSchema: {
            type: 'object',
            properties: {
                contextId: { type: 'string', description: 'Optional explicit context scope.' },
                types: { type: 'array', items: { type: 'string' }, description: 'Optional event types to include.' },
                afterSequence: { type: 'number', description: 'Optional starting event sequence cursor.' }
            },
            required: [],
        },
    },
    {
        name: 'ctx_blackboard_poll',
        description: 'Poll events for an existing blackboard subscription.',
        inputSchema: {
            type: 'object',
            properties: {
                subscriptionId: { type: 'string', description: 'Subscription ID from ctx_blackboard_subscribe.' },
                afterSequence: { type: 'number', description: 'Optional cursor override.' },
                limit: { type: 'number', description: 'Optional max events (default 100).' }
            },
            required: ['subscriptionId'],
        },
    },
    {
        name: 'ctx_blackboard_ack',
        description: 'Acknowledge blackboard events for a subscription.',
        inputSchema: {
            type: 'object',
            properties: {
                subscriptionId: { type: 'string', description: 'Subscription ID to ack against.' },
                eventId: { type: 'string', description: 'Optional event ID to ack.' },
                sequence: { type: 'number', description: 'Optional sequence cursor to ack up to.' }
            },
            required: ['subscriptionId'],
        },
    },
    {
        name: 'ctx_blackboard_state',
        description: 'Inspect blackboard runtime state (recent events, leases, gates).',
        inputSchema: {
            type: 'object',
            properties: {
                contextId: { type: 'string', description: 'Optional explicit context scope.' },
                limit: { type: 'number', description: 'Optional max number of recent events.' }
            },
            required: [],
        },
    },
    {
        name: 'ctx_task_claim',
        description: 'Attempt to claim a blackboard task lease for this session.',
        inputSchema: {
            type: 'object',
            properties: {
                taskId: { type: 'string', description: 'Task identifier to claim.' },
                contextId: { type: 'string', description: 'Optional explicit context scope.' },
                leaseMs: { type: 'number', description: 'Optional lease duration in milliseconds.' }
            },
            required: ['taskId'],
        },
    },
    {
        name: 'ctx_task_release',
        description: 'Release a previously claimed blackboard task lease.',
        inputSchema: {
            type: 'object',
            properties: {
                taskId: { type: 'string', description: 'Task identifier to release.' }
            },
            required: ['taskId'],
        },
    },
    {
        name: 'ctx_gate_resolve',
        description: 'Resolve or open a blackboard quality gate.',
        inputSchema: {
            type: 'object',
            properties: {
                gateId: { type: 'string', description: 'Quality gate identifier.' },
                contextId: { type: 'string', description: 'Optional explicit context scope.' },
                severity: { type: 'string', description: 'Optional severity label.' },
                status: { type: 'string', enum: ['open', 'resolved'], description: 'Gate status update.' },
                message: { type: 'string', description: 'Optional gate update message.' }
            },
            required: ['gateId'],
        },
    }
];
