import type { AgentContextPack, Graph } from '@0ctx/core';
import { buildWorkstreamBrief } from './brief';
import { formatRelativeAge, parsePositiveInt, truncateBriefLine } from './format';

export function buildAgentContextPack(
    graph: Graph,
    contextId: string,
    options: {
        branch?: string | null;
        worktreePath?: string | null;
        sessionLimit?: number;
        checkpointLimit?: number;
        handoffLimit?: number;
    }
): AgentContextPack {
    const workstream = buildWorkstreamBrief(graph, contextId, options);
    const handoffLimit = parsePositiveInt(options.handoffLimit, 3, 20);
    const handoffTimeline = graph.getHandoffTimeline(
        contextId,
        workstream.branch ?? undefined,
        workstream.worktreePath,
        handoffLimit
    );

    const workstreamLabel = workstream.branch
        ?? (workstream.currentHeadSha ? `detached HEAD @ ${workstream.currentHeadSha.slice(0, 12)}` : 'unresolved workstream');
    const lines = [
        '0ctx workstream context',
        `Workspace: ${workstream.workspaceName}`,
        `Workstream: ${workstreamLabel}`,
        `Tool binding: Always set contextId to ${contextId} on 0ctx tool calls in this chat.`,
        `State: ${workstream.stateSummary ?? 'Current local workstream.'}`
    ];

    if (workstream.worktreePath) {
        lines.push(`Worktree binding: When a 0ctx tool accepts worktreePath, pass ${workstream.worktreePath}.`);
    }
    if (workstream.branch) {
        lines.push(`Branch binding: When a 0ctx tool accepts branch, use ${workstream.branch}.`);
    }

    if (workstream.stateActionHint) lines.push(`Next: ${workstream.stateActionHint}`);
    if (workstream.handoffSummary) lines.push(`Handoff: ${workstream.handoffSummary}`);

    const latestCheckpoint = workstream.latestCheckpoints[0] ?? null;
    if (latestCheckpoint) {
        const commitFact = latestCheckpoint.commitSha ? ` · ${latestCheckpoint.commitSha.slice(0, 12)}` : '';
        lines.push('', 'Latest checkpoint:', `- ${truncateBriefLine(latestCheckpoint.summary || latestCheckpoint.name)} · ${formatRelativeAge(latestCheckpoint.createdAt)}${commitFact}`);
    }

    if (workstream.recentSessions.length > 0) {
        lines.push('', 'Recent sessions:');
        for (const session of workstream.recentSessions.slice(0, 2)) {
            const commitFact = session.commitSha ? ` · ${session.commitSha.slice(0, 12)}` : '';
            lines.push(`- ${session.agent ?? 'agent'} · ${formatRelativeAge(session.lastTurnAt || session.startedAt)}${commitFact} · ${truncateBriefLine(session.summary)}`);
        }
    }

    if (workstream.insights.length > 0) {
        lines.push('', 'Reviewed insights:');
        for (const insight of workstream.insights.slice(0, 3)) {
            lines.push(`- ${insight.type}: ${truncateBriefLine(insight.content)}`);
        }
    }

    if (handoffTimeline.length > 0) {
        lines.push('', 'Recent handoffs:');
        for (const handoff of handoffTimeline.slice(0, 2)) {
            const commitFact = handoff.commitSha ? ` · ${handoff.commitSha.slice(0, 12)}` : '';
            lines.push(`- ${handoff.agent ?? 'agent'} · ${formatRelativeAge(handoff.lastTurnAt)}${commitFact} · ${truncateBriefLine(handoff.summary)}`);
        }
    }

    lines.push('', 'Resume from the latest checkpoint first. Use session history only for short-term continuity.');

    return {
        contextId,
        workspaceName: workstream.workspaceName,
        branch: workstream.branch,
        worktreePath: workstream.worktreePath,
        repositoryRoot: workstream.repositoryRoot,
        workstream,
        baseline: workstream.baseline,
        recentSessions: workstream.recentSessions,
        latestCheckpoints: workstream.latestCheckpoints,
        insights: workstream.insights,
        handoffTimeline,
        promptText: lines.join('\n')
    };
}
