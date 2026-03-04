import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptJson, encryptJson, Graph, openDb, type ContextDump, type SyncEnvelope } from '@0ctx/core';
import { SyncEngine } from '../src/sync-engine';
import { enqueueSync } from '../src/sync-queue';
import { pullEnvelopes, pushEnvelope } from '../src/sync-transport';

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

function toFullSyncEnvelope(dump: ContextDump, timestamp: number): SyncEnvelope {
    return {
        version: 1,
        contextId: dump.context.id,
        tenantId: 'tenant-test',
        userId: 'remote-user@example.com',
        timestamp,
        encrypted: true,
        syncPolicy: 'full_sync',
        payload: encryptJson(dump)
    };
}

beforeEach(() => {
    process.env.CTX_AUTH_TOKEN = 'test-token';
    process.env.CTX_TENANT_ID = 'tenant-test';
    vi.mocked(pushEnvelope).mockClear();
    vi.mocked(pullEnvelopes).mockReset();
    vi.mocked(pullEnvelopes).mockResolvedValue({ ok: true, envelopes: [] });
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

describe('sync-engine pull merge behavior', () => {
    it('imports missing full_sync contexts with stable IDs and emits sync_merge audit', async () => {
        const { db, graph } = createGraph();
        try {
            const now = Date.now();
            const dump: ContextDump = {
                version: 1,
                exportedAt: now,
                context: {
                    id: 'ctx-remote-1',
                    name: 'Remote Context',
                    paths: ['C:/workspace/remote'],
                    syncPolicy: 'full_sync',
                    createdAt: now - 5_000
                },
                nodes: [
                    {
                        id: 'node-remote-1',
                        contextId: 'ctx-remote-1',
                        type: 'goal',
                        content: 'Ship tenant-wide machine routing',
                        tags: ['sync', 'ux'],
                        createdAt: now - 4_000
                    }
                ],
                edges: [],
                checkpoints: []
            };

            vi.mocked(pullEnvelopes).mockResolvedValueOnce({
                ok: true,
                envelopes: [toFullSyncEnvelope(dump, now)]
            });

            const engine = new SyncEngine(graph, db, { enabled: true, intervalMs: 60_000 });
            const result = await engine.pull();

            expect(result.received).toBe(1);
            expect(graph.getContext('ctx-remote-1')?.name).toBe('Remote Context');
            expect(graph.getNode('node-remote-1')?.content).toBe('Ship tenant-wide machine routing');

            const audits = graph.listAuditEvents('ctx-remote-1', 10).filter(event => event.action === 'sync_merge');
            expect(audits.length).toBe(1);
            const payload = (audits[0].payload ?? {}) as Record<string, unknown>;
            expect(payload.decision).toBe('remote_create');
        } finally {
            db.close();
        }
    });

    it('overwrites existing context when remote envelope is newer and records before/after', async () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('Local Context', [], 'full_sync');
            const localNode = graph.addNode({
                contextId: context.id,
                type: 'decision',
                content: 'use local value',
                tags: ['local']
            });
            const localDump = graph.exportContextDump(context.id);
            const remoteDump: ContextDump = {
                ...localDump,
                exportedAt: localDump.exportedAt + 1_000,
                context: {
                    ...localDump.context,
                    name: 'Remote Context'
                },
                nodes: localDump.nodes.map(node => (
                    node.id === localNode.id
                        ? { ...node, content: 'use remote value', tags: ['remote'] }
                        : node
                ))
            };
            const remoteTimestamp = Date.now() + 5_000;

            vi.mocked(pullEnvelopes).mockResolvedValueOnce({
                ok: true,
                envelopes: [toFullSyncEnvelope(remoteDump, remoteTimestamp)]
            });

            const engine = new SyncEngine(graph, db, { enabled: true, intervalMs: 60_000 });
            await engine.pull();

            expect(graph.getContext(context.id)?.name).toBe('Remote Context');
            expect(graph.getNode(localNode.id)?.content).toBe('use remote value');

            const mergeAudit = graph
                .listAuditEvents(context.id, 20)
                .find(event => event.action === 'sync_merge');
            expect(mergeAudit).toBeDefined();
            const payload = (mergeAudit?.payload ?? {}) as Record<string, unknown>;
            expect(payload.decision).toBe('remote_overwrite');
            const changes = (payload.changes ?? {}) as Record<string, unknown>;
            expect(Number(changes.updatedNodeCount ?? 0)).toBeGreaterThanOrEqual(1);
        } finally {
            db.close();
        }
    });

    it('keeps local context when local mutation is newer than incoming envelope', async () => {
        const { db, graph } = createGraph();
        try {
            const context = graph.createContext('Conflict Context', [], 'full_sync');
            const node = graph.addNode({
                contextId: context.id,
                type: 'goal',
                content: 'local-latest',
                tags: ['local']
            });
            const remoteDump: ContextDump = {
                ...graph.exportContextDump(context.id),
                nodes: graph.exportContextDump(context.id).nodes.map(current => (
                    current.id === node.id ? { ...current, content: 'remote-stale' } : current
                ))
            };

            graph.recordAuditEvent({
                action: 'update_node',
                contextId: context.id,
                payload: { nodeId: node.id, reason: 'local edit after remote timestamp' },
                result: { ok: true },
                metadata: { source: 'test-suite' }
            });

            const staleTimestamp = Date.now() - 10_000;
            const staleEnvelope = toFullSyncEnvelope(remoteDump, staleTimestamp);
            vi.mocked(pullEnvelopes).mockResolvedValueOnce({
                ok: true,
                envelopes: [staleEnvelope]
            });

            const engine = new SyncEngine(graph, db, { enabled: true, intervalMs: 60_000 });
            await engine.pull();
            expect(graph.getNode(node.id)?.content).toBe('local-latest');

            const mergeAuditsAfterFirstPull = graph
                .listAuditEvents(context.id, 30)
                .filter(event => event.action === 'sync_merge');
            expect(mergeAuditsAfterFirstPull.length).toBe(1);
            const payload = (mergeAuditsAfterFirstPull[0].payload ?? {}) as Record<string, unknown>;
            expect(payload.decision).toBe('kept_local');

            vi.mocked(pullEnvelopes).mockResolvedValueOnce({
                ok: true,
                envelopes: [staleEnvelope]
            });
            await engine.pull();

            const mergeAuditsAfterSecondPull = graph
                .listAuditEvents(context.id, 40)
                .filter(event => event.action === 'sync_merge');
            expect(mergeAuditsAfterSecondPull.length).toBe(1);
        } finally {
            db.close();
        }
    });
});
