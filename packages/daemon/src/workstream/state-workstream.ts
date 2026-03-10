import type { WorkstreamBaselineComparison } from '@0ctx/core';

export function deriveWorkstreamState(
    data: {
        branch: string | null;
        isDetachedHead: boolean | null;
        headDiffersFromCaptured: boolean | null;
        checkedOutHere?: boolean | null;
        checkedOutElsewhere?: boolean | null;
        hasUncommittedChanges: boolean | null;
        aheadCount: number | null;
        behindCount: number | null;
        baseline?: WorkstreamBaselineComparison | null;
        upstream?: string | null;
        isCurrent?: boolean | null;
    }
): {
    kind: 'current' | 'ahead' | 'behind' | 'diverged' | 'detached' | 'drifted' | 'dirty' | 'elsewhere' | 'isolated' | 'unknown';
    summary: string;
    actionHint: string | null;
} {
    if (data.isDetachedHead) {
        return { kind: 'detached', summary: 'Detached HEAD. This checkout is not on a named branch.', actionHint: 'Create or switch to a named branch before relying on this workstream.' };
    }
    if (data.checkedOutHere !== true && data.checkedOutElsewhere === true) {
        return { kind: 'elsewhere', summary: 'Checked out in another worktree, not in the current checkout.', actionHint: 'Open the checked-out worktree before continuing on this workstream.' };
    }
    if (data.headDiffersFromCaptured) {
        return { kind: 'drifted', summary: 'Current HEAD differs from the last captured commit.', actionHint: 'Capture a fresh session or checkpoint so memory matches the current HEAD.' };
    }
    if (data.hasUncommittedChanges) {
        return { kind: 'dirty', summary: 'Working tree has local uncommitted changes.', actionHint: 'Commit or checkpoint local changes before handing this workstream to another agent.' };
    }
    if (typeof data.aheadCount === 'number' && typeof data.behindCount === 'number' && data.upstream) {
        if (data.aheadCount > 0 && data.behindCount > 0) {
            return { kind: 'diverged', summary: `Diverged from upstream (${data.aheadCount} ahead / ${data.behindCount} behind).`, actionHint: 'Compare and reconcile this workstream with upstream before continuing.' };
        }
        if (data.aheadCount > 0) {
            return { kind: 'ahead', summary: `Ahead of upstream by ${data.aheadCount} commit${data.aheadCount === 1 ? '' : 's'}.`, actionHint: 'Create a checkpoint or merge this workstream before handing it off.' };
        }
        if (data.behindCount > 0) {
            return { kind: 'behind', summary: `Behind upstream by ${data.behindCount} commit${data.behindCount === 1 ? '' : 's'}.`, actionHint: 'Update from upstream before relying on this workstream context.' };
        }
    }
    if (data.baseline?.comparable && typeof data.baseline.aheadCount === 'number' && typeof data.baseline.behindCount === 'number') {
        if (data.baseline.aheadCount > 0 && data.baseline.behindCount > 0) {
            return { kind: 'diverged', summary: `Diverged from ${data.baseline.branch || 'the default branch'} (${data.baseline.aheadCount} ahead / ${data.baseline.behindCount} behind).`, actionHint: `Compare and reconcile this workstream with ${data.baseline.branch || 'the default branch'} before continuing.` };
        }
        if (data.baseline.aheadCount > 0) {
            return { kind: 'ahead', summary: `Ahead of ${data.baseline.branch || 'the default branch'} by ${data.baseline.aheadCount} commit${data.baseline.aheadCount === 1 ? '' : 's'}.`, actionHint: 'Create a checkpoint or merge this workstream before handing it off.' };
        }
        if (data.baseline.behindCount > 0) {
            return { kind: 'behind', summary: `Behind ${data.baseline.branch || 'the default branch'} by ${data.baseline.behindCount} commit${data.baseline.behindCount === 1 ? '' : 's'}.`, actionHint: `Update from ${data.baseline.branch || 'the default branch'} before relying on this workstream context.` };
        }
    }
    if (Boolean(data.branch) && !data.upstream && !(data.baseline?.comparable)) {
        return { kind: 'isolated', summary: 'Local-only workstream with no upstream or baseline comparison.', actionHint: 'Create a checkpoint before handing this workstream off or comparing it elsewhere.' };
    }
    if (data.isCurrent === true || data.checkedOutHere === true || Boolean(data.branch)) {
        return { kind: 'current', summary: 'Current local workstream is in sync with captured state.', actionHint: null };
    }
    return { kind: 'unknown', summary: 'Workstream state could not be determined.', actionHint: 'Open this repo and refresh 0ctx before relying on this workstream.' };
}

export function deriveHandoffReadiness(options: {
    stateKind?: 'current' | 'ahead' | 'behind' | 'diverged' | 'detached' | 'drifted' | 'dirty' | 'elsewhere' | 'isolated' | 'unknown';
    checkpointCount?: number | null;
}): {
    readiness: 'ready' | 'review' | 'blocked';
    summary: string;
    blockers: string[];
    reviewItems: string[];
} {
    const checkpointCount = typeof options.checkpointCount === 'number' ? options.checkpointCount : 0;
    switch (options.stateKind) {
        case 'current':
            return { readiness: 'ready', summary: checkpointCount > 0 ? 'Ready to continue. The checkout matches captured state and a recent checkpoint exists.' : 'Ready to continue. The checkout matches captured state; create a checkpoint before handoff if you need a durable restore point.', blockers: [], reviewItems: checkpointCount > 0 ? [] : ['Create a checkpoint before handing this workstream to another agent.'] };
        case 'ahead':
            return { readiness: 'ready', summary: checkpointCount > 0 ? 'Ready to continue locally. This workstream is ahead and already has checkpoint coverage.' : 'Ready to continue locally, but create a checkpoint before handing this workstream to another agent.', blockers: [], reviewItems: checkpointCount > 0 ? [] : ['Create a checkpoint before handing this ahead workstream to another agent.'] };
        case 'isolated':
            return { readiness: 'review', summary: checkpointCount > 0 ? 'Review before handoff. This workstream is local-only and should be compared or checkpointed deliberately.' : 'Review before handoff. This local-only workstream has no baseline and no checkpoint coverage yet.', blockers: [], reviewItems: checkpointCount > 0 ? ['This workstream has no upstream or baseline; compare it deliberately before handoff.'] : ['This workstream has no upstream or baseline.', 'Create a checkpoint before handoff.'] };
        case 'dirty':
        case 'drifted':
        case 'behind':
        case 'diverged':
            return {
                readiness: 'review',
                summary: 'Review git state before handoff. The current checkout and recorded memory are no longer cleanly aligned.',
                blockers: [],
                reviewItems: options.stateKind === 'dirty'
                    ? ['Commit or checkpoint local changes before handoff.']
                    : options.stateKind === 'drifted'
                        ? ['Capture a fresh session or checkpoint so memory matches the current HEAD.']
                        : options.stateKind === 'behind'
                            ? ['Update from upstream or the baseline branch before handoff.']
                            : ['Reconcile divergence before handing work across agents.']
            };
        case 'detached':
        case 'elsewhere':
        case 'unknown':
        default:
            return {
                readiness: 'blocked',
                summary: 'Do not hand this workstream off yet. Resolve checkout state first so another agent does not start from the wrong place.',
                blockers: options.stateKind === 'detached'
                    ? ['This checkout is on detached HEAD and is not attached to a named branch.']
                    : options.stateKind === 'elsewhere'
                        ? ['This workstream is checked out in another worktree, not here.']
                        : ['0ctx could not determine the checkout state for this workstream.'],
                reviewItems: []
            };
    }
}
