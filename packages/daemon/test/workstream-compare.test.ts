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
    const tempDir = mkdtempSync(path.join(os.tmpdir(), '0ctx-daemon-workstream-compare-'));
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
    agent: string,
    repoRoot: string,
    occurredAt: number
) {
    handleRequest(graph, 'conn-workstream-compare', {
        method: 'addNode',
        sessionToken,
        params: {
            contextId,
            type: 'artifact',
            hidden: true,
            thread: sessionId,
            key: `chat_session:${agent}:${sessionId}`,
            content: `${branch} summary`,
            tags: ['chat_session', `agent:${agent}`],
            rawPayload: { sessionId, branch, agent, worktreePath: repoRoot, repositoryRoot: repoRoot }
        }
    }, runtime());

    handleRequest(graph, 'conn-workstream-compare', {
        method: 'addNode',
        sessionToken,
        params: {
            contextId,
            type: 'artifact',
            hidden: true,
            thread: sessionId,
            key: `chat_turn:${agent}:${sessionId}:msg-1`,
            content: `${branch} captured turn`,
            tags: ['chat_turn', 'role:assistant'],
            rawPayload: {
                sessionId,
                messageId: 'msg-1',
                role: 'assistant',
                branch,
                agent,
                worktreePath: repoRoot,
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

describe('daemon workstream compare reconcile steps', () => {
    it('keeps aligned comparisons review-aware when local git cleanup is still required', () => {
        if (!gitAvailable()) return;
        const { db, graph } = createGraph();
        const repoRoot = mkdtempSync(path.join(os.tmpdir(), '0ctx-workstream-aligned-review-'));
        tempDirs.push(repoRoot);
        try {
            spawnSync('git', ['init', '-b', 'main', repoRoot], { encoding: 'utf8', windowsHide: true });
            runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
            runGit(repoRoot, ['config', 'user.name', 'Test User']);
            writeFileSync(path.join(repoRoot, 'tracked.txt'), 'base\n', 'utf8');
            runGit(repoRoot, ['add', '.']);
            runGit(repoRoot, ['commit', '-m', 'base']);
            runGit(repoRoot, ['branch', 'feature/aligned-review']);

            const session = handleRequest(graph, 'conn-workstream-compare', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-workstream-compare', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'aligned-review-context', paths: [repoRoot] }
            }, runtime()) as { id: string };

            const now = Date.now();
            addCapturedBranch(graph, session.sessionToken, context.id, 'session-main', 'main', 'factory', repoRoot, now - 60_000);
            addCapturedBranch(graph, session.sessionToken, context.id, 'session-feature', 'feature/aligned-review', 'claude', repoRoot, now);

            writeFileSync(path.join(repoRoot, 'tracked.txt'), 'dirty local change\n', 'utf8');

            const comparison = handleRequest(graph, 'conn-workstream-compare', {
                method: 'compareWorkstreams',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    sourceBranch: 'main',
                    targetBranch: 'feature/aligned-review'
                }
            }, runtime()) as {
                comparisonKind: string;
                comparisonReadiness: string;
                mergeRisk: string;
                mergeRiskSummary: string;
                reconcileStrategy: string;
                reconcileStrategySummary: string;
                reconcileSteps: string[];
                comparisonText: string;
            };

            expect(comparison.comparisonKind).toBe('aligned');
            expect(comparison.comparisonReadiness).toBe('review');
            expect(comparison.mergeRisk).toBe('medium');
            expect(comparison.mergeRiskSummary).toContain('local git state still needs review');
            expect(comparison.reconcileStrategy).toBe('none');
            expect(comparison.reconcileStrategySummary).toContain('local git state still needs review');
            expect(comparison.reconcileSteps[0]).toContain('Commit or checkpoint local changes before handing this workstream to another agent.');
            expect(comparison.reconcileSteps[1]).toContain('Review git state before handoff');
            expect(comparison.reconcileSteps).not.toContain('No git reconcile is required. Keep working on either side normally.');
            expect(comparison.comparisonText).toContain('Merge risk: Branch history is aligned, but local git state still needs review before handoff.');
            expect(comparison.comparisonText).toContain('Reconcile: No branch reconcile is needed, but local git state still needs review before handoff.');
            expect(comparison.comparisonText).toContain('Reconcile steps: 1) Commit or checkpoint local changes before handing this workstream to another agent.');
        } finally {
            db.close();
        }
    }, 20_000);
});
