import type {
    AgentSessionSummary,
    Context,
    Graph,
    InsightSummary,
    WorkspaceComparison,
    WorkspaceComparisonSide
} from '@0ctx/core';
import path from 'path';

function normalizePath(value: string): string {
    return path.resolve(value).replace(/\\/g, '/').toLowerCase();
}

function normalizeText(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function toWorkstreamKey(branch: string, worktreePath: string | null): string {
    return `${branch}::${worktreePath ? normalizePath(worktreePath) : ''}`;
}

function toWorkstreamLabel(branch: string, worktreePath: string | null): string {
    return worktreePath ? `${branch} (${worktreePath})` : branch;
}

function toInsightKey(insight: InsightSummary): string {
    return `${insight.type}:${normalizeText(insight.content)}`;
}

function buildWorkspaceSide(graph: Graph, context: Context): WorkspaceComparisonSide {
    const workstreams = graph.listBranchLanes(context.id, 200);
    const sessions = graph.listChatSessions(context.id, 5000) as AgentSessionSummary[];
    const checkpoints = graph.listCheckpoints(context.id);
    const graphData = graph.getGraphData(context.id, { includeHidden: false });
    const insights = graphData.nodes
        .flatMap((node): InsightSummary[] => {
            if (node.type === 'artifact') {
                return [];
            }
            return [{
                contextId: context.id,
                nodeId: node.id,
                type: node.type,
                content: node.content,
                createdAt: node.createdAt,
                branch: Array.isArray(node.tags)
                    ? (node.tags.find((tag) => tag.startsWith('branch:'))?.slice('branch:'.length) ?? null)
                    : null,
                worktreePath: Array.isArray(node.tags)
                    ? (node.tags.find((tag) => tag.startsWith('worktree:'))?.slice('worktree:'.length) ?? null)
                    : null,
                source: node.source ?? null
            }];
        })
        .sort((a, b) => b.createdAt - a.createdAt);

    const agents = new Set<string>();
    for (const session of sessions) {
        if (session.agent) agents.add(session.agent);
    }
    for (const checkpoint of checkpoints) {
        for (const agent of checkpoint.agentSet ?? []) {
            if (agent) agents.add(agent);
        }
    }

    const latestActivityCandidates = [
        context.createdAt,
        ...workstreams.map((workstream) => workstream.lastActivityAt),
        ...sessions.map((session) => session.lastTurnAt),
        ...checkpoints.map((checkpoint) => checkpoint.createdAt),
        ...insights.map((insight) => insight.createdAt)
    ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

    return {
        contextId: context.id,
        workspaceName: context.name,
        paths: Array.isArray(context.paths) ? [...context.paths] : [],
        syncPolicy: context.syncPolicy,
        workstreamCount: workstreams.length,
        sessionCount: sessions.length,
        checkpointCount: checkpoints.length,
        insightCount: insights.length,
        latestActivityAt: latestActivityCandidates.length > 0 ? Math.max(...latestActivityCandidates) : null,
        agents: [...agents].sort(),
        workstreams: workstreams.map((workstream) => ({
            branch: workstream.branch,
            worktreePath: workstream.worktreePath ?? null,
            stateKind: workstream.stateKind ?? 'unknown',
            lastActivityAt: workstream.lastActivityAt
        })),
        recentInsights: insights.slice(0, 6)
    };
}

function intersect(left: string[], right: string[]): string[] {
    const rightSet = new Set(right);
    return [...new Set(left)].filter((value) => rightSet.has(value)).sort();
}

function difference(left: string[], right: string[]): string[] {
    const rightSet = new Set(right);
    return [...new Set(left)].filter((value) => !rightSet.has(value)).sort();
}

function describeComparison(
    source: WorkspaceComparisonSide,
    target: WorkspaceComparisonSide,
    sharedRepositoryPaths: string[],
    sharedWorkstreams: string[],
    sharedInsights: string[],
    sharedAgents: string[]
): Pick<WorkspaceComparison, 'comparisonKind' | 'comparisonSummary' | 'comparisonActionHint' | 'comparisonText'> {
    let comparisonKind: WorkspaceComparison['comparisonKind'] = 'isolated';
    let comparisonSummary = 'These workspaces appear independent.';
    let comparisonActionHint: string | null = 'Keep them isolated unless you intentionally want to compare or promote reviewed insights.';

    if (sharedRepositoryPaths.length > 0) {
        comparisonKind = 'same_repository';
        comparisonSummary = 'Both workspaces are bound to the same repository path.';
        comparisonActionHint = 'Compare workstreams before keeping both workspace bindings, or consolidate duplicate bindings if they represent the same project.';
    } else if (sharedWorkstreams.length > 0) {
        comparisonKind = 'shared_workstreams';
        comparisonSummary = 'Both workspaces contain overlapping workstream names.';
        comparisonActionHint = 'Compare the matching workstreams before promoting insights or consolidating workspaces.';
    } else if (sharedInsights.length > 0) {
        comparisonKind = 'shared_insights';
        comparisonSummary = 'Both workspaces already contain overlapping reviewed insights.';
        comparisonActionHint = 'Promote only the specific reviewed insights you want to reuse. Avoid treating these workspaces as a shared memory pool.';
    } else if (sharedAgents.length > 0) {
        comparisonKind = 'shared_agents';
        comparisonSummary = 'The same agents have touched both workspaces, but there is no strong repository or workstream overlap.';
        comparisonActionHint = 'Keep these workspaces isolated unless there is an explicit promotion or comparison need.';
    }

    const lines = [
        `Workspace comparison: ${source.workspaceName} -> ${target.workspaceName}`,
        comparisonSummary
    ];
    if (sharedRepositoryPaths.length > 0) {
        lines.push(`Shared repository paths: ${sharedRepositoryPaths.join(', ')}`);
    }
    if (sharedWorkstreams.length > 0) {
        lines.push(`Shared workstreams: ${sharedWorkstreams.join(', ')}`);
    }
    if (sharedAgents.length > 0) {
        lines.push(`Shared agents: ${sharedAgents.join(', ')}`);
    }
    if (sharedInsights.length > 0) {
        lines.push(`Shared reviewed insights: ${sharedInsights.join(', ')}`);
    }
    lines.push(
        `${source.workspaceName}: ${source.workstreamCount} workstreams, ${source.sessionCount} sessions, ${source.checkpointCount} checkpoints, ${source.insightCount} insights.`,
        `${target.workspaceName}: ${target.workstreamCount} workstreams, ${target.sessionCount} sessions, ${target.checkpointCount} checkpoints, ${target.insightCount} insights.`
    );
    if (comparisonActionHint) {
        lines.push(`Next: ${comparisonActionHint}`);
    }

    return {
        comparisonKind,
        comparisonSummary,
        comparisonActionHint,
        comparisonText: lines.join('\n')
    };
}

export function compareWorkspaces(
    graph: Graph,
    options: {
        sourceContextId: string;
        targetContextId: string;
    }
): WorkspaceComparison {
    const sourceContext = graph.getContext(options.sourceContextId);
    if (!sourceContext) {
        throw new Error(`Context ${options.sourceContextId} not found`);
    }
    const targetContext = graph.getContext(options.targetContextId);
    if (!targetContext) {
        throw new Error(`Context ${options.targetContextId} not found`);
    }

    const source = buildWorkspaceSide(graph, sourceContext);
    const target = buildWorkspaceSide(graph, targetContext);

    const sharedRepositoryPaths = intersect(
        source.paths.map(normalizePath),
        target.paths.map(normalizePath)
    );
    const sharedAgents = intersect(source.agents, target.agents);
    const sourceOnlyAgents = difference(source.agents, target.agents);
    const targetOnlyAgents = difference(target.agents, source.agents);

    const sourceWorkstreams = source.workstreams.map((workstream) => toWorkstreamKey(workstream.branch, workstream.worktreePath));
    const targetWorkstreams = target.workstreams.map((workstream) => toWorkstreamKey(workstream.branch, workstream.worktreePath));
    const sharedWorkstreamKeys = intersect(sourceWorkstreams, targetWorkstreams);
    const sharedWorkstreams = sharedWorkstreamKeys.map((key) => {
        const [branch, rawWorktree] = key.split('::');
        return toWorkstreamLabel(branch, rawWorktree ? rawWorktree : null);
    });

    const sourceInsights = source.recentInsights.map((insight) => toInsightKey(insight));
    const targetInsights = target.recentInsights.map((insight) => toInsightKey(insight));
    const sharedInsightKeys = intersect(sourceInsights, targetInsights);
    const sharedInsights = sharedInsightKeys.map((key) => key.slice(key.indexOf(':') + 1));

    const comparison = describeComparison(
        source,
        target,
        sharedRepositoryPaths,
        sharedWorkstreams,
        sharedInsights,
        sharedAgents
    );

    return {
        source,
        target,
        sharedRepositoryPaths,
        sharedAgents,
        sourceOnlyAgents,
        targetOnlyAgents,
        sharedWorkstreams,
        sharedInsights,
        comparisonKind: comparison.comparisonKind,
        comparisonSummary: comparison.comparisonSummary,
        comparisonActionHint: comparison.comparisonActionHint,
        comparisonText: comparison.comparisonText
    };
}
