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
    blockers: string[];
    reviewItems: string[];
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
    const withReadiness = (base: {
        kind: 'aligned' | 'source_ahead' | 'target_ahead' | 'diverged' | 'different_repository' | 'not_comparable';
        summary: string;
        actionHint: string | null;
        blockers?: string[];
        reviewItems?: string[];
    }) => {
        const baseBlockers = base.blockers ?? [];
        const baseReviewItems = base.reviewItems ?? [];
        if (sourceBlocked || targetBlocked) {
            const blockedLabel = sourceBlocked && targetBlocked ? 'Both workstreams are currently blocked for handoff.' : sourceBlocked ? `${sourceLabel} is currently blocked for handoff.` : `${targetLabel} is currently blocked for handoff.`;
            return {
                kind: base.kind,
                readiness: 'blocked' as const,
                summary: `${base.summary} ${blockedLabel}`,
                actionHint: blockedHint() ?? base.actionHint,
                blockers: [...baseBlockers, ...(sourceBlocked ? [`${sourceLabel}: ${options.sourceHandoffSummary ?? 'blocked for handoff'}`] : []), ...(targetBlocked ? [`${targetLabel}: ${options.targetHandoffSummary ?? 'blocked for handoff'}`] : [])],
                reviewItems: baseReviewItems
            };
        }
        if (sourceReview || targetReview) {
            const reviewLabel = sourceReview && targetReview ? 'Both workstreams still need review before handoff.' : sourceReview ? `${sourceLabel} still needs review before handoff.` : `${targetLabel} still needs review before handoff.`;
            return {
                kind: base.kind,
                readiness: 'review' as const,
                summary: `${base.summary} ${reviewLabel}`,
                actionHint: reviewHint() ?? base.actionHint,
                blockers: baseBlockers,
                reviewItems: [...baseReviewItems, ...(sourceReview ? [`${sourceLabel}: ${options.sourceHandoffSummary ?? 'review before handoff'}`] : []), ...(targetReview ? [`${targetLabel}: ${options.targetHandoffSummary ?? 'review before handoff'}`] : [])]
            };
        }
        if (base.kind === 'aligned') return { ...base, readiness: 'ready' as const, blockers: baseBlockers, reviewItems: baseReviewItems };
        return { ...base, readiness: 'review' as const, blockers: baseBlockers, reviewItems: baseReviewItems };
    };

    if (!options.sameRepository) {
        return withReadiness({ kind: 'different_repository', summary: 'These workstreams resolve to different repositories.', actionHint: 'Compare them only at the session and checkpoint level; git divergence is not meaningful across repositories.', blockers: ['These workstreams belong to different repositories.'] });
    }
    if (!options.comparable || typeof options.sourceAheadCount !== 'number' || typeof options.targetAheadCount !== 'number') {
        return withReadiness({ kind: 'not_comparable', summary: 'Git divergence could not be computed for these workstreams.', actionHint: 'Open both workstreams from named branches in the same repository before relying on git comparison.', blockers: ['Git divergence is unavailable for one or both workstreams.'] });
    }
    if (options.sourceAheadCount === 0 && options.targetAheadCount === 0) {
        return withReadiness({ kind: 'aligned', summary: `${sourceLabel} and ${targetLabel} are aligned from the same merge base.`, actionHint: null });
    }
    if (options.sourceAheadCount > 0 && options.targetAheadCount === 0) {
        return withReadiness({ kind: 'source_ahead', summary: `${sourceLabel} is ahead of ${targetLabel} by ${options.sourceAheadCount} commit${options.sourceAheadCount === 1 ? '' : 's'}.`, actionHint: `Merge or checkpoint ${sourceLabel} before handing it off as the newer line of work.`, reviewItems: [`${sourceLabel} is ahead and should be checkpointed or merged before handoff.`] });
    }
    if (options.sourceAheadCount === 0 && options.targetAheadCount > 0) {
        return withReadiness({ kind: 'target_ahead', summary: `${targetLabel} is ahead of ${sourceLabel} by ${options.targetAheadCount} commit${options.targetAheadCount === 1 ? '' : 's'}.`, actionHint: `Update or compare ${sourceLabel} against ${targetLabel} before continuing work there.`, reviewItems: [`${sourceLabel} should be updated or compared against ${targetLabel} before work continues there.`] });
    }
    return withReadiness({ kind: 'diverged', summary: `${sourceLabel} and ${targetLabel} have diverged from merge base ${options.mergeBaseSha ? options.mergeBaseSha.slice(0, 8) : 'unknown'}.`, actionHint: 'Review both branches before merging or handing work across agents.', reviewItems: ['Both workstreams have diverged and need explicit reconciliation before handoff.'] });
}
