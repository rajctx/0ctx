import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db';
import { Graph } from '../src/graph';

const tempDirs: string[] = [];

function createGraph() {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), '0ctx-core-backup-'));
    tempDirs.push(tempDir);
    const db = openDb({ dbPath: path.join(tempDir, '0ctx.db') });
    return { db, graph: new Graph(db) };
}

afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('Graph export/import context dump', () => {
    it('round-trips a context graph into a new context', () => {
        const { db, graph } = createGraph();
        try {
            const sourceContext = graph.createContext('source-context');
            const first = graph.addNode({
                contextId: sourceContext.id,
                type: 'goal',
                content: 'Ship enterprise-grade 0ctx',
                tags: ['goal']
            });

            const second = graph.addNode({
                contextId: sourceContext.id,
                type: 'constraint',
                content: 'Maintain local-first behavior',
                hidden: true,
                thread: 'session-restore',
                rawPayload: {
                    role: 'assistant',
                    branch: 'main',
                    commitSha: 'deadbeef'
                }
            });

            graph.addEdge(first.id, second.id, 'constrains');
            graph.saveCheckpoint(sourceContext.id, 'before-release');

            const dump = graph.exportContextDump(sourceContext.id);
            const restored = graph.importContextDump(dump, { name: 'restored-context' });
            const restoredData = graph.getGraphData(restored.id, { includeHidden: true });

            expect(restored.id).not.toBe(sourceContext.id);
            expect(restoredData.nodes).toHaveLength(2);
            expect(restoredData.edges).toHaveLength(1);
            expect(graph.listCheckpoints(restored.id)).toHaveLength(1);

            const restoredHidden = restoredData.nodes.find(node => node.hidden);
            expect(restoredHidden).toBeTruthy();
            const restoredPayload = restoredHidden ? graph.getNodePayload(restoredHidden.id) : null;
            expect(restoredPayload).not.toBeNull();
            expect((restoredPayload?.payload as Record<string, unknown>)?.commitSha).toBe('deadbeef');
        } finally {
            db.close();
        }
    });
});
