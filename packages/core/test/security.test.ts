import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db';
import { Graph } from '../src/graph';
import Database from 'better-sqlite3';

const tempDirs: string[] = [];

function createGraph() {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), '0ctx-sec-'));
    tempDirs.push(tempDir);
    const db = openDb({ dbPath: path.join(tempDir, '0ctx.db') });
    return { db, graph: new Graph(db) };
}

afterEach(() => {
    delete process.env.CTX_AUDIT_HMAC_SECRET;
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('Audit HMAC chain (SEC-001)', () => {
    it('records entries with entryHash and prevHash', () => {
        const { db, graph } = createGraph();
        try {
            process.env.CTX_AUDIT_HMAC_SECRET = 'test-secret-1';
            const ctx = graph.createContext('sec-test');

            const entry = graph.recordAuditEvent({
                action: 'create_context',
                contextId: ctx.id,
                payload: { name: ctx.name },
                result: { contextId: ctx.id },
                metadata: { source: 'test' }
            });

            expect((entry as any).entryHash).toBeDefined();
            expect((entry as any).prevHash).toBe('genesis');
        } finally {
            db.close();
        }
    });

    it('chains hashes across multiple entries', () => {
        const { db, graph } = createGraph();
        try {
            process.env.CTX_AUDIT_HMAC_SECRET = 'test-secret-2';
            const ctx = graph.createContext('chain-test');

            const first = graph.recordAuditEvent({
                action: 'create_context',
                contextId: ctx.id,
                payload: { name: ctx.name }
            });

            const second = graph.recordAuditEvent({
                action: 'add_node',
                contextId: ctx.id,
                payload: { type: 'goal' }
            });

            expect((second as any).prevHash).toBe((first as any).entryHash);
        } finally {
            db.close();
        }
    });

    it('verifyAuditChain passes for a valid chain', () => {
        const { db, graph } = createGraph();
        try {
            process.env.CTX_AUDIT_HMAC_SECRET = 'test-secret-3';
            const ctx = graph.createContext('verify-test');

            for (let i = 0; i < 5; i++) {
                graph.recordAuditEvent({
                    action: 'add_node',
                    contextId: ctx.id,
                    payload: { i }
                });
            }

            const result = graph.verifyAuditChain();
            expect(result.valid).toBe(true);
            expect(result.checked).toBe(5);
            expect(result.brokenAt).toBeUndefined();
        } finally {
            db.close();
        }
    });

    it('verifyAuditChain detects tampered entryHash', () => {
        const { db, graph } = createGraph();
        try {
            process.env.CTX_AUDIT_HMAC_SECRET = 'test-secret-4';
            const ctx = graph.createContext('tamper-test');

            graph.recordAuditEvent({
                action: 'create_context',
                contextId: ctx.id,
                payload: { name: ctx.name }
            });

            const entry2 = graph.recordAuditEvent({
                action: 'add_node',
                contextId: ctx.id,
                payload: { type: 'goal' }
            });

            // Tamper: overwrite the hash of the second entry
            db.prepare('UPDATE audit_logs SET entryHash = ? WHERE id = ?')
                .run('tampered-hash', entry2.id);

            const result = graph.verifyAuditChain();
            expect(result.valid).toBe(false);
            expect(result.brokenAt).toBe(entry2.id);
        } finally {
            db.close();
        }
    });

    it('verifyAuditChain detects broken prevHash link', () => {
        const { db, graph } = createGraph();
        try {
            process.env.CTX_AUDIT_HMAC_SECRET = 'test-secret-5';
            const ctx = graph.createContext('link-break-test');

            graph.recordAuditEvent({
                action: 'create_context',
                contextId: ctx.id,
                payload: {}
            });

            const entry2 = graph.recordAuditEvent({
                action: 'add_node',
                contextId: ctx.id,
                payload: { type: 'goal' }
            });

            // Tamper: break the prev link
            db.prepare('UPDATE audit_logs SET prevHash = ? WHERE id = ?')
                .run('wrong-prev', entry2.id);

            const result = graph.verifyAuditChain();
            expect(result.valid).toBe(false);
            expect(result.brokenAt).toBe(entry2.id);
        } finally {
            db.close();
        }
    });

    it('returns valid for empty audit log', () => {
        const { db, graph } = createGraph();
        try {
            const result = graph.verifyAuditChain();
            expect(result.valid).toBe(true);
            expect(result.checked).toBe(0);
        } finally {
            db.close();
        }
    });
});
