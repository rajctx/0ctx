import type { WorkstreamComparison } from '@0ctx/core';

function summarizeReconcileFocus(options: {
    sharedConflictLikelyFiles: string[];
    sharedChangedAreas: string[];
}): string | null {
    if (options.sharedConflictLikelyFiles.length > 0) {
        const sample = options.sharedConflictLikelyFiles.slice(0, 3).join(', ');
        const suffix = options.sharedConflictLikelyFiles.length > 3
            ? ` (+${options.sharedConflictLikelyFiles.length - 3} more)`
            : '';
        return `Resolve likely conflicts in ${sample}${suffix}.`;
    }

    if (options.sharedChangedAreas.length > 0) {
        const sample = options.sharedChangedAreas.slice(0, 3).join(', ');
        const suffix = options.sharedChangedAreas.length > 3
            ? ` (+${options.sharedChangedAreas.length - 3} more)`
            : '';
        return `Focus review on ${sample}${suffix}.`;
    }

    return null;
}

export function deriveMergeRisk(options: {
    sameRepository: boolean;
    comparable: boolean;
    comparisonKind: WorkstreamComparison['comparisonKind'];
    comparisonReadiness: WorkstreamComparison['comparisonReadiness'];
    changeOverlapKind: WorkstreamComparison['changeOverlapKind'];
    sharedChangedFileCount: number | null;
    lineOverlapKind: WorkstreamComparison['lineOverlapKind'];
    sharedConflictLikelyCount: number | null;
}): {
    mergeRisk: WorkstreamComparison['mergeRisk'];
    mergeRiskSummary: string;
} {
    if (options.comparisonReadiness === 'blocked') {
        return {
            mergeRisk: 'blocked',
            mergeRiskSummary: 'Resolve checkout or handoff blockers before trusting merge guidance for these workstreams.'
        };
    }

    if (!options.sameRepository || !options.comparable) {
        return {
            mergeRisk: 'unknown',
            mergeRiskSummary: 'Merge risk cannot be estimated until both workstreams are comparable branches in the same repository.'
        };
    }

    if (options.comparisonKind === 'aligned' && options.comparisonReadiness === 'review') {
        return {
            mergeRisk: 'medium',
            mergeRiskSummary: 'Branch history is aligned, but local git state still needs review before handoff.'
        };
    }

    if (options.lineOverlapKind === 'high' || options.lineOverlapKind === 'partial') {
        return {
            mergeRisk: 'high',
            mergeRiskSummary: `High merge risk: both workstreams modify overlapping line ranges in ${options.sharedConflictLikelyCount ?? '?'} shared file${options.sharedConflictLikelyCount === 1 ? '' : 's'}.`
        };
    }

    if (options.changeOverlapKind === 'high' && options.comparisonKind === 'diverged') {
        return {
            mergeRisk: 'high',
            mergeRiskSummary: `High merge risk: both workstreams diverged and overlap on ${options.sharedChangedFileCount ?? '?'} changed files.`
        };
    }

    if (options.changeOverlapKind === 'high') {
        return {
            mergeRisk: 'high',
            mergeRiskSummary: `High merge risk: the workstreams overlap heavily on ${options.sharedChangedFileCount ?? '?'} changed files.`
        };
    }

    if (options.comparisonKind === 'diverged' || options.changeOverlapKind === 'partial') {
        return {
            mergeRisk: 'medium',
            mergeRiskSummary: 'Medium merge risk: review the shared files before handing work across these workstreams.'
        };
    }

    if (options.changeOverlapKind === 'none') {
        return {
            mergeRisk: 'low',
            mergeRiskSummary: 'Low merge risk: the workstreams currently touch different files.'
        };
    }

    return {
        mergeRisk: 'unknown',
        mergeRiskSummary: 'Merge risk is unknown for these workstreams.'
    };
}

export function deriveReconcileStrategy(options: {
    sameRepository: boolean;
    comparable: boolean;
    comparisonKind: WorkstreamComparison['comparisonKind'];
    comparisonReadiness: WorkstreamComparison['comparisonReadiness'];
    mergeRisk: WorkstreamComparison['mergeRisk'];
    newerSide: WorkstreamComparison['newerSide'];
    sourceLabel: string;
    targetLabel: string;
}): {
    reconcileStrategy: WorkstreamComparison['reconcileStrategy'];
    reconcileStrategySummary: string;
} {
    if (options.comparisonReadiness === 'blocked') {
        return {
            reconcileStrategy: 'blocked',
            reconcileStrategySummary: 'Resolve checkout and handoff blockers before reconciling these workstreams.'
        };
    }

    if (!options.sameRepository || !options.comparable) {
        return {
            reconcileStrategy: 'unknown',
            reconcileStrategySummary: 'Reconcile guidance is unavailable until both workstreams are comparable branches in the same repository.'
        };
    }

    switch (options.comparisonKind) {
        case 'aligned':
            return {
                reconcileStrategy: 'none',
                reconcileStrategySummary: options.comparisonReadiness === 'review'
                    ? 'No branch reconcile is needed, but local git state still needs review before handoff.'
                    : 'No git reconcile is needed. Both workstreams are already aligned.'
            };
        case 'source_ahead':
            return {
                reconcileStrategy: 'fast_forward_target_to_source',
                reconcileStrategySummary: `Fast-forward ${options.targetLabel} to ${options.sourceLabel}.`
            };
        case 'target_ahead':
            return {
                reconcileStrategy: 'fast_forward_source_to_target',
                reconcileStrategySummary: `Fast-forward ${options.sourceLabel} to ${options.targetLabel}.`
            };
        case 'diverged':
            if (options.mergeRisk === 'high' || options.mergeRisk === 'medium') {
                return {
                    reconcileStrategy: 'manual_conflict_resolution',
                    reconcileStrategySummary: 'Manual reconcile is recommended. Review overlap and resolve conflicts before merging or rebasing either workstream.'
                };
            }
            if (options.newerSide === 'source') {
                return {
                    reconcileStrategy: 'rebase_target_on_source',
                    reconcileStrategySummary: `Rebase ${options.targetLabel} onto ${options.sourceLabel}, then review the resulting history before handoff.`
                };
            }
            if (options.newerSide === 'target') {
                return {
                    reconcileStrategy: 'rebase_source_on_target',
                    reconcileStrategySummary: `Rebase ${options.sourceLabel} onto ${options.targetLabel}, then review the resulting history before handoff.`
                };
            }
            return {
                reconcileStrategy: 'manual_conflict_resolution',
                reconcileStrategySummary: 'Both workstreams diverged and neither side is clearly newer. Review manually before choosing a merge or rebase direction.'
            };
        default:
            return {
                reconcileStrategy: 'unknown',
                reconcileStrategySummary: 'Reconcile guidance is not available for this comparison.'
            };
    }
}

export function deriveReconcileSteps(options: {
    sameRepository: boolean;
    comparable: boolean;
    comparisonReadiness: WorkstreamComparison['comparisonReadiness'];
    comparisonActionHint: string | null;
    reconcileStrategy: WorkstreamComparison['reconcileStrategy'];
    sourceLabel: string;
    targetLabel: string;
    comparisonBlockers: string[];
    comparisonReviewItems: string[];
    sharedConflictLikelyFiles: string[];
    sharedChangedAreas: string[];
}): string[] {
    const focus = summarizeReconcileFocus({
        sharedConflictLikelyFiles: options.sharedConflictLikelyFiles,
        sharedChangedAreas: options.sharedChangedAreas
    });

    if (options.reconcileStrategy === 'blocked') {
        return [
            ...options.comparisonBlockers,
            'Re-run the comparison after the blocked workstream is open, attached to a named branch, and clean enough for handoff.'
        ].filter(Boolean);
    }

    if (!options.sameRepository || !options.comparable || options.reconcileStrategy === 'unknown') {
        return [
            'Compare only branches in the same repository before choosing a reconcile direction.',
            'Open both workstreams locally and refresh 0ctx after git state is available.'
        ];
    }

    switch (options.reconcileStrategy) {
        case 'none':
            if (options.comparisonReadiness === 'review') {
                return [
                    options.comparisonActionHint ?? 'Review the git state on both workstreams before treating them as aligned.',
                    options.comparisonReviewItems[0] ?? 'Review the flagged workstream before handoff.',
                    'Create a checkpoint once the workstreams are clean and still aligned before handoff.'
                ].filter(Boolean);
            }
            return ['No git reconcile is required. Keep working on either side normally.'];
        case 'fast_forward_target_to_source':
            return [
                `Open ${options.targetLabel}.`,
                `Fast-forward it to ${options.sourceLabel}.`,
                'Create a checkpoint after the update before handing the workstream to another agent.'
            ];
        case 'fast_forward_source_to_target':
            return [
                `Open ${options.sourceLabel}.`,
                `Fast-forward it to ${options.targetLabel}.`,
                'Create a checkpoint after the update before handing the workstream to another agent.'
            ];
        case 'rebase_target_on_source':
            return [
                `Open ${options.targetLabel}.`,
                `Rebase it onto ${options.sourceLabel}.`,
                focus ?? 'Review the shared areas after the rebase completes.',
                'Create a checkpoint before handing the workstream to another agent.'
            ];
        case 'rebase_source_on_target':
            return [
                `Open ${options.sourceLabel}.`,
                `Rebase it onto ${options.targetLabel}.`,
                focus ?? 'Review the shared areas after the rebase completes.',
                'Create a checkpoint before handing the workstream to another agent.'
            ];
        case 'manual_conflict_resolution':
            return [
                'Review the shared changed files before choosing merge or rebase.',
                focus ?? 'Review the shared hotspots before reconciling the workstreams.',
                'Resolve conflicts manually and verify the resulting branch state.',
                'Create a checkpoint after reconciliation and before handoff.'
            ];
        default:
            return [];
    }
}
