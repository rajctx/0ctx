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

    it('creates hidden-node and payload indexes introduced in schema v6', () => {
        const db = openDb({ dbPath: createTempDbPath() });
        try {
            const hiddenIndex = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_nodes_context_hidden_created'
      `).get() as { name?: string } | undefined;
            const keyIndex = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_nodes_context_key_created'
      `).get() as { name?: string } | undefined;
            const payloadIndex = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_node_payloads_context_created'
      `).get() as { name?: string } | undefined;
            const payloadTable = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'node_payloads'
      `).get() as { name?: string } | undefined;
            const auditIndex = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_audit_logs_session_created'
      `).get() as { name?: string } | undefined;

            expect(hiddenIndex?.name).toBe('idx_nodes_context_hidden_created');
            expect(keyIndex?.name).toBe('idx_nodes_context_key_created');
            expect(payloadIndex?.name).toBe('idx_node_payloads_context_created');
            expect(payloadTable?.name).toBe('node_payloads');
            expect(auditIndex?.name).toBe('idx_audit_logs_session_created');
        } finally {
            db.close();
        }
    });

    it('uses metadata_only as the contexts syncPolicy default', () => {
        const db = openDb({ dbPath: createTempDbPath() });
        try {
            const columns = db.prepare(`PRAGMA table_info(contexts)`).all() as Array<{ name: string; dflt_value: string | null }>;
            const syncPolicy = columns.find((column) => column.name === 'syncPolicy');
            expect(syncPolicy?.dflt_value).toBe("'metadata_only'");
        } finally {
            db.close();
        }
    });

    it('normalizes legacy full_sync contexts to metadata_only on upgrade', () => {
        const dbPath = createTempDbPath();
        const db = openDb({ dbPath });
        try {
            const now = Date.now();
            db.prepare(`
        INSERT INTO contexts (id, name, paths, createdAt, syncPolicy)
        VALUES (?, ?, ?, ?, ?)
      `).run('ctx-sync', 'ctx', '[]', now, 'full_sync');
            db.prepare(`
        INSERT INTO schema_meta (key, value)
        VALUES ('schema_version', '9')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run();
        } finally {
            db.close();
        }

        const reopened = openDb({ dbPath });
        try {
            expect(getSchemaVersion(reopened)).toBe(CURRENT_SCHEMA_VERSION);
            const row = reopened.prepare('SELECT syncPolicy FROM contexts WHERE id = ?').get('ctx-sync') as { syncPolicy: string };
            expect(row.syncPolicy).toBe('metadata_only');
        } finally {
            reopened.close();
        }
    });

    it('backfills legacy chat artifacts and upgrades legacy databases to the current schema', () => {
        const dbPath = createTempDbPath();
        const db = openDb({ dbPath });
        try {
            const now = Date.now();
            db.prepare(`
        INSERT INTO contexts (id, name, paths, createdAt, syncPolicy)
        VALUES (?, ?, ?, ?, ?)
      `).run('ctx-1', 'ctx', '[]', now, 'metadata_only');
            db.prepare(`
        INSERT INTO nodes (id, contextId, thread, type, content, key, tags, source, hidden, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
                'node-1',
                'ctx-1',
                'legacy-session',
                'artifact',
                'legacy chat node',
                'chat_turn:codex:legacy-session:legacy-turn-1',
                '[]',
                'hook:codex',
                0,
                now
            );
            db.prepare(`
        INSERT INTO schema_meta (key, value)
        VALUES ('schema_version', '6')
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run();
        } finally {
            db.close();
        }

        const reopened = openDb({ dbPath });
        try {
            expect(getSchemaVersion(reopened)).toBe(CURRENT_SCHEMA_VERSION);
            const row = reopened.prepare('SELECT hidden FROM nodes WHERE id = ?').get('node-1') as { hidden: number };
            const checkpointPayloadTable = reopened.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'checkpoint_payloads'
      `).get() as { name?: string } | undefined;
            const branchLaneTable = reopened.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'branch_lanes'
      `).get() as { name?: string } | undefined;
            expect(row.hidden).toBe(1);
            expect(checkpointPayloadTable?.name).toBe('checkpoint_payloads');
            expect(branchLaneTable?.name).toBe('branch_lanes');
        } finally {
            reopened.close();
        }
    });
});
