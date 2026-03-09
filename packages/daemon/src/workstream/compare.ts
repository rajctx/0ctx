import type { Graph, WorkstreamComparison } from '@0ctx/core';
import path from 'path';
import { buildWorkstreamBrief } from './brief';
import { safeGit } from './git';
import { deriveWorkstreamComparisonState } from './state';

function compareAgentSets(source: string[], target: string[]): {
    sharedAgents: string[];
    sourceOnlyAgents: string[];
    targetOnlyAgents: string[];
} {
    const sourceSet = new Set(source.filter(Boolean));
    const targetSet = new Set(target.filter(Boolean));
    const sharedAgents = [...sourceSet].filter((agent) => targetSet.has(agent)).sort();
    const sourceOnlyAgents = [...sourceSet].filter((agent) => !targetSet.has(agent)).sort();
    const targetOnlyAgents = [...targetSet].filter((agent) => !sourceSet.has(agent)).sort();
    return { sharedAgents, sourceOnlyAgents, targetOnlyAgents };
}

function parseChangedFiles(output: string | null): string[] | null {
    if (output === null) return null;
    return output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .sort();
}

interface ChangedBaseRange {
    start: number;
    end: number;
}

function parseChangedBaseRanges(output: string | null): Map<string, ChangedBaseRange[]> | null {
    if (output === null) return null;
    const rangesByFile = new Map<string, ChangedBaseRange[]>();
    let currentFile: string | null = null;

    for (const rawLine of output.split(/\r?\n/)) {
        const line = rawLine.trimEnd();
        if (line.startsWith('diff --git ')) {
            const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
            currentFile = match?.[2] ?? null;
            if (currentFile && !rangesByFile.has(currentFile)) {
                rangesByFile.set(currentFile, []);
            }
            continue;
        }
        if (!currentFile || !line.startsWith('@@')) {
            continue;
        }
        const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (!match) continue;
        const oldStart = Number(match[1]);
        const oldCount = Number(match[2] ?? '1');
        const start = oldStart;
        const end = oldCount <= 0 ? oldStart : oldStart + oldCount - 1;
        rangesByFile.get(currentFile)?.push({ start, end });
    }

    return rangesByFile;
}

function compareChangedFiles(source: string[] | null, target: string[] | null): {
    sourceChangedFileCount: number | null;
    targetChangedFileCount: number | null;
    sharedChangedFileCount: number | null;
    sharedChangedFiles: string[];
    sourceOnlyChangedFiles: string[];
    targetOnlyChangedFiles: string[];
    changeOverlapKind: 'none' | 'partial' | 'high' | 'unknown';
    changeOverlapSummary: string;
} {
    if (source === null || target === null) {
        return {
            sourceChangedFileCount: null,
            targetChangedFileCount: null,
            sharedChangedFileCount: null,
            sharedChangedFiles: [],
            sourceOnlyChangedFiles: [],
            targetOnlyChangedFiles: [],
            changeOverlapKind: 'unknown',
            changeOverlapSummary: 'Changed-file overlap could not be computed for these workstreams.'
        };
    }

    const sourceSet = new Set(source);
    const targetSet = new Set(target);
    const sharedChangedFiles = [...sourceSet].filter((file) => targetSet.has(file)).sort();
    const sourceOnlyChangedFiles = [...sourceSet].filter((file) => !targetSet.has(file)).sort();
    const targetOnlyChangedFiles = [...targetSet].filter((file) => !sourceSet.has(file)).sort();
    const sourceChangedFileCount = source.length;
    const targetChangedFileCount = target.length;
    const sharedChangedFileCount = sharedChangedFiles.length;

    if (sourceChangedFileCount === 0 && targetChangedFileCount === 0) {
        return {
            sourceChangedFileCount,
            targetChangedFileCount,
            sharedChangedFileCount,
            sharedChangedFiles,
            sourceOnlyChangedFiles,
            targetOnlyChangedFiles,
            changeOverlapKind: 'none',
            changeOverlapSummary: 'Neither workstream has changed files beyond the merge base.'
        };
    }

    if (sharedChangedFileCount === 0) {
        return {
            sourceChangedFileCount,
            targetChangedFileCount,
            sharedChangedFileCount,
            sharedChangedFiles,
            sourceOnlyChangedFiles,
            targetOnlyChangedFiles,
            changeOverlapKind: 'none',
            changeOverlapSummary: 'The compared workstreams touch different files.'
        };
    }

    const overlapRatio = Math.max(
        sharedChangedFileCount / Math.max(sourceChangedFileCount, 1),
        sharedChangedFileCount / Math.max(targetChangedFileCount, 1)
    );
    const changeOverlapKind = sharedChangedFileCount >= 3 || overlapRatio >= 0.6 ? 'high' : 'partial';
    const sampled = sharedChangedFiles.slice(0, 3).join(', ');
    const suffix = sharedChangedFileCount > 3 ? ` (+${sharedChangedFileCount - 3} more)` : '';
    return {
        sourceChangedFileCount,
        targetChangedFileCount,
        sharedChangedFileCount,
        sharedChangedFiles,
        sourceOnlyChangedFiles,
        targetOnlyChangedFiles,
        changeOverlapKind,
        changeOverlapSummary: changeOverlapKind === 'high'
            ? `Both workstreams modify ${sharedChangedFileCount} of the same files: ${sampled}${suffix}.`
            : `The workstreams overlap on ${sharedChangedFileCount} file${sharedChangedFileCount === 1 ? '' : 's'}: ${sampled}${suffix}.`
    };
}

function rangesOverlap(left: ChangedBaseRange, right: ChangedBaseRange): boolean {
    return left.start <= right.end && right.start <= left.end;
}

function compareChangedLineRanges(
    source: Map<string, ChangedBaseRange[]> | null,
    target: Map<string, ChangedBaseRange[]> | null,
    sharedChangedFiles: string[]
): {
    sharedConflictLikelyCount: number | null;
    sharedConflictLikelyFiles: string[];
    lineOverlapKind: 'none' | 'partial' | 'high' | 'unknown';
    lineOverlapSummary: string;
} {
    if (source === null || target === null) {
        return {
            sharedConflictLikelyCount: null,
            sharedConflictLikelyFiles: [],
            lineOverlapKind: 'unknown',
            lineOverlapSummary: 'Changed-line overlap could not be computed for these workstreams.'
        };
    }

    const sharedConflictLikelyFiles = sharedChangedFiles.filter((file) => {
        const sourceRanges = source.get(file) ?? [];
        const targetRanges = target.get(file) ?? [];
        return sourceRanges.some((sourceRange) => targetRanges.some((targetRange) => rangesOverlap(sourceRange, targetRange)));
    }).sort();
    const sharedConflictLikelyCount = sharedConflictLikelyFiles.length;

    if (sharedChangedFiles.length === 0 || sharedConflictLikelyCount === 0) {
        return {
            sharedConflictLikelyCount,
            sharedConflictLikelyFiles,
            lineOverlapKind: 'none',
            lineOverlapSummary: 'No overlapping changed line ranges were detected in shared files.'
        };
    }

    const overlapRatio = sharedConflictLikelyCount / Math.max(sharedChangedFiles.length, 1);
    const lineOverlapKind = sharedConflictLikelyCount >= 2 || overlapRatio >= 0.6 ? 'high' : 'partial';
    const sampled = sharedConflictLikelyFiles.slice(0, 3).join(', ');
    const suffix = sharedConflictLikelyCount > 3 ? ` (+${sharedConflictLikelyCount - 3} more)` : '';
    return {
        sharedConflictLikelyCount,
        sharedConflictLikelyFiles,
        lineOverlapKind,
        lineOverlapSummary: lineOverlapKind === 'high'
            ? `Both workstreams modify overlapping line ranges in ${sharedConflictLikelyCount} shared files: ${sampled}${suffix}.`
            : `The workstreams overlap on the same line ranges in ${sharedConflictLikelyCount} shared file${sharedConflictLikelyCount === 1 ? '' : 's'}: ${sampled}${suffix}.`
    };
}

function summarizeChangedAreas(files: string[]): {
    sharedChangedAreas: string[];
    changeHotspotSummary: string;
} {
    if (files.length === 0) {
        return {
            sharedChangedAreas: [],
            changeHotspotSummary: 'No shared change hotspots were detected.'
        };
    }

    const counts = new Map<string, number>();
    for (const file of files) {
        const normalized = file.replace(/\\/g, '/').split('/').filter(Boolean);
        const area = normalized.length >= 2
            ? normalized.slice(0, 2).join('/')
            : normalized[0] || file;
        counts.set(area, (counts.get(area) ?? 0) + 1);
    }

    const sharedChangedAreas = [...counts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([area]) => area);

    const sample = sharedChangedAreas.slice(0, 3).join(', ');
    const suffix = sharedChangedAreas.length > 3 ? ` (+${sharedChangedAreas.length - 3} more)` : '';
    return {
        sharedChangedAreas,
        changeHotspotSummary: `Shared change hotspots: ${sample}${suffix}.`
    };
}

function deriveMergeRisk(options: {
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

function deriveReconcileStrategy(options: {
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
                reconcileStrategySummary: 'No git reconcile is needed. Both workstreams are already aligned.'
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

export function compareWorkstreams(
    graph: Graph,
    contextId: string,
    options: {
        sourceBranch: string;
        targetBranch: string;
        sourceWorktreePath?: string | null;
        targetWorktreePath?: string | null;
        sessionLimit?: number;
        checkpointLimit?: number;
    }
): WorkstreamComparison {
    const source = buildWorkstreamBrief(graph, contextId, {
        branch: options.sourceBranch,
        worktreePath: options.sourceWorktreePath ?? null,
        sessionLimit: options.sessionLimit,
        checkpointLimit: options.checkpointLimit
    });
    const target = buildWorkstreamBrief(graph, contextId, {
        branch: options.targetBranch,
        worktreePath: options.targetWorktreePath ?? null,
        sessionLimit: options.sessionLimit,
        checkpointLimit: options.checkpointLimit
    });

    const sameRepository = Boolean(
        source.repositoryRoot && target.repositoryRoot && path.resolve(source.repositoryRoot) === path.resolve(target.repositoryRoot)
    );

    let sourceAheadCount: number | null = null;
    let targetAheadCount: number | null = null;
    let mergeBaseSha: string | null = null;
    let comparable = false;
    let sourceChangedFiles: string[] | null = null;
    let targetChangedFiles: string[] | null = null;
    let sourceChangedLineRanges: Map<string, ChangedBaseRange[]> | null = null;
    let targetChangedLineRanges: Map<string, ChangedBaseRange[]> | null = null;

    if (sameRepository && source.branch && target.branch && source.branch !== target.branch && source.repositoryRoot) {
        const countText = safeGit(source.repositoryRoot, ['rev-list', '--left-right', '--count', `${source.branch}...${target.branch}`]);
        const counts = countText ? countText.split(/\s+/).map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry)) : [];
        sourceAheadCount = counts.length >= 2 ? counts[0] : null;
        targetAheadCount = counts.length >= 2 ? counts[1] : null;
        mergeBaseSha = safeGit(source.repositoryRoot, ['merge-base', source.branch, target.branch]);
        comparable = sourceAheadCount !== null && targetAheadCount !== null;
        if (mergeBaseSha) {
            sourceChangedFiles = parseChangedFiles(safeGit(source.repositoryRoot, ['diff', '--name-only', `${mergeBaseSha}..${source.branch}`])) ?? [];
            targetChangedFiles = parseChangedFiles(safeGit(source.repositoryRoot, ['diff', '--name-only', `${mergeBaseSha}..${target.branch}`])) ?? [];
            sourceChangedLineRanges = parseChangedBaseRanges(safeGit(source.repositoryRoot, ['diff', '--unified=0', '--no-color', `${mergeBaseSha}..${source.branch}`])) ?? new Map();
            targetChangedLineRanges = parseChangedBaseRanges(safeGit(source.repositoryRoot, ['diff', '--unified=0', '--no-color', `${mergeBaseSha}..${target.branch}`])) ?? new Map();
        }
    } else if (sameRepository && source.branch && target.branch && source.branch === target.branch) {
        comparable = true;
        sourceAheadCount = 0;
        targetAheadCount = 0;
        mergeBaseSha = source.mergeBaseSha ?? target.mergeBaseSha ?? null;
        sourceChangedFiles = [];
        targetChangedFiles = [];
        sourceChangedLineRanges = new Map();
        targetChangedLineRanges = new Map();
    }

    const comparisonState = deriveWorkstreamComparisonState({
        sameRepository,
        comparable,
        sourceBranch: source.branch,
        targetBranch: target.branch,
        sourceAheadCount,
        targetAheadCount,
        mergeBaseSha,
        sourceStateSummary: source.stateSummary,
        targetStateSummary: target.stateSummary,
        sourceStateActionHint: source.stateActionHint,
        targetStateActionHint: target.stateActionHint,
        sourceHandoffReadiness: source.handoffReadiness,
        targetHandoffReadiness: target.handoffReadiness,
        sourceHandoffSummary: source.handoffSummary,
        targetHandoffSummary: target.handoffSummary
    });

    const newerSide = source.lastActivityAt && target.lastActivityAt
        ? source.lastActivityAt === target.lastActivityAt ? 'same' : source.lastActivityAt > target.lastActivityAt ? 'source' : 'target'
        : source.lastActivityAt ? 'source' : target.lastActivityAt ? 'target' : 'unknown';

    const { sharedAgents, sourceOnlyAgents, targetOnlyAgents } = compareAgentSets(
        [
            ...(source.recentSessions.map((session) => session.agent ?? '').filter(Boolean)),
            ...(source.latestCheckpoints.flatMap((checkpoint) => checkpoint.agentSet ?? []))
        ],
        [
            ...(target.recentSessions.map((session) => session.agent ?? '').filter(Boolean)),
            ...(target.latestCheckpoints.flatMap((checkpoint) => checkpoint.agentSet ?? []))
        ]
    );
    const changedFiles = compareChangedFiles(sourceChangedFiles, targetChangedFiles);
    const changedLines = compareChangedLineRanges(sourceChangedLineRanges, targetChangedLineRanges, changedFiles.sharedChangedFiles);
    const hotspots = summarizeChangedAreas(changedFiles.sharedChangedFiles);
    const mergeRisk = deriveMergeRisk({
        sameRepository,
        comparable,
        comparisonKind: comparisonState.kind,
        comparisonReadiness: comparisonState.readiness,
        changeOverlapKind: changedFiles.changeOverlapKind,
        sharedChangedFileCount: changedFiles.sharedChangedFileCount,
        lineOverlapKind: changedLines.lineOverlapKind,
        sharedConflictLikelyCount: changedLines.sharedConflictLikelyCount
    });
    const reconcile = deriveReconcileStrategy({
        sameRepository,
        comparable,
        comparisonKind: comparisonState.kind,
        comparisonReadiness: comparisonState.readiness,
        mergeRisk: mergeRisk.mergeRisk,
        newerSide,
        sourceLabel: source.branch ?? 'source workstream',
        targetLabel: target.branch ?? 'target workstream'
    });
    const comparisonBlockers = [
        ...(comparisonState.blockers ?? []),
        ...(mergeRisk.mergeRisk === 'blocked' ? [mergeRisk.mergeRiskSummary] : [])
    ];
    const comparisonReviewItems = [
        ...(comparisonState.reviewItems ?? []),
        ...(mergeRisk.mergeRisk === 'medium' || mergeRisk.mergeRisk === 'high' ? [mergeRisk.mergeRiskSummary] : []),
        ...(changedLines.lineOverlapKind === 'high' || changedLines.lineOverlapKind === 'partial'
            ? ['Both workstreams touch overlapping line ranges in shared files; resolve those conflicts before handoff or merge.']
            : []),
        ...(changedFiles.changeOverlapKind === 'high'
            ? ['Both workstreams modify many of the same files; review those files before merging or handing work off.']
            : changedFiles.changeOverlapKind === 'partial'
                ? ['The workstreams overlap on some files; inspect the overlap before handoff.']
                : []),
        ...(hotspots.sharedChangedAreas.length > 0
            ? [`Focus review on: ${hotspots.sharedChangedAreas.slice(0, 3).join(', ')}${hotspots.sharedChangedAreas.length > 3 ? ` (+${hotspots.sharedChangedAreas.length - 3} more)` : ''}.`]
            : [])
    ];

    const lines = [
        `Workstream comparison for ${source.workspaceName}`,
        `Source: ${source.branch ?? 'unknown branch'}`,
        `Target: ${target.branch ?? 'unknown branch'}`,
        comparisonState.summary,
        `Readiness: ${comparisonState.readiness}`,
        `Changed files: ${changedFiles.changeOverlapSummary}`,
        `Changed lines: ${changedLines.lineOverlapSummary}`,
        `Hotspots: ${hotspots.changeHotspotSummary}`,
        `Merge risk: ${mergeRisk.mergeRiskSummary}`,
        `Reconcile: ${reconcile.reconcileStrategySummary}`
    ];
    if (comparisonBlockers.length > 0) lines.push(`Blockers: ${comparisonBlockers.join(' ')}`);
    if (comparisonReviewItems.length > 0) lines.push(`Review: ${comparisonReviewItems.join(' ')}`);
    if (comparisonState.actionHint) lines.push(`Recommended next step: ${comparisonState.actionHint}`);
    if (source.stateSummary) lines.push(`Source status: ${source.stateSummary}`);
    if (source.handoffSummary) lines.push(`Source handoff: ${source.handoffSummary}`);
    if (target.stateSummary) lines.push(`Target status: ${target.stateSummary}`);
    if (target.handoffSummary) lines.push(`Target handoff: ${target.handoffSummary}`);
    lines.push(`Activity: ${source.branch ?? 'source'} has ${source.sessionCount} sessions / ${source.checkpointCount} checkpoints; ${target.branch ?? 'target'} has ${target.sessionCount} sessions / ${target.checkpointCount} checkpoints.`);
    if (sharedAgents.length > 0) lines.push(`Shared agents: ${sharedAgents.join(', ')}.`);
    if (sourceOnlyAgents.length > 0) lines.push(`Only on ${source.branch ?? 'source'}: ${sourceOnlyAgents.join(', ')}.`);
    if (targetOnlyAgents.length > 0) lines.push(`Only on ${target.branch ?? 'target'}: ${targetOnlyAgents.join(', ')}.`);
    if (changedFiles.sharedChangedFiles.length > 0) lines.push(`Shared files: ${changedFiles.sharedChangedFiles.slice(0, 5).join(', ')}${changedFiles.sharedChangedFiles.length > 5 ? ` (+${changedFiles.sharedChangedFiles.length - 5} more)` : ''}.`);
    if (changedLines.sharedConflictLikelyFiles.length > 0) lines.push(`Likely conflict files: ${changedLines.sharedConflictLikelyFiles.slice(0, 5).join(', ')}${changedLines.sharedConflictLikelyFiles.length > 5 ? ` (+${changedLines.sharedConflictLikelyFiles.length - 5} more)` : ''}.`);
    if (hotspots.sharedChangedAreas.length > 0) lines.push(hotspots.changeHotspotSummary);
    if (newerSide === 'source') lines.push(`${source.branch ?? 'Source'} has the newer captured activity.`);
    else if (newerSide === 'target') lines.push(`${target.branch ?? 'Target'} has the newer captured activity.`);

    return {
        contextId,
        workspaceName: source.workspaceName,
        source,
        target,
        comparable,
        sameRepository,
        sourceAheadCount,
        targetAheadCount,
        mergeBaseSha,
        newerSide,
        comparisonKind: comparisonState.kind,
        comparisonReadiness: comparisonState.readiness,
        comparisonSummary: comparisonState.summary,
        comparisonActionHint: comparisonState.actionHint,
        reconcileStrategy: reconcile.reconcileStrategy,
        reconcileStrategySummary: reconcile.reconcileStrategySummary,
        comparisonBlockers,
        comparisonReviewItems,
        sharedAgents,
        sourceOnlyAgents,
        targetOnlyAgents,
        sharedConflictLikelyCount: changedLines.sharedConflictLikelyCount,
        sharedConflictLikelyFiles: changedLines.sharedConflictLikelyFiles,
        lineOverlapKind: changedLines.lineOverlapKind,
        lineOverlapSummary: changedLines.lineOverlapSummary,
        sourceChangedFileCount: changedFiles.sourceChangedFileCount,
        targetChangedFileCount: changedFiles.targetChangedFileCount,
        sharedChangedFileCount: changedFiles.sharedChangedFileCount,
        sharedChangedFiles: changedFiles.sharedChangedFiles,
        sharedChangedAreas: hotspots.sharedChangedAreas,
        sourceOnlyChangedFiles: changedFiles.sourceOnlyChangedFiles,
        targetOnlyChangedFiles: changedFiles.targetOnlyChangedFiles,
        changeOverlapKind: changedFiles.changeOverlapKind,
        changeOverlapSummary: changedFiles.changeOverlapSummary,
        changeHotspotSummary: hotspots.changeHotspotSummary,
        mergeRisk: mergeRisk.mergeRisk,
        mergeRiskSummary: mergeRisk.mergeRiskSummary,
        comparisonText: lines.join('\n')
    };
}
