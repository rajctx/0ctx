import path from 'path';
import type { WorkstreamBrief } from '@0ctx/core';
import { deriveHandoffReadiness, deriveWorkstreamState } from './state';

function normalizeWorktreePath(candidate: string | null | undefined): string | null {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) return null;
    const resolved = path.resolve(candidate);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function alignBriefToReferenceWorktree(
    brief: WorkstreamBrief,
    referenceWorktreePath: string | null | undefined
): WorkstreamBrief {
    const normalizedReference = normalizeWorktreePath(referenceWorktreePath);
    const normalizedCheckedOut = (brief.checkedOutWorktreePaths ?? [])
        .map((entry) => normalizeWorktreePath(entry))
        .filter((entry): entry is string => Boolean(entry));

    if (!normalizedReference || normalizedCheckedOut.length === 0) {
        return brief;
    }

    const checkedOutHere = normalizedCheckedOut.includes(normalizedReference);
    const checkedOutElsewhere = normalizedCheckedOut.some((entry) => entry !== normalizedReference);

    if (brief.checkedOutHere === checkedOutHere && brief.checkedOutElsewhere === checkedOutElsewhere) {
        return brief;
    }

    const state = deriveWorkstreamState({
        branch: brief.branch,
        isDetachedHead: brief.isDetachedHead,
        headDiffersFromCaptured: brief.headDiffersFromCaptured,
        checkedOutHere,
        checkedOutElsewhere,
        hasUncommittedChanges: brief.hasUncommittedChanges,
        aheadCount: brief.aheadCount,
        behindCount: brief.behindCount,
        baseline: brief.baseline,
        upstream: brief.upstream,
        isCurrent: checkedOutHere ? brief.isCurrent : false
    });
    const handoff = deriveHandoffReadiness({
        stateKind: state.kind,
        checkpointCount: brief.checkpointCount
    });

    return {
        ...brief,
        checkedOutHere,
        checkedOutElsewhere,
        stateKind: state.kind,
        stateSummary: state.summary,
        stateActionHint: state.actionHint,
        handoffReadiness: handoff.readiness,
        handoffSummary: handoff.summary,
        handoffBlockers: handoff.blockers,
        handoffReviewItems: handoff.reviewItems
    };
}
