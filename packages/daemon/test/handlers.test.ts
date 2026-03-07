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
            spawnSync('git', ['init', '--initial-branch', 'feature/runtime-shape', repoRoot], { encoding: 'utf8', windowsHide: true });

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
                        agent: 'claude',
                        worktreePath: repoRoot,
                        repositoryRoot: repoRoot,
                        occurredAt: Date.now()
                    }
                }
            }, runtime());

            const lanes = handleRequest(graph, 'conn-git', {
                method: 'listBranchLanes',
                sessionToken: session.sessionToken,
                params: { contextId: context.id }
            }, runtime()) as Array<{
                branch: string;
                repositoryRoot: string | null;
                isCurrent: boolean | null;
                upstream: string | null;
            }>;

            expect(lanes).toHaveLength(1);
            expect(lanes[0].branch).toBe('feature/runtime-shape');
            expect(lanes[0].repositoryRoot).toBe(repoRoot);
            expect(lanes[0].isCurrent).toBe(true);
            expect(lanes[0].upstream).toBeNull();

            const brief = handleRequest(graph, 'conn-git', {
                method: 'getWorkstreamBrief',
                sessionToken: session.sessionToken,
                params: {
                    contextId: context.id,
                    branch: 'feature/runtime-shape',
                    worktreePath: repoRoot
                }
            }, runtime()) as { repositoryRoot: string | null; isCurrent: boolean | null; contextText: string };

            expect(brief.repositoryRoot).toBe(repoRoot);
            expect(brief.isCurrent).toBe(true);
            expect(brief.contextText).toContain('Git state: current local workstream.');
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
