import { defineTool } from './define';

export const workstreamTools = [
    defineTool('ctx_list_workstreams', 'List workstreams for the active workspace. A workstream maps to a branch or worktree.', {
        limit: { type: 'number', description: 'Maximum number of workstreams to return (default 100).' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }),
    defineTool('ctx_list_workstream_insights', 'List reviewed insight nodes attached to the current workstream.', {
        branch: { type: 'string', description: 'Optional branch name for the workstream.' },
        worktreePath: { type: 'string', description: 'Optional worktree path for a specific workstream.' },
        limit: { type: 'number', description: 'Maximum number of insights to return (default 5).' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }),
    defineTool('ctx_get_workstream_brief', 'Get a compact workstream brief suitable for injecting into an agent session or summarizing the current workstream.', {
        branch: { type: 'string', description: 'Optional branch name for the workstream.' },
        worktreePath: { type: 'string', description: 'Optional worktree path for a specific workstream.' },
        sessionLimit: { type: 'number', description: 'Maximum number of recent sessions to include (default 3).' },
        checkpointLimit: { type: 'number', description: 'Maximum number of checkpoints to include (default 2).' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }),
    defineTool('ctx_get_agent_context', 'Get a compact agent-ready context pack for the current workstream, including recent sessions, checkpoints, handoffs, and a ready-to-use prompt summary.', {
        branch: { type: 'string', description: 'Optional branch name for the workstream.' },
        worktreePath: { type: 'string', description: 'Optional worktree path for a specific workstream.' },
        sessionLimit: { type: 'number', description: 'Maximum number of recent sessions to include (default 3).' },
        checkpointLimit: { type: 'number', description: 'Maximum number of checkpoints to include (default 2).' },
        handoffLimit: { type: 'number', description: 'Maximum number of recent handoffs to include (default 5).' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }),
    defineTool('ctx_compare_workstreams', 'Compare two workstreams in the same workspace. Returns git divergence, activity differences, shared agents, and a compact comparison summary.', {
        sourceBranch: { type: 'string', description: 'Source branch name for the comparison.' },
        sourceWorktreePath: { type: 'string', description: 'Optional worktree path for the source workstream.' },
        targetBranch: { type: 'string', description: 'Target branch name for the comparison.' },
        targetWorktreePath: { type: 'string', description: 'Optional worktree path for the target workstream.' },
        sessionLimit: { type: 'number', description: 'Maximum number of recent sessions to include per side (default 3).' },
        checkpointLimit: { type: 'number', description: 'Maximum number of checkpoints to include per side (default 2).' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }, ['sourceBranch', 'targetBranch']),
    defineTool('ctx_compare_workspaces', 'Compare two workspaces explicitly. Returns shared repository paths, overlapping workstreams, reviewed insights, shared agents, and a compact action summary.', {
        sourceContextId: { type: 'string', description: 'Optional source workspace context ID. Defaults to the active workspace when omitted.' },
        targetContextId: { type: 'string', description: 'Target workspace context ID.' }
    }, ['targetContextId']),
    defineTool('ctx_list_workstream_sessions', 'List sessions captured on a specific workstream.', {
        branch: { type: 'string', description: 'Branch name for the workstream.' },
        worktreePath: { type: 'string', description: 'Optional worktree path for a specific workstream.' },
        limit: { type: 'number', description: 'Maximum number of sessions to return (default 100).' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }, ['branch']),
    defineTool('ctx_get_session', 'Get a session detail payload including its summary, messages, and latest checkpoint.', {
        sessionId: { type: 'string', description: 'Session ID to inspect.' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }, ['sessionId']),
    defineTool('ctx_list_session_messages', 'List transcript-derived messages for a session.', {
        sessionId: { type: 'string', description: 'Session ID to inspect.' },
        limit: { type: 'number', description: 'Maximum number of messages to return (default 500).' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }, ['sessionId']),
    defineTool('ctx_list_workstream_checkpoints', 'List checkpoints created on a specific workstream.', {
        branch: { type: 'string', description: 'Branch name for the workstream.' },
        worktreePath: { type: 'string', description: 'Optional worktree path for a specific workstream.' },
        limit: { type: 'number', description: 'Maximum number of checkpoints to return (default 100).' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }, ['branch']),
    defineTool('ctx_get_checkpoint', 'Get the full detail for a checkpoint, including snapshot counts.', {
        checkpointId: { type: 'string', description: 'Checkpoint ID to inspect.' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }, ['checkpointId']),
    defineTool('ctx_get_handoff_timeline', 'List recent agent handoffs on a workstream or across the active workspace.', {
        branch: { type: 'string', description: 'Optional branch filter.' },
        worktreePath: { type: 'string', description: 'Optional worktree path filter.' },
        limit: { type: 'number', description: 'Maximum number of handoff entries to return (default 100).' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }),
    defineTool('ctx_create_session_checkpoint', 'Create a checkpoint from a captured session so the workstream can be resumed or explained later.', {
        sessionId: { type: 'string', description: 'Session ID to checkpoint.' },
        name: { type: 'string', description: 'Optional checkpoint name.' },
        summary: { type: 'string', description: 'Optional checkpoint summary override.' },
        kind: { type: 'string', enum: ['manual', 'session', 'legacy'], description: 'Optional checkpoint kind.' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }, ['sessionId']),
    defineTool('ctx_resume_session', 'Resume a session by loading its detail and linked checkpoint state.', {
        sessionId: { type: 'string', description: 'Session ID to resume.' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }, ['sessionId']),
    defineTool('ctx_rewind_checkpoint', 'Rewind the active workspace to a checkpoint snapshot.', {
        checkpointId: { type: 'string', description: 'Checkpoint ID to restore.' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }, ['checkpointId']),
    defineTool('ctx_explain_checkpoint', 'Explain a checkpoint by returning its metadata and snapshot scope.', {
        checkpointId: { type: 'string', description: 'Checkpoint ID to explain.' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }, ['checkpointId'])
];
