import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, getSchemaVersion, openDb } from '../src/db';

const tempDirs: string[] = [];

function createTempDbPath(): string {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), '0ctx-core-db-'));
    tempDirs.push(tempDir);
    return path.join(tempDir, '0ctx.db');
}

afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('openDb migrations', () => {
    it('creates schema metadata and sets schema version', () => {
        const db = openDb({ dbPath: createTempDbPath() });
        try {
            expect(getSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);

            const row = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('schema_version') as { value: string } | undefined;
            expect(row?.value).toBe(String(CURRENT_SCHEMA_VERSION));
        } finally {
            db.close();
        }
    });

    it('creates performance indexes introduced in schema v5', () => {
        const db = openDb({ dbPath: createTempDbPath() });
        try {
            const nodeIndex = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_nodes_context_created'
      `).get() as { name?: string } | undefined;
            const auditIndex = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_audit_logs_session_created'
      `).get() as { name?: string } | undefined;

            expect(nodeIndex?.name).toBe('idx_nodes_context_created');
            expect(auditIndex?.name).toBe('idx_audit_logs_session_created');
        } finally {
            db.close();
        }
    });
});
