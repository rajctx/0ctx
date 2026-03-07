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
        name: 'ctx_list_workstreams',
        description: 'List workstreams for the active workspace. A workstream maps to a branch or worktree.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'Maximum number of workstreams to return (default 100).' },
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
            },
            required: [],
        },
    },
    {
        name: 'ctx_get_workstream_brief',
        description: 'Get a compact workstream brief suitable for injecting into an agent session or summarizing the current workstream.',
        inputSchema: {
            type: 'object',
            properties: {
                branch: { type: 'string', description: 'Optional branch name for the workstream.' },
                worktreePath: { type: 'string', description: 'Optional worktree path for a specific workstream.' },
                sessionLimit: { type: 'number', description: 'Maximum number of recent sessions to include (default 3).' },
                checkpointLimit: { type: 'number', description: 'Maximum number of checkpoints to include (default 2).' },
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
            },
            required: [],
        },
    },
    {
        name: 'ctx_list_workstream_sessions',
        description: 'List sessions captured on a specific workstream.',
        inputSchema: {
            type: 'object',
            properties: {
                branch: { type: 'string', description: 'Branch name for the workstream.' },
                worktreePath: { type: 'string', description: 'Optional worktree path for a specific workstream.' },
                limit: { type: 'number', description: 'Maximum number of sessions to return (default 100).' },
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
            },
            required: ['branch'],
        },
    },
    {
        name: 'ctx_get_session',
        description: 'Get a session detail payload including its summary, messages, and latest checkpoint.',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', description: 'Session ID to inspect.' },
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
            },
            required: ['sessionId'],
        },
    },
    {
        name: 'ctx_list_session_messages',
        description: 'List transcript-derived messages for a session.',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', description: 'Session ID to inspect.' },
                limit: { type: 'number', description: 'Maximum number of messages to return (default 500).' },
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
            },
            required: ['sessionId'],
        },
    },
    {
        name: 'ctx_list_workstream_checkpoints',
        description: 'List checkpoints created on a specific workstream.',
        inputSchema: {
            type: 'object',
            properties: {
                branch: { type: 'string', description: 'Branch name for the workstream.' },
                worktreePath: { type: 'string', description: 'Optional worktree path for a specific workstream.' },
                limit: { type: 'number', description: 'Maximum number of checkpoints to return (default 100).' },
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
            },
            required: ['branch'],
        },
    },
    {
        name: 'ctx_get_checkpoint',
        description: 'Get the full detail for a checkpoint, including snapshot counts.',
        inputSchema: {
            type: 'object',
            properties: {
                checkpointId: { type: 'string', description: 'Checkpoint ID to inspect.' },
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
            },
            required: ['checkpointId'],
        },
    },
    {
        name: 'ctx_get_handoff_timeline',
        description: 'List recent agent handoffs on a workstream or across the active workspace.',
        inputSchema: {
            type: 'object',
            properties: {
                branch: { type: 'string', description: 'Optional branch filter.' },
                worktreePath: { type: 'string', description: 'Optional worktree path filter.' },
                limit: { type: 'number', description: 'Maximum number of handoff entries to return (default 100).' },
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
            },
            required: [],
        },
    },
    {
        name: 'ctx_create_session_checkpoint',
        description: 'Create a checkpoint from a captured session so the workstream can be resumed or explained later.',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', description: 'Session ID to checkpoint.' },
                name: { type: 'string', description: 'Optional checkpoint name.' },
                summary: { type: 'string', description: 'Optional checkpoint summary override.' },
                kind: { type: 'string', enum: ['manual', 'session', 'legacy'], description: 'Optional checkpoint kind.' },
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
            },
            required: ['sessionId'],
        },
    },
    {
        name: 'ctx_resume_session',
        description: 'Resume a session by loading its detail and linked checkpoint state.',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', description: 'Session ID to resume.' },
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
            },
            required: ['sessionId'],
        },
    },
    {
        name: 'ctx_rewind_checkpoint',
        description: 'Rewind the active workspace to a checkpoint snapshot.',
        inputSchema: {
            type: 'object',
            properties: {
                checkpointId: { type: 'string', description: 'Checkpoint ID to restore.' },
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
            },
            required: ['checkpointId'],
        },
    },
    {
        name: 'ctx_explain_checkpoint',
        description: 'Explain a checkpoint by returning its metadata and snapshot scope.',
        inputSchema: {
            type: 'object',
            properties: {
                checkpointId: { type: 'string', description: 'Checkpoint ID to explain.' },
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
            },
            required: ['checkpointId'],
        },
    },
    {
        name: 'ctx_preview_insights',
        description: 'Preview reviewed insight candidates for a session or checkpoint.',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', description: 'Optional session ID to preview insight candidates from.' },
                checkpointId: { type: 'string', description: 'Optional checkpoint ID to preview insight candidates from.' },
                maxNodes: { type: 'number', description: 'Maximum number of candidates to return (default 12).' },
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
            },
            required: [],
        },
    },
    {
        name: 'ctx_extract_insights',
        description: 'Persist selected reviewed insight candidates from a session or checkpoint.',
        inputSchema: {
            type: 'object',
            properties: {
                sessionId: { type: 'string', description: 'Optional session ID to extract insight candidates from.' },
                checkpointId: { type: 'string', description: 'Optional checkpoint ID to extract insight candidates from.' },
                candidateKeys: { type: 'array', items: { type: 'string' }, description: 'Optional candidate keys to persist; omit to extract all returned candidates.' },
                maxNodes: { type: 'number', description: 'Maximum number of candidates to inspect (default 12).' },
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
            },
            required: [],
        },
    },
    {
        name: 'ctx_recall',
        description: 'Unified recall before starting work. Combines temporal, topic, and graph context into one payload.',
        inputSchema: {
            type: 'object',
            properties: {
                mode: { type: 'string', enum: ['auto', 'temporal', 'topic', 'graph'], description: 'Recall mode (default auto).' },
                query: { type: 'string', description: 'Optional topic query for topic/graph recall.' },
                sinceHours: { type: 'number', description: 'Lookback window in hours (default 24).' },
                limit: { type: 'number', description: 'Max hits/sessions to return (default 10).' },
                depth: { type: 'number', description: 'Graph traversal depth for graph recall (default 2).' },
                maxNodes: { type: 'number', description: 'Max graph nodes for graph recall (default 30).' },
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
            },
            required: [],
        },
    },
    {
        name: 'ctx_recall_temporal',
        description: 'Reconstruct a recent activity timeline from audit/session history.',
        inputSchema: {
            type: 'object',
            properties: {
                sinceHours: { type: 'number', description: 'Lookback window in hours (default 24).' },
                limit: { type: 'number', description: 'Max sessions to return (default 10).' },
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
            },
            required: [],
        },
    },
    {
        name: 'ctx_recall_topic',
        description: 'BM25-ranked topic recall over context nodes with reasoned ranking metadata.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Topic query for ranked recall.' },
                sinceHours: { type: 'number', description: 'Recency window in hours (default 24).' },
                limit: { type: 'number', description: 'Max hits to return (default 10).' },
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
            },
            required: ['query'],
        },
    },
    {
        name: 'ctx_recall_graph',
        description: 'Graph-oriented recall from top topic anchors or explicit anchor nodes.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Optional query used to pick anchor nodes.' },
                anchorNodeIds: { type: 'array', items: { type: 'string' }, description: 'Optional explicit anchor node IDs.' },
                sinceHours: { type: 'number', description: 'Recency window in hours (default 24).' },
                limit: { type: 'number', description: 'Max anchors to use (default 6).' },
                depth: { type: 'number', description: 'Traversal depth (default 2).' },
                maxNodes: { type: 'number', description: 'Max nodes to include (default 30).' },
                contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
            },
            required: [],
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
        name: 'ctx_blackboard_completion',
        description: 'Evaluate whether a context has stabilized for completion (gates, leases, and cooldown window).',
        inputSchema: {
            type: 'object',
            properties: {
                contextId: { type: 'string', description: 'Optional explicit context scope.' },
                cooldownMs: { type: 'number', description: 'Optional stabilization cooldown window in milliseconds (default 30000).' },
                requiredGates: { type: 'array', items: { type: 'string' }, description: 'Optional required gate IDs (default: typecheck,test,lint,security).' }
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
    },
    {
        name: 'ctx_auth_status',
        description: 'Get the current authentication status (logged in/out, email, tenant, token expiry).',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'ctx_sync_status',
        description: 'Get the sync engine status including enabled state, queue counts, last push/pull timestamps, and errors.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'ctx_sync_now',
        description: 'Trigger an immediate sync cycle (push pending changes then pull remote updates).',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    }
];

type ToolScope = 'core' | 'recall' | 'ops';
export type McpToolProfile = 'all' | ToolScope;
export type McpToolDefinition = (typeof tools)[number];

const ALL_TOOL_SCOPES: ToolScope[] = ['core', 'recall', 'ops'];

const TOOL_SCOPE_BY_NAME: Record<string, ToolScope> = {
    // Core graph context workflows
    ctx_list_contexts: 'core',
    ctx_create_context: 'core',
    ctx_switch_context: 'core',
    ctx_set: 'core',
    ctx_get: 'core',
    ctx_query: 'core',
    ctx_search: 'core',
    ctx_list_workstreams: 'core',
    ctx_get_workstream_brief: 'core',
    ctx_list_workstream_sessions: 'core',
    ctx_get_session: 'core',
    ctx_list_session_messages: 'core',
    ctx_list_workstream_checkpoints: 'core',
    ctx_get_checkpoint: 'core',
    ctx_get_handoff_timeline: 'core',
    ctx_create_session_checkpoint: 'core',
    ctx_resume_session: 'core',
    ctx_rewind_checkpoint: 'core',
    ctx_explain_checkpoint: 'core',
    ctx_preview_insights: 'core',
    ctx_extract_insights: 'core',
    ctx_supersede: 'core',
    ctx_checkpoint: 'core',
    ctx_rewind: 'core',
    ctx_runtime_status: 'core',

    // Recall workflows
    ctx_recall: 'recall',
    ctx_recall_temporal: 'recall',
    ctx_recall_topic: 'recall',
    ctx_recall_graph: 'recall',

    // Ops / governance / runtime control
    ctx_health: 'ops',
    ctx_metrics: 'ops',
    ctx_sync_policy_get: 'ops',
    ctx_sync_policy_set: 'ops',
    ctx_audit_recent: 'ops',
    ctx_backup_create: 'ops',
    ctx_backup_list: 'ops',
    ctx_backup_restore: 'ops',
    ctx_blackboard_subscribe: 'ops',
    ctx_blackboard_poll: 'ops',
    ctx_blackboard_ack: 'ops',
    ctx_blackboard_state: 'ops',
    ctx_blackboard_completion: 'ops',
    ctx_task_claim: 'ops',
    ctx_task_release: 'ops',
    ctx_gate_resolve: 'ops',
    ctx_auth_status: 'ops',
    ctx_sync_status: 'ops',
    ctx_sync_now: 'ops',
};

const PROFILE_SCOPE_EXPANSION: Record<ToolScope, ToolScope[]> = {
    core: ['core'],
    recall: ['core', 'recall'],
    ops: ['core', 'ops'],
};

export interface ResolvedMcpToolProfile {
    requested: string;
    all: boolean;
    profiles: ToolScope[];
    scopes: ToolScope[];
    normalized: string;
    invalidTokens: string[];
}

export function resolveMcpToolProfile(raw: string | null | undefined): ResolvedMcpToolProfile {
    const requested = (raw ?? '').trim();
    if (requested.length === 0) {
        return {
            requested: 'all',
            all: true,
            profiles: [],
            scopes: [...ALL_TOOL_SCOPES],
            normalized: 'all',
            invalidTokens: []
        };
    }

    const tokens = requested
        .split(',')
        .map(token => token.trim().toLowerCase())
        .filter(token => token.length > 0);

    const profiles = new Set<ToolScope>();
    const scopes = new Set<ToolScope>();
    const invalidTokens: string[] = [];
    let all = false;

    for (const token of tokens) {
        if (token === 'all') {
            all = true;
            continue;
        }
        if (token === 'core' || token === 'recall' || token === 'ops') {
            profiles.add(token);
            for (const scope of PROFILE_SCOPE_EXPANSION[token]) {
                scopes.add(scope);
            }
            continue;
        }
        invalidTokens.push(token);
    }

    if (all || (profiles.size === 0 && invalidTokens.length > 0)) {
        return {
            requested,
            all: true,
            profiles: [],
            scopes: [...ALL_TOOL_SCOPES],
            normalized: 'all',
            invalidTokens
        };
    }

    if (profiles.size === 0) {
        return {
            requested,
            all: true,
            profiles: [],
            scopes: [...ALL_TOOL_SCOPES],
            normalized: 'all',
            invalidTokens
        };
    }

    return {
        requested,
        all: false,
        profiles: Array.from(profiles).sort(),
        scopes: Array.from(scopes).sort(),
        normalized: Array.from(profiles).sort().join(','),
        invalidTokens
    };
}

function toResolvedProfile(profile: ResolvedMcpToolProfile | string | null | undefined): ResolvedMcpToolProfile {
    if (typeof profile === 'string' || profile === null || profile === undefined) {
        return resolveMcpToolProfile(profile);
    }
    return profile;
}

export function isToolEnabledForProfile(
    toolName: string,
    profile: ResolvedMcpToolProfile | string | null | undefined
): boolean {
    const resolved = toResolvedProfile(profile);
    if (resolved.all) return true;
    const scope = TOOL_SCOPE_BY_NAME[toolName] ?? 'core';
    return resolved.scopes.includes(scope);
}

export function getToolsForProfile(profile: ResolvedMcpToolProfile | string | null | undefined): McpToolDefinition[] {
    const resolved = toResolvedProfile(profile);
    if (resolved.all) return [...tools];
    return tools.filter(tool => isToolEnabledForProfile(tool.name, resolved));
}
