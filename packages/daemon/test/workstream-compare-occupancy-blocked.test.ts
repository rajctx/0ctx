import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Graph, openDb } from '@0ctx/core';
import { handleRequest } from '../src/handlers';
import { resetResolverStateForTests } from '../src/resolver';
import type { HandlerRuntimeContext } from '../src/handlers';

const tempDirs: string[] = [];

function createGraph() {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), '0ctx-daemon-worktree-blocked-'));
    tempDirs.push(tempDir);
    const db = openDb({ dbPath: path.join(tempDir, '0ctx.db') });
    return { db, graph: new Graph(db) };
}

function runtime(): HandlerRuntimeContext {
    return {
        startedAt: Date.now(),
        getMetricsSnapshot: () => ({
            startedAt: Date.now(),
            uptimeMs: 0,
            totalRequests: 0,
            methods: {}
        })
    };
}

function gitAvailable(): boolean {
    return spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true }).status === 0;
}

function runGit(repoRoot: string, args: string[]) {
    const result = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr ?? result.stdout ?? '').trim()}`);
    }
}

function addCapturedBranch(
    graph: Graph,
    sessionToken: string,
    contextId: string,
    sessionId: string,
    branch: string,
    repoRoot: string,
    worktreePath: string,
    occurredAt: number
) {
    handleRequest(graph, 'conn-worktree-blocked', {
        method: 'addNode',
        sessionToken,
        params: {
            contextId,
            type: 'artifact',
            hidden: true,
            thread: sessionId,
            key: `chat_session:claude:${sessionId}`,
            content: `${branch} summary`,
            tags: ['chat_session', 'agent:claude'],
            rawPayload: { sessionId, branch, agent: 'claude', worktreePath, repositoryRoot: repoRoot }
        }
    }, runtime());

    handleRequest(graph, 'conn-worktree-blocked', {
        method: 'addNode',
        sessionToken,
        params: {
            contextId,
            type: 'artifact',
            hidden: true,
            thread: sessionId,
            key: `chat_turn:claude:${sessionId}:msg-1`,
            content: `${branch} captured turn`,
            tags: ['chat_turn', 'role:assistant'],
            rawPayload: {
                sessionId,
                messageId: 'msg-1',
                role: 'assistant',
                branch,
                agent: 'claude',
                worktreePath,
                repositoryRoot: repoRoot,
                occurredAt
            }
        }
    }, runtime());
}

beforeEach(() => {
    resetResolverStateForTests();
});

afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('daemon workstream compare blocked occupancy guidance', () => {
    it('blocks compare guidance when the target branch is only checked out in another worktree', () => {
        if (!gitAvailable()) return;

        const { db, graph } = createGraph();
        const repoRoot = mkdtempSync(path.join(os.tmpdir(), '0ctx-compare-occupancy-main-'));
        const extraWorktree = mkdtempSync(path.join(os.tmpdir(), '0ctx-compare-occupancy-extra-'));
        tempDirs.push(repoRoot, extraWorktree);

        try {
            spawnSync('git', ['init', '-b', 'main', repoRoot], { encoding: 'utf8', windowsHide: true });
            runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
            runGit(repoRoot, ['config', 'user.name', 'Test User']);
            writeFileSync(path.join(repoRoot, 'tracked.txt'), 'base\n', 'utf8');
            runGit(repoRoot, ['add', '.']);
            runGit(repoRoot, ['commit', '-m', 'base']);

            rmSync(extraWorktree, { recursive: true, force: true });
            runGit(repoRoot, ['worktree', 'add', extraWorktree, '-b', 'feature/other-worktree']);
            writeFileSync(path.join(extraWorktree, 'tracked.txt'), 'feature branch\n', 'utf8');
            runGit(extraWorktree, ['add', '.']);
            runGit(extraWorktree, ['commit', '-m', 'feature branch']);

            const session = handleRequest(graph, 'conn-worktree-blocked', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-worktree-blocked', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'compare-occupancy-context', paths: [repoRoot] }
            }, runtime()) as { id: string };

            const now = Date.now();
            addCapturedBranch(graph, session.sessionToken, context.id, 'session-main', 'main', repoRoot, repoRoot, now - 60_000);
            addCapturedBranch(graph, session.sessionToken, context.id, 'session-feature', 'feature/other-worktree', repoRoot, extraWorktree, now);

            const comparison = handleRequest(graph, 'conn-worktree-blocked', {
                method: 'compareWorkstreams',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    sourceBranch: 'main',
                    targetBranch: 'feature/other-worktree'
                }
            }, runtime()) as {
                comparisonKind: string;
                comparisonReadiness: string;
                comparisonSummary: string;
                comparisonActionHint: string | null;
                comparisonBlockers: string[];
                mergeRisk: string;
                reconcileStrategy: string;
                reconcileSteps: string[];
                comparisonText: string;
                target: {
                    stateKind: string;
                    stateSummary: string;
                    handoffReadiness: string;
                    handoffSummary: string | null;
                };
            };

            expect(comparison.comparisonKind).toBe('target_ahead');
            expect(comparison.comparisonReadiness).toBe('blocked');
            expect(comparison.comparisonSummary).toContain('feature/other-worktree is currently blocked for handoff');
            expect(comparison.comparisonActionHint).toContain('Open the checked-out worktree before continuing on this workstream.');
            expect(comparison.target.stateKind).toBe('elsewhere');
            expect(comparison.target.stateSummary).toContain('Checked out in another worktree');
            expect(comparison.target.handoffReadiness).toBe('blocked');
            expect(comparison.target.handoffSummary).toContain('Do not hand this workstream off yet');
            expect(comparison.comparisonBlockers.some((item) => item.includes('feature/other-worktree: Do not hand this workstream off yet'))).toBe(true);
            expect(comparison.mergeRisk).toBe('blocked');
            expect(comparison.reconcileStrategy).toBe('blocked');
            expect(comparison.reconcileSteps.some((item) => item.includes('Resolve checkout or handoff blockers before trusting merge guidance'))).toBe(true);
            expect(comparison.reconcileSteps.some((item) => item.includes('Re-run the comparison after the blocked workstream is open'))).toBe(true);
            expect(comparison.comparisonText).toContain('Target status: Checked out in another worktree, not in the current checkout.');
            expect(comparison.comparisonText).toContain('Target handoff: Do not hand this workstream off yet.');
        } finally {
            db.close();
        }
    }, 20_000);
});
