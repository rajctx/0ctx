import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Graph, openDb } from '@0ctx/core';
import { handleRequest, type HandlerRuntimeContext } from '../src/handlers';
import { resetResolverStateForTests } from '../src/resolver';

const tempDirs: string[] = [];
const originalBackupDir = process.env.CTX_BACKUP_DIR;
const originalMasterKey = process.env.CTX_MASTER_KEY;

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

function createGraph() {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), '0ctx-daemon-backup-'));
    tempDirs.push(tempDir);

    process.env.CTX_BACKUP_DIR = path.join(tempDir, 'backups');
    process.env.CTX_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');

    const db = openDb({ dbPath: path.join(tempDir, '0ctx.db') });
    return { db, graph: new Graph(db) };
}

beforeEach(() => {
    resetResolverStateForTests();
});

afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        rmSync(dir, { recursive: true, force: true });
    }

    if (originalBackupDir === undefined) delete process.env.CTX_BACKUP_DIR;
    else process.env.CTX_BACKUP_DIR = originalBackupDir;

    if (originalMasterKey === undefined) delete process.env.CTX_MASTER_KEY;
    else process.env.CTX_MASTER_KEY = originalMasterKey;
});

describe('backup and restore handlers', () => {
    it('creates and restores an encrypted context backup', () => {
        const { db, graph } = createGraph();
        try {
            const session = handleRequest(graph, 'conn-a', { method: 'createSession' }, runtime()) as { sessionToken: string };

            const context = handleRequest(graph, 'conn-a', {
                method: 'createContext',
                sessionToken: session.sessionToken,
                params: { name: 'backup-source' }
            }, runtime()) as { id: string };

            handleRequest(graph, 'conn-a', {
                method: 'addNode',
                sessionToken: session.sessionToken,
                params: { type: 'goal', content: 'Protect production context' }
            }, runtime());

            const backup = handleRequest(graph, 'conn-a', {
                method: 'createBackup',
                sessionToken: session.sessionToken,
                params: { contextId: context.id, name: 'nightly', encrypted: true }
            }, runtime()) as { fileName: string };

            const backups = handleRequest(graph, 'conn-a', {
                method: 'listBackups',
                sessionToken: session.sessionToken
            }, runtime()) as Array<{ fileName: string }>;

            expect(backups.some(item => item.fileName === backup.fileName)).toBe(true);

            const restored = handleRequest(graph, 'conn-a', {
                method: 'restoreBackup',
                sessionToken: session.sessionToken,
                params: { fileName: backup.fileName, name: 'backup-restored' }
            }, runtime()) as { id: string };

            expect(restored.id).not.toBe(context.id);
            const restoredGraph = graph.getGraphData(restored.id);
            expect(restoredGraph.nodes.length).toBe(1);
        } finally {
            db.close();
        }
    });
});
