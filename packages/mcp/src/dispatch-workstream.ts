import type { ToolDispatchContext, ToolResponse } from './tool-dispatch-types';
import { jsonToolResult } from './tool-results';

export async function handleWorkstreamToolCall(
    name: string,
    args: Record<string, unknown>,
    context: ToolDispatchContext
): Promise<ToolResponse | null> {
    const contextId = context.pickContextId(args);
    switch (name) {
        case 'ctx_list_workstreams':
            return jsonToolResult(await context.callDaemon('listBranchLanes', { contextId, limit: args.limit ?? 100 }));
        case 'ctx_list_workstream_sessions':
            return jsonToolResult(await context.callDaemon('listBranchSessions', {
                contextId,
                branch: args.branch,
                worktreePath: args.worktreePath,
                limit: args.limit ?? 100
            }));
        case 'ctx_list_session_messages':
            return jsonToolResult(await context.callDaemon('listSessionMessages', {
                contextId,
                sessionId: args.sessionId,
                limit: args.limit ?? 500
            }));
        case 'ctx_list_workstream_checkpoints':
            return jsonToolResult(await context.callDaemon('listBranchCheckpoints', {
                contextId,
                branch: args.branch,
                worktreePath: args.worktreePath,
                limit: args.limit ?? 100
            }));
        case 'ctx_get_workstream_brief':
            return jsonToolResult(await context.callDaemon('getWorkstreamBrief', {
                contextId,
                branch: args.branch,
                worktreePath: args.worktreePath,
                sessionLimit: args.sessionLimit,
                checkpointLimit: args.checkpointLimit
            }));
        case 'ctx_get_agent_context':
            return jsonToolResult(await context.callDaemon('getAgentContextPack', {
                contextId,
                branch: args.branch,
                worktreePath: args.worktreePath,
                sessionLimit: args.sessionLimit,
                checkpointLimit: args.checkpointLimit,
                handoffLimit: args.handoffLimit
            }));
        case 'ctx_compare_workstreams':
            return jsonToolResult(await context.callDaemon('compareWorkstreams', {
                contextId,
                sourceBranch: args.sourceBranch,
                sourceWorktreePath: args.sourceWorktreePath,
                targetBranch: args.targetBranch,
                targetWorktreePath: args.targetWorktreePath,
                sessionLimit: args.sessionLimit,
                checkpointLimit: args.checkpointLimit
            }));
        case 'ctx_compare_workspaces':
            return jsonToolResult(await context.callDaemon('compareWorkspaces', {
                sourceContextId: typeof args.sourceContextId === 'string' && args.sourceContextId.length > 0
                    ? args.sourceContextId
                    : undefined,
                targetContextId: args.targetContextId
            }));
        case 'ctx_get_session':
            return jsonToolResult(await context.callDaemon('getSessionDetail', { contextId, sessionId: args.sessionId }));
        case 'ctx_get_checkpoint':
            return jsonToolResult(await context.callDaemon('getCheckpointDetail', { checkpointId: args.checkpointId }));
        case 'ctx_get_handoff_timeline':
            return jsonToolResult(await context.callDaemon('getHandoffTimeline', {
                contextId,
                branch: args.branch,
                worktreePath: args.worktreePath,
                limit: args.limit ?? 100
            }));
        case 'ctx_create_session_checkpoint':
            return jsonToolResult(await context.callDaemon('createSessionCheckpoint', {
                contextId,
                sessionId: args.sessionId,
                name: args.name,
                summary: args.summary,
                kind: args.kind
            }));
        case 'ctx_resume_session':
            return jsonToolResult(await context.callDaemon('resumeSession', { contextId, sessionId: args.sessionId }));
        case 'ctx_rewind_checkpoint':
            return jsonToolResult(await context.callDaemon('rewindCheckpoint', { contextId, checkpointId: args.checkpointId }));
        case 'ctx_explain_checkpoint':
            return jsonToolResult(await context.callDaemon('explainCheckpoint', { contextId, checkpointId: args.checkpointId }));
        default:
            return null;
    }
}
