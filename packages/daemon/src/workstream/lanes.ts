import type { BranchLaneSummary, Graph, WorkstreamBaselineComparison } from '@0ctx/core';
import path from 'path';
import { getGitHeadState, getWorkingTreeState, listGitWorktrees, safeGit, safeGitDefaultBranch } from './git';
import { deriveHandoffReadiness, deriveWorkstreamState } from './state';

function resolveWorkstreamCheckoutState(
    repositoryRoot: string | null,
    branch: string | null,
    referenceWorktreePath: string | null,
    fallbackCurrentRoot: string | null
): {
    checkedOutWorktreePaths: string[];
    checkedOutHere: boolean | null;
    checkedOutElsewhere: boolean | null;
} {
    if (!repositoryRoot || !branch) {
        return { checkedOutWorktreePaths: [], checkedOutHere: null, checkedOutElsewhere: null };
    }

    const worktrees = listGitWorktrees(repositoryRoot) ?? [];
    const checkedOutWorktreePaths = [...new Set(
        worktrees.filter((entry) => entry.branch === branch).map((entry) => entry.path)
    )];

    const referencePaths = new Set<string>();
    if (referenceWorktreePath) {
        referencePaths.add(path.resolve(referenceWorktreePath));
    } else if (fallbackCurrentRoot) {
        referencePaths.add(path.resolve(fallbackCurrentRoot));
    }

    const checkedOutHere = referencePaths.size > 0
        ? checkedOutWorktreePaths.some((entry) => referencePaths.has(path.resolve(entry)))
        : null;
    const checkedOutElsewhere = checkedOutWorktreePaths.length > 0
        ? checkedOutWorktreePaths.some((entry) => !referencePaths.has(path.resolve(entry)))
        : false;

    return { checkedOutWorktreePaths, checkedOutHere, checkedOutElsewhere };
}

export function compareAgainstBaselineBranch(
    repositoryRoot: string | null,
    branch: string | null
): WorkstreamBaselineComparison | null {
    if (!repositoryRoot) return null;
    const baselineBranch = safeGitDefaultBranch(repositoryRoot);
    if (!baselineBranch) {
        return {
            branch: null,
            repositoryRoot,
            comparable: false,
            sameBranch: false,
            aheadCount: null,
            behindCount: null,
            mergeBaseSha: null,
            summary: 'No default branch could be determined for this repository.'
        };
    }
    if (!branch) {
        return {
            branch: baselineBranch,
            repositoryRoot,
            comparable: false,
            sameBranch: false,
            aheadCount: null,
            behindCount: null,
            mergeBaseSha: null,
            summary: `Default branch is ${baselineBranch}, but the current workstream has no branch name.`
        };
    }
    if (branch === baselineBranch) {
        return {
            branch: baselineBranch,
            repositoryRoot,
            comparable: true,
            sameBranch: true,
            aheadCount: 0,
            behindCount: 0,
            mergeBaseSha: safeGit(repositoryRoot, ['rev-parse', branch]),
            summary: `${branch} is the default branch for this repository.`
        };
    }

    const countText = safeGit(repositoryRoot, ['rev-list', '--left-right', '--count', `${branch}...${baselineBranch}`]);
    const counts = countText ? countText.split(/\s+/).map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry)) : [];
    const aheadCount = counts.length >= 2 ? counts[0] : null;
    const behindCount = counts.length >= 2 ? counts[1] : null;
    const mergeBaseSha = safeGit(repositoryRoot, ['merge-base', branch, baselineBranch]);

    let summary = `Git divergence against ${baselineBranch} could not be computed.`;
    if (aheadCount !== null && behindCount !== null) {
        summary = aheadCount === 0 && behindCount === 0
            ? `${branch} is in sync with ${baselineBranch}.`
            : aheadCount > 0 && behindCount === 0
                ? `${branch} is ${aheadCount} commit${aheadCount === 1 ? '' : 's'} ahead of ${baselineBranch}.`
                : aheadCount === 0 && behindCount > 0
                    ? `${branch} is ${behindCount} commit${behindCount === 1 ? '' : 's'} behind ${baselineBranch}.`
                    : `${branch} is ${aheadCount} ahead and ${behindCount} behind ${baselineBranch}.`;
    }

    return {
        branch: baselineBranch,
        repositoryRoot,
        comparable: aheadCount !== null && behindCount !== null,
        sameBranch: false,
        aheadCount,
        behindCount,
        mergeBaseSha,
        summary
    };
}

function resolveWorkstreamRepositoryRoot(
    graph: Graph,
    contextId: string,
    lane: BranchLaneSummary,
    contextPaths: string[]
): string | null {
    const branchSessions = graph.listBranchSessions(contextId, lane.branch, { worktreePath: lane.worktreePath, limit: 10 });
    const sessionRoot = branchSessions.find((session) => typeof session.repositoryRoot === 'string' && session.repositoryRoot.trim().length > 0)?.repositoryRoot ?? null;
    const preferred = sessionRoot ?? lane.worktreePath ?? contextPaths.find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0) ?? null;
    if (!preferred) return null;
    try {
        return path.resolve(preferred);
    } catch {
        return null;
    }
}

export function enrichWorkstreamLane(
    graph: Graph,
    contextId: string,
    contextPaths: string[],
    lane: BranchLaneSummary
): BranchLaneSummary {
    const repositoryRoot = resolveWorkstreamRepositoryRoot(graph, contextId, lane, contextPaths);
    if (!repositoryRoot) {
        const fallbackReadiness = deriveHandoffReadiness({ stateKind: 'unknown', checkpointCount: lane.checkpointCount });
        return {
            ...lane,
            repositoryRoot: null,
            currentHeadSha: null,
            currentHeadRef: null,
            isDetachedHead: null,
            headDiffersFromCaptured: null,
            upstream: null,
            aheadCount: null,
            behindCount: null,
            mergeBaseSha: null,
            isCurrent: null,
            checkedOutWorktreePaths: [],
            checkedOutHere: null,
            checkedOutElsewhere: null,
            hasUncommittedChanges: null,
            stagedChangeCount: null,
            unstagedChangeCount: null,
            untrackedCount: null,
            baseline: null,
            stateKind: 'unknown',
            stateSummary: 'Workstream state could not be determined.',
            stateActionHint: 'Open this repo and refresh 0ctx before relying on this workstream.',
            handoffReadiness: fallbackReadiness.readiness,
            handoffSummary: fallbackReadiness.summary
        };
    }

    const gitHead = getGitHeadState(repositoryRoot);
    const currentBranch = gitHead?.branch ?? null;
    const currentRoot = safeGit(repositoryRoot, ['rev-parse', '--show-toplevel']);
    const upstream = safeGit(repositoryRoot, ['rev-parse', '--abbrev-ref', `${lane.branch}@{upstream}`]);
    const countText = upstream ? safeGit(repositoryRoot, ['rev-list', '--left-right', '--count', `${lane.branch}...${upstream}`]) : null;
    const counts = countText ? countText.split(/\s+/).map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry)) : [];
    const mergeBaseSha = upstream ? safeGit(repositoryRoot, ['merge-base', lane.branch, upstream]) : null;
    const normalizedWorktree = lane.worktreePath ? path.resolve(lane.worktreePath) : null;
    const normalizedCurrentRoot = currentRoot ? path.resolve(currentRoot) : null;
    const workingTreeState = getWorkingTreeState(repositoryRoot);
    const checkoutState = resolveWorkstreamCheckoutState(repositoryRoot, lane.branch, normalizedWorktree, normalizedCurrentRoot);
    const baseline = compareAgainstBaselineBranch(repositoryRoot, lane.branch);
    const state = deriveWorkstreamState({
        branch: lane.branch,
        isDetachedHead: gitHead?.detached ?? null,
        headDiffersFromCaptured: gitHead?.headSha && lane.lastCommitSha ? gitHead.headSha !== lane.lastCommitSha : null,
        checkedOutHere: checkoutState.checkedOutHere,
        checkedOutElsewhere: checkoutState.checkedOutElsewhere,
        hasUncommittedChanges: workingTreeState?.hasUncommittedChanges ?? null,
        aheadCount: counts.length >= 2 ? counts[0] : null,
        behindCount: counts.length >= 2 ? counts[1] : null,
        baseline,
        upstream,
        isCurrent: currentBranch ? currentBranch === lane.branch && (!normalizedWorktree || normalizedCurrentRoot === normalizedWorktree) : null
    });
    const handoff = deriveHandoffReadiness({ stateKind: state.kind, checkpointCount: lane.checkpointCount });

    return {
        ...lane,
        repositoryRoot,
        currentHeadSha: gitHead?.headSha ?? null,
        currentHeadRef: gitHead?.headRef ?? null,
        isDetachedHead: gitHead?.detached ?? null,
        headDiffersFromCaptured: gitHead?.headSha && lane.lastCommitSha ? gitHead.headSha !== lane.lastCommitSha : null,
        upstream,
        aheadCount: counts.length >= 2 ? counts[0] : null,
        behindCount: counts.length >= 2 ? counts[1] : null,
        mergeBaseSha,
        isCurrent: currentBranch ? currentBranch === lane.branch && (!normalizedWorktree || normalizedCurrentRoot === normalizedWorktree) : null,
        checkedOutWorktreePaths: checkoutState.checkedOutWorktreePaths,
        checkedOutHere: checkoutState.checkedOutHere,
        checkedOutElsewhere: checkoutState.checkedOutElsewhere,
        hasUncommittedChanges: workingTreeState?.hasUncommittedChanges ?? null,
        stagedChangeCount: workingTreeState?.stagedChangeCount ?? null,
        unstagedChangeCount: workingTreeState?.unstagedChangeCount ?? null,
        untrackedCount: workingTreeState?.untrackedCount ?? null,
        baseline,
        stateKind: state.kind,
        stateSummary: state.summary,
        stateActionHint: state.actionHint,
        handoffReadiness: handoff.readiness,
        handoffSummary: handoff.summary
    };
}

export function resolveCurrentWorkstreamFromContextPaths(contextPaths: string[]): {
    branch: string | null;
    worktreePath: string | null;
    repositoryRoot: string | null;
    currentHeadSha: string | null;
    currentHeadRef: string | null;
    isDetachedHead: boolean | null;
} {
    for (const candidate of contextPaths) {
        if (typeof candidate !== 'string' || candidate.trim().length === 0) continue;
        try {
            const resolved = path.resolve(candidate);
            const repositoryRoot = safeGit(resolved, ['rev-parse', '--show-toplevel']);
            if (!repositoryRoot) continue;
            const gitHead = getGitHeadState(repositoryRoot);
            return {
                branch: gitHead?.branch ?? null,
                worktreePath: repositoryRoot,
                repositoryRoot,
                currentHeadSha: gitHead?.headSha ?? null,
                currentHeadRef: gitHead?.headRef ?? null,
                isDetachedHead: gitHead?.detached ?? null
            };
        } catch {
            continue;
        }
    }

    return {
        branch: null,
        worktreePath: null,
        repositoryRoot: null,
        currentHeadSha: null,
        currentHeadRef: null,
        isDetachedHead: null
    };
}
