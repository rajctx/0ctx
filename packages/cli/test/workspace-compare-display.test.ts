import { describe, expect, it } from 'vitest';
import { buildWorkspaceCompareFlowLines } from '../src/commands/product/workspace-compare-display';

describe('workspace compare display', () => {
    it('builds explicit workstream inspection and insight promotion commands', () => {
        const lines = buildWorkspaceCompareFlowLines({
            source: {
                contextId: 'ctx-source',
                workstreams: [
                    {
                        branch: 'main',
                        worktreePath: 'C:\\Repo\\main worktree',
                        stateKind: 'current'
                    }
                ],
                recentInsights: [
                    {
                        nodeId: 'shared-source',
                        type: 'decision',
                        content: 'Keep cross-workspace promotion explicit.',
                        branch: 'main'
                    },
                    {
                        nodeId: 'source-only',
                        type: 'goal',
                        content: 'Promote the deployment checklist before reuse.',
                        branch: 'release/train'
                    }
                ]
            },
            target: {
                contextId: 'ctx-target',
                workstreams: [
                    {
                        branch: 'main',
                        worktreePath: 'C:\\Repo\\main worktree',
                        stateKind: 'dirty'
                    }
                ],
                recentInsights: [
                    {
                        nodeId: 'shared-target',
                        type: 'decision',
                        content: 'Keep cross-workspace promotion explicit.',
                        branch: 'main'
                    },
                    {
                        nodeId: 'target-only',
                        type: 'constraint',
                        content: 'Retain a manual review gate for shared changes.',
                        branch: 'main'
                    }
                ]
            }
        });

        expect(lines).toContain('  Compare-first flow:');
        expect(lines).toContain('  Matching workstreams:');
        expect(lines.some((line) => line.includes('Inspect source: 0ctx workstreams current --context-id=ctx-source --branch=main --worktree-path="C:\\Repo\\main worktree"'))).toBe(true);
        expect(lines.some((line) => line.includes('Inspect target: 0ctx workstreams current --context-id=ctx-target --branch=main --worktree-path="C:\\Repo\\main worktree"'))).toBe(true);
        expect(lines).toContain('  Shared reviewed insights:');
        expect(lines.some((line) => line.includes('source node: shared-source | target node: shared-target'))).toBe(true);
        expect(lines).toContain('  Source-only reviewed insights:');
        expect(lines.some((line) => line.includes('Promote into target: 0ctx insights promote --context-id=ctx-source --node-id=source-only --target-context-id=ctx-target --branch=release/train'))).toBe(true);
        expect(lines).toContain('  Target-only reviewed insights:');
        expect(lines.some((line) => line.includes('Promote back into source: 0ctx insights promote --context-id=ctx-target --node-id=target-only --target-context-id=ctx-source --branch=main'))).toBe(true);
    });

    it('reports when there is no recent comparison flow to inspect', () => {
        const lines = buildWorkspaceCompareFlowLines({
            source: { contextId: 'ctx-source', workstreams: [], recentInsights: [] },
            target: { contextId: 'ctx-target', workstreams: [], recentInsights: [] }
        });

        expect(lines).toEqual([
            '  Compare-first flow: no matching workstreams or reviewed insights in the recent comparison window.'
        ]);
    });
});
