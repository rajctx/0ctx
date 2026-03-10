import { defineTool } from './define';

export const insightTools = [
    defineTool('ctx_preview_insights', 'Preview reviewed insight candidates for a session or checkpoint.', {
        sessionId: { type: 'string', description: 'Optional session ID to preview insight candidates from.' },
        checkpointId: { type: 'string', description: 'Optional checkpoint ID to preview insight candidates from.' },
        maxNodes: { type: 'number', description: 'Maximum number of candidates to return (default 12).' },
        minConfidence: { type: 'number', description: 'Optional minimum confidence between 0 and 1.' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }),
    defineTool('ctx_extract_insights', 'Persist selected reviewed insight candidates from a session or checkpoint.', {
        sessionId: { type: 'string', description: 'Optional session ID to extract insight candidates from.' },
        checkpointId: { type: 'string', description: 'Optional checkpoint ID to extract insight candidates from.' },
        candidateKeys: { type: 'array', items: { type: 'string' }, description: 'Optional candidate keys to persist; omit to extract all returned candidates.' },
        maxNodes: { type: 'number', description: 'Maximum number of candidates to inspect (default 12).' },
        minConfidence: { type: 'number', description: 'Optional minimum confidence between 0 and 1.' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }),
    defineTool('ctx_promote_insight', 'Explicitly promote one reviewed insight node from a source workspace into the active workspace or another target workspace.', {
        sourceContextId: { type: 'string', description: 'Source workspace context ID that currently owns the reviewed insight.' },
        nodeId: { type: 'string', description: 'Insight node ID to promote.' },
        branch: { type: 'string', description: 'Optional target workstream branch for the promoted insight.' },
        worktreePath: { type: 'string', description: 'Optional target worktree path for the promoted insight.' },
        contextId: { type: 'string', description: 'Optional explicit target context ID override for this operation.' }
    }, ['sourceContextId', 'nodeId'])
];
