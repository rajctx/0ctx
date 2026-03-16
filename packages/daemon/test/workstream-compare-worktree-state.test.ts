import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Graph, openDb } from '@0ctx/core';
import { handleRequest } from '../src/handlers';
import { resetResolverStateForTests } from '../src/resolver';
import type { HandlerRuntimeContext } from '../src/handlers';

const tempDirs: string[] = [];
let previousConfigPath: string | undefined;

function createGraph() {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), '0ctx-daemon-worktree-state-'));
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

function writeFile(filePath: string, content: string) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${filePath}' -Value '${content}'`], {
        encoding: 'utf8',
        windowsHide: true
    });
}

beforeEach(() => {
    resetResolverStateForTests();
    previousConfigPath = process.env.CTX_CONFIG_PATH;
    const configDir = mkdtempSync(path.join(os.tmpdir(), '0ctx-daemon-config-'));
    tempDirs.push(configDir);
    process.env.CTX_CONFIG_PATH = path.join(configDir, 'config.json');
});

afterEach(() => {
    if (previousConfigPath === undefined) {
        delete process.env.CTX_CONFIG_PATH;
    } else {
        process.env.CTX_CONFIG_PATH = previousConfigPath;
    }
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('workstream comparison worktree-aware git state', () => {
    it('uses the selected worktree path for target git head and dirty state', () => {
        if (!gitAvailable()) return;

        const { db, graph } = createGraph();
        const repoRoot = mkdtempSync(path.join(os.tmpdir(), '0ctx-compare-main-'));
        const extraWorktree = mkdtempSync(path.join(os.tmpdir(), '0ctx-compare-feature-'));
        tempDirs.push(repoRoot, extraWorktree);

        try {
            spawnSync('git', ['init', '-b', 'main', repoRoot], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'config', 'user.email', 'test@example.com'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'config', 'user.name', 'Test User'], { encoding: 'utf8', windowsHide: true });

            writeFile(path.join(repoRoot, 'shared.txt'), 'base');
            spawnSync('git', ['-C', repoRoot, 'add', '.'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'commit', '-m', 'base'], { encoding: 'utf8', windowsHide: true });
            const mainHead = String(spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).stdout ?? '').trim();

            rmSync(extraWorktree, { recursive: true, force: true });
            spawnSync('git', ['-C', repoRoot, 'worktree', 'add', extraWorktree, '-b', 'feature/dirty-worktree'], { encoding: 'utf8', windowsHide: true });
            writeFile(path.join(extraWorktree, 'shared.txt'), 'feature committed');
            spawnSync('git', ['-C', extraWorktree, 'add', '.'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', extraWorktree, 'commit', '-m', 'feature commit'], { encoding: 'utf8', windowsHide: true });
            const featureHead = String(spawnSync('git', ['-C', extraWorktree, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).stdout ?? '').trim();

            writeFile(path.join(extraWorktree, 'shared.txt'), 'feature dirty');

            const session = handleRequest(graph, 'conn-worktree-state', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-worktree-state', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'worktree-compare-context', paths: [repoRoot] }
            }, runtime()) as { id: string };

            const addCapturedMessage = (
                thread: string,
                branch: string,
                worktreePath: string,
                commitSha: string,
                occurredAt: number
            ) => {
                handleRequest(graph, 'conn-worktree-state', {
                    method: 'addNode',
                    sessionToken: session.sessionToken,
                    params: {
                        contextId: context.id,
                        type: 'artifact',
                        hidden: true,
                        thread,
                        key: `chat_session:factory:${thread}`,
                        content: `${branch} summary`,
                        tags: ['chat_session', 'agent:factory'],
                        rawPayload: { sessionId: thread, branch, agent: 'factory', worktreePath, repositoryRoot: repoRoot, commitSha }
                    }
                }, runtime());

                handleRequest(graph, 'conn-worktree-state', {
                    method: 'addNode',
                    sessionToken: session.sessionToken,
                    params: {
                        contextId: context.id,
                        type: 'artifact',
                        hidden: true,
                        thread,
                        key: `chat_turn:factory:${thread}:msg-1`,
                        content: `${branch} captured turn`,
                        tags: ['chat_turn', 'role:assistant'],
                        rawPayload: { sessionId: thread, messageId: 'msg-1', role: 'assistant', branch, agent: 'factory', worktreePath, repositoryRoot: repoRoot, commitSha, occurredAt }
                    }
                }, runtime());
            };

            const now = Date.now();
            addCapturedMessage('session-main', 'main', repoRoot, mainHead, now - 60_000);
            addCapturedMessage('session-feature', 'feature/dirty-worktree', extraWorktree, featureHead, now);

            const comparison = handleRequest(graph, 'conn-worktree-state', {
                method: 'compareWorkstreams',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    sourceBranch: 'main',
                    sourceWorktreePath: repoRoot,
                    targetBranch: 'feature/dirty-worktree',
                    targetWorktreePath: extraWorktree
                }
            }, runtime()) as {
                target: {
                    worktreePath: string | null;
                    currentHeadSha: string | null;
                    headDiffersFromCaptured: boolean | null;
                    hasUncommittedChanges: boolean | null;
                    stateKind: string;
                    stateSummary: string;
                    handoffReadiness: string;
                    handoffReviewItems: string[];
                };
            };

            expect(path.resolve(String(comparison.target.worktreePath))).toBe(path.resolve(extraWorktree));
            expect(comparison.target.currentHeadSha).toBe(featureHead);
            expect(comparison.target.headDiffersFromCaptured).toBe(false);
            expect(comparison.target.hasUncommittedChanges).toBe(true);
            expect(comparison.target.stateKind).toBe('dirty');
            expect(comparison.target.stateSummary).toContain('Working tree has local uncommitted changes');
            expect(comparison.target.handoffReadiness).toBe('review');
            expect(comparison.target.handoffReviewItems).toContain('Commit or checkpoint local changes before handoff.');
        } finally {
            db.close();
        }
    }, 20_000);
});
