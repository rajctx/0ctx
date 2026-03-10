import type { WorkstreamComparison } from '@0ctx/core';

export interface ChangedBaseRange {
    start: number;
    end: number;
}

export function parseChangedFiles(output: string | null): string[] | null {
    if (output === null) return null;
    return output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .sort();
}

export function parseChangedBaseRanges(output: string | null): Map<string, ChangedBaseRange[]> | null {
    if (output === null) return null;
    const rangesByFile = new Map<string, ChangedBaseRange[]>();
    let currentFile = null;

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

export function compareChangedFiles(source: string[] | null, target: string[] | null): {
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

export function compareChangedLineRanges(
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

export function summarizeChangedAreas(files: string[]): {
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
