import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptJson, Graph, openDb } from '@0ctx/core';
import { SyncEngine } from '../src/sync-engine';
import { enqueueSync } from '../src/sync-queue';
import { pushEnvelope } from '../src/sync-transport';

vi.mock('../src/sync-transport', () => ({
    pushEnvelope: vi.fn(async () => ({ ok: true, statusCode: 200 })),
    pullEnvelopes: vi.fn(async () => ({ ok: true, envelopes: [] }))
}));

const tempDirs: string[] = [];

function createGraph() {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), '0ctx-daemon-sync-engine-'));
    tempDirs.push(tempDir);
    const db = openDb({ dbPath: path.join(tempDir, '0ctx.db') });
    return { db, graph: new Graph(db) };
}

beforeEach(() => {
    process.env.CTX_AUTH_TOKEN = 'test-token';
    process.env.CTX_TENANT_ID = 'tenant-test';
    vi.mocked(pushEnvelope).mockClear();
});

afterEach(() => {
    delete process.env.CTX_AUTH_TOKEN;
    delete process.env.CTX_TENANT_ID;
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('sync-engine policy enforcement', () => {
    it('does not enqueue local_only contexts', () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('local-only', [], 'local_only');
            const engine = new SyncEngine(graph, db, { enabled: true, intervalMs: 60_000 });

            engine.enqueue(context.id);
            expect(engine.getStatus().queue.pending).toBe(0);
        } finally {
            db.close();
        }
    });

    it('pushes redacted metadata payload for metadata_only contexts', async () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('metadata-only', [], 'metadata_only');
            graph.addNode({
                contextId: context.id,
                type: 'decision',
                content: 'sensitive implementation detail',
                tags: ['security']
            });

            const engine = new SyncEngine(graph, db, { enabled: true, intervalMs: 60_000 });
            engine.enqueue(context.id);
            const result = await engine.push();

            expect(result.failed).toBe(0);
            expect(result.succeeded).toBe(1);
            expect(pushEnvelope).toHaveBeenCalledTimes(1);

            const envelope = vi.mocked(pushEnvelope).mock.calls[0][1];
            expect(envelope.syncPolicy).toBe('metadata_only');
            const payload = decryptJson<Record<string, unknown>>(envelope.payload as Parameters<typeof decryptJson>[0]);

            expect(payload.mode).toBe('metadata_only');
            expect(JSON.stringify(payload)).not.toContain('sensitive implementation detail');
            expect(payload.graph).toMatchObject({
                nodeCount: 1,
                edgeCount: 0
            });
        } finally {
            db.close();
        }
    });

    it('marks local_only queue entries done without cloud push', async () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('local-only-pending', [], 'local_only');
            const engine = new SyncEngine(graph, db, { enabled: true, intervalMs: 60_000 });
            enqueueSync(db, context.id);
            const result = await engine.push();

            expect(result.processed).toBe(1);
            expect(result.succeeded).toBe(1);
            expect(result.failed).toBe(0);
            expect(pushEnvelope).not.toHaveBeenCalled();
            expect(engine.getStatus().queue.done).toBe(1);
        } finally {
            db.close();
        }
    });
});
