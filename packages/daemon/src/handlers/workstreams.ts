import {
    buildAgentContextPack,
    buildWorkstreamBrief,
    compareWorkstreams,
    enrichWorkstreamLane
} from '../workstream';
import { compareWorkspaces } from '../workspace/compare';
import { handled, NOT_HANDLED, type HandlerMethodContext, type MethodDispatchResult } from './types';

export function dispatchWorkstreamRequest(context: HandlerMethodContext): MethodDispatchResult {
    const { graph, params, contextId } = context;

    switch (context.req.method) {
        case 'listBranchLanes': {
            const current = graph.getContext(contextId!);
            const contextPaths = Array.isArray(current?.paths)
                ? current.paths.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
                : [];
            return handled(graph.listBranchLanes(contextId!, params.limit as number | undefined)
                .map((lane) => enrichWorkstreamLane(graph, contextId!, contextPaths, lane)));
        }
        case 'listWorkstreamInsights':
            return handled(graph.listWorkstreamInsights(contextId!, {
                branch: typeof params.branch === 'string' ? params.branch : null,
                worktreePath: typeof params.worktreePath === 'string' ? params.worktreePath : null,
                limit: params.limit as number | undefined
            }));
        case 'getWorkstreamBrief':
            return handled(buildWorkstreamBrief(graph, contextId!, {
                branch: typeof params.branch === 'string' ? params.branch : null,
                worktreePath: typeof params.worktreePath === 'string' ? params.worktreePath : null,
                sessionLimit: params.sessionLimit as number | undefined,
                checkpointLimit: params.checkpointLimit as number | undefined
            }));
        case 'getAgentContextPack':
            return handled(buildAgentContextPack(graph, contextId!, {
                branch: typeof params.branch === 'string' ? params.branch : null,
                worktreePath: typeof params.worktreePath === 'string' ? params.worktreePath : null,
                sessionLimit: params.sessionLimit as number | undefined,
                checkpointLimit: params.checkpointLimit as number | undefined,
                handoffLimit: params.handoffLimit as number | undefined
            }));
        case 'compareWorkstreams': {
            const sourceBranch = typeof params.sourceBranch === 'string' ? params.sourceBranch.trim() : '';
            const targetBranch = typeof params.targetBranch === 'string' ? params.targetBranch.trim() : '';
            if (!sourceBranch) throw new Error("Missing required 'sourceBranch' for compareWorkstreams.");
            if (!targetBranch) throw new Error("Missing required 'targetBranch' for compareWorkstreams.");
            return handled(compareWorkstreams(graph, contextId!, {
                sourceBranch,
                targetBranch,
                sourceWorktreePath: typeof params.sourceWorktreePath === 'string' ? params.sourceWorktreePath : null,
                targetWorktreePath: typeof params.targetWorktreePath === 'string' ? params.targetWorktreePath : null,
                sessionLimit: params.sessionLimit as number | undefined,
                checkpointLimit: params.checkpointLimit as number | undefined
            }));
        }
        case 'compareWorkspaces': {
            const sourceContextId = typeof params.sourceContextId === 'string' && params.sourceContextId.trim().length > 0
                ? params.sourceContextId.trim()
                : contextId;
            const targetContextId = typeof params.targetContextId === 'string' && params.targetContextId.trim().length > 0
                ? params.targetContextId.trim()
                : null;
            if (!sourceContextId) throw new Error("Missing required 'sourceContextId' or active context for compareWorkspaces.");
            if (!targetContextId) throw new Error("Missing required 'targetContextId' for compareWorkspaces.");
            return handled(compareWorkspaces(graph, { sourceContextId, targetContextId }));
        }
        case 'listBranchSessions': {
            const branch = typeof params.branch === 'string' ? params.branch : null;
            if (!branch || branch.trim().length === 0) throw new Error("Missing required 'branch' for listBranchSessions.");
            return handled(graph.listBranchSessions(contextId!, branch, {
                worktreePath: typeof params.worktreePath === 'string' ? params.worktreePath : null,
                limit: params.limit as number | undefined
            }));
        }
        case 'listSessionMessages': {
            const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null;
            if (!sessionId || sessionId.trim().length === 0) throw new Error("Missing required 'sessionId' for listSessionMessages.");
            return handled(graph.listSessionMessages(contextId!, sessionId, params.limit as number | undefined));
        }
        case 'listBranchCheckpoints': {
            const branch = typeof params.branch === 'string' ? params.branch : null;
            if (!branch || branch.trim().length === 0) throw new Error("Missing required 'branch' for listBranchCheckpoints.");
            return handled(graph.listBranchCheckpoints(contextId!, branch, {
                worktreePath: typeof params.worktreePath === 'string' ? params.worktreePath : null,
                limit: params.limit as number | undefined
            }));
        }
        case 'getSessionDetail': {
            const sessionId = typeof params.sessionId === 'string' ? params.sessionId : null;
            if (!sessionId || sessionId.trim().length === 0) throw new Error("Missing required 'sessionId' for getSessionDetail.");
            return handled(graph.getSessionDetail(contextId!, sessionId));
        }
        case 'getCheckpointDetail': {
            const checkpointId = typeof params.checkpointId === 'string' ? params.checkpointId : null;
            if (!checkpointId || checkpointId.trim().length === 0) throw new Error("Missing required 'checkpointId' for getCheckpointDetail.");
            return handled(graph.getCheckpointDetail(checkpointId));
        }
        case 'getHandoffTimeline':
            return handled(graph.getHandoffTimeline(
                contextId!,
                typeof params.branch === 'string' ? params.branch : undefined,
                typeof params.worktreePath === 'string' ? params.worktreePath : null,
                params.limit as number | undefined
            ));
        default:
            return NOT_HANDLED;
    }
}
