import { describe, expect, it } from 'vitest';
import {
    compareChangedFiles,
    compareChangedLineRanges,
    parseChangedBaseRanges,
    parseChangedFiles,
    summarizeChangedAreas
} from '../src/workstream/change-overlap';

describe('workstream change overlap helpers', () => {
    it('parses changed files and shared hotspots from merge-base diffs', () => {
        const sourceFiles = parseChangedFiles('packages/core/shared.ts\nshared.txt\npackages/daemon/compare.ts\n');
        const targetFiles = parseChangedFiles('packages/core/shared.ts\nshared.txt\npackages/mcp/tool.ts\n');
        const changedFiles = compareChangedFiles(sourceFiles, targetFiles);
        const hotspots = summarizeChangedAreas(changedFiles.sharedChangedFiles);

        expect(changedFiles.sharedChangedFiles).toEqual(['packages/core/shared.ts', 'shared.txt']);
        expect(changedFiles.sourceOnlyChangedFiles).toEqual(['packages/daemon/compare.ts']);
        expect(changedFiles.targetOnlyChangedFiles).toEqual(['packages/mcp/tool.ts']);
        expect(changedFiles.changeOverlapKind).toBe('high');
        expect(changedFiles.changeOverlapSummary).toContain('shared.txt');
        expect(hotspots.sharedChangedAreas).toEqual(['packages/core', 'shared.txt']);
        expect(hotspots.changeHotspotSummary).toContain('packages/core, shared.txt');
    });

    it('detects likely conflicts when shared files overlap on base line ranges', () => {
        const sourceRanges = parseChangedBaseRanges([
            'diff --git a/shared.txt b/shared.txt',
            '@@ -2,2 +2,2 @@',
            'diff --git a/packages/core/shared.ts b/packages/core/shared.ts',
            '@@ -10,3 +10,4 @@'
        ].join('\n'));
        const targetRanges = parseChangedBaseRanges([
            'diff --git a/shared.txt b/shared.txt',
            '@@ -3,2 +3,3 @@',
            'diff --git a/packages/core/shared.ts b/packages/core/shared.ts',
            '@@ -20,2 +20,2 @@'
        ].join('\n'));
        const changedLines = compareChangedLineRanges(sourceRanges, targetRanges, ['packages/core/shared.ts', 'shared.txt']);

        expect(changedLines.sharedConflictLikelyCount).toBe(1);
        expect(changedLines.sharedConflictLikelyFiles).toEqual(['shared.txt']);
        expect(changedLines.lineOverlapKind).toBe('partial');
        expect(changedLines.lineOverlapSummary).toContain('shared.txt');
    });

    it('returns unknown overlap details when git diff data is unavailable', () => {
        const changedFiles = compareChangedFiles(null, ['shared.txt']);
        const changedLines = compareChangedLineRanges(null, new Map(), ['shared.txt']);

        expect(changedFiles.changeOverlapKind).toBe('unknown');
        expect(changedFiles.changeOverlapSummary).toContain('could not be computed');
        expect(changedLines.lineOverlapKind).toBe('unknown');
        expect(changedLines.lineOverlapSummary).toContain('could not be computed');
    });
});
