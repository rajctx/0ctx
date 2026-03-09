import type { AgentSessionSummary, BranchLaneSummary, CheckpointSummary, Graph, InsightSummary, WorkstreamBrief } from '@0ctx/core';
import path from 'path';
import { formatRelativeAge, humanizeLabel, parsePositiveInt, truncateBriefLine } from './format';
import { getGitHeadState, getWorkingTreeState } from './git';
import { compareAgainstBaselineBranch, enrichWorkstreamLane, resolveCurrentWorkstreamFromContextPaths } from './lanes';
import { deriveHandoffReadiness, deriveWorkstreamState } from './state';

export function buildWorkstreamBrief(
    graph: Graph,
    contextId: string,
    options: {
        branch?: string | null;
        worktreePath?: string | null;
        sessionLimit?: number;
        checkpointLimit?: number;
    }
): WorkstreamBrief {
    const context = graph.getContext(contextId);
    if (!context) {
        throw new Error(`Context ${contextId} not found`);
    }
    const contextPaths = Array.isArray(context.paths)
        ? context.paths.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [];
    const inferredCurrent = resolveCurrentWorkstreamFromContextPaths(contextPaths);

    const branch = typeof options.branch === 'string' && options.branch.trim().length > 0 ? options.branch.trim() : inferredCurrent.branch;
    const worktreePath = typeof options.worktreePath === 'string' && options.worktreePath.trim().length > 0 ? options.worktreePath.trim() : inferredCurrent.worktreePath;
    const sessionLimit = parsePositiveInt(options.sessionLimit, 3, 20);
    const checkpointLimit = parsePositiveInt(options.checkpointLimit, 2, 20);

    let lane: BranchLaneSummary | null = null;
    let recentSessions: AgentSessionSummary[] = [];
    let latestCheckpoints: CheckpointSummary[] = [];
    let insights: InsightSummary[] = [];

    if (branch) {
        const lanes = graph.listBranchLanes(contextId, 200).map((entry) => enrichWorkstreamLane(graph, contextId, contextPaths, entry));
        lane = lanes.find((entry) => entry.branch === branch && (!worktreePath || entry.worktreePath === worktreePath))
            ?? lanes.find((entry) => entry.branch === branch)
            ?? null;

        recentSessions = graph.listBranchSessions(contextId, branch, { worktreePath, limit: sessionLimit });
        if (recentSessions.length === 0 && worktreePath) {
            recentSessions = graph.listBranchSessions(contextId, branch, { limit: sessionLimit });
        }

        latestCheckpoints = graph.listBranchCheckpoints(contextId, branch, { worktreePath, limit: checkpointLimit });
        if (latestCheckpoints.length === 0 && worktreePath) {
            latestCheckpoints = graph.listBranchCheckpoints(contextId, branch, { limit: checkpointLimit });
        }

        insights = graph.listWorkstreamInsights(contextId, { branch, worktreePath, limit: 4 });
        if (insights.length === 0 && worktreePath) {
            insights = graph.listWorkstreamInsights(contextId, { branch, limit: 4 });
        }
    }

    const repositoryRoot = lane?.repositoryRoot ?? inferredCurrent.repositoryRoot ?? contextPaths[0] ?? null;
    const gitHead = getGitHeadState(repositoryRoot);
    const workingTreeState = getWorkingTreeState(repositoryRoot);
    const baseline = compareAgainstBaselineBranch(repositoryRoot, branch);
    const currentHeadSha = lane?.currentHeadSha ?? gitHead?.headSha ?? inferredCurrent.currentHeadSha ?? null;
    const currentHeadRef = lane?.currentHeadRef ?? gitHead?.headRef ?? inferredCurrent.currentHeadRef ?? null;
    const isDetachedHead = lane?.isDetachedHead ?? gitHead?.detached ?? inferredCurrent.isDetachedHead ?? null;
    const headDiffersFromCaptured = lane?.headDiffersFromCaptured ?? (currentHeadSha && lane?.lastCommitSha ? currentHeadSha !== lane.lastCommitSha : null);
    const isCurrent = lane?.isCurrent ?? (repositoryRoot ? Boolean(branch && gitHead?.branch === branch && (!worktreePath || path.resolve(repositoryRoot) === path.resolve(worktreePath))) : null);
    const checkoutState = lane
        ? { checkedOutWorktreePaths: lane.checkedOutWorktreePaths ?? [], checkedOutHere: lane.checkedOutHere ?? null, checkedOutElsewhere: lane.checkedOutElsewhere ?? null }
        : { checkedOutWorktreePaths: [], checkedOutHere: null, checkedOutElsewhere: null };
    const hasUncommittedChanges = lane?.hasUncommittedChanges ?? workingTreeState?.hasUncommittedChanges ?? null;
    const stagedChangeCount = lane?.stagedChangeCount ?? workingTreeState?.stagedChangeCount ?? null;
    const unstagedChangeCount = lane?.unstagedChangeCount ?? workingTreeState?.unstagedChangeCount ?? null;
    const untrackedCount = lane?.untrackedCount ?? workingTreeState?.untrackedCount ?? null;
    const state = deriveWorkstreamState({
        branch,
        isDetachedHead,
        headDiffersFromCaptured,
        checkedOutHere: checkoutState.checkedOutHere,
        checkedOutElsewhere: checkoutState.checkedOutElsewhere,
        hasUncommittedChanges,
        aheadCount: lane?.aheadCount ?? null,
        behindCount: lane?.behindCount ?? null,
        baseline,
        upstream: lane?.upstream ?? null,
        isCurrent
    });
    const handoff = deriveHandoffReadiness({ stateKind: state.kind, checkpointCount: latestCheckpoints.length > 0 ? latestCheckpoints.length : (lane?.checkpointCount ?? 0) });

    const lines = [
        '0ctx project memory',
        `Workspace: ${context.name}`,
        `Current workstream: ${branch ?? (isDetachedHead && currentHeadSha ? `detached HEAD @ ${currentHeadSha.slice(0, 12)}` : 'no git branch detected')}`,
        `Status: ${state.summary}`,
        `Handoff: ${handoff.summary}`
    ];
    if (state.actionHint) lines.push(`Recommended next step: ${state.actionHint}`);
    if (handoff.blockers.length > 0) lines.push(`Blockers: ${handoff.blockers.join(' ')}`);
    if (handoff.reviewItems.length > 0) lines.push(`Review: ${handoff.reviewItems.join(' ')}`);

    if (lane) {
        const laneFacts = [
            typeof lane.sessionCount === 'number' ? `${lane.sessionCount} sessions` : null,
            typeof lane.checkpointCount === 'number' ? `${lane.checkpointCount} checkpoints` : null,
            lane.lastAgent ? `last agent ${lane.lastAgent}` : null
        ].filter((value): value is string => Boolean(value));
        if (laneFacts.length > 0) lines.push(`Tracked activity: ${laneFacts.join(', ')}.`);
        if (isDetachedHead && currentHeadSha) {
            lines.push(`Git state: detached HEAD at ${currentHeadSha.slice(0, 12)}.`);
        } else if (lane.upstream && typeof lane.aheadCount === 'number' && typeof lane.behindCount === 'number') {
            const gitState = lane.aheadCount === 0 && lane.behindCount === 0
                ? `in sync with ${lane.upstream}`
                : lane.aheadCount > 0 && lane.behindCount === 0
                    ? `${lane.aheadCount} commit${lane.aheadCount === 1 ? '' : 's'} ahead of ${lane.upstream}`
                    : lane.aheadCount === 0 && lane.behindCount > 0
                        ? `${lane.behindCount} commit${lane.behindCount === 1 ? '' : 's'} behind ${lane.upstream}`
                        : `${lane.aheadCount} ahead / ${lane.behindCount} behind ${lane.upstream}`;
            lines.push(`Git state: ${gitState}.`);
        } else if (state.kind === 'isolated') {
            lines.push('Git state: local-only workstream without upstream or baseline comparison.');
        } else if (state.kind === 'current' && isCurrent === true) {
            lines.push('Git state: current local workstream.');
        }
    } else if (state.kind === 'isolated') {
        lines.push('Git state: local-only workstream without upstream or baseline comparison.');
    }

    if (branch) {
        if (checkoutState.checkedOutHere === true && checkoutState.checkedOutElsewhere === true) {
            const elsewhereCount = Math.max(0, checkoutState.checkedOutWorktreePaths.length - 1);
            lines.push(`Checkout: this workstream is checked out here and in ${elsewhereCount} other worktree${elsewhereCount === 1 ? '' : 's'}.`);
        } else if (checkoutState.checkedOutHere === true) {
            lines.push('Checkout: this workstream is checked out here.');
        } else if (checkoutState.checkedOutElsewhere === true) {
            const labels = checkoutState.checkedOutWorktreePaths.slice(0, 2).join(', ');
            const suffix = checkoutState.checkedOutWorktreePaths.length > 2 ? '...' : '';
            lines.push(`Checkout: this workstream is checked out elsewhere (${labels}${suffix}).`);
        } else if (checkoutState.checkedOutWorktreePaths.length === 0) {
            lines.push('Checkout: this workstream is not currently checked out in a known worktree.');
        }
    }

    if (!lane && isDetachedHead && currentHeadSha) lines.push(`Git state: detached HEAD at ${currentHeadSha.slice(0, 12)}.`);
    if (currentHeadRef) lines.push(`Checked-out ref: ${currentHeadRef}.`);
    if (headDiffersFromCaptured && lane?.lastCommitSha && currentHeadSha) {
        lines.push(`Capture drift: last captured commit ${lane.lastCommitSha.slice(0, 12)} differs from checked-out HEAD ${currentHeadSha.slice(0, 12)}.`);
    }

    if (hasUncommittedChanges) {
        const dirtyFacts = [
            typeof stagedChangeCount === 'number' && stagedChangeCount > 0 ? `${stagedChangeCount} staged` : null,
            typeof unstagedChangeCount === 'number' && unstagedChangeCount > 0 ? `${unstagedChangeCount} unstaged` : null,
            typeof untrackedCount === 'number' && untrackedCount > 0 ? `${untrackedCount} untracked` : null
        ].filter((value): value is string => Boolean(value));
        if (dirtyFacts.length > 0) lines.push(`Local changes: ${dirtyFacts.join(', ')}.`);
    }

    if (baseline?.summary) lines.push(`Baseline: ${baseline.summary}`);
    if (recentSessions.length > 0) {
        lines.push('', 'Recent sessions:');
        for (const session of recentSessions) {
            lines.push(`- ${session.agent ?? 'agent'} · ${formatRelativeAge(session.lastTurnAt)} · ${truncateBriefLine(session.summary)}`);
        }
    }
    if (latestCheckpoints.length > 0) {
        lines.push('', 'Latest checkpoints:');
        for (const checkpoint of latestCheckpoints) {
            const label = checkpoint.name?.trim().length ? checkpoint.name : checkpoint.summary;
            lines.push(`- ${truncateBriefLine(label)} · ${formatRelativeAge(checkpoint.createdAt)}`);
        }
    }
    if (insights.length > 0) {
        lines.push('', 'Reviewed insights:');
        for (const insight of insights) {
            lines.push(`- ${humanizeLabel(insight.type)} · ${truncateBriefLine(insight.content)}`);
        }
    }
    if (recentSessions.length === 0 && latestCheckpoints.length === 0 && insights.length === 0) {
        lines.push('', 'No captured sessions or checkpoints for this workstream yet.');
    }

    return {
        contextId,
        workspaceName: context.name,
        branch,
        worktreePath,
        repositoryRoot,
        currentHeadSha,
        currentHeadRef,
        isDetachedHead,
        headDiffersFromCaptured,
        tracked: Boolean(lane),
        sessionCount: lane?.sessionCount ?? recentSessions.length,
        checkpointCount: lane?.checkpointCount ?? latestCheckpoints.length,
        lastAgent: lane?.lastAgent ?? null,
        lastCommitSha: lane?.lastCommitSha ?? null,
        lastActivityAt: lane?.lastActivityAt ?? null,
        upstream: lane?.upstream ?? null,
        aheadCount: lane?.aheadCount ?? null,
        behindCount: lane?.behindCount ?? null,
        mergeBaseSha: lane?.mergeBaseSha ?? null,
        isCurrent,
        checkedOutWorktreePaths: checkoutState.checkedOutWorktreePaths,
        checkedOutHere: checkoutState.checkedOutHere,
        checkedOutElsewhere: checkoutState.checkedOutElsewhere,
        hasUncommittedChanges,
        stagedChangeCount,
        unstagedChangeCount,
        untrackedCount,
        baseline,
        stateKind: state.kind,
        stateSummary: state.summary,
        stateActionHint: state.actionHint,
        handoffReadiness: handoff.readiness,
        handoffSummary: handoff.summary,
        handoffBlockers: handoff.blockers,
        handoffReviewItems: handoff.reviewItems,
        recentSessions,
        latestCheckpoints,
        insights,
        contextText: lines.join('\n')
    };
}
