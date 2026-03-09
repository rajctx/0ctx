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

    if (sameRepository && source.branch && target.branch && source.branch !== target.branch && source.repositoryRoot) {
        const countText = safeGit(source.repositoryRoot, ['rev-list', '--left-right', '--count', `${source.branch}...${target.branch}`]);
        const counts = countText ? countText.split(/\s+/).map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry)) : [];
        sourceAheadCount = counts.length >= 2 ? counts[0] : null;
        targetAheadCount = counts.length >= 2 ? counts[1] : null;
        mergeBaseSha = safeGit(source.repositoryRoot, ['merge-base', source.branch, target.branch]);
        comparable = sourceAheadCount !== null && targetAheadCount !== null;
    } else if (sameRepository && source.branch && target.branch && source.branch === target.branch) {
        comparable = true;
        sourceAheadCount = 0;
        targetAheadCount = 0;
        mergeBaseSha = source.mergeBaseSha ?? target.mergeBaseSha ?? null;
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

    const lines = [
        `Workstream comparison for ${source.workspaceName}`,
        `Source: ${source.branch ?? 'unknown branch'}`,
        `Target: ${target.branch ?? 'unknown branch'}`,
        comparisonState.summary,
        `Readiness: ${comparisonState.readiness}`
    ];
    if (comparisonState.actionHint) lines.push(`Recommended next step: ${comparisonState.actionHint}`);
    if (source.stateSummary) lines.push(`Source status: ${source.stateSummary}`);
    if (source.handoffSummary) lines.push(`Source handoff: ${source.handoffSummary}`);
    if (target.stateSummary) lines.push(`Target status: ${target.stateSummary}`);
    if (target.handoffSummary) lines.push(`Target handoff: ${target.handoffSummary}`);
    lines.push(`Activity: ${source.branch ?? 'source'} has ${source.sessionCount} sessions / ${source.checkpointCount} checkpoints; ${target.branch ?? 'target'} has ${target.sessionCount} sessions / ${target.checkpointCount} checkpoints.`);
    if (sharedAgents.length > 0) lines.push(`Shared agents: ${sharedAgents.join(', ')}.`);
    if (sourceOnlyAgents.length > 0) lines.push(`Only on ${source.branch ?? 'source'}: ${sourceOnlyAgents.join(', ')}.`);
    if (targetOnlyAgents.length > 0) lines.push(`Only on ${target.branch ?? 'target'}: ${targetOnlyAgents.join(', ')}.`);
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
        sharedAgents,
        sourceOnlyAgents,
        targetOnlyAgents,
        comparisonText: lines.join('\n')
    };
}
