interface WorkspaceWorkstreamRecord {
    branch: string;
    worktreePath: string | null;
    stateKind?: string | null;
}

interface WorkspaceInsightRecord {
    nodeId: string;
    type: string;
    content: string;
    branch?: string | null;
    worktreePath?: string | null;
}

interface WorkspaceComparisonSideRecord {
    contextId: string;
    workstreams?: WorkspaceWorkstreamRecord[];
    recentInsights?: WorkspaceInsightRecord[];
}

interface WorkspaceComparisonDisplayRecord {
    source: WorkspaceComparisonSideRecord;
    target: WorkspaceComparisonSideRecord;
}

function normalizePath(value: string | null | undefined): string {
    return value ? value.replace(/\\/g, '/').toLowerCase() : '';
}

function normalizeText(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function quoteArg(value: string): string {
    return /[\s"]/u.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function shorten(value: string, max = 96): string {
    return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function describeWorkstream(workstream: WorkspaceWorkstreamRecord): string {
    return workstream.worktreePath ? `${workstream.branch} (${workstream.worktreePath})` : workstream.branch;
}

function describeInsightScope(insight: WorkspaceInsightRecord): string {
    return insight.worktreePath ?? insight.branch ?? 'workspace';
}

function buildWorkstreamCommand(contextId: string, workstream: WorkspaceWorkstreamRecord): string {
    const parts = [
        '0ctx workstreams current',
        `--context-id=${quoteArg(contextId)}`,
        `--branch=${quoteArg(workstream.branch)}`
    ];
    if (workstream.worktreePath) {
        parts.push(`--worktree-path=${quoteArg(workstream.worktreePath)}`);
    }
    return parts.join(' ');
}

function buildPromoteCommand(sourceContextId: string, targetContextId: string, insight: WorkspaceInsightRecord): string {
    const parts = [
        '0ctx insights promote',
        `--context-id=${quoteArg(sourceContextId)}`,
        `--node-id=${quoteArg(insight.nodeId)}`,
        `--target-context-id=${quoteArg(targetContextId)}`
    ];
    if (insight.branch) {
        parts.push(`--branch=${quoteArg(insight.branch)}`);
    }
    return parts.join(' ');
}

function toWorkstreamKey(workstream: WorkspaceWorkstreamRecord): string {
    return `${workstream.branch}::${normalizePath(workstream.worktreePath)}`;
}

function toInsightKey(insight: WorkspaceInsightRecord): string {
    return `${insight.type}:${normalizeText(insight.content)}`;
}

function pairByKey<T>(left: T[], right: T[], toKey: (value: T) => string): Array<{ left: T; right: T }> {
    const rightGroups = new Map<string, T[]>();
    for (const item of right) {
        const key = toKey(item);
        const group = rightGroups.get(key);
        if (group) {
            group.push(item);
        } else {
            rightGroups.set(key, [item]);
        }
    }

    const pairs: Array<{ left: T; right: T }> = [];
    for (const item of left) {
        const group = rightGroups.get(toKey(item));
        const match = group?.shift();
        if (match) {
            pairs.push({ left: item, right: match });
        }
    }
    return pairs;
}

function excludeMatched<T>(items: T[], matched: Array<{ left: T; right: T }>, side: 'left' | 'right'): T[] {
    const matchedItems = new Set(matched.map((item) => item[side]));
    return items.filter((item) => !matchedItems.has(item));
}

function pushRemainingCount(lines: string[], total: number, max: number): void {
    if (total > max) {
        lines.push(`    ... +${total - max} more`);
    }
}

export function buildWorkspaceCompareFlowLines(comparison: WorkspaceComparisonDisplayRecord): string[] {
    const sourceWorkstreams = Array.isArray(comparison.source.workstreams) ? comparison.source.workstreams : [];
    const targetWorkstreams = Array.isArray(comparison.target.workstreams) ? comparison.target.workstreams : [];
    const sourceInsights = Array.isArray(comparison.source.recentInsights) ? comparison.source.recentInsights : [];
    const targetInsights = Array.isArray(comparison.target.recentInsights) ? comparison.target.recentInsights : [];

    const workstreamPairs = pairByKey(sourceWorkstreams, targetWorkstreams, toWorkstreamKey);
    const insightPairs = pairByKey(sourceInsights, targetInsights, toInsightKey);
    const sourceOnlyInsights = excludeMatched(sourceInsights, insightPairs, 'left');
    const targetOnlyInsights = excludeMatched(targetInsights, insightPairs, 'right');

    const lines: string[] = [];
    if (workstreamPairs.length === 0 && insightPairs.length === 0 && sourceOnlyInsights.length === 0 && targetOnlyInsights.length === 0) {
        return ['  Compare-first flow: no matching workstreams or reviewed insights in the recent comparison window.'];
    }

    lines.push('  Compare-first flow:');

    if (workstreamPairs.length > 0) {
        lines.push('  Matching workstreams:');
        for (const pair of workstreamPairs.slice(0, 3)) {
            lines.push(`    - ${describeWorkstream(pair.left)} | source ${pair.left.stateKind ?? 'unknown'} | target ${pair.right.stateKind ?? 'unknown'}`);
            lines.push(`      Inspect source: ${buildWorkstreamCommand(comparison.source.contextId, pair.left)}`);
            lines.push(`      Inspect target: ${buildWorkstreamCommand(comparison.target.contextId, pair.right)}`);
        }
        pushRemainingCount(lines, workstreamPairs.length, 3);
    }

    if (insightPairs.length > 0) {
        lines.push('  Shared reviewed insights:');
        for (const pair of insightPairs.slice(0, 3)) {
            lines.push(`    - [${pair.left.type}] ${shorten(pair.left.content)}`);
            lines.push(`      source node: ${pair.left.nodeId} | target node: ${pair.right.nodeId}`);
        }
        pushRemainingCount(lines, insightPairs.length, 3);
    }

    if (sourceOnlyInsights.length > 0) {
        lines.push('  Source-only reviewed insights:');
        for (const insight of sourceOnlyInsights.slice(0, 3)) {
            lines.push(`    - [${insight.type}] ${shorten(insight.content)} (${describeInsightScope(insight)})`);
            lines.push(`      Promote into target: ${buildPromoteCommand(comparison.source.contextId, comparison.target.contextId, insight)}`);
        }
        pushRemainingCount(lines, sourceOnlyInsights.length, 3);
    }

    if (targetOnlyInsights.length > 0) {
        lines.push('  Target-only reviewed insights:');
        for (const insight of targetOnlyInsights.slice(0, 3)) {
            lines.push(`    - [${insight.type}] ${shorten(insight.content)} (${describeInsightScope(insight)})`);
            lines.push(`      Promote back into source: ${buildPromoteCommand(comparison.target.contextId, comparison.source.contextId, insight)}`);
        }
        pushRemainingCount(lines, targetOnlyInsights.length, 3);
    }

    return lines;
}
