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
        return {
            kind: 'detached',
            summary: 'Detached HEAD. This checkout is not on a named branch.',
            actionHint: 'Create or switch to a named branch before relying on this workstream.'
        };
    }

    if (data.checkedOutHere !== true && data.checkedOutElsewhere === true) {
        return {
            kind: 'elsewhere',
            summary: 'Checked out in another worktree, not in the current checkout.',
            actionHint: 'Open the checked-out worktree before continuing on this workstream.'
        };
    }

    if (data.headDiffersFromCaptured) {
        return {
            kind: 'drifted',
            summary: 'Current HEAD differs from the last captured commit.',
            actionHint: 'Capture a fresh session or checkpoint so memory matches the current HEAD.'
        };
    }

    if (data.hasUncommittedChanges) {
        return {
            kind: 'dirty',
            summary: 'Working tree has local uncommitted changes.',
            actionHint: 'Commit or checkpoint local changes before handing this workstream to another agent.'
        };
    }

    if (typeof data.aheadCount === 'number' && typeof data.behindCount === 'number' && data.upstream) {
        if (data.aheadCount > 0 && data.behindCount > 0) {
            return {
                kind: 'diverged',
                summary: `Diverged from upstream (${data.aheadCount} ahead / ${data.behindCount} behind).`,
                actionHint: 'Compare and reconcile this workstream with upstream before continuing.'
            };
        }
        if (data.aheadCount > 0) {
            return {
                kind: 'ahead',
                summary: `Ahead of upstream by ${data.aheadCount} commit${data.aheadCount === 1 ? '' : 's'}.`,
                actionHint: 'Create a checkpoint or merge this workstream before handing it off.'
            };
        }
        if (data.behindCount > 0) {
            return {
                kind: 'behind',
                summary: `Behind upstream by ${data.behindCount} commit${data.behindCount === 1 ? '' : 's'}.`,
                actionHint: 'Update from upstream before relying on this workstream context.'
            };
        }
    }

    if (data.baseline?.comparable) {
        if (typeof data.baseline.aheadCount === 'number' && typeof data.baseline.behindCount === 'number') {
            if (data.baseline.aheadCount > 0 && data.baseline.behindCount > 0) {
                return {
                    kind: 'diverged',
                    summary: `Diverged from ${data.baseline.branch || 'the default branch'} (${data.baseline.aheadCount} ahead / ${data.baseline.behindCount} behind).`,
                    actionHint: `Compare and reconcile this workstream with ${data.baseline.branch || 'the default branch'} before continuing.`
                };
            }
            if (data.baseline.aheadCount > 0) {
                return {
                    kind: 'ahead',
                    summary: `Ahead of ${data.baseline.branch || 'the default branch'} by ${data.baseline.aheadCount} commit${data.baseline.aheadCount === 1 ? '' : 's'}.`,
                    actionHint: 'Create a checkpoint or merge this workstream before handing it off.'
                };
            }
            if (data.baseline.behindCount > 0) {
                return {
                    kind: 'behind',
                    summary: `Behind ${data.baseline.branch || 'the default branch'} by ${data.baseline.behindCount} commit${data.baseline.behindCount === 1 ? '' : 's'}.`,
                    actionHint: `Update from ${data.baseline.branch || 'the default branch'} before relying on this workstream context.`
                };
            }
        }
    }

    if (Boolean(data.branch) && !data.upstream && !(data.baseline?.comparable)) {
        return {
            kind: 'isolated',
            summary: 'Local-only workstream with no upstream or baseline comparison.',
            actionHint: 'Create a checkpoint before handing this workstream off or comparing it elsewhere.'
        };
    }

    if (data.isCurrent === true || data.checkedOutHere === true || Boolean(data.branch)) {
        return {
            kind: 'current',
            summary: 'Current local workstream is in sync with captured state.',
            actionHint: null
        };
    }

    return {
        kind: 'unknown',
        summary: 'Workstream state could not be determined.',
        actionHint: 'Open this repo and refresh 0ctx before relying on this workstream.'
    };
}

export function deriveHandoffReadiness(options: {
    stateKind?: 'current' | 'ahead' | 'behind' | 'diverged' | 'detached' | 'drifted' | 'dirty' | 'elsewhere' | 'isolated' | 'unknown';
    checkpointCount?: number | null;
}): {
    readiness: 'ready' | 'review' | 'blocked';
    summary: string;
} {
    const checkpointCount = typeof options.checkpointCount === 'number' ? options.checkpointCount : 0;
    switch (options.stateKind) {
        case 'current':
            return {
                readiness: 'ready',
                summary: checkpointCount > 0
                    ? 'Ready to continue. The checkout matches captured state and a recent checkpoint exists.'
                    : 'Ready to continue. The checkout matches captured state; create a checkpoint before handoff if you need a durable restore point.'
            };
        case 'ahead':
            return {
                readiness: 'ready',
                summary: checkpointCount > 0
                    ? 'Ready to continue locally. This workstream is ahead and already has checkpoint coverage.'
                    : 'Ready to continue locally, but create a checkpoint before handing this workstream to another agent.'
            };
        case 'isolated':
            return {
                readiness: 'review',
                summary: checkpointCount > 0
                    ? 'Review before handoff. This workstream is local-only and should be compared or checkpointed deliberately.'
                    : 'Review before handoff. This local-only workstream has no baseline and no checkpoint coverage yet.'
            };
        case 'dirty':
        case 'drifted':
        case 'behind':
        case 'diverged':
            return {
                readiness: 'review',
                summary: 'Review git state before handoff. The current checkout and recorded memory are no longer cleanly aligned.'
            };
        case 'detached':
        case 'elsewhere':
        case 'unknown':
        default:
            return {
                readiness: 'blocked',
                summary: 'Do not hand this workstream off yet. Resolve checkout state first so another agent does not start from the wrong place.'
            };
    }
}

export function deriveWorkstreamComparisonState(options: {
    sameRepository: boolean;
    comparable: boolean;
    sourceBranch: string | null;
    targetBranch: string | null;
    sourceAheadCount: number | null;
    targetAheadCount: number | null;
    mergeBaseSha: string | null;
    sourceStateSummary?: string | null;
    targetStateSummary?: string | null;
    sourceStateActionHint?: string | null;
    targetStateActionHint?: string | null;
    sourceHandoffReadiness?: 'ready' | 'review' | 'blocked';
    targetHandoffReadiness?: 'ready' | 'review' | 'blocked';
    sourceHandoffSummary?: string | null;
    targetHandoffSummary?: string | null;
}): {
    kind: 'aligned' | 'source_ahead' | 'target_ahead' | 'diverged' | 'different_repository' | 'not_comparable';
    readiness: 'ready' | 'review' | 'blocked';
    summary: string;
    actionHint: string | null;
} {
    const sourceLabel = options.sourceBranch || 'source workstream';
    const targetLabel = options.targetBranch || 'target workstream';
    const sourceBlocked = options.sourceHandoffReadiness === 'blocked';
    const targetBlocked = options.targetHandoffReadiness === 'blocked';
    const sourceReview = options.sourceHandoffReadiness === 'review';
    const targetReview = options.targetHandoffReadiness === 'review';

    const blockedHint = () => {
        if (sourceBlocked && options.sourceStateActionHint) return options.sourceStateActionHint;
        if (targetBlocked && options.targetStateActionHint) return options.targetStateActionHint;
        if (sourceBlocked) return `Resolve ${sourceLabel} checkout state before relying on this comparison.`;
        if (targetBlocked) return `Resolve ${targetLabel} checkout state before relying on this comparison.`;
        return null;
    };

    const reviewHint = () => {
        if (sourceReview && options.sourceStateActionHint) return options.sourceStateActionHint;
        if (targetReview && options.targetStateActionHint) return options.targetStateActionHint;
        if (sourceReview) return `Review ${sourceLabel} before handing work across this comparison.`;
        if (targetReview) return `Review ${targetLabel} before handing work across this comparison.`;
        return null;
    };

    const withReadiness = (
        base: {
            kind: 'aligned' | 'source_ahead' | 'target_ahead' | 'diverged' | 'different_repository' | 'not_comparable';
            summary: string;
            actionHint: string | null;
        }
    ): {
        kind: 'aligned' | 'source_ahead' | 'target_ahead' | 'diverged' | 'different_repository' | 'not_comparable';
        readiness: 'ready' | 'review' | 'blocked';
        summary: string;
        actionHint: string | null;
    } => {
        if (sourceBlocked || targetBlocked) {
            const blockedLabel = sourceBlocked && targetBlocked
                ? 'Both workstreams are currently blocked for handoff.'
                : sourceBlocked
                    ? `${sourceLabel} is currently blocked for handoff.`
                    : `${targetLabel} is currently blocked for handoff.`;
            return {
                kind: base.kind,
                readiness: 'blocked',
                summary: `${base.summary} ${blockedLabel}`,
                actionHint: blockedHint() ?? base.actionHint
            };
        }

        if (sourceReview || targetReview) {
            const reviewLabel = sourceReview && targetReview
                ? 'Both workstreams still need review before handoff.'
                : sourceReview
                    ? `${sourceLabel} still needs review before handoff.`
                    : `${targetLabel} still needs review before handoff.`;
            return {
                kind: base.kind,
                readiness: 'review',
                summary: `${base.summary} ${reviewLabel}`,
                actionHint: reviewHint() ?? base.actionHint
            };
        }

        if (base.kind === 'aligned') {
            return { ...base, readiness: 'ready' };
        }

        return { ...base, readiness: 'review' };
    };

    if (!options.sameRepository) {
        return withReadiness({
            kind: 'different_repository',
            summary: 'These workstreams resolve to different repositories.',
            actionHint: 'Compare them only at the session and checkpoint level; git divergence is not meaningful across repositories.'
        });
    }

    if (!options.comparable || typeof options.sourceAheadCount !== 'number' || typeof options.targetAheadCount !== 'number') {
        return withReadiness({
            kind: 'not_comparable',
            summary: 'Git divergence could not be computed for these workstreams.',
            actionHint: 'Open both workstreams from named branches in the same repository before relying on git comparison.'
        });
    }

    if (options.sourceAheadCount === 0 && options.targetAheadCount === 0) {
        return withReadiness({
            kind: 'aligned',
            summary: `${sourceLabel} and ${targetLabel} are aligned from the same merge base.`,
            actionHint: null
        });
    }

    if (options.sourceAheadCount > 0 && options.targetAheadCount === 0) {
        return withReadiness({
            kind: 'source_ahead',
            summary: `${sourceLabel} is ahead of ${targetLabel} by ${options.sourceAheadCount} commit${options.sourceAheadCount === 1 ? '' : 's'}.`,
            actionHint: `Merge or checkpoint ${sourceLabel} before handing it off as the newer line of work.`
        });
    }

    if (options.sourceAheadCount === 0 && options.targetAheadCount > 0) {
        return withReadiness({
            kind: 'target_ahead',
            summary: `${targetLabel} is ahead of ${sourceLabel} by ${options.targetAheadCount} commit${options.targetAheadCount === 1 ? '' : 's'}.`,
            actionHint: `Update or compare ${sourceLabel} against ${targetLabel} before continuing work there.`
        });
    }

    return withReadiness({
        kind: 'diverged',
        summary: `${sourceLabel} and ${targetLabel} have diverged from merge base ${options.mergeBaseSha ? options.mergeBaseSha.slice(0, 8) : 'unknown'}.`,
        actionHint: 'Review both branches before merging or handing work across agents.'
    });
}
