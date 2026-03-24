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
    it('can reuse an existing keyed node instead of inserting a duplicate', () => {
        const { db, graph } = createGraph();
        try {
            const ctx = graph.createContext('dedupe-by-key');

            const first = graph.ensureNodeByKey({
                contextId: ctx.id,
                type: 'artifact',
                hidden: true,
                key: 'chat_turn:claude:session-1:turn-1',
                content: 'hello',
                tags: ['chat_turn', 'agent:claude']
            });
            const second = graph.ensureNodeByKey({
                contextId: ctx.id,
                type: 'artifact',
                hidden: true,
                key: 'chat_turn:claude:session-1:turn-1',
                content: 'hello',
                tags: ['chat_turn', 'agent:claude']
            });

            expect(first.created).toBe(true);
            expect(second.created).toBe(false);
            expect(second.node.id).toBe(first.node.id);
            expect(graph.search(ctx.id, 'hello', 10, { includeHidden: true })).toHaveLength(1);
        } finally {
            db.close();
        }
    });

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
            expect(preview.candidates.some(candidate => candidate.type === 'decision')).toBe(true);
            expect(preview.candidates.some(candidate => candidate.type === 'constraint')).toBe(true);
            expect(graph.getGraphData(ctx.id).nodes.some(node => node.type !== 'artifact')).toBe(false);

            const first = graph.extractKnowledgeFromSession(ctx.id, 'session-knowledge-1');
            expect(first.createdCount).toBeGreaterThan(0);
            expect(first.nodes.some(node => node.type === 'goal')).toBe(true);
            expect(first.nodes.some(node => node.type === 'decision')).toBe(false);
            expect(first.nodes.some(node => node.type === 'constraint')).toBe(false);

            const visibleGraph = graph.getGraphData(ctx.id);
            expect(visibleGraph.nodes.some(node => node.type !== 'artifact')).toBe(true);
            const extractedEdges = graph.getEdges(first.nodes[0].id);
            expect(extractedEdges.some(edge => edge.toId === userTurn.id || edge.toId === assistantTurn.id)).toBe(true);

            const goalCandidate = preview.candidates.find(candidate => candidate.type === 'goal');
            expect(goalCandidate?.key).toBeTruthy();

            const filtered = graph.extractKnowledgeFromSession(ctx.id, 'session-knowledge-1', {
                allowedKeys: goalCandidate ? [goalCandidate.key] : []
            });
            expect(filtered.nodeCount).toBe(1);
            expect(filtered.nodes[0]?.type).toBe('goal');

            const secondPreview = graph.previewKnowledgeFromSession(ctx.id, 'session-knowledge-1');
            expect(secondPreview.reuseCount).toBeGreaterThan(0);

            const second = graph.extractKnowledgeFromSession(ctx.id, 'session-knowledge-1');
            expect(second.createdCount).toBe(0);
            expect(second.reusedCount).toBeGreaterThan(0);
        } finally {
            db.close();
        }
    });

    it('boosts reviewed insight confidence when the same signal repeats across messages', () => {
        const { db, graph } = createGraph();
        try {
            const ctx = graph.createContext('knowledge-repeated-evidence');
            graph.addNode({
                contextId: ctx.id,
                thread: 'session-repeated-1',
                type: 'artifact',
                content: 'repeated evidence session',
                key: 'chat_session:factory:session-repeated-1',
                tags: ['chat_session', 'agent:factory'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-repeated-1',
                    branch: 'feature/repeated-evidence',
                    commitSha: 'abc123def456',
                    agent: 'factory'
                }
            });

            graph.addNode({
                contextId: ctx.id,
                thread: 'session-repeated-1',
                type: 'artifact',
                content: 'We need to ship a branch-first desktop workflow for local project memory.',
                key: 'chat_turn:factory:session-repeated-1:user-1',
                tags: ['chat_turn', 'role:user'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-repeated-1',
                    messageId: 'user-1',
                    role: 'user',
                    branch: 'feature/repeated-evidence',
                    occurredAt: 1700000101000
                }
            });

            graph.addNode({
                contextId: ctx.id,
                thread: 'session-repeated-1',
                type: 'artifact',
                content: 'We need to ship a branch-first desktop workflow for local project memory.',
                key: 'chat_turn:factory:session-repeated-1:assistant-1',
                tags: ['chat_turn', 'role:assistant'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-repeated-1',
                    messageId: 'assistant-1',
                    role: 'assistant',
                    branch: 'feature/repeated-evidence',
                    occurredAt: 1700000102000
                }
            });

            const preview = graph.previewKnowledgeFromSession(ctx.id, 'session-repeated-1');
            const repeatedGoal = preview.candidates.find((candidate) => candidate.type === 'goal');
            expect(repeatedGoal?.evidenceCount).toBe(2);
            expect(Number(repeatedGoal?.confidence || 0)).toBeGreaterThan(0.9);
            expect(String(repeatedGoal?.reason || '')).toContain('repeated-2-times');
            expect(String(repeatedGoal?.reason || '')).toContain('corroborated-across-roles');
            expect(repeatedGoal?.reviewTier).toBe('review');
            expect(String(repeatedGoal?.reviewSummary || '')).toContain('one session');
            expect(repeatedGoal?.autoPersist).toBe(false);
            expect(String(repeatedGoal?.autoPersistSummary || '')).toContain('Single-session corroboration stays manual');
            expect(repeatedGoal?.distinctEvidenceCount).toBe(1);
            expect(repeatedGoal?.distinctSessionCount).toBe(1);
            expect(String(repeatedGoal?.evidenceSummary || '')).toContain('Repeated 2 times across user and assistant messages');
            expect(String(repeatedGoal?.trustSummary || '')).toContain('Repeated within one session only');
            expect(repeatedGoal?.promotionState).toBe('review');
            expect(String(repeatedGoal?.promotionSummary || '')).toContain('single session');
            expect(repeatedGoal?.trustFlags).toEqual(expect.arrayContaining(['repeated', 'cross_role', 'same_session_only']));
            expect(repeatedGoal?.trustFlags).not.toContain('distinct_support');
            expect(Array.isArray(repeatedGoal?.evidencePreview)).toBe(true);
            expect(String(repeatedGoal?.sourceExcerpt || '')).toContain('branch-first desktop workflow');
            expect(preview.summary).toMatchObject({
                strongCount: 0,
                reviewCount: 1,
                weakCount: 0,
                autoPersistCount: 0,
                reviewOnlyCount: 1,
                readyPromotionCount: 0,
                reviewPromotionCount: 1,
                blockedPromotionCount: 0
            });
        } finally {
            db.close();
        }
    });

    it('does not auto-persist same-session cross-role corroboration at checkpoint time', () => {
        const { db, graph } = createGraph();
        try {
            const ctx = graph.createContext('knowledge-same-session-manual');
            graph.addNode({
                contextId: ctx.id,
                thread: 'session-same-session-manual-1',
                type: 'artifact',
                content: 'same session corroboration session',
                key: 'chat_session:factory:session-same-session-manual-1',
                tags: ['chat_session', 'agent:factory'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-same-session-manual-1',
                    branch: 'feature/same-session-manual',
                    agent: 'factory'
                }
            });

            graph.addNode({
                contextId: ctx.id,
                thread: 'session-same-session-manual-1',
                type: 'artifact',
                content: 'We need to keep checkpoint restore explicit across workstreams.',
                key: 'chat_turn:factory:session-same-session-manual-1:user-1',
                tags: ['chat_turn', 'role:user'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-same-session-manual-1',
                    messageId: 'user-1',
                    role: 'user',
                    branch: 'feature/same-session-manual',
                    occurredAt: 1700000103000
                }
            });

            graph.addNode({
                contextId: ctx.id,
                thread: 'session-same-session-manual-1',
                type: 'artifact',
                content: 'We need to keep checkpoint restore explicit across workstreams.',
                key: 'chat_turn:factory:session-same-session-manual-1:assistant-1',
                tags: ['chat_turn', 'role:assistant'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-same-session-manual-1',
                    messageId: 'assistant-1',
                    role: 'assistant',
                    branch: 'feature/same-session-manual',
                    occurredAt: 1700000104000
                }
            });

            const autoPersistOnly = graph.extractKnowledgeFromSession(ctx.id, 'session-same-session-manual-1', {
                autoPersistOnly: true
            });
            expect(autoPersistOnly.nodeCount).toBe(0);

            const manual = graph.previewKnowledgeFromSession(ctx.id, 'session-same-session-manual-1');
            const candidate = manual.candidates.find((item) => item.type === 'goal');
            expect(candidate?.reviewTier).toBe('review');
            expect(candidate?.autoPersist).toBe(false);
            expect(candidate?.trustFlags).toEqual(expect.arrayContaining(['same_session_only', 'cross_role']));
        } finally {
            db.close();
        }
    });

    it('does not treat repeated identical user-only statements as distinct corroboration', () => {
        const { db, graph } = createGraph();
        try {
            const ctx = graph.createContext('knowledge-duplicate-user-evidence');
            graph.addNode({
                contextId: ctx.id,
                thread: 'session-duplicate-user-1',
                type: 'artifact',
                content: 'duplicate user evidence session',
                key: 'chat_session:factory:session-duplicate-user-1',
                tags: ['chat_session', 'agent:factory'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-duplicate-user-1',
                    branch: 'feature/duplicate-user-evidence',
                    commitSha: 'abc123def456',
                    agent: 'factory'
                }
            });

            for (const [key, createdAt] of [
                ['user-1', 1700000151000],
                ['user-2', 1700000152000]
            ] as const) {
                graph.addNode({
                    contextId: ctx.id,
                    thread: 'session-duplicate-user-1',
                    type: 'artifact',
                    content: 'Metadata_only should remain the default sync policy.',
                    key: `chat_turn:factory:session-duplicate-user-1:${key}`,
                    tags: ['chat_turn', 'role:user'],
                    source: 'hook:factory',
                    hidden: true,
                    rawPayload: {
                        sessionId: 'session-duplicate-user-1',
                        messageId: key,
                        role: 'user',
                        branch: 'feature/duplicate-user-evidence',
                        occurredAt: createdAt
                    }
                });
            }

            const preview = graph.previewKnowledgeFromSession(ctx.id, 'session-duplicate-user-1');
            const repeatedConstraint = preview.candidates.find((candidate) => candidate.type === 'constraint');
            expect(repeatedConstraint).toBeTruthy();
            expect(repeatedConstraint?.evidenceCount).toBe(2);
            expect(repeatedConstraint?.distinctEvidenceCount).toBe(1);
            expect(Number(repeatedConstraint?.confidence || 0)).toBeLessThan(0.9);
            expect(repeatedConstraint?.reviewTier).toBe('review');
            expect(String(repeatedConstraint?.evidenceSummary || '')).toContain('Distinct supporting statements: 1');
            expect(repeatedConstraint?.trustFlags).toEqual(expect.arrayContaining(['repeated', 'user_only', 'duplicate_only']));
        } finally {
            db.close();
        }
    });

    it('keeps repeated single-role signals in review instead of upgrading them to strong', () => {
        const { db, graph } = createGraph();
        try {
            const ctx = graph.createContext('knowledge-single-role-repeat-review');
            graph.addNode({
                contextId: ctx.id,
                thread: 'session-single-role-review-1',
                type: 'artifact',
                content: 'single-role repeat review session',
                key: 'chat_session:factory:session-single-role-review-1',
                tags: ['chat_session', 'agent:factory'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-single-role-review-1',
                    branch: 'feature/single-role-review',
                    agent: 'factory'
                }
            });

            for (const [key, content, createdAt] of [
                ['assistant-1', 'We decided to keep branch-first workstreams as the default organization model.', 1700000161000],
                ['assistant-2', 'We chose to keep branch-first workstreams as the default organization model.', 1700000162000]
            ] as const) {
                graph.addNode({
                    contextId: ctx.id,
                    thread: 'session-single-role-review-1',
                    type: 'artifact',
                    content,
                    key: `chat_turn:factory:session-single-role-review-1:${key}`,
                    tags: ['chat_turn', 'role:assistant'],
                    source: 'hook:factory',
                    hidden: true,
                    rawPayload: {
                        sessionId: 'session-single-role-review-1',
                        messageId: key,
                        role: 'assistant',
                        branch: 'feature/single-role-review',
                        occurredAt: createdAt
                    }
                });
            }

            const preview = graph.previewKnowledgeFromSession(ctx.id, 'session-single-role-review-1');
            const decision = preview.candidates.find((candidate) => candidate.type === 'decision');
            expect(decision).toBeTruthy();
            expect(decision?.reviewTier).toBe('review');
            expect(String(decision?.reviewSummary || '')).toContain('Repeated single-role signal');
            expect(decision?.autoPersist).toBe(false);
            expect(String(decision?.autoPersistSummary || '')).toContain('Assistant-only');
            expect(decision?.trustFlags).toEqual(expect.arrayContaining(['repeated', 'distinct_support', 'assistant_only']));
        } finally {
            db.close();
        }
    });

    it('deduplicates reviewed insights across common boilerplate prefixes', () => {
        const { db, graph } = createGraph();
        try {
            const ctx = graph.createContext('knowledge-canonical-dedupe');
            graph.addNode({
                contextId: ctx.id,
                thread: 'session-canonical-1',
                type: 'artifact',
                content: 'canonical dedupe session',
                key: 'chat_session:factory:session-canonical-1',
                tags: ['chat_session', 'agent:factory'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-canonical-1',
                    branch: 'feature/canonical-dedupe',
                    commitSha: '001122334455',
                    agent: 'factory'
                }
            });

            graph.addNode({
                contextId: ctx.id,
                thread: 'session-canonical-1',
                type: 'artifact',
                content: 'We need to ship a branch-first desktop workflow for local project memory.',
                key: 'chat_turn:factory:session-canonical-1:user-1',
                tags: ['chat_turn', 'role:user'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-canonical-1',
                    messageId: 'user-1',
                    role: 'user',
                    branch: 'feature/canonical-dedupe',
                    occurredAt: 1700000201000
                }
            });

            graph.addNode({
                contextId: ctx.id,
                thread: 'session-canonical-1',
                type: 'artifact',
                content: 'Need to ship a branch-first desktop workflow for local project memory.',
                key: 'chat_turn:factory:session-canonical-1:assistant-1',
                tags: ['chat_turn', 'role:assistant'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-canonical-1',
                    messageId: 'assistant-1',
                    role: 'assistant',
                    branch: 'feature/canonical-dedupe',
                    occurredAt: 1700000202000
                }
            });

            const preview = graph.previewKnowledgeFromSession(ctx.id, 'session-canonical-1');
            const goalCandidates = preview.candidates.filter((candidate) => candidate.type === 'goal');
            expect(goalCandidates).toHaveLength(1);
            expect(goalCandidates[0]?.evidenceCount).toBe(2);
            expect(goalCandidates[0]?.corroboratedRoles).toContain('user');
            expect(goalCandidates[0]?.corroboratedRoles).toContain('assistant');
        } finally {
            db.close();
        }
    });
    it('filters operational chatter out of reviewed insights', () => {
        const { db, graph } = createGraph();
        try {
            const ctx = graph.createContext('knowledge-noise-filter');
            graph.addNode({
                contextId: ctx.id,
                thread: 'session-noise-1',
                type: 'artifact',
                content: 'noise filtering session',
                key: 'chat_session:factory:session-noise-1',
                tags: ['chat_session', 'agent:factory'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-noise-1',
                    branch: 'feature/noise-filter',
                    commitSha: 'def456abc123',
                    agent: 'factory'
                }
            });

            for (const [key, role, content, createdAt] of [
                ['assistant-1', 'assistant', 'Implemented the next slice and tests passed after npm run build.', 1700000100000],
                ['assistant-2', 'assistant', 'Click refresh and restart the connector after reinstall.', 1700000101000],
                ['user-1', 'user', 'Can you please rerun the smoke test after refresh?', 1700000102000],
                ['assistant-3', 'assistant', 'We decided to keep 0ctx enable as the normal repo-first path.', 1700000103000]
            ] as const) {
                graph.addNode({
                    contextId: ctx.id,
                    thread: 'session-noise-1',
                    type: 'artifact',
                    content,
                    key: `chat_turn:factory:session-noise-1:${key}`,
                    tags: ['chat_turn', `role:${role}`],
                    source: 'hook:factory',
                    hidden: true,
                    rawPayload: {
                        sessionId: 'session-noise-1',
                        messageId: key,
                        role,
                        branch: 'feature/noise-filter',
                        commitSha: 'def456abc123',
                        occurredAt: createdAt
                    }
                });
            }

            const preview = graph.previewKnowledgeFromSession(ctx.id, 'session-noise-1');
            expect(preview.candidates.some(candidate => /tests passed/i.test(candidate.content))).toBe(false);
            expect(preview.candidates.some(candidate => /click refresh/i.test(candidate.content))).toBe(false);
            expect(preview.candidates.some(candidate => /rerun the smoke test/i.test(candidate.content))).toBe(false);
            expect(preview.candidates.some(candidate => candidate.type === 'decision' && /0ctx enable/i.test(candidate.content))).toBe(true);

            const extraction = graph.extractKnowledgeFromSession(ctx.id, 'session-noise-1');
            expect(extraction.nodeCount).toBe(0);

            const permissiveExtraction = graph.extractKnowledgeFromSession(ctx.id, 'session-noise-1', { minConfidence: 0.68 });
            expect(permissiveExtraction.nodeCount).toBe(1);
            expect(permissiveExtraction.nodes[0]?.type).toBe('decision');
            expect(permissiveExtraction.nodes[0]?.content).toContain('0ctx enable');
        } finally {
            db.close();
        }
    });

    it('filters roadmap and progress chatter out of reviewed insights', () => {
        const { db, graph } = createGraph();
        try {
            const ctx = graph.createContext('knowledge-roadmap-filter');
            graph.addNode({
                contextId: ctx.id,
                thread: 'session-roadmap-1',
                type: 'artifact',
                content: 'roadmap filtering session',
                key: 'chat_session:factory:session-roadmap-1',
                tags: ['chat_session', 'agent:factory'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-roadmap-1',
                    branch: 'feature/roadmap-filter',
                    commitSha: 'fedcba654321',
                    agent: 'factory'
                }
            });

            for (const [key, role, content, createdAt] of [
                ['assistant-1', 'assistant', 'Where we are: not done yet, but this was not circular work.', 1700000200000],
                ['assistant-2', 'assistant', 'Best next move is supported-agent retrieval ergonomics, then lean data policy finalization.', 1700000201000],
                ['assistant-3', 'assistant', 'The default sync policy should remain metadata_only unless users explicitly opt into full_sync.', 1700000202000],
                ['user-1', 'user', 'We need to keep metadata_only as the default sync policy for the normal path.', 1700000203000]
            ] as const) {
                graph.addNode({
                    contextId: ctx.id,
                    thread: 'session-roadmap-1',
                    type: 'artifact',
                    content,
                    key: `chat_turn:factory:session-roadmap-1:${key}`,
                    tags: ['chat_turn', `role:${role}`],
                    source: 'hook:factory',
                    hidden: true,
                    rawPayload: {
                        sessionId: 'session-roadmap-1',
                        messageId: key,
                        role,
                        branch: 'feature/roadmap-filter',
                        commitSha: 'fedcba654321',
                        occurredAt: createdAt
                    }
                });
            }

            const preview = graph.previewKnowledgeFromSession(ctx.id, 'session-roadmap-1');
            expect(preview.candidates.some(candidate => /where we are/i.test(candidate.content))).toBe(false);
            expect(preview.candidates.some(candidate => /best next move/i.test(candidate.content))).toBe(false);
            expect(preview.candidates.some(candidate => /metadata only/i.test(candidate.content))).toBe(true);

            const extraction = graph.extractKnowledgeFromSession(ctx.id, 'session-roadmap-1');
            expect(extraction.nodeCount).toBeGreaterThanOrEqual(1);
            expect(extraction.nodes.some(node => /metadata only/i.test(node.content))).toBe(true);
            expect(extraction.nodes.some(node => /where we are/i.test(node.content))).toBe(false);
            expect(extraction.nodes.some(node => /best next move/i.test(node.content))).toBe(false);
        } finally {
            db.close();
        }
    });

    it('filters quoted and source-attributed statements out of reviewed insights', () => {
        const { db, graph } = createGraph();
        try {
            const ctx = graph.createContext('knowledge-attribution-filter');
            graph.addNode({
                contextId: ctx.id,
                thread: 'session-attribution-1',
                type: 'artifact',
                content: 'attribution filtering session',
                key: 'chat_session:factory:session-attribution-1',
                tags: ['chat_session', 'agent:factory'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-attribution-1',
                    branch: 'feature/attribution-filter',
                    commitSha: 'attribution123456',
                    agent: 'factory'
                }
            });

            for (const [key, role, content, createdAt] of [
                ['assistant-1', 'assistant', 'The roadmap recommends using metadata_only by default for new workspaces.', 1700000220000],
                ['assistant-2', 'assistant', 'The docs require users to restart the connector after reinstalling.', 1700000221000],
                ['assistant-3', 'assistant', 'Quote: "Keep raw payload inspection utility-only."', 1700000222000],
                ['assistant-4', 'assistant', 'We decided raw payload inspection should stay utility-only.', 1700000223000]
            ] as const) {
                graph.addNode({
                    contextId: ctx.id,
                    thread: 'session-attribution-1',
                    type: 'artifact',
                    content,
                    key: `chat_turn:factory:session-attribution-1:${key}`,
                    tags: ['chat_turn', `role:${role}`],
                    source: 'hook:factory',
                    hidden: true,
                    rawPayload: {
                        sessionId: 'session-attribution-1',
                        messageId: key,
                        role,
                        branch: 'feature/attribution-filter',
                        commitSha: 'attribution123456',
                        occurredAt: createdAt
                    }
                });
            }

            const preview = graph.previewKnowledgeFromSession(ctx.id, 'session-attribution-1');
            expect(preview.candidates.some(candidate => /roadmap recommends/i.test(candidate.content))).toBe(false);
            expect(preview.candidates.some(candidate => /docs require users/i.test(candidate.content))).toBe(false);
            expect(preview.candidates.some(candidate => /quote:/i.test(candidate.content))).toBe(false);
            expect(preview.candidates.some(candidate => /raw payload inspection should stay utility-only/i.test(candidate.content))).toBe(true);

            const extraction = graph.extractKnowledgeFromSession(ctx.id, 'session-attribution-1');
            expect(extraction.nodeCount).toBe(0);

            const permissiveExtraction = graph.extractKnowledgeFromSession(ctx.id, 'session-attribution-1', { minConfidence: 0.68 });
            expect(permissiveExtraction.nodeCount).toBe(1);
            expect(permissiveExtraction.nodes[0]?.type).toBe('constraint');
            expect(permissiveExtraction.nodes[0]?.content).toContain('raw payload inspection should stay utility-only');
        } finally {
            db.close();
        }
    });

    it('filters assistant planning chatter out of reviewed insights', () => {
        const { db, graph } = createGraph();
        try {
            const ctx = graph.createContext('knowledge-planning-filter');
            graph.addNode({
                contextId: ctx.id,
                thread: 'session-planning-1',
                type: 'artifact',
                content: 'planning filtering session',
                key: 'chat_session:factory:session-planning-1',
                tags: ['chat_session', 'agent:factory'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-planning-1',
                    branch: 'feature/planning-filter',
                    commitSha: '1234abcd9999',
                    agent: 'factory'
                }
            });

            for (const [key, role, content, createdAt] of [
                ['assistant-1', 'assistant', 'We need to keep going on supported-agent retrieval ergonomics next.', 1700000250000],
                ['assistant-2', 'assistant', 'The correct move is to continue on retention UX after that.', 1700000251000],
                ['assistant-3', 'assistant', 'We decided metadata_only should remain the default sync policy.', 1700000252000]
            ] as const) {
                graph.addNode({
                    contextId: ctx.id,
                    thread: 'session-planning-1',
                    type: 'artifact',
                    content,
                    key: `chat_turn:factory:session-planning-1:${key}`,
                    tags: ['chat_turn', `role:${role}`],
                    source: 'hook:factory',
                    hidden: true,
                    rawPayload: {
                        sessionId: 'session-planning-1',
                        messageId: key,
                        role,
                        branch: 'feature/planning-filter',
                        commitSha: '1234abcd9999',
                        occurredAt: createdAt
                    }
                });
            }

            const preview = graph.previewKnowledgeFromSession(ctx.id, 'session-planning-1');
            expect(preview.candidates.some(candidate => /keep going on supported-agent retrieval/i.test(candidate.content))).toBe(false);
            expect(preview.candidates.some(candidate => /continue on retention ux/i.test(candidate.content))).toBe(false);
            expect(preview.candidates.some(candidate => /metadata only should remain the default sync policy/i.test(candidate.content))).toBe(true);
            const constraintCandidate = preview.candidates.find(candidate => /metadata only should remain the default sync policy/i.test(candidate.content));
            expect(constraintCandidate?.reviewTier).toBe('review');
            expect(String(constraintCandidate?.evidenceSummary || '')).toContain('Single assistant-only statement');

            const extraction = graph.extractKnowledgeFromSession(ctx.id, 'session-planning-1');
            expect(extraction.nodeCount).toBe(0);

            const permissiveExtraction = graph.extractKnowledgeFromSession(ctx.id, 'session-planning-1', { minConfidence: 0.68 });
            expect(permissiveExtraction.nodeCount).toBe(1);
            expect(permissiveExtraction.nodes[0]?.type).toBe('constraint');
        } finally {
            db.close();
        }
    });

    it('filters sequencing chatter even when it mentions durable policy words', () => {
        const { db, graph } = createGraph();
        try {
            const ctx = graph.createContext('knowledge-sequencing-filter');
            graph.addNode({
                contextId: ctx.id,
                thread: 'session-sequencing-1',
                type: 'artifact',
                content: 'sequencing filtering session',
                key: 'chat_session:factory:session-sequencing-1',
                tags: ['chat_session', 'agent:factory'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-sequencing-1',
                    branch: 'feature/sequencing-filter',
                    commitSha: '7777abcd9999',
                    agent: 'factory'
                }
            });

            for (const [key, role, content, createdAt] of [
                ['assistant-1', 'assistant', 'The next step should be making metadata_only the default sync policy everywhere.', 1700000253000],
                ['assistant-2', 'assistant', 'Then we should finish zero-touch retrieval for supported agents.', 1700000254000],
                ['assistant-3', 'assistant', 'Metadata_only should remain the default sync policy for new workspaces.', 1700000255000]
            ] as const) {
                graph.addNode({
                    contextId: ctx.id,
                    thread: 'session-sequencing-1',
                    type: 'artifact',
                    content,
                    key: `chat_turn:factory:session-sequencing-1:${key}`,
                    tags: ['chat_turn', `role:${role}`],
                    source: 'hook:factory',
                    hidden: true,
                    rawPayload: {
                        sessionId: 'session-sequencing-1',
                        messageId: key,
                        role,
                        branch: 'feature/sequencing-filter',
                        commitSha: '7777abcd9999',
                        occurredAt: createdAt
                    }
                });
            }

            const preview = graph.previewKnowledgeFromSession(ctx.id, 'session-sequencing-1');
            expect(preview.candidates.some(candidate => /next step should be making metadata only/i.test(candidate.content))).toBe(false);
            expect(preview.candidates.some(candidate => /finish zero-touch retrieval/i.test(candidate.content))).toBe(false);
            expect(preview.candidates.some(candidate => /metadata only should remain the default sync policy/i.test(candidate.content))).toBe(true);

            const extraction = graph.extractKnowledgeFromSession(ctx.id, 'session-sequencing-1');
            expect(extraction.nodeCount).toBe(0);

            const permissiveExtraction = graph.extractKnowledgeFromSession(ctx.id, 'session-sequencing-1', { minConfidence: 0.68 });
            expect(permissiveExtraction.nodeCount).toBe(1);
            expect(permissiveExtraction.nodes[0]?.content).toContain('Metadata only should remain the default sync policy');
        } finally {
            db.close();
        }
    });

    it('filters repair and support procedures while honoring confidence thresholds', () => {
        const { db, graph } = createGraph();
        try {
            const ctx = graph.createContext('knowledge-support-filter');
            graph.addNode({
                contextId: ctx.id,
                thread: 'session-support-1',
                type: 'artifact',
                content: 'support filtering session',
                key: 'chat_session:factory:session-support-1',
                tags: ['chat_session', 'agent:factory'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-support-1',
                    branch: 'feature/support-filter',
                    commitSha: '1234abcd5678',
                    agent: 'factory'
                }
            });

            for (const [key, role, content, createdAt] of [
                ['assistant-1', 'assistant', 'Please run 0ctx repair and restart the connector if the issue remains.', 1700000300000],
                ['assistant-2', 'assistant', 'It seems the local daemon is probably the right source of truth for project state.', 1700000301000],
                ['assistant-3', 'assistant', 'We decided to keep reviewed insights explicit instead of silently blending them across workspaces.', 1700000302000]
            ] as const) {
                graph.addNode({
                    contextId: ctx.id,
                    thread: 'session-support-1',
                    type: 'artifact',
                    content,
                    key: `chat_turn:factory:session-support-1:${key}`,
                    tags: ['chat_turn', `role:${role}`],
                    source: 'hook:factory',
                    hidden: true,
                    rawPayload: {
                        sessionId: 'session-support-1',
                        messageId: key,
                        role,
                        branch: 'feature/support-filter',
                        commitSha: '1234abcd5678',
                        occurredAt: createdAt
                    }
                });
            }

            const preview = graph.previewKnowledgeFromSession(ctx.id, 'session-support-1');
            expect(preview.candidates.some(candidate => /run 0ctx repair/i.test(candidate.content))).toBe(false);
            expect(preview.candidates.some(candidate => candidate.type === 'assumption')).toBe(true);
            expect(preview.candidates.some(candidate => candidate.type === 'decision')).toBe(true);

            const highConfidence = graph.previewKnowledgeFromSession(ctx.id, 'session-support-1', { minConfidence: 0.8 });
            expect(highConfidence.candidates.some(candidate => candidate.type === 'assumption')).toBe(false);
            expect(highConfidence.candidates.some(candidate => candidate.type === 'decision')).toBe(false);
            const decisionCandidate = preview.candidates.find(candidate => candidate.type === 'decision');
            expect(decisionCandidate?.reviewTier).toBe('review');
            expect(String(decisionCandidate?.evidenceSummary || '')).toContain('Single assistant-only statement');
            expect(String(decisionCandidate?.reviewSummary || '')).toContain('Review before promoting');

            const extracted = graph.extractKnowledgeFromSession(ctx.id, 'session-support-1');
            expect(extracted.nodeCount).toBe(0);

            const permissiveExtraction = graph.extractKnowledgeFromSession(ctx.id, 'session-support-1', { minConfidence: 0.67 });
            expect(permissiveExtraction.nodeCount).toBe(1);
            expect(permissiveExtraction.nodes[0]?.type).toBe('decision');
            expect(permissiveExtraction.nodes[0]?.content).toContain('reviewed insights');
        } finally {
            db.close();
        }
    });

    it('filters implementation-status chatter out of reviewed insights', () => {
        const { db, graph } = createGraph();
        try {
            const ctx = graph.createContext('knowledge-implementation-filter');
            graph.addNode({
                contextId: ctx.id,
                thread: 'session-implementation-1',
                type: 'artifact',
                content: 'implementation filtering session',
                key: 'chat_session:factory:session-implementation-1',
                tags: ['chat_session', 'agent:factory'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-implementation-1',
                    branch: 'feature/implementation-filter',
                    commitSha: 'aa11bb22cc33',
                    agent: 'factory'
                }
            });

            for (const [key, role, content, createdAt] of [
                ['assistant-1', 'assistant', 'The desktop app now shows workstream compare in the branches view.', 1700000400000],
                ['assistant-2', 'assistant', 'The daemon now returns changed-file overlap and hotspot summaries.', 1700000401000],
                ['assistant-3', 'assistant', 'We decided to keep workstream compare explicit instead of hiding divergence.', 1700000402000]
            ] as const) {
                graph.addNode({
                    contextId: ctx.id,
                    thread: 'session-implementation-1',
                    type: 'artifact',
                    content,
                    key: `chat_turn:factory:session-implementation-1:${key}`,
                    tags: ['chat_turn', `role:${role}`],
                    source: 'hook:factory',
                    hidden: true,
                    rawPayload: {
                        sessionId: 'session-implementation-1',
                        messageId: key,
                        role,
                        branch: 'feature/implementation-filter',
                        commitSha: 'aa11bb22cc33',
                        occurredAt: createdAt
                    }
                });
            }

            const preview = graph.previewKnowledgeFromSession(ctx.id, 'session-implementation-1');
            expect(preview.candidates.some(candidate => /desktop app now shows/i.test(candidate.content))).toBe(false);
            expect(preview.candidates.some(candidate => /daemon now returns/i.test(candidate.content))).toBe(false);
            expect(preview.candidates.some(candidate => /workstream compare explicit/i.test(candidate.content))).toBe(true);
            const decisionCandidate = preview.candidates.find(candidate => /workstream compare explicit/i.test(candidate.content));
            expect(decisionCandidate?.reviewTier).toBe('review');
            expect(String(decisionCandidate?.evidenceSummary || '')).toContain('Single assistant-only statement');

            const extraction = graph.extractKnowledgeFromSession(ctx.id, 'session-implementation-1');
            expect(extraction.nodeCount).toBe(0);

            const permissiveExtraction = graph.extractKnowledgeFromSession(ctx.id, 'session-implementation-1', { minConfidence: 0.66 });
            expect(permissiveExtraction.nodeCount).toBe(1);
            expect(permissiveExtraction.nodes[0]?.type).toBe('decision');
            expect(permissiveExtraction.nodes[0]?.content).toContain('workstream compare explicit');
        } finally {
            db.close();
        }
    });

    it('filters low-level design and layout churn out of reviewed insights', () => {
        const { db, graph } = createGraph();
        try {
            const ctx = graph.createContext('knowledge-design-filter');
            graph.addNode({
                contextId: ctx.id,
                thread: 'session-design-1',
                type: 'artifact',
                content: 'design filtering session',
                key: 'chat_session:factory:session-design-1',
                tags: ['chat_session', 'agent:factory'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-design-1',
                    branch: 'feature/design-filter',
                    commitSha: 'dd11cc22bb33',
                    agent: 'factory'
                }
            });

            for (const [key, role, content, createdAt] of [
                ['assistant-1', 'assistant', 'We decided to move setup into the utility dock and simplify the sidebar chrome.', 1700000450000],
                ['assistant-2', 'assistant', 'The topbar was tightened and the reader body spacing was reduced for a calmer layout.', 1700000451000],
                ['assistant-3', 'assistant', 'The normal path should stay focused on workspaces, workstreams, sessions, and checkpoints.', 1700000452000]
            ] as const) {
                graph.addNode({
                    contextId: ctx.id,
                    thread: 'session-design-1',
                    type: 'artifact',
                    content,
                    key: `chat_turn:factory:session-design-1:${key}`,
                    tags: ['chat_turn', `role:${role}`],
                    source: 'hook:factory',
                    hidden: true,
                    rawPayload: {
                        sessionId: 'session-design-1',
                        messageId: key,
                        role,
                        branch: 'feature/design-filter',
                        commitSha: 'dd11cc22bb33',
                        occurredAt: createdAt
                    }
                });
            }

            const preview = graph.previewKnowledgeFromSession(ctx.id, 'session-design-1');
            expect(preview.candidates.some(candidate => /utility dock/i.test(candidate.content))).toBe(false);
            expect(preview.candidates.some(candidate => /reader body spacing/i.test(candidate.content))).toBe(false);
            expect(preview.candidates.some(candidate => /normal path should stay focused/i.test(candidate.content))).toBe(true);

            const extraction = graph.extractKnowledgeFromSession(ctx.id, 'session-design-1');
            expect(extraction.nodeCount).toBe(0);

            const permissiveExtraction = graph.extractKnowledgeFromSession(ctx.id, 'session-design-1', { minConfidence: 0.68 });
            expect(permissiveExtraction.nodeCount).toBe(1);
            expect(permissiveExtraction.nodes[0]?.type).toBe('constraint');
            expect(permissiveExtraction.nodes[0]?.content).toContain('normal path should stay focused');
        } finally {
            db.close();
        }
    });

    it('keeps low-confidence assumptions in preview but out of default extraction', () => {
        const { db, graph } = createGraph();
        try {
            const ctx = graph.createContext('knowledge-default-threshold');
            graph.addNode({
                contextId: ctx.id,
                thread: 'session-threshold-1',
                type: 'artifact',
                content: 'threshold filtering session',
                key: 'chat_session:factory:session-threshold-1',
                tags: ['chat_session', 'agent:factory'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-threshold-1',
                    branch: 'feature/threshold-filter',
                    commitSha: 'dd44ee55ff66',
                    agent: 'factory'
                }
            });

            graph.addNode({
                contextId: ctx.id,
                thread: 'session-threshold-1',
                type: 'artifact',
                content: 'It seems the local daemon is probably the right source of truth for project state.',
                key: 'chat_turn:factory:session-threshold-1:assistant-1',
                tags: ['chat_turn', 'role:assistant'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-threshold-1',
                    messageId: 'assistant-1',
                    role: 'assistant',
                    branch: 'feature/threshold-filter',
                    commitSha: 'dd44ee55ff66',
                    occurredAt: 1700000500000
                }
            });

            const preview = graph.previewKnowledgeFromSession(ctx.id, 'session-threshold-1');
            expect(preview.candidates.some(candidate => candidate.type === 'assumption')).toBe(true);
            const assumptionCandidate = preview.candidates.find(candidate => candidate.type === 'assumption');
            expect(assumptionCandidate?.reviewTier).toBe('weak');
            expect(String(assumptionCandidate?.reviewSummary || '')).toContain('Tentative signal');

            const extraction = graph.extractKnowledgeFromSession(ctx.id, 'session-threshold-1');
            expect(extraction.nodeCount).toBe(0);

            const permissiveExtraction = graph.extractKnowledgeFromSession(ctx.id, 'session-threshold-1', { minConfidence: 0.55 });
            expect(permissiveExtraction.nodeCount).toBe(1);
            expect(permissiveExtraction.nodes[0]?.type).toBe('assumption');
        } finally {
            db.close();
        }
    });

    it('keeps single assistant goals in review but out of default extraction', () => {
        const { db, graph } = createGraph();
        try {
            const ctx = graph.createContext('knowledge-assistant-goal-threshold');
            graph.addNode({
                contextId: ctx.id,
                thread: 'session-assistant-goal-1',
                type: 'artifact',
                content: 'assistant-only goal session',
                key: 'chat_session:factory:session-assistant-goal-1',
                tags: ['chat_session', 'agent:factory'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-assistant-goal-1',
                    branch: 'feature/assistant-goal-threshold',
                    commitSha: 'ab12cd34ef56',
                    agent: 'factory'
                }
            });

            graph.addNode({
                contextId: ctx.id,
                thread: 'session-assistant-goal-1',
                type: 'artifact',
                content: 'We need to support automatic context injection for Claude session start.',
                key: 'chat_turn:factory:session-assistant-goal-1:assistant-1',
                tags: ['chat_turn', 'role:assistant'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-assistant-goal-1',
                    messageId: 'assistant-1',
                    role: 'assistant',
                    branch: 'feature/assistant-goal-threshold',
                    commitSha: 'ab12cd34ef56',
                    occurredAt: 1700000550000
                }
            });

            const preview = graph.previewKnowledgeFromSession(ctx.id, 'session-assistant-goal-1');
            expect(preview.candidates.some(candidate => candidate.type === 'goal')).toBe(true);
            const goalCandidate = preview.candidates.find(candidate => candidate.type === 'goal');
            expect(goalCandidate?.reviewTier).toBe('review');
            expect(String(goalCandidate?.evidenceSummary || '')).toContain('Single assistant-only statement');
            expect(goalCandidate?.autoPersist).toBe(false);
            expect(String(goalCandidate?.autoPersistSummary || '')).toContain('Assistant-only');
            expect(goalCandidate?.promotionState).toBe('blocked');
            expect(String(goalCandidate?.promotionSummary || '')).toContain('assistant-only');

            const extraction = graph.extractKnowledgeFromSession(ctx.id, 'session-assistant-goal-1');
            expect(extraction.nodeCount).toBe(0);

            const autoPersistExtraction = graph.extractKnowledgeFromSession(ctx.id, 'session-assistant-goal-1', {
                minConfidence: 0.64,
                autoPersistOnly: true
            });
            expect(autoPersistExtraction.nodeCount).toBe(0);

            const permissiveExtraction = graph.extractKnowledgeFromSession(ctx.id, 'session-assistant-goal-1', { minConfidence: 0.64 });
            expect(permissiveExtraction.nodeCount).toBe(1);
            expect(permissiveExtraction.nodes[0]?.type).toBe('goal');
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
                content: 'We need to keep hidden session nodes out of the default graph.',
                key: 'chat_turn:factory:session-knowledge-a:user-1',
                tags: ['chat_turn', 'role:user'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-knowledge-a',
                    messageId: 'user-1',
                    role: 'user',
                    branch: 'feature/shared-memory',
                    commitSha: 'abc123def456',
                    occurredAt: 1700000001500
                }
            });

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
                content: 'We need to keep hidden session nodes out of the default graph.',
                key: 'chat_turn:factory:session-knowledge-b:user-1',
                tags: ['chat_turn', 'role:user'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-knowledge-b',
                    messageId: 'user-1',
                    role: 'user',
                    branch: 'feature/shared-memory',
                    commitSha: 'abc123def456',
                    occurredAt: 1700000002500
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

      it('adds trust metadata to reviewed insights from linked evidence', () => {
          const { db, graph } = createGraph();
          try {
              const ctx = graph.createContext('knowledge-evidence-summary');
              const userTurn = graph.addNode({
                  contextId: ctx.id,
                  thread: 'session-evidence-1',
                  type: 'artifact',
                  content: 'We should keep repo routing strict for capture.',
                  key: 'chat_turn:factory:session-evidence-1:user-1',
                  tags: ['chat_turn', 'role:user', 'branch:feature/evidence'],
                  source: 'hook:factory',
                  hidden: true
              });
              const assistantTurn = graph.addNode({
                  contextId: ctx.id,
                  thread: 'session-evidence-1',
                  type: 'artifact',
                  content: 'Agreed. Strict repo routing avoids writing to the wrong workspace.',
                  key: 'chat_turn:factory:session-evidence-1:assistant-1',
                  tags: ['chat_turn', 'role:assistant', 'branch:feature/evidence'],
                  source: 'hook:factory',
                  hidden: true
              });
              const insight = graph.addNode({
                  contextId: ctx.id,
                  type: 'decision',
                  content: 'Keep repo routing strict for capture.',
                  key: 'knowledge:decision:feature-evidence-routing',
                  tags: ['knowledge', 'branch:feature/evidence'],
                  source: 'extractor:session'
              });
              graph.addEdge(insight.id, userTurn.id, 'caused_by');
              graph.addEdge(insight.id, assistantTurn.id, 'caused_by');

              const insights = graph.listWorkstreamInsights(ctx.id, { branch: 'feature/evidence' });
              expect(insights).toHaveLength(1);
              expect(insights[0]?.evidenceCount).toBe(2);
              expect(insights[0]?.distinctSessionCount).toBe(1);
              expect(insights[0]?.corroboratedRoles).toEqual(['assistant', 'user']);
              expect(insights[0]?.trustFlags).toEqual(expect.arrayContaining(['repeated', 'distinct_support', 'cross_role', 'same_session_only']));
              expect(insights[0]?.trustTier).toBe('review');
              expect(insights[0]?.trustSummary).toMatch(/Repeated 2 times/i);
              expect(insights[0]?.evidencePreview).toEqual([
                  'We should keep repo routing strict for capture.',
                  'Agreed. Strict repo routing avoids writing to the wrong workspace.'
              ]);
              expect(insights[0]?.promotionState).toBe('review');
              expect(insights[0]?.promotionSummary).toMatch(/single session/i);
              expect(insights[0]?.latestEvidenceAt).toBeGreaterThan(0);
          } finally {
              db.close();
          }
      });

      it('marks cross-session corroborated insights as ready to promote', () => {
          const { db, graph } = createGraph();
          try {
              const ctx = graph.createContext('knowledge-cross-session-summary');
              const userTurn = graph.addNode({
                  contextId: ctx.id,
                  thread: 'session-evidence-a',
                  type: 'artifact',
                  content: 'We should keep repo routing strict for capture.',
                  key: 'chat_turn:factory:session-evidence-a:user-1',
                  tags: ['chat_turn', 'role:user', 'branch:feature/evidence'],
                  source: 'hook:factory',
                  hidden: true
              });
              const assistantTurn = graph.addNode({
                  contextId: ctx.id,
                  thread: 'session-evidence-b',
                  type: 'artifact',
                  content: 'Agreed. Strict repo routing avoids writing to the wrong workspace.',
                  key: 'chat_turn:factory:session-evidence-b:assistant-1',
                  tags: ['chat_turn', 'role:assistant', 'branch:feature/evidence'],
                  source: 'hook:factory',
                  hidden: true
              });
              const insight = graph.addNode({
                  contextId: ctx.id,
                  type: 'decision',
                  content: 'Keep repo routing strict for capture.',
                  key: 'knowledge:decision:feature-evidence-routing-cross-session',
                  tags: ['knowledge', 'branch:feature/evidence'],
                  source: 'extractor:session'
              });
              graph.addEdge(insight.id, userTurn.id, 'caused_by');
              graph.addEdge(insight.id, assistantTurn.id, 'caused_by');

              const insights = graph.listWorkstreamInsights(ctx.id, { branch: 'feature/evidence' });
              expect(insights).toHaveLength(1);
              expect(insights[0]?.distinctSessionCount).toBe(2);
              expect(insights[0]?.trustFlags).toEqual(expect.arrayContaining(['cross_session', 'cross_role']));
              expect(insights[0]?.promotionState).toBe('ready');
              expect(insights[0]?.promotionSummary).toMatch(/across 2 sessions/i);
          } finally {
              db.close();
          }
      });

      it('marks promoted insights without local evidence as review-tier memory', () => {
          const { db, graph } = createGraph();
          try {
              const ctx = graph.createContext('knowledge-promoted-summary');
              graph.addNode({
                  contextId: ctx.id,
                  type: 'goal',
                  content: 'Keep promotion explicit across workspaces.',
                  key: 'knowledge:goal:promotion-review',
                  tags: ['knowledge', 'promoted', 'origin_context:source-workspace', 'origin_node:source-node-1'],
                  source: 'promotion'
              });

              const insights = graph.listWorkstreamInsights(ctx.id);
              expect(insights).toHaveLength(1);
              expect(insights[0]?.evidenceCount).toBe(0);
              expect(insights[0]?.trustFlags).toEqual(expect.arrayContaining(['promoted', 'no_local_evidence']));
              expect(insights[0]?.trustTier).toBe('review');
              expect(insights[0]?.trustSummary).toMatch(/No local corroboration yet/i);
              expect(insights[0]?.promotionState).toBe('blocked');
              expect(insights[0]?.promotionSummary).toMatch(/no local corroboration yet/i);
              expect(insights[0]?.originContextId).toBe('source-workspace');
              expect(insights[0]?.originNodeId).toBe('source-node-1');
          } finally {
              db.close();
          }
      });

      it('reuses prior cross-session corroboration when previewing the same insight in a later session', () => {
          const { db, graph } = createGraph();
          try {
              const ctx = graph.createContext('knowledge-preview-existing-cross-session');
              graph.addNode({
                  contextId: ctx.id,
                  thread: 'session-existing-a',
                  type: 'artifact',
                  content: 'existing corroboration session a',
                  key: 'chat_session:factory:session-existing-a',
                  tags: ['chat_session', 'agent:factory'],
                  source: 'hook:factory',
                  hidden: true,
                  rawPayload: {
                      sessionId: 'session-existing-a',
                      branch: 'feature/existing-corroboration',
                      agent: 'factory'
                  }
              });
              const sessionAUser = graph.addNode({
                  contextId: ctx.id,
                  thread: 'session-existing-a',
                  type: 'artifact',
                  content: 'We decided to keep strict repo routing for capture.',
                  key: 'chat_turn:factory:session-existing-a:user-1',
                  tags: ['chat_turn', 'role:user', 'branch:feature/existing-corroboration'],
                  source: 'hook:factory',
                  hidden: true
              });
              graph.addNode({
                  contextId: ctx.id,
                  thread: 'session-existing-b',
                  type: 'artifact',
                  content: 'existing corroboration session b',
                  key: 'chat_session:factory:session-existing-b',
                  tags: ['chat_session', 'agent:factory'],
                  source: 'hook:factory',
                  hidden: true,
                  rawPayload: {
                      sessionId: 'session-existing-b',
                      branch: 'feature/existing-corroboration',
                      agent: 'factory'
                  }
              });
              const sessionBAssistant = graph.addNode({
                  contextId: ctx.id,
                  thread: 'session-existing-b',
                  type: 'artifact',
                  content: 'Agreed. Keep strict repo routing for capture.',
                  key: 'chat_turn:factory:session-existing-b:assistant-1',
                  tags: ['chat_turn', 'role:assistant', 'branch:feature/existing-corroboration'],
                  source: 'hook:factory',
                  hidden: true
              });
              const previewA = graph.previewKnowledgeFromSession(ctx.id, 'session-existing-a', { minConfidence: 0.6 });
              const generatedKey = previewA.candidates.find((item) => item.type === 'decision')?.key;
              expect(generatedKey).toBeTruthy();
              const existingInsight = graph.addNode({
                  contextId: ctx.id,
                  type: 'decision',
                  content: 'Keep strict repo routing for capture.',
                  key: generatedKey ?? undefined,
                  tags: ['knowledge', 'branch:feature/existing-corroboration'],
                  source: 'extractor:session'
              });
              graph.addEdge(existingInsight.id, sessionAUser.id, 'caused_by');
              graph.addEdge(existingInsight.id, sessionBAssistant.id, 'caused_by');

              graph.addNode({
                  contextId: ctx.id,
                  thread: 'session-existing-c',
                  type: 'artifact',
                  content: 'We decided to keep strict repo routing for capture.',
                  key: 'chat_turn:factory:session-existing-c:assistant-1',
                  tags: ['chat_turn', 'role:assistant', 'branch:feature/existing-corroboration'],
                  source: 'hook:factory',
                  hidden: true,
                  rawPayload: {
                      sessionId: 'session-existing-c',
                      messageId: 'assistant-1',
                      role: 'assistant',
                      branch: 'feature/existing-corroboration'
                  }
              });

              graph.addNode({
                  contextId: ctx.id,
                  thread: 'session-existing-c',
                  type: 'artifact',
                  content: 'existing corroboration session',
                  key: 'chat_session:factory:session-existing-c',
                  tags: ['chat_session', 'agent:factory'],
                  source: 'hook:factory',
                  hidden: true,
                  rawPayload: {
                      sessionId: 'session-existing-c',
                      branch: 'feature/existing-corroboration',
                      agent: 'factory'
                  }
              });

              const preview = graph.previewKnowledgeFromSession(ctx.id, 'session-existing-c', { minConfidence: 0.6 });
              const candidate = preview.candidates.find((item) => item.existingNodeId === existingInsight.id);

              expect(candidate).toBeTruthy();
              expect(candidate?.action).toBe('reuse');
              expect(candidate?.reviewTier).toBe('strong');
              expect(candidate?.autoPersist).toBe(true);
              expect(candidate?.trustFlags).toEqual(expect.arrayContaining(['cross_session', 'cross_role']));
              expect(candidate?.distinctSessionCount).toBe(3);
              expect(candidate?.evidenceCount).toBe(3);
              expect(candidate?.evidenceSummary).toMatch(/3 sessions/i);
              expect(candidate?.promotionSummary).toMatch(/across 3 sessions/i);
              expect(candidate?.reason).toContain('corroborated-by-existing-insight');
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

    it('keeps assistant-only checkpoint extraction manual when auto-persist is required', () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('checkpoint-knowledge-assistant-only');
            graph.addNode({
                contextId: context.id,
                thread: 'session-k2',
                type: 'artifact',
                content: 'assistant-only checkpoint extraction session',
                key: 'chat_session:factory:session-k2',
                tags: ['chat_session', 'agent:factory'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-k2',
                    branch: 'feature/checkpoint-knowledge',
                    agent: 'factory'
                }
            });
            graph.addNode({
                contextId: context.id,
                thread: 'session-k2',
                type: 'artifact',
                content: 'We need to support automatic context injection for Claude session start.',
                key: 'chat_turn:factory:session-k2:assistant-1',
                tags: ['chat_turn', 'role:assistant'],
                source: 'hook:factory',
                hidden: true,
                rawPayload: {
                    sessionId: 'session-k2',
                    messageId: 'assistant-1',
                    role: 'assistant'
                }
            });

            const checkpoint = graph.createSessionCheckpoint(context.id, 'session-k2', {
                summary: 'Automatic context injection for Claude',
                name: 'checkpoint-knowledge-assistant-only'
            });

            const autoResult = graph.extractKnowledgeFromCheckpoint(checkpoint.id, {
                minConfidence: 0.64,
                autoPersistOnly: true
            });
            expect(autoResult.nodeCount).toBe(0);

            const preview = graph.previewKnowledgeFromCheckpoint(checkpoint.id, {
                minConfidence: 0.64
            });
            expect(preview.candidates[0]?.promotionState).toBe('blocked');
            expect(String(preview.candidates[0]?.promotionSummary || '')).toContain('assistant-only');

            const manualResult = graph.extractKnowledgeFromCheckpoint(checkpoint.id, {
                minConfidence: 0.64
            });
            expect(manualResult.nodeCount).toBe(1);
            expect(manualResult.nodes[0]?.type).toBe('goal');
        } finally {
            db.close();
        }
    });

    it('promotes a reviewed insight into another workspace and reuses it on repeat', () => {
        const { db, graph } = createGraph();
        try {
            const source = graph.createContext('source-workspace');
            const target = graph.createContext('target-workspace');
            const supportingUserTurn = graph.addNode({
                contextId: source.id,
                thread: 'session-promote-1',
                type: 'artifact',
                content: 'We need to ship checkpoints as the primary restore primitive.',
                key: 'chat_turn:factory:session-promote-1:user-1',
                tags: ['chat_turn', 'role:user', 'branch:feat/restore-flow'],
                source: 'hook:factory',
                hidden: true
            });
            const supportingAssistantTurn = graph.addNode({
                contextId: source.id,
                thread: 'session-promote-1',
                type: 'artifact',
                content: 'We decided to ship checkpoints as the primary restore primitive.',
                key: 'chat_turn:factory:session-promote-1:assistant-1',
                tags: ['chat_turn', 'role:assistant', 'branch:feat/restore-flow'],
                source: 'hook:factory',
                hidden: true
            });
            const insight = graph.addNode({
                contextId: source.id,
                type: 'decision',
                content: 'Ship checkpoints as the primary restore primitive.',
                tags: ['knowledge', 'derived', 'branch:feat/restore-flow'],
                source: 'extractor:session',
                hidden: false
            });
            graph.addEdge(insight.id, supportingUserTurn.id, 'caused_by');
            graph.addEdge(insight.id, supportingAssistantTurn.id, 'caused_by');

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

    it('blocks promotion of weak or imported-without-local-evidence insights', () => {
        const { db, graph } = createGraph();
        try {
            const source = graph.createContext('source-workspace-promotion-block');
            const target = graph.createContext('target-workspace-promotion-block');
            const weakNode = graph.addNode({
                contextId: source.id,
                type: 'assumption',
                content: 'Maybe the branch is fine as-is.',
                tags: ['knowledge', 'branch:feat/promotion-block'],
                source: 'extractor:session',
                hidden: false
            });
            const importedNode = graph.addNode({
                contextId: source.id,
                type: 'decision',
                content: 'Keep promotion explicit across workspaces.',
                tags: ['knowledge', 'promoted', 'origin_context:older-workspace', 'origin_node:source-legacy'],
                source: 'promote:workspace',
                hidden: false
            });

            expect(() => graph.promoteInsightNode(source.id, weakNode.id, target.id)).toThrow(/weak insight candidates/i);
            expect(() => graph.promoteInsightNode(source.id, importedNode.id, target.id)).toThrow(/no local corroboration yet/i);
        } finally {
            db.close();
        }
    });

    it('still allows promotion of review-tier insights when they have local evidence', () => {
        const { db, graph } = createGraph();
        try {
            const source = graph.createContext('source-workspace-promotion-review');
            const target = graph.createContext('target-workspace-promotion-review');
            const supportingUserTurn = graph.addNode({
                contextId: source.id,
                thread: 'session-review-1',
                type: 'artifact',
                content: 'We need to keep repo routing strict for this workflow.',
                key: 'chat_turn:factory:session-review-1:user-1',
                tags: ['chat_turn', 'role:user', 'branch:feat/promotion-review'],
                source: 'hook:factory',
                hidden: true
            });
            const supportingAssistantTurn = graph.addNode({
                contextId: source.id,
                thread: 'session-review-1',
                type: 'artifact',
                content: 'Agreed. Keep repo routing strict for this workflow.',
                key: 'chat_turn:factory:session-review-1:assistant-1',
                tags: ['chat_turn', 'role:assistant', 'branch:feat/promotion-review'],
                source: 'hook:factory',
                hidden: true
            });
            const reviewInsight = graph.addNode({
                contextId: source.id,
                type: 'constraint',
                content: 'Keep repo routing strict for this workflow.',
                tags: ['knowledge', 'branch:feat/promotion-review'],
                source: 'extractor:session',
                hidden: false
            });
            graph.addEdge(reviewInsight.id, supportingUserTurn.id, 'caused_by');
            graph.addEdge(reviewInsight.id, supportingAssistantTurn.id, 'caused_by');

            const insights = graph.listWorkstreamInsights(source.id, { branch: 'feat/promotion-review' });
            expect(insights[0]?.trustTier).toBe('review');
            expect(insights[0]?.promotionState).toBe('review');

            const result = graph.promoteInsightNode(source.id, reviewInsight.id, target.id);
            expect(result.created).toBe(true);
            expect(result.reused).toBe(false);
        } finally {
            db.close();
        }
    });

    it('blocks promotion of assistant-only review insights until another source corroborates them', () => {
        const { db, graph } = createGraph();
        try {
            const source = graph.createContext('source-workspace-promotion-assistant-only');
            const target = graph.createContext('target-workspace-promotion-assistant-only');
            const supportingTurn = graph.addNode({
                contextId: source.id,
                thread: 'session-review-assistant-only-1',
                type: 'artifact',
                content: 'We should keep repo routing strict for this workflow.',
                key: 'chat_turn:factory:session-review-assistant-only-1:assistant-1',
                tags: ['chat_turn', 'role:assistant', 'branch:feat/promotion-assistant-only'],
                source: 'hook:factory',
                hidden: true
            });
            const reviewInsight = graph.addNode({
                contextId: source.id,
                type: 'constraint',
                content: 'Keep repo routing strict for this workflow.',
                tags: ['knowledge', 'branch:feat/promotion-assistant-only'],
                source: 'extractor:session',
                hidden: false
            });
            graph.addEdge(reviewInsight.id, supportingTurn.id, 'caused_by');

            const insights = graph.listWorkstreamInsights(source.id, { branch: 'feat/promotion-assistant-only' });
            expect(insights[0]?.trustTier).toBe('review');
            expect(insights[0]?.promotionState).toBe('blocked');
            expect(String(insights[0]?.promotionSummary || '')).toContain('assistant-only');

            expect(() => graph.promoteInsightNode(source.id, reviewInsight.id, target.id)).toThrow(/assistant-only/i);
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
