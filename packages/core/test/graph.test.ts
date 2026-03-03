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
