import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Graph, openDb } from '@0ctx/core';
import { handleRequest } from '../src/handlers';
import { EventRuntime } from '../src/events';
import { resetResolverStateForTests } from '../src/resolver';
import type { HandlerRuntimeContext } from '../src/handlers';

const tempDirs: string[] = [];

function createGraph() {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), '0ctx-daemon-handlers-'));
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

beforeEach(() => {
    resetResolverStateForTests();
});

afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('daemon request handling', () => {
    it('rejects context-bound operations when no active context exists', () => {
        const { db, graph } = createGraph();
        try {
            expect(() => {
                handleRequest(graph, 'conn-1', {
                    method: 'addNode',
                    params: { type: 'goal', content: 'test node' }
                }, runtime());
            }).toThrow(/No active context set/);
        } finally {
            db.close();
        }
    });

    it('persists active context across socket reconnections using sessionToken', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-a', { method: 'createSession' }, runtime()) as { sessionToken: string };

            const context = handleRequest(graph, 'conn-a', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'enterprise-rollout' }
            }, runtime()) as { id: string };

            const node = handleRequest(graph, 'conn-b', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: { type: 'decision', content: 'Ship session-aware protocol' }
            }, runtime()) as { contextId: string };

            expect(node.contextId).toBe(context.id);
        } finally {
            db.close();
        }
    });

    it('writes audit events for mutating calls', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-a', { method: 'createSession' }, runtime()) as { sessionToken: string };

            const context = handleRequest(graph, 'conn-a', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'audit-context', actor: 'test-user', source: 'test-suite' }
            }, runtime()) as { id: string };

            handleRequest(graph, 'conn-a', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: { type: 'goal', content: 'Capture auditable mutations' }
            }, runtime());

            const events = handleRequest(graph, 'conn-a', {
                method: 'listAuditEvents',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, limit: 10 }
            }, runtime()) as Array<{ action: string; sessionToken: string | null }>;

            expect(events.length).toBeGreaterThan(0);
            expect(events.some(event => event.action === 'create_context')).toBe(true);
            expect(events.some(event => event.action === 'add_node')).toBe(true);
            expect(events.every(event => event.sessionToken === session.sessionToken)).toBe(true);
        } finally {
            db.close();
        }
    });

    it('reports GA and preview integration defaults honestly when no hook state exists yet', () => {
        const { db, graph } = createGraph();
        const hookStatePath = path.join(path.dirname(db.name), 'missing-hooks-state.json');
        const previousHookStatePath = process.env.CTX_HOOK_STATE_PATH;
        try {
            process.env.CTX_HOOK_STATE_PATH = hookStatePath;

            const hookHealth = handleRequest(graph, 'conn-hook-health', {
                method: 'getHookHealth',
                params: {}
            }, runtime()) as { agents: Array<{ agent: string; notes: string | null }> };

            const byAgent = new Map(hookHealth.agents.map((agent) => [agent.agent, agent.notes]));
            expect(byAgent.get('claude')).toBe('supported');
            expect(byAgent.get('factory')).toBe('supported');
            expect(byAgent.get('antigravity')).toBe('supported');
            expect(byAgent.get('codex')).toBe('preview-notify-archive');
            expect(byAgent.get('cursor')).toBe('preview-hook');
            expect(byAgent.get('windsurf')).toBe('preview-hook');
        } finally {
            if (previousHookStatePath === undefined) {
                delete process.env.CTX_HOOK_STATE_PATH;
            } else {
                process.env.CTX_HOOK_STATE_PATH = previousHookStatePath;
            }
            db.close();
        }
    });

    it('gets and sets per-context sync policy with audit trail', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-sync', { method: 'createSession' }, runtime()) as { sessionToken: string };

            const context = handleRequest(graph, 'conn-sync', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'sync-policy-context', syncPolicy: 'metadata_only' }
            }, runtime()) as { id: string };

            const before = handleRequest(graph, 'conn-sync', {
                method: 'getSyncPolicy',
                sessionToken: session.sessionToken,
                params: { contextId: context.id }
            }, runtime()) as { syncPolicy: string };

            const after = handleRequest(graph, 'conn-sync', {
                method: 'setSyncPolicy',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, syncPolicy: 'full_sync', actor: 'test-user', source: 'test-suite' }
            }, runtime()) as { syncPolicy: string };

            const events = handleRequest(graph, 'conn-sync', {
                method: 'listAuditEvents',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, limit: 10 }
            }, runtime()) as Array<{ action: string }>;

            expect(before.syncPolicy).toBe('metadata_only');
            expect(after.syncPolicy).toBe('full_sync');
            expect(events.some(event => event.action === 'set_sync_policy')).toBe(true);
        } finally {
            db.close();
        }
    });

    it('defaults new contexts to metadata_only sync', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-sync-default', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-sync-default', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'default-sync-policy-context' }
            }, runtime()) as { id: string; syncPolicy: string };

            const current = handleRequest(graph, 'conn-sync-default', {
                method: 'getSyncPolicy',
                sessionToken: session.sessionToken,
                params: { contextId: context.id }
            }, runtime()) as { syncPolicy: string };

            expect(context.syncPolicy).toBe('metadata_only');
            expect(current.syncPolicy).toBe('metadata_only');
        } finally {
            db.close();
        }
    });

    it('lists chat sessions/turns and keeps hidden nodes out of default graph data', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-chat', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-chat', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'chat-context' }
            }, runtime()) as { id: string };

            const visible = handleRequest(graph, 'conn-chat', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, type: 'artifact', content: 'visible node' }
            }, runtime()) as { id: string };

            const hiddenTurn = handleRequest(graph, 'conn-chat', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    type: 'artifact',
                    hidden: true,
                    thread: 'session-1',
                    key: 'chat_turn:codex:session-1:turn-1',
                    content: 'chat turn summary',
                    tags: ['chat_turn', 'role:assistant'],
                    rawPayload: {
                        role: 'assistant',
                        branch: 'main',
                        commitSha: 'abc123'
                    }
                }
            }, runtime()) as { id: string };

            const graphDefault = handleRequest(graph, 'conn-chat', {
                method: 'getGraphData',
                sessionToken: session.sessionToken,
                params: { contextId: context.id }
            }, runtime()) as { nodes: Array<{ id: string }> };
            expect(graphDefault.nodes.map(node => node.id)).toContain(visible.id);
            expect(graphDefault.nodes.map(node => node.id)).not.toContain(hiddenTurn.id);

            const graphWithHidden = handleRequest(graph, 'conn-chat', {
                method: 'getGraphData',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, includeHidden: true }
            }, runtime()) as { nodes: Array<{ id: string }> };
            expect(graphWithHidden.nodes.map(node => node.id)).toContain(hiddenTurn.id);

            const byKeyDefault = handleRequest(graph, 'conn-chat', {
                method: 'getByKey',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, key: 'chat_turn:codex:session-1:turn-1' }
            }, runtime()) as { id?: string } | null;
            expect(byKeyDefault).toBeNull();

            const byKeyWithHidden = handleRequest(graph, 'conn-chat', {
                method: 'getByKey',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, key: 'chat_turn:codex:session-1:turn-1', includeHidden: true }
            }, runtime()) as { id?: string } | null;
            expect(byKeyWithHidden?.id).toBe(hiddenTurn.id);

            const sessions = handleRequest(graph, 'conn-chat', {
                method: 'listChatSessions',
                sessionToken: session.sessionToken,
                params: { contextId: context.id }
            }, runtime()) as Array<{ sessionId: string; turnCount: number }>;
            expect(sessions).toHaveLength(1);
            expect(sessions[0].sessionId).toBe('session-1');
            expect(sessions[0].turnCount).toBe(1);

            const turns = handleRequest(graph, 'conn-chat', {
                method: 'listChatTurns',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, sessionId: 'session-1' }
            }, runtime()) as Array<{ nodeId: string; hasPayload: boolean }>;
            expect(turns).toHaveLength(1);
            expect(turns[0].nodeId).toBe(hiddenTurn.id);
            expect(turns[0].hasPayload).toBe(true);

            const payload = handleRequest(graph, 'conn-chat', {
                method: 'getNodePayload',
                sessionToken: session.sessionToken,
                params: { nodeId: hiddenTurn.id }
            }, runtime()) as { payload: Record<string, unknown> };
            expect(payload.payload.commitSha).toBe('abc123');
        } finally {
            db.close();
        }
    });

    it('serves branch lanes, session messages, and checkpoint workflows', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-branch', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-branch', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'branch-context' }
            }, runtime()) as { id: string };

            handleRequest(graph, 'conn-branch', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    type: 'artifact',
                    hidden: true,
                    thread: 'session-branch-1',
                    key: 'chat_session:factory:session-branch-1',
                    content: 'branch lane summary -> checkpoint ready',
                    tags: ['chat_session', 'agent:factory'],
                    rawPayload: {
                        sessionId: 'session-branch-1',
                        branch: 'feature/branch-lane',
                        commitSha: 'abc123def456',
                        agent: 'factory',
                        worktreePath: 'C:/repo',
                        repositoryRoot: 'C:/repo'
                    }
                }
            }, runtime());

            handleRequest(graph, 'conn-branch', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    type: 'artifact',
                    hidden: true,
                    thread: 'session-branch-1',
                    key: 'chat_turn:factory:session-branch-1:msg-1',
                    content: 'checkpoint ready',
                    tags: ['chat_turn', 'role:assistant'],
                    rawPayload: {
                        sessionId: 'session-branch-1',
                        messageId: 'msg-1',
                        role: 'assistant',
                        branch: 'feature/branch-lane',
                        commitSha: 'abc123def456',
                        agent: 'factory',
                        worktreePath: 'C:/repo',
                        repositoryRoot: 'C:/repo',
                        occurredAt: 1700000003000
                    }
                }
            }, runtime());

            const lanes = handleRequest(graph, 'conn-branch', {
                method: 'listBranchLanes',
                sessionToken: session.sessionToken,
                params: { contextId: context.id }
            }, runtime()) as Array<{ branch: string; lastAgent: string | null; sessionCount: number }>;
            expect(lanes).toHaveLength(1);
            expect(lanes[0].branch).toBe('feature/branch-lane');
            expect(lanes[0].lastAgent).toBe('factory');
            expect(lanes[0].sessionCount).toBe(1);

            const brief = handleRequest(graph, 'conn-branch', {
                method: 'getWorkstreamBrief',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    branch: 'feature/branch-lane',
                    worktreePath: 'C:/repo'
                }
            }, runtime()) as {
                workspaceName: string;
                branch: string | null;
                tracked: boolean;
                recentSessions: Array<{ sessionId: string }>;
                contextText: string;
            };
            expect(brief.workspaceName).toBe('branch-context');
            expect(brief.branch).toBe('feature/branch-lane');
            expect(brief.tracked).toBe(true);
            expect(brief.recentSessions[0]?.sessionId).toBe('session-branch-1');
            expect(brief.contextText).toContain('Current workstream: feature/branch-lane');

            const agentContext = handleRequest(graph, 'conn-branch', {
                method: 'getAgentContextPack',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    branch: 'feature/branch-lane',
                    worktreePath: 'C:/repo'
                }
            }, runtime()) as {
                workspaceName: string;
                branch: string | null;
                recentSessions: Array<{ sessionId: string }>;
                latestCheckpoints: Array<unknown>;
                handoffTimeline: Array<{ sessionId: string }>;
                promptText: string;
            };
            expect(agentContext.workspaceName).toBe('branch-context');
            expect(agentContext.branch).toBe('feature/branch-lane');
            expect(agentContext.recentSessions[0]?.sessionId).toBe('session-branch-1');
            expect(agentContext.latestCheckpoints).toHaveLength(0);
            expect(agentContext.handoffTimeline[0]?.sessionId).toBe('session-branch-1');
            expect(agentContext.promptText).toContain('Current workstream: feature/branch-lane');
            expect(agentContext.promptText).toContain('Recent handoffs:');

            const sessions = handleRequest(graph, 'conn-branch', {
                method: 'listBranchSessions',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, branch: 'feature/branch-lane', worktreePath: 'C:/repo' }
            }, runtime()) as Array<{ sessionId: string }>;
            expect(sessions).toHaveLength(1);
            expect(sessions[0].sessionId).toBe('session-branch-1');

            const messages = handleRequest(graph, 'conn-branch', {
                method: 'listSessionMessages',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, sessionId: 'session-branch-1' }
            }, runtime()) as Array<{ messageId?: string; agent?: string | null }>;
            expect(messages).toHaveLength(1);
            expect(messages[0].messageId).toBe('msg-1');
            expect(messages[0].agent).toBe('factory');

            const checkpoint = handleRequest(graph, 'conn-branch', {
                method: 'createSessionCheckpoint',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, sessionId: 'session-branch-1', summary: 'checkpoint summary' }
            }, runtime()) as { id: string; sessionId: string | null; branch: string | null };
            expect(checkpoint.sessionId).toBe('session-branch-1');
            expect(checkpoint.branch).toBe('feature/branch-lane');

            const checkpointDetail = handleRequest(graph, 'conn-branch', {
                method: 'getCheckpointDetail',
                sessionToken: session.sessionToken,
                params: { checkpointId: checkpoint.id }
            }, runtime()) as { checkpoint: { id: string }; payloadAvailable: boolean };
            expect(checkpointDetail.checkpoint.id).toBe(checkpoint.id);
            expect(checkpointDetail.payloadAvailable).toBe(true);

            const explain = handleRequest(graph, 'conn-branch', {
                method: 'explainCheckpoint',
                sessionToken: session.sessionToken,
                params: { checkpointId: checkpoint.id }
            }, runtime()) as { checkpoint: { id: string } };
            expect(explain.checkpoint.id).toBe(checkpoint.id);

            const handoff = handleRequest(graph, 'conn-branch', {
                method: 'getHandoffTimeline',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, branch: 'feature/branch-lane', worktreePath: 'C:/repo' }
            }, runtime()) as Array<{ sessionId: string }>;
            expect(handoff).toHaveLength(1);
            expect(handoff[0].sessionId).toBe('session-branch-1');

            handleRequest(graph, 'conn-branch', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, type: 'assumption', content: 'remove on rewind' }
            }, runtime());

            const rewind = handleRequest(graph, 'conn-branch', {
                method: 'rewindCheckpoint',
                sessionToken: session.sessionToken,
                params: { checkpointId: checkpoint.id }
            }, runtime()) as { checkpoint: { id: string } };
            expect(rewind.checkpoint.id).toBe(checkpoint.id);

            const resume = handleRequest(graph, 'conn-branch', {
                method: 'resumeSession',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, sessionId: 'session-branch-1' }
            }, runtime()) as { session: { sessionId: string } | null; checkpointCount: number };
            expect(resume.session?.sessionId).toBe('session-branch-1');
            expect(resume.checkpointCount).toBeGreaterThanOrEqual(1);

            const audit = handleRequest(graph, 'conn-branch', {
                method: 'listAuditEvents',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, limit: 20 }
            }, runtime()) as Array<{ action: string }>;

            expect(audit.some(event => event.action === 'save_checkpoint')).toBe(true);
            expect(audit.some(event => event.action === 'rewind')).toBe(true);
            expect(audit.some(event => event.action === 'resume_session')).toBe(true);
            expect(audit.some(event => event.action === 'explain_checkpoint')).toBe(true);
        } finally {
            db.close();
        }
    });

    it('enriches workstreams with git-aware state when the repository exists locally', () => {
        if (!gitAvailable()) return;
        const { db, graph } = createGraph();
        try {
            const repoRoot = path.join(os.tmpdir(), `0ctx-workstream-repo-${Date.now()}`);
            tempDirs.push(repoRoot);
            spawnSync('git', ['init', '--initial-branch', 'main', repoRoot], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'config', 'user.email', 'test@example.com'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'config', 'user.name', '0ctx test'], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(repoRoot, 'notes.txt')}' -Value 'base'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'add', '.'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'commit', '-m', 'base'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'checkout', '-b', 'feature/runtime-shape'], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(repoRoot, 'notes.txt')}' -Value 'feature'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'add', '.'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'commit', '-m', 'feature'], { encoding: 'utf8', windowsHide: true });
            const featureHead = String(spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).stdout ?? '').trim();
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(repoRoot, 'staged.txt')}' -Value 'staged change'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'add', 'staged.txt'], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Add-Content -Path '${path.join(repoRoot, 'staged.txt')}' -Value 'unstaged change'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(repoRoot, 'draft.txt')}' -Value 'untracked change'`], { encoding: 'utf8', windowsHide: true });

            const session = handleRequest(graph, 'conn-git', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-git', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'git-aware-context', paths: [repoRoot] }
            }, runtime()) as { id: string };

            handleRequest(graph, 'conn-git', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    type: 'artifact',
                    hidden: true,
                    thread: 'session-git-1',
                    key: 'chat_session:claude:session-git-1',
                    content: 'git aware session summary',
                    tags: ['chat_session', 'agent:claude'],
                    rawPayload: {
                        sessionId: 'session-git-1',
                        branch: 'feature/runtime-shape',
                        commitSha: featureHead,
                        agent: 'claude',
                        worktreePath: repoRoot,
                        repositoryRoot: repoRoot
                    }
                }
            }, runtime());

            handleRequest(graph, 'conn-git', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    type: 'artifact',
                    hidden: true,
                    thread: 'session-git-1',
                    key: 'chat_turn:claude:session-git-1:msg-1',
                    content: 'git aware captured turn',
                    tags: ['chat_turn', 'role:assistant'],
                    rawPayload: {
                        sessionId: 'session-git-1',
                        messageId: 'msg-1',
                        role: 'assistant',
                        branch: 'feature/runtime-shape',
                        commitSha: featureHead,
                        agent: 'claude',
                        worktreePath: repoRoot,
                        repositoryRoot: repoRoot,
                        occurredAt: Date.now()
                    }
                }
            }, runtime());

            graph.addNode({
                contextId: context.id,
                type: 'decision',
                content: 'Keep reviewed insights scoped to the current workstream.',
                key: 'knowledge:decision:feature-runtime-shape',
                tags: ['knowledge', 'derived', 'branch:feature/runtime-shape', `worktree:${repoRoot}`],
                source: 'extractor:session',
                hidden: false
            });

            const lanes = handleRequest(graph, 'conn-git', {
                method: 'listBranchLanes',
                sessionToken: session.sessionToken,
                params: { contextId: context.id }
            }, runtime()) as Array<{
                branch: string;
                repositoryRoot: string | null;
                currentHeadSha: string | null;
                currentHeadRef: string | null;
                isDetachedHead: boolean | null;
                headDiffersFromCaptured: boolean | null;
                isCurrent: boolean | null;
                upstream: string | null;
                hasUncommittedChanges: boolean | null;
                stagedChangeCount: number | null;
                unstagedChangeCount: number | null;
                untrackedCount: number | null;
                baseline: { branch: string | null; aheadCount: number | null; behindCount: number | null; summary: string } | null;
            }>;

            expect(lanes).toHaveLength(1);
            expect(lanes[0].branch).toBe('feature/runtime-shape');
            expect(lanes[0].repositoryRoot).toBe(repoRoot);
            expect(lanes[0].currentHeadSha).toBe(featureHead);
            expect(lanes[0].currentHeadRef).toBe('refs/heads/feature/runtime-shape');
            expect(lanes[0].isDetachedHead).toBe(false);
            expect(lanes[0].headDiffersFromCaptured).toBe(false);
            expect(lanes[0].isCurrent).toBe(true);
            expect(lanes[0].upstream).toBeNull();
            expect(lanes[0].hasUncommittedChanges).toBe(true);
            expect(lanes[0].stagedChangeCount).toBeGreaterThanOrEqual(1);
            expect(lanes[0].unstagedChangeCount).toBe(1);
            expect(lanes[0].untrackedCount).toBe(1);
            expect(lanes[0].baseline?.branch).toBe('main');
            expect(lanes[0].baseline?.aheadCount).toBe(1);
            expect(lanes[0].baseline?.behindCount).toBe(0);
            expect(lanes[0].baseline?.summary).toContain('ahead of main');

            const brief = handleRequest(graph, 'conn-git', {
                method: 'getWorkstreamBrief',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    branch: 'feature/runtime-shape',
                    worktreePath: repoRoot
                }
            }, runtime()) as {
                repositoryRoot: string | null;
                currentHeadSha: string | null;
                currentHeadRef: string | null;
                isDetachedHead: boolean | null;
                headDiffersFromCaptured: boolean | null;
                isCurrent: boolean | null;
                hasUncommittedChanges: boolean | null;
                stagedChangeCount: number | null;
                unstagedChangeCount: number | null;
                untrackedCount: number | null;
                baseline: { branch: string | null; aheadCount: number | null; behindCount: number | null; summary: string } | null;
                insights: Array<{ type: string; content: string }>;
                contextText: string;
            };

            expect(brief.repositoryRoot).toBe(repoRoot);
            expect(brief.currentHeadSha).toBe(featureHead);
            expect(brief.currentHeadRef).toBe('refs/heads/feature/runtime-shape');
            expect(brief.isDetachedHead).toBe(false);
            expect(brief.headDiffersFromCaptured).toBe(false);
            expect(brief.isCurrent).toBe(true);
            expect(brief.hasUncommittedChanges).toBe(true);
            expect(brief.stagedChangeCount).toBeGreaterThanOrEqual(1);
            expect(brief.unstagedChangeCount).toBe(1);
            expect(brief.untrackedCount).toBe(1);
            expect(brief.baseline?.branch).toBe('main');
            expect(brief.baseline?.aheadCount).toBe(1);
            expect(brief.baseline?.behindCount).toBe(0);
            expect(brief.baseline?.summary).toContain('ahead of main');
            expect(brief.insights).toHaveLength(1);
            expect(brief.insights[0]?.type).toBe('decision');
            expect(brief.insights[0]?.content).toContain('current workstream');
            expect(brief.contextText).toContain('Git state: current local workstream.');
            expect(brief.contextText).toContain('Baseline: feature/runtime-shape is 1 commit ahead of main.');
            expect(brief.contextText).toContain('Local changes:');
            expect(brief.contextText).toContain('staged');
            expect(brief.contextText).toContain('1 unstaged');
            expect(brief.contextText).toContain('1 untracked');
            expect(brief.contextText).toContain('Reviewed insights:');

            const pack = handleRequest(graph, 'conn-git', {
                method: 'getAgentContextPack',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    branch: 'feature/runtime-shape',
                    worktreePath: repoRoot
                }
            }, runtime()) as {
                workstream: {
                    currentHeadSha: string | null;
                    currentHeadRef: string | null;
                    isDetachedHead: boolean | null;
                    headDiffersFromCaptured: boolean | null;
                    hasUncommittedChanges: boolean | null;
                    stagedChangeCount: number | null;
                    unstagedChangeCount: number | null;
                    untrackedCount: number | null;
                };
                baseline: { branch: string | null; aheadCount: number | null; behindCount: number | null; summary: string } | null;
                insights: Array<{ type: string; content: string }>;
                promptText: string;
            };

            expect(pack.baseline?.branch).toBe('main');
            expect(pack.baseline?.aheadCount).toBe(1);
            expect(pack.workstream.currentHeadSha).toBe(featureHead);
            expect(pack.workstream.currentHeadRef).toBe('refs/heads/feature/runtime-shape');
            expect(pack.workstream.isDetachedHead).toBe(false);
            expect(pack.workstream.headDiffersFromCaptured).toBe(false);
            expect(pack.workstream.hasUncommittedChanges).toBe(true);
            expect(pack.workstream.stagedChangeCount).toBeGreaterThanOrEqual(1);
            expect(pack.workstream.unstagedChangeCount).toBe(1);
            expect(pack.workstream.untrackedCount).toBe(1);
            expect(pack.insights).toHaveLength(1);
            expect(pack.insights[0]?.type).toBe('decision');
            expect(pack.promptText).toContain('Baseline: feature/runtime-shape is 1 commit ahead of main.');
            expect(pack.promptText).toContain('Local changes:');
            expect(pack.promptText).toContain('staged');
            expect(pack.promptText).toContain('1 unstaged');
            expect(pack.promptText).toContain('1 untracked');
            expect(pack.promptText).toContain('Reviewed insights:');

            const insights = handleRequest(graph, 'conn-git', {
                method: 'listWorkstreamInsights',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    branch: 'feature/runtime-shape',
                    worktreePath: repoRoot
                }
            }, runtime()) as Array<{ type: string; content: string }>;

            expect(insights).toHaveLength(1);
            expect(insights[0]?.type).toBe('decision');

            const inferredBrief = handleRequest(graph, 'conn-git', {
                method: 'getWorkstreamBrief',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id
                }
            }, runtime()) as {
                branch: string | null;
                worktreePath: string | null;
                baseline: { branch: string | null; aheadCount: number | null; behindCount: number | null; summary: string } | null;
            };

            expect(inferredBrief.branch).toBe('feature/runtime-shape');
            expect(path.resolve(String(inferredBrief.worktreePath))).toBe(path.resolve(repoRoot));
            expect(inferredBrief.baseline?.branch).toBe('main');

            const inferredPack = handleRequest(graph, 'conn-git', {
                method: 'getAgentContextPack',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id
                }
            }, runtime()) as {
                branch: string | null;
                workstream: { branch: string | null };
                baseline: { branch: string | null } | null;
            };

            expect(inferredPack.branch).toBe('feature/runtime-shape');
            expect(inferredPack.workstream.branch).toBe('feature/runtime-shape');
            expect(inferredPack.baseline?.branch).toBe('main');
        } finally {
            db.close();
        }
    }, 15000);

    it('represents detached HEAD honestly in workstream context', () => {
        if (!gitAvailable()) return;
        const { db, graph } = createGraph();
        try {
            const repoRoot = path.join(os.tmpdir(), `0ctx-detached-head-${Date.now()}`);
            tempDirs.push(repoRoot);
            spawnSync('git', ['init', '--initial-branch', 'main', repoRoot], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'config', 'user.email', 'test@example.com'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'config', 'user.name', '0ctx test'], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(repoRoot, 'notes.txt')}' -Value 'base'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'add', '.'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'commit', '-m', 'base'], { encoding: 'utf8', windowsHide: true });
            const detachedHead = String(spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).stdout ?? '').trim();
            spawnSync('git', ['-C', repoRoot, 'checkout', '--detach'], { encoding: 'utf8', windowsHide: true });

            const session = handleRequest(graph, 'conn-detached', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-detached', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'detached-context', paths: [repoRoot] }
            }, runtime()) as { id: string };

            const brief = handleRequest(graph, 'conn-detached', {
                method: 'getWorkstreamBrief',
                sessionToken: session.sessionToken,
                params: { contextId: context.id }
            }, runtime()) as {
                branch: string | null;
                currentHeadSha: string | null;
                currentHeadRef: string | null;
                isDetachedHead: boolean | null;
                tracked: boolean;
                baseline: { branch: string | null; comparable: boolean; summary: string } | null;
                contextText: string;
            };

            expect(brief.branch).toBeNull();
            expect(brief.currentHeadSha).toBe(detachedHead);
            expect(brief.currentHeadRef).toBeNull();
            expect(brief.isDetachedHead).toBe(true);
            expect(brief.tracked).toBe(false);
            expect(brief.baseline?.branch).toBe('main');
            expect(brief.baseline?.comparable).toBe(false);
            expect(brief.contextText).toContain(`Current workstream: detached HEAD @ ${detachedHead.slice(0, 12)}`);
            expect(brief.contextText).toContain(`Git state: detached HEAD at ${detachedHead.slice(0, 12)}.`);

            const pack = handleRequest(graph, 'conn-detached', {
                method: 'getAgentContextPack',
                sessionToken: session.sessionToken,
                params: { contextId: context.id }
            }, runtime()) as {
                branch: string | null;
                workstream: {
                    branch: string | null;
                    currentHeadSha: string | null;
                    isDetachedHead: boolean | null;
                };
                promptText: string;
            };

            expect(pack.branch).toBeNull();
            expect(pack.workstream.branch).toBeNull();
            expect(pack.workstream.currentHeadSha).toBe(detachedHead);
            expect(pack.workstream.isDetachedHead).toBe(true);
            expect(pack.promptText).toContain(`Current workstream: detached HEAD @ ${detachedHead.slice(0, 12)}`);
        } finally {
            db.close();
        }
    }, 15000);

    it('compares workstreams with real git divergence and activity context', () => {
        if (!gitAvailable()) return;
        const { db, graph } = createGraph();
        try {
            const repoRoot = path.join(os.tmpdir(), `0ctx-workstream-compare-${Date.now()}`);
            tempDirs.push(repoRoot);

            spawnSync('git', ['init', '--initial-branch', 'main', repoRoot], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'config', 'user.email', 'test@example.com'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'config', 'user.name', '0ctx test'], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(repoRoot, 'notes.txt')}' -Value 'base'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'add', '.'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'commit', '-m', 'base'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'checkout', '-b', 'feature/runtime-compare'], { encoding: 'utf8', windowsHide: true });
            spawnSync('powershell', ['-NoProfile', '-Command', `Set-Content -Path '${path.join(repoRoot, 'notes.txt')}' -Value 'feature'`], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'add', '.'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'commit', '-m', 'feature'], { encoding: 'utf8', windowsHide: true });
            spawnSync('git', ['-C', repoRoot, 'checkout', 'main'], { encoding: 'utf8', windowsHide: true });

            const session = handleRequest(graph, 'conn-compare', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-compare', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'compare-context', paths: [repoRoot] }
            }, runtime()) as { id: string };

            const now = Date.now();
            const addCapturedMessage = (thread: string, branch: string, agent: string, occurredAt: number) => {
                handleRequest(graph, 'conn-compare', {
                    method: 'addNode',
                    sessionToken: session.sessionToken,
                    params: {
                        contextId: context.id,
                        type: 'artifact',
                        hidden: true,
                        thread,
                        key: `chat_session:${agent}:${thread}`,
                        content: `${branch} summary`,
                        tags: ['chat_session', `agent:${agent}`],
                        rawPayload: {
                            sessionId: thread,
                            branch,
                            agent,
                            worktreePath: repoRoot,
                            repositoryRoot: repoRoot
                        }
                    }
                }, runtime());

                handleRequest(graph, 'conn-compare', {
                    method: 'addNode',
                    sessionToken: session.sessionToken,
                    params: {
                        contextId: context.id,
                        type: 'artifact',
                        hidden: true,
                        thread,
                        key: `chat_turn:${agent}:${thread}:msg-1`,
                        content: `${branch} captured turn`,
                        tags: ['chat_turn', 'role:assistant'],
                        rawPayload: {
                            sessionId: thread,
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
            };

            addCapturedMessage('session-main-1', 'main', 'factory', now - 60_000);
            addCapturedMessage('session-feature-1', 'feature/runtime-compare', 'claude', now);

            const comparison = handleRequest(graph, 'conn-compare', {
                method: 'compareWorkstreams',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    sourceBranch: 'main',
                    targetBranch: 'feature/runtime-compare'
                }
            }, runtime()) as {
                sameRepository: boolean;
                comparable: boolean;
                sourceAheadCount: number | null;
                targetAheadCount: number | null;
                mergeBaseSha: string | null;
                source: { sessionCount: number; branch: string | null };
                target: { sessionCount: number; branch: string | null };
                sourceOnlyAgents: string[];
                targetOnlyAgents: string[];
                comparisonText: string;
                newerSide: string;
            };

            expect(comparison.sameRepository).toBe(true);
            expect(comparison.comparable).toBe(true);
            expect(comparison.sourceAheadCount).toBe(0);
            expect(comparison.targetAheadCount).toBe(1);
            expect(comparison.mergeBaseSha).toBeTruthy();
            expect(comparison.source.branch).toBe('main');
            expect(comparison.target.branch).toBe('feature/runtime-compare');
            expect(comparison.source.sessionCount).toBe(1);
            expect(comparison.target.sessionCount).toBe(1);
            expect(comparison.sourceOnlyAgents).toEqual(['factory']);
            expect(comparison.targetOnlyAgents).toEqual(['claude']);
            expect(comparison.newerSide).toBe('target');
            expect(comparison.comparisonText).toContain('Source: main');
            expect(comparison.comparisonText).toContain('Target: feature/runtime-compare');
        } finally {
            db.close();
        }
    });

    it('extracts visible knowledge nodes from sessions and checkpoints through daemon methods', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-extract', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-extract', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'extract-context' }
            }, runtime()) as { id: string };

            handleRequest(graph, 'conn-extract', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    type: 'artifact',
                    hidden: true,
                    thread: 'session-extract-1',
                    key: 'chat_session:factory:session-extract-1',
                    content: 'extract session summary',
                    tags: ['chat_session', 'agent:factory'],
                    rawPayload: {
                        sessionId: 'session-extract-1',
                        branch: 'feature/extract',
                        agent: 'factory'
                    }
                }
            }, runtime());

            handleRequest(graph, 'conn-extract', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    type: 'artifact',
                    hidden: true,
                    thread: 'session-extract-1',
                    key: 'chat_turn:factory:session-extract-1:user-1',
                    content: 'We need to keep the graph focused on visible project decisions.',
                    tags: ['chat_turn', 'role:user'],
                    rawPayload: {
                        sessionId: 'session-extract-1',
                        messageId: 'user-1',
                        role: 'user'
                    }
                }
            }, runtime());

            handleRequest(graph, 'conn-extract', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    type: 'artifact',
                    hidden: true,
                    thread: 'session-extract-1',
                    key: 'chat_turn:factory:session-extract-1:assistant-1',
                    content: 'We are going with visible decision nodes and hidden raw capture nodes.',
                    tags: ['chat_turn', 'role:assistant'],
                    rawPayload: {
                        sessionId: 'session-extract-1',
                        messageId: 'assistant-1',
                        role: 'assistant'
                    }
                }
            }, runtime());

            const preview = handleRequest(graph, 'conn-extract', {
                method: 'previewSessionKnowledge',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, sessionId: 'session-extract-1' }
            }, runtime()) as { candidateCount: number; createCount: number };
            expect(preview.candidateCount).toBeGreaterThan(0);
            expect(preview.createCount).toBeGreaterThan(0);

            const extracted = handleRequest(graph, 'conn-extract', {
                method: 'extractSessionKnowledge',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, sessionId: 'session-extract-1' }
            }, runtime()) as { createdCount: number; nodeCount: number };
            expect(extracted.createdCount).toBeGreaterThan(0);
            expect(extracted.nodeCount).toBeGreaterThan(0);

            const checkpoint = handleRequest(graph, 'conn-extract', {
                method: 'createSessionCheckpoint',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, sessionId: 'session-extract-1', summary: 'extract checkpoint' }
            }, runtime()) as { id: string; knowledge?: { nodeCount?: number; createdCount?: number } };
            expect(checkpoint.knowledge?.nodeCount ?? 0).toBeGreaterThan(0);
            expect((checkpoint.knowledge?.createdCount ?? 0) + ((checkpoint.knowledge as { reusedCount?: number } | undefined)?.reusedCount ?? 0)).toBeGreaterThan(0);

            const previewCheckpoint = handleRequest(graph, 'conn-extract', {
                method: 'previewCheckpointKnowledge',
                sessionToken: session.sessionToken,
                params: { checkpointId: checkpoint.id }
            }, runtime()) as { checkpointId: string | null; candidateCount: number };
            expect(previewCheckpoint.checkpointId).toBe(checkpoint.id);
            expect(previewCheckpoint.candidateCount).toBeGreaterThan(0);

            const fromCheckpoint = handleRequest(graph, 'conn-extract', {
                method: 'extractCheckpointKnowledge',
                sessionToken: session.sessionToken,
                params: { checkpointId: checkpoint.id }
            }, runtime()) as { checkpointId: string | null; nodeCount: number };
            expect(fromCheckpoint.checkpointId).toBe(checkpoint.id);
            expect(fromCheckpoint.nodeCount).toBeGreaterThan(0);

            const audit = handleRequest(graph, 'conn-extract', {
                method: 'listAuditEvents',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, limit: 20 }
            }, runtime()) as Array<{ action: string }>;
            expect(audit.filter(event => event.action === 'extract_knowledge').length).toBeGreaterThan(0);
        } finally {
            db.close();
        }
    });

    it('supports temporal, topic, graph, and auto recall methods', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-recall', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-recall', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'recall-context' }
            }, runtime()) as { id: string };

            const first = handleRequest(graph, 'conn-recall', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: { type: 'goal', content: 'Improve sleep quality with routine' }
            }, runtime()) as { id: string };

            const second = handleRequest(graph, 'conn-recall', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: { type: 'decision', content: 'Sleep interrupted at 3am, enforce bedtime protocol', tags: ['sleep'] }
            }, runtime()) as { id: string };

            handleRequest(graph, 'conn-recall', {
                method: 'addEdge',
                sessionToken: session.sessionToken,
                params: { fromId: second.id, toId: first.id, relation: 'supersedes' }
            }, runtime());

            const temporal = handleRequest(graph, 'conn-recall', {
                method: 'recallTemporal',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, sinceHours: 24, limit: 10 }
            }, runtime()) as { mode: string; totalEvents: number; sessions: unknown[] };

            const topic = handleRequest(graph, 'conn-recall', {
                method: 'recallTopic',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, query: 'sleep', sinceHours: 24, limit: 10 }
            }, runtime()) as { mode: string; hits: Array<{ nodeId: string; matchReason: string }> };

            const graphRecall = handleRequest(graph, 'conn-recall', {
                method: 'recallGraph',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, query: 'sleep', depth: 2, maxNodes: 20, limit: 5 }
            }, runtime()) as { mode: string; anchors: unknown[]; subgraph: { nodes: unknown[]; edges: unknown[] } };

            const auto = handleRequest(graph, 'conn-recall', {
                method: 'recall',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, mode: 'auto', query: 'sleep', sinceHours: 24, limit: 10 }
            }, runtime()) as { mode: string; summary: { topicHitCount: number; sessionCount: number } };

            expect(temporal.mode).toBe('temporal');
            expect(temporal.totalEvents).toBeGreaterThan(0);
            expect(temporal.sessions.length).toBeGreaterThan(0);

            expect(topic.mode).toBe('topic');
            expect(topic.hits.length).toBeGreaterThan(0);
            expect(topic.hits[0].nodeId).toBeTruthy();
            expect(topic.hits[0].matchReason).toBeTruthy();

            expect(graphRecall.mode).toBe('graph');
            expect(graphRecall.anchors.length).toBeGreaterThan(0);
            expect(graphRecall.subgraph.nodes.length).toBeGreaterThan(0);

            expect(auto.mode).toBe('auto');
            expect(auto.summary.topicHitCount).toBeGreaterThan(0);
            expect(auto.summary.sessionCount).toBeGreaterThan(0);
        } finally {
            db.close();
        }
    });

    it('records recall feedback as an audit event', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-feedback', { method: 'createSession' }, runtime()) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-feedback', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'recall-feedback-context' }
            }, runtime()) as { id: string };

            const node = handleRequest(graph, 'conn-feedback', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: { type: 'artifact', content: 'Recall target node for feedback' }
            }, runtime()) as { id: string };

            const feedback = handleRequest(graph, 'conn-feedback', {
                method: 'recallFeedback',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    nodeId: node.id,
                    helpful: true,
                    reason: 'top result matched user intent'
                }
            }, runtime()) as { ok: boolean; nodeId: string; helpful: boolean };

            const audit = handleRequest(graph, 'conn-feedback', {
                method: 'listAuditEvents',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, limit: 20 }
            }, runtime()) as Array<{ action: string; payload?: Record<string, unknown> }>;
            const listed = handleRequest(graph, 'conn-feedback', {
                method: 'listRecallFeedback',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, limit: 10 }
            }, runtime()) as {
                total: number;
                helpfulCount: number;
                notHelpfulCount: number;
                items: Array<{ nodeId: string; helpful: boolean }>;
            };

            expect(feedback.ok).toBe(true);
            expect(feedback.nodeId).toBe(node.id);
            expect(feedback.helpful).toBe(true);
            expect(audit.some(event => event.action === 'recall_feedback')).toBe(true);
            expect(listed.total).toBeGreaterThanOrEqual(1);
            expect(listed.helpfulCount).toBeGreaterThanOrEqual(1);
            expect(listed.notHelpfulCount).toBe(0);
            expect(listed.items.some(item => item.nodeId === node.id && item.helpful)).toBe(true);
        } finally {
            db.close();
        }
    });

    it('records and polls blackboard events via subscriptions', () => {
        const { db, graph } = createGraph();
        const events = new EventRuntime();
        const ctxRuntime: HandlerRuntimeContext = {
            ...runtime(),
            eventRuntime: events
        };

        try {
            const session = handleRequest(graph, 'conn-a', { method: 'createSession' }, ctxRuntime) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-a', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'blackboard-context' }
            }, ctxRuntime) as { id: string };

            const subscription = handleRequest(graph, 'conn-a', {
                method: 'subscribeEvents',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, types: ['NodeAdded'] }
            }, ctxRuntime) as { subscriptionId: string };

            handleRequest(graph, 'conn-a', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: { type: 'goal', content: 'Track blackboard events' }
            }, ctxRuntime);

            const polled = handleRequest(graph, 'conn-a', {
                method: 'pollEvents',
                sessionToken: session.sessionToken,
                params: { subscriptionId: subscription.subscriptionId }
            }, ctxRuntime) as { events: Array<{ type: string; contextId: string | null; sequence: number }> };

            expect(polled.events.length).toBeGreaterThan(0);
            expect(polled.events.some(event => event.type === 'NodeAdded')).toBe(true);
            expect(polled.events.every(event => event.contextId === context.id)).toBe(true);
        } finally {
            db.close();
        }
    });

    it('enforces task lease ownership semantics', () => {
        const { db, graph } = createGraph();
        const events = new EventRuntime();
        const ctxRuntime: HandlerRuntimeContext = {
            ...runtime(),
            eventRuntime: events
        };

        try {
            const sessionA = handleRequest(graph, 'conn-a', { method: 'createSession' }, ctxRuntime) as { sessionToken: string };
            const sessionB = handleRequest(graph, 'conn-b', { method: 'createSession' }, ctxRuntime) as { sessionToken: string };

            const claimA = handleRequest(graph, 'conn-a', {
                method: 'claimTask',
                sessionToken: sessionA.sessionToken,
                params: { taskId: 'task-1', leaseMs: 30000 }
            }, ctxRuntime) as { claimed: boolean };

            const claimBWhileHeld = handleRequest(graph, 'conn-b', {
                method: 'claimTask',
                sessionToken: sessionB.sessionToken,
                params: { taskId: 'task-1', leaseMs: 30000 }
            }, ctxRuntime) as { claimed: boolean };

            const releaseA = handleRequest(graph, 'conn-a', {
                method: 'releaseTask',
                sessionToken: sessionA.sessionToken,
                params: { taskId: 'task-1' }
            }, ctxRuntime) as { released: boolean };

            const claimBAfterRelease = handleRequest(graph, 'conn-b', {
                method: 'claimTask',
                sessionToken: sessionB.sessionToken,
                params: { taskId: 'task-1', leaseMs: 30000 }
            }, ctxRuntime) as { claimed: boolean };

            expect(claimA.claimed).toBe(true);
            expect(claimBWhileHeld.claimed).toBe(false);
            expect(releaseA.released).toBe(true);
            expect(claimBAfterRelease.claimed).toBe(true);
        } finally {
            db.close();
        }
    });

    it('evaluates blackboard completion deterministically', () => {
        const { db, graph } = createGraph();
        const events = new EventRuntime();
        const ctxRuntime: HandlerRuntimeContext = {
            ...runtime(),
            eventRuntime: events
        };

        try {
            const session = handleRequest(graph, 'conn-a', { method: 'createSession' }, ctxRuntime) as { sessionToken: string };
            const context = handleRequest(graph, 'conn-a', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'completion-context' }
            }, ctxRuntime) as { id: string };

            handleRequest(graph, 'conn-a', {
                method: 'claimTask',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, taskId: 'task-1', leaseMs: 60_000 }
            }, ctxRuntime);
            handleRequest(graph, 'conn-a', {
                method: 'resolveGate',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, gateId: 'typecheck', status: 'open', severity: 'high' }
            }, ctxRuntime);

            const blocked = handleRequest(graph, 'conn-a', {
                method: 'evaluateCompletion',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, cooldownMs: 0, requiredGates: ['typecheck'] }
            }, ctxRuntime) as { complete: boolean; reasons: string[] };

            handleRequest(graph, 'conn-a', {
                method: 'releaseTask',
                sessionToken: session.sessionToken,
                params: { taskId: 'task-1' }
            }, ctxRuntime);
            handleRequest(graph, 'conn-a', {
                method: 'resolveGate',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, gateId: 'typecheck', status: 'resolved' }
            }, ctxRuntime);

            const complete = handleRequest(graph, 'conn-a', {
                method: 'evaluateCompletion',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, cooldownMs: 0, requiredGates: ['typecheck'] }
            }, ctxRuntime) as { complete: boolean; reasons: string[] };

            expect(blocked.complete).toBe(false);
            expect(blocked.reasons).toContain('open_gates');
            expect(blocked.reasons).toContain('active_leases');
            expect(complete.complete).toBe(true);
            expect(complete.reasons).toHaveLength(0);
        } finally {
            db.close();
        }
    });
});
