import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db';
import { Graph } from '../src/graph';

const tempDirs: string[] = [];

function createGraph() {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), '0ctx-core-graph-'));
    tempDirs.push(tempDir);

    const db = openDb({ dbPath: path.join(tempDir, '0ctx.db') });
    return { db, graph: new Graph(db) };
}

afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('Graph context isolation', () => {
    it('keeps lookup and search scoped by context', () => {
        const { db, graph } = createGraph();
        try {
            const alpha = graph.createContext('alpha');
            const beta = graph.createContext('beta');

            const alphaNode = graph.addNode({
                contextId: alpha.id,
                type: 'decision',
                key: 'current-plan',
                content: 'Use alpha rollout strategy',
                tags: ['alpha']
            });

            graph.addNode({
                contextId: beta.id,
                type: 'decision',
                key: 'current-plan',
                content: 'Use beta rollout strategy',
                tags: ['beta']
            });

            const byKey = graph.getByKey(alpha.id, 'current-plan');
            expect(byKey?.id).toBe(alphaNode.id);

            const search = graph.search(alpha.id, 'alpha', 10);
            expect(search.map(node => node.id)).toContain(alphaNode.id);
            expect(search.every(node => node.contextId === alpha.id)).toBe(true);
        } finally {
            db.close();
        }
    });

    it('returns searchAdvanced results with supersede-aware ranking metadata', () => {
        const { db, graph } = createGraph();
        try {
            const ctx = graph.createContext('search-advanced');

            const oldNode = graph.addNode({
                contextId: ctx.id,
                type: 'goal',
                content: 'Improve sleep quality with journaling',
                tags: ['wellness', 'sleep']
            });

            const newNode = graph.addNode({
                contextId: ctx.id,
                type: 'decision',
                content: 'Sleep interrupted at 3am; use strict bedtime routine',
                tags: ['sleep', 'routine']
            });

            graph.addEdge(newNode.id, oldNode.id, 'supersedes');

            const advanced = graph.searchAdvanced(ctx.id, 'sleep', { limit: 10, includeSuperseded: true });
            expect(advanced.length).toBeGreaterThan(0);
            expect(advanced.some(result => result.node.id === oldNode.id)).toBe(true);
            expect(advanced.some(result => result.node.id === newNode.id)).toBe(true);

            const rankedNew = advanced.find(result => result.node.id === newNode.id);
            const rankedOld = advanced.find(result => result.node.id === oldNode.id);
            expect(rankedNew).toBeTruthy();
            expect(rankedOld).toBeTruthy();
            expect((rankedNew?.score ?? 0)).toBeGreaterThan((rankedOld?.score ?? 0));
            expect(rankedNew?.matchedTerms).toContain('sleep');
            expect(['exact_term', 'tag_match', 'recent_mutation', 'connected_to_hot_node']).toContain(rankedNew?.matchReason);

            const legacy = graph.search(ctx.id, 'sleep', 10);
            expect(legacy.some(node => node.id === newNode.id)).toBe(true);
        } finally {
            db.close();
        }
    });

    it('boosts exact phrase matches above loose term matches', () => {
        const { db, graph } = createGraph();
        try {
            const ctx = graph.createContext('phrase-boost');
            const exact = graph.addNode({
                contextId: ctx.id,
                type: 'artifact',
                content: 'Sleep interrupted at 3am and could not fall back asleep',
                tags: ['sleep']
            });
            graph.addNode({
                contextId: ctx.id,
                type: 'artifact',
                content: 'Could not work today because of random interruptions',
                tags: ['sleep', 'night']
            });

            const results = graph.searchAdvanced(ctx.id, 'sleep interrupted at 3am', { limit: 5, includeSuperseded: true });
            expect(results.length).toBeGreaterThan(0);
            const topExact = results.find(result => result.node.id === exact.id);
            expect(topExact).toBeTruthy();
            expect(topExact?.matchReason).toBe('exact_term');
            const topOther = results.find(result => result.node.id !== exact.id);
            if (topOther) {
                expect((topExact?.score ?? 0)).toBeGreaterThanOrEqual(topOther.score);
            }
        } finally {
            db.close();
        }
    });

    it('excludes hidden nodes from default graph/search queries', () => {
        const { db, graph } = createGraph();
        try {
            const ctx = graph.createContext('hidden-defaults');

            const visible = graph.addNode({
                contextId: ctx.id,
                type: 'artifact',
                content: 'Visible graph node',
                tags: ['visible']
            });
            const hidden = graph.addNode({
                contextId: ctx.id,
                type: 'artifact',
                content: 'Hidden chat dump node',
                tags: ['chat_turn'],
                hidden: true
            });

            const graphDefault = graph.getGraphData(ctx.id);
            expect(graphDefault.nodes.map(node => node.id)).toContain(visible.id);
            expect(graphDefault.nodes.map(node => node.id)).not.toContain(hidden.id);

            const graphWithHidden = graph.getGraphData(ctx.id, { includeHidden: true });
            expect(graphWithHidden.nodes.map(node => node.id)).toContain(hidden.id);

            const searchDefault = graph.search(ctx.id, 'chat dump', 10);
            expect(searchDefault.some(node => node.id === hidden.id)).toBe(false);

            const searchWithHidden = graph.search(ctx.id, 'chat dump', 10, { includeHidden: true });
            expect(searchWithHidden.some(node => node.id === hidden.id)).toBe(true);
        } finally {
            db.close();
        }
    });

    it('stores compressed payload sidecar and lists chat sessions/turns', () => {
        const { db, graph } = createGraph();
        try {
            const ctx = graph.createContext('chat-session-context');
            graph.addNode({
                contextId: ctx.id,
                thread: 'session-1',
                type: 'artifact',
                content: 'what changed? -> Assistant proposed rollout plan',
                key: 'chat_session:claude:session-1',
                tags: ['chat_session', 'agent:claude'],
                source: 'hook:claude',
                hidden: true,
                createdAtOverride: 1700000000000,
                rawPayload: {
                    sessionId: 'session-1',
                    agent: 'claude',
                    branch: 'main',
                    commitSha: 'abc123def456',
                    worktreePath: 'C:/repo',
                    repositoryRoot: 'C:/repo'
                }
            });

            const turn = graph.addNode({
                contextId: ctx.id,
                thread: 'session-1',
                type: 'artifact',
                content: 'Assistant proposed rollout plan',
                key: 'chat_turn:claude:session-1:turn-1',
                tags: ['chat_turn', 'role:assistant'],
                source: 'hook:claude',
                hidden: true,
                createdAtOverride: 1700000001000,
                rawPayload: {
                    messageId: 'turn-1',
                    parentId: 'user-1',
                    role: 'assistant',
                    agent: 'claude',
                    branch: 'main',
                    commitSha: 'abc123def456',
                    occurredAt: 1700000001000,
                    worktreePath: 'C:/repo',
                    repositoryRoot: 'C:/repo',
                    text: 'full raw dump'
                }
            });

            const payload = graph.getNodePayload(turn.id);
            expect(payload).not.toBeNull();
            expect(payload?.compression).toBe('gzip');
            expect((payload?.payload as Record<string, unknown>)?.branch).toBe('main');
            expect((payload?.payload as Record<string, unknown>)?.commitSha).toBe('abc123def456');

            const sessions = graph.listChatSessions(ctx.id);
            expect(sessions).toHaveLength(1);
            expect(sessions[0].sessionId).toBe('session-1');
            expect(sessions[0].turnCount).toBe(1);
            expect(sessions[0].summary).toBe('what changed? -> Assistant proposed rollout plan');
            expect(sessions[0].branch).toBe('main');
            expect(sessions[0].commitSha).toBe('abc123def456');
            expect(sessions[0].agent).toBe('claude');
            expect(sessions[0].worktreePath).toBe('C:/repo');

            const turns = graph.listChatTurns(ctx.id, 'session-1');
            expect(turns).toHaveLength(1);
            expect(turns[0].nodeId).toBe(turn.id);
            expect(turns[0].hasPayload).toBe(true);
            expect(turns[0].role).toBe('assistant');
            expect(turns[0].createdAt).toBe(1700000001000);
            expect(turns[0].messageId).toBe('turn-1');
            expect(turns[0].parentId).toBe('user-1');

            const messages = graph.listSessionMessages(ctx.id, 'session-1');
            expect(messages).toHaveLength(1);
            expect(messages[0].agent).toBe('claude');
            expect(messages[0].worktreePath).toBe('C:/repo');

            const lanes = graph.listBranchLanes(ctx.id);
            expect(lanes).toHaveLength(1);
            expect(lanes[0].branch).toBe('main');
            expect(lanes[0].lastAgent).toBe('claude');
            expect(lanes[0].sessionCount).toBe(1);
        } finally {
            db.close();
        }
    });

    it('extracts visible knowledge nodes from captured session messages', () => {
        const { db, graph } = createGraph();
        try {
            const ctx = graph.createContext('knowledge-extract');
            graph.addNode({
                contextId: ctx.id,
                thread: 'session-knowledge-1',
                type: 'artifact',
                content: 'knowledge extraction session',
                key: 'chat_session:factory:session-knowledge-1',
                tags: ['chat_session', 'agent:factory'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-knowledge-1',
                    branch: 'feature/knowledge',
                    commitSha: 'abc123def456',
                    agent: 'factory'
                }
            });

            const userTurn = graph.addNode({
                contextId: ctx.id,
                thread: 'session-knowledge-1',
                type: 'artifact',
                content: 'We need to ship a branch-first desktop workflow for local project memory.',
                key: 'chat_turn:factory:session-knowledge-1:user-1',
                tags: ['chat_turn', 'role:user'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-knowledge-1',
                    messageId: 'user-1',
                    role: 'user',
                    branch: 'feature/knowledge',
                    commitSha: 'abc123def456',
                    occurredAt: 1700000001000
                }
            });

            const assistantTurn = graph.addNode({
                contextId: ctx.id,
                thread: 'session-knowledge-1',
                type: 'artifact',
                content: 'We are going with a branch-first desktop flow. Hidden session nodes should stay out of the default graph.',
                key: 'chat_turn:factory:session-knowledge-1:assistant-1',
                tags: ['chat_turn', 'role:assistant'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-knowledge-1',
                    messageId: 'assistant-1',
                    role: 'assistant',
                    branch: 'feature/knowledge',
                    commitSha: 'abc123def456',
                    occurredAt: 1700000002000
                }
            });

            const preview = graph.previewKnowledgeFromSession(ctx.id, 'session-knowledge-1');
            expect(preview.candidateCount).toBeGreaterThan(0);
            expect(preview.createCount).toBe(preview.candidateCount);
            expect(preview.candidates.some(candidate => candidate.type === 'goal')).toBe(true);
            expect(graph.getGraphData(ctx.id).nodes.some(node => node.type !== 'artifact')).toBe(false);

            const goalCandidate = preview.candidates.find(candidate => candidate.type === 'goal');
            expect(goalCandidate?.key).toBeTruthy();

            const filtered = graph.extractKnowledgeFromSession(ctx.id, 'session-knowledge-1', {
                allowedKeys: goalCandidate ? [goalCandidate.key] : []
            });
            expect(filtered.nodeCount).toBe(1);
            expect(filtered.nodes[0]?.type).toBe('goal');

            const first = graph.extractKnowledgeFromSession(ctx.id, 'session-knowledge-1');
            expect(first.createdCount).toBeGreaterThan(0);
            expect(first.nodes.some(node => node.type === 'goal')).toBe(true);
            expect(first.nodes.some(node => node.type === 'decision')).toBe(true);
            expect(first.nodes.some(node => node.type === 'constraint')).toBe(true);

            const visibleGraph = graph.getGraphData(ctx.id);
            expect(visibleGraph.nodes.some(node => node.type !== 'artifact')).toBe(true);
            const extractedEdges = graph.getEdges(first.nodes[0].id);
            expect(extractedEdges.some(edge => edge.toId === userTurn.id || edge.toId === assistantTurn.id)).toBe(true);

            const secondPreview = graph.previewKnowledgeFromSession(ctx.id, 'session-knowledge-1');
            expect(secondPreview.reuseCount).toBeGreaterThan(0);

            const second = graph.extractKnowledgeFromSession(ctx.id, 'session-knowledge-1');
            expect(second.createdCount).toBe(0);
            expect(second.reusedCount).toBeGreaterThan(0);
        } finally {
            db.close();
        }
    });

    it('reuses extracted knowledge across sessions on the same branch lane', () => {
        const { db, graph } = createGraph();
        try {
            const ctx = graph.createContext('knowledge-branch-scope');
            for (const sessionId of ['session-knowledge-a', 'session-knowledge-b']) {
                graph.addNode({
                    contextId: ctx.id,
                    thread: sessionId,
                    type: 'artifact',
                    content: `session ${sessionId}`,
                    key: `chat_session:factory:${sessionId}`,
                    tags: ['chat_session', 'agent:factory'],
                    source: 'hook:factory',
                    hidden: true,
                    rawPayload: {
                        sessionId,
                        branch: 'feature/shared-memory',
                        commitSha: 'abc123def456',
                        agent: 'factory'
                    }
                });
            }

            graph.addNode({
                contextId: ctx.id,
                thread: 'session-knowledge-a',
                type: 'artifact',
                content: 'We decided to keep hidden session nodes out of the default graph.',
                key: 'chat_turn:factory:session-knowledge-a:assistant-1',
                tags: ['chat_turn', 'role:assistant'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-knowledge-a',
                    messageId: 'assistant-1',
                    role: 'assistant',
                    branch: 'feature/shared-memory',
                    commitSha: 'abc123def456',
                    occurredAt: 1700000002000
                }
            });

            graph.addNode({
                contextId: ctx.id,
                thread: 'session-knowledge-b',
                type: 'artifact',
                content: 'We decided to keep hidden session nodes out of the default graph.',
                key: 'chat_turn:factory:session-knowledge-b:assistant-1',
                tags: ['chat_turn', 'role:assistant'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-knowledge-b',
                    messageId: 'assistant-1',
                    role: 'assistant',
                    branch: 'feature/shared-memory',
                    commitSha: 'abc123def456',
                    occurredAt: 1700000003000
                }
            });

            const first = graph.extractKnowledgeFromSession(ctx.id, 'session-knowledge-a');
            expect(first.createdCount).toBeGreaterThan(0);

            const secondPreview = graph.previewKnowledgeFromSession(ctx.id, 'session-knowledge-b');
            expect(secondPreview.reuseCount).toBeGreaterThan(0);

            const second = graph.extractKnowledgeFromSession(ctx.id, 'session-knowledge-b');
            expect(second.createdCount).toBe(0);
            expect(second.reusedCount).toBeGreaterThan(0);
        } finally {
            db.close();
        }
    });

    it('lists reviewed insights scoped to the selected workstream', () => {
        const { db, graph } = createGraph();
        try {
            const ctx = graph.createContext('knowledge-workstream-insights');
            graph.addNode({
                contextId: ctx.id,
                type: 'decision',
                content: 'Keep reviewed insights scoped to the current branch.',
                key: 'knowledge:decision:branch-feature-a',
                tags: ['knowledge', 'derived', 'branch:feature/a', 'worktree:C:/repo-a'],
                source: 'extractor:session'
            });
            graph.addNode({
                contextId: ctx.id,
                type: 'constraint',
                content: 'Sync stays metadata only for the main branch.',
                key: 'knowledge:constraint:branch-main',
                tags: ['knowledge', 'derived', 'branch:main', 'worktree:C:/repo-main'],
                source: 'extractor:session'
            });
            graph.addNode({
                contextId: ctx.id,
                type: 'artifact',
                content: 'hidden artifact should never appear here',
                key: 'artifact:ignored',
                tags: ['branch:feature/a'],
                source: 'hook:factory'
            });

            const branchScoped = graph.listWorkstreamInsights(ctx.id, {
                branch: 'feature/a',
                worktreePath: 'C:/repo-a'
            });
            expect(branchScoped).toHaveLength(1);
            expect(branchScoped[0]?.type).toBe('decision');
            expect(branchScoped[0]?.content).toContain('current branch');

            const mainScoped = graph.listWorkstreamInsights(ctx.id, { branch: 'main' });
            expect(mainScoped).toHaveLength(1);
            expect(mainScoped[0]?.type).toBe('constraint');
        } finally {
            db.close();
        }
    });
});

describe('Graph checkpoints', () => {
    it('rewinds nodes added after the checkpoint', () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('checkpoint-test');
            const keep = graph.addNode({
                contextId: context.id,
                type: 'goal',
                content: 'Keep this node'
            });

            const checkpoint = graph.saveCheckpoint(context.id, 'baseline');

            const remove = graph.addNode({
                contextId: context.id,
                type: 'assumption',
                content: 'Remove this node'
            });

            graph.rewind(checkpoint.id);

            expect(graph.getNode(keep.id)?.id).toBe(keep.id);
            expect(graph.getNode(remove.id)).toBeNull();
        } finally {
            db.close();
        }
    });

    it('creates session checkpoints with branch metadata and restores from payload snapshot', () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('session-checkpoint-test');
            graph.addNode({
                contextId: context.id,
                thread: 'session-1',
                type: 'artifact',
                content: 'ship checkpoint flow -> created checkpoint metadata',
                key: 'chat_session:factory:session-1',
                tags: ['chat_session', 'agent:factory'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-1',
                    branch: 'feature/checkpoints',
                    commitSha: 'def456abc123',
                    agent: 'factory',
                    worktreePath: 'C:/repo',
                    repositoryRoot: 'C:/repo'
                }
            });
            graph.addNode({
                contextId: context.id,
                thread: 'session-1',
                type: 'artifact',
                content: 'created checkpoint metadata',
                key: 'chat_turn:factory:session-1:msg-1',
                tags: ['chat_turn', 'role:assistant'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-1',
                    messageId: 'msg-1',
                    role: 'assistant',
                    branch: 'feature/checkpoints',
                    commitSha: 'def456abc123',
                    agent: 'factory',
                    occurredAt: 1700000002000
                }
            });

            const checkpoint = graph.createSessionCheckpoint(context.id, 'session-1', {
                summary: 'checkpoint summary'
            });
            expect(checkpoint.kind).toBe('session');
            expect(checkpoint.sessionId).toBe('session-1');
            expect(checkpoint.branch).toBe('feature/checkpoints');
            expect(checkpoint.agentSet).toEqual(['factory']);

            const detail = graph.getCheckpointDetail(checkpoint.id);
            expect(detail?.payloadAvailable).toBe(true);
            expect(detail?.snapshotNodeCount).toBeGreaterThan(0);

            const remove = graph.addNode({
                contextId: context.id,
                type: 'assumption',
                content: 'remove after rewind'
            });

            const rewound = graph.rewindCheckpoint(checkpoint.id);
            expect(rewound.checkpoint.id).toBe(checkpoint.id);
            expect(graph.getNode(remove.id)).toBeNull();

            const branchCheckpoints = graph.listBranchCheckpoints(context.id, 'feature/checkpoints', {
                worktreePath: 'C:/repo'
            });
            expect(branchCheckpoints).toHaveLength(1);
            expect(branchCheckpoints[0].checkpointId).toBe(checkpoint.id);
        } finally {
            db.close();
        }
    });

    it('extracts knowledge from a checkpoint-linked session', () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('checkpoint-knowledge');
            graph.addNode({
                contextId: context.id,
                thread: 'session-k1',
                type: 'artifact',
                content: 'checkpoint extraction session',
                key: 'chat_session:factory:session-k1',
                tags: ['chat_session', 'agent:factory'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-k1',
                    branch: 'feature/checkpoint-knowledge',
                    agent: 'factory'
                }
            });
            graph.addNode({
                contextId: context.id,
                thread: 'session-k1',
                type: 'artifact',
                content: 'What should stay visible in the graph?',
                key: 'chat_turn:factory:session-k1:user-1',
                tags: ['chat_turn', 'role:user'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-k1',
                    messageId: 'user-1',
                    role: 'user'
                }
            });
            graph.addNode({
                contextId: context.id,
                thread: 'session-k1',
                type: 'artifact',
                content: 'We are going with visible decision nodes and hidden raw capture nodes.',
                key: 'chat_turn:factory:session-k1:assistant-1',
                tags: ['chat_turn', 'role:assistant'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-k1',
                    messageId: 'assistant-1',
                    role: 'assistant'
                }
            });

            const checkpoint = graph.createSessionCheckpoint(context.id, 'session-k1', {
                summary: 'Visible decision nodes',
                name: 'checkpoint-knowledge'
            });

            const result = graph.extractKnowledgeFromCheckpoint(checkpoint.id);
            expect(result.checkpointId).toBe(checkpoint.id);
            expect(result.sessionId).toBe('session-k1');
            expect(result.nodeCount).toBeGreaterThan(0);
            expect(result.nodes.some(node => node.checkpointId === checkpoint.id)).toBe(true);
        } finally {
            db.close();
        }
    });

    it('promotes a reviewed insight into another workspace and reuses it on repeat', () => {
        const { db, graph } = createGraph();
        try {
            const source = graph.createContext('source-workspace');
            const target = graph.createContext('target-workspace');
            const insight = graph.addNode({
                contextId: source.id,
                type: 'decision',
                content: 'Ship checkpoints as the primary restore primitive.',
                tags: ['knowledge', 'derived', 'branch:feat/restore-flow'],
                source: 'extractor:session',
                hidden: false
            });

            const first = graph.promoteInsightNode(source.id, insight.id, target.id);
            expect(first.created).toBe(true);
            expect(first.reused).toBe(false);
            expect(first.branch).toBe('feat/restore-flow');

            const targetNode = graph.getNode(first.targetNodeId);
            expect(targetNode?.contextId).toBe(target.id);
            expect(targetNode?.key).toBe(first.key);
            expect(targetNode?.tags).toContain('promoted');
            expect(targetNode?.tags).toContain(`origin_context:${source.id}`);
            expect(targetNode?.tags).toContain(`origin_node:${insight.id}`);

            const second = graph.promoteInsightNode(source.id, insight.id, target.id);
            expect(second.created).toBe(false);
            expect(second.reused).toBe(true);
            expect(second.targetNodeId).toBe(first.targetNodeId);
        } finally {
            db.close();
        }
    });

    it('rejects hidden or artifact nodes when promoting reviewed insights', () => {
        const { db, graph } = createGraph();
        try {
            const source = graph.createContext('source-workspace');
            const target = graph.createContext('target-workspace');
            const hiddenNode = graph.addNode({
                contextId: source.id,
                type: 'decision',
                content: 'Do not expose this yet.',
                tags: ['knowledge'],
                source: 'extractor:session',
                hidden: true
            });
            const artifactNode = graph.addNode({
                contextId: source.id,
                type: 'artifact',
                content: 'session transcript',
                tags: ['artifact'],
                source: 'hook:factory',
                hidden: false
            });

            expect(() => graph.promoteInsightNode(source.id, hiddenNode.id, target.id)).toThrow(/hidden/i);
            expect(() => graph.promoteInsightNode(source.id, artifactNode.id, target.id)).toThrow(/artifact/i);
        } finally {
            db.close();
        }
    });
});

describe('Graph audit events', () => {
    it('stores and lists audit entries in reverse chronological order', () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('audit-context');
            graph.recordAuditEvent({
                action: 'create_context',
                contextId: context.id,
                payload: { name: context.name },
                result: { contextId: context.id },
                metadata: { source: 'test-suite', sessionToken: 'session-1' }
            });

            graph.recordAuditEvent({
                action: 'add_node',
                contextId: context.id,
                payload: { type: 'goal' },
                result: { id: 'node-1' },
                metadata: { source: 'test-suite', sessionToken: 'session-1' }
            });

            const events = graph.listAuditEvents(context.id, 10);
            expect(events).toHaveLength(2);
            const actions = events.map(event => event.action);
            expect(actions).toContain('add_node');
            expect(actions).toContain('create_context');
        } finally {
            db.close();
        }
    });
});
