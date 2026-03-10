import type { Graph, WorkstreamComparison } from '@0ctx/core';
import path from 'path';
import { buildWorkstreamBrief } from './brief';
import {
    type ChangedBaseRange,
    compareChangedFiles,
    compareChangedLineRanges,
    parseChangedBaseRanges,
    parseChangedFiles,
    summarizeChangedAreas
} from './change-overlap';
import { alignBriefToReferenceWorktree } from './comparison-reference';
import { safeGit } from './git';
import { resolveCurrentWorkstreamFromContextPaths } from './lanes';
import { deriveMergeRisk, deriveReconcileSteps, deriveReconcileStrategy } from './reconcile';
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
    const context = graph.getContext(contextId);
    const contextPaths = Array.isArray(context?.paths)
        ? context.paths.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [];
    const referenceWorktreePath = resolveCurrentWorkstreamFromContextPaths(contextPaths).worktreePath
        ?? contextPaths[0]
        ?? null;

    const source = alignBriefToReferenceWorktree(buildWorkstreamBrief(graph, contextId, {
        branch: options.sourceBranch,
        worktreePath: options.sourceWorktreePath ?? null,
        sessionLimit: options.sessionLimit,
        checkpointLimit: options.checkpointLimit
    }), options.sourceWorktreePath ?? referenceWorktreePath);
    const target = alignBriefToReferenceWorktree(buildWorkstreamBrief(graph, contextId, {
        branch: options.targetBranch,
        worktreePath: options.targetWorktreePath ?? null,
        sessionLimit: options.sessionLimit,
        checkpointLimit: options.checkpointLimit
    }), options.targetWorktreePath ?? referenceWorktreePath);

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
    const reconcileSteps = deriveReconcileSteps({
        sameRepository,
        comparable,
        comparisonReadiness: comparisonState.readiness,
        comparisonActionHint: comparisonState.actionHint,
        reconcileStrategy: reconcile.reconcileStrategy,
        sourceLabel: source.branch ?? 'source workstream',
        targetLabel: target.branch ?? 'target workstream',
        comparisonBlockers,
        comparisonReviewItems,
        sharedConflictLikelyFiles: changedLines.sharedConflictLikelyFiles,
        sharedChangedAreas: hotspots.sharedChangedAreas
    });

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
    if (reconcileSteps.length > 0) lines.push(`Reconcile steps: ${reconcileSteps.map((step, idx) => `${idx + 1}) ${step}`).join(' ')}`);
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
        reconcileSteps,
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
