import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type { Context, SyncPolicy } from '../schema';

export function createContextRecord(
    db: Database.Database,
    name: string,
    paths: string[] = [],
    syncPolicy: SyncPolicy = 'metadata_only'
): Context {
    const context: Context = { id: randomUUID(), name, paths, syncPolicy, createdAt: Date.now() };
    db.prepare(`
      INSERT INTO contexts (id, name, paths, syncPolicy, createdAt)
      VALUES (@id, @name, @paths, @syncPolicy, @createdAt)
    `).run({ ...context, paths: JSON.stringify(context.paths) });
    return context;
}

export function getContextRecord(db: Database.Database, id: string): Context | null {
    const row = db.prepare('SELECT * FROM contexts WHERE id = ?').get(id) as any;
    return row ? { ...row, paths: JSON.parse(row.paths), syncPolicy: row.syncPolicy ?? 'metadata_only' } : null;
}

export function listContextRecords(db: Database.Database): Context[] {
    const rows = db.prepare('SELECT * FROM contexts ORDER BY createdAt DESC').all() as any[];
    return rows.map((row) => ({
        ...row,
        paths: JSON.parse(row.paths),
        syncPolicy: row.syncPolicy ?? 'metadata_only'
    }));
}

export function getContextSyncPolicyRecord(db: Database.Database, contextId: string): SyncPolicy | null {
    const row = db.prepare('SELECT syncPolicy FROM contexts WHERE id = ?').get(contextId) as { syncPolicy?: string } | undefined;
    if (!row) return null;
    if (row.syncPolicy === 'local_only' || row.syncPolicy === 'full_sync' || row.syncPolicy === 'metadata_only') {
        return row.syncPolicy;
    }
    return 'metadata_only';
}

export function setContextSyncPolicyRecord(
    db: Database.Database,
    contextId: string,
    policy: SyncPolicy
): Context | null {
    const existing = getContextRecord(db, contextId);
    if (!existing) return null;

    db.prepare('UPDATE contexts SET syncPolicy = ? WHERE id = ?').run(policy, contextId);
    return getContextRecord(db, contextId);
}

export function deleteContextRecord(db: Database.Database, id: string): void {
    const nodeIds = (db.prepare('SELECT id FROM nodes WHERE contextId = ?').all(id) as any[]).map((row) => row.id);

    for (const nodeId of nodeIds) {
        db.prepare('DELETE FROM nodes_fts WHERE id = ?').run(nodeId);
        db.prepare('DELETE FROM node_payloads WHERE nodeId = ?').run(nodeId);
        db.prepare('DELETE FROM edges WHERE fromId = ? OR toId = ?').run(nodeId, nodeId);
    }

    db.prepare('DELETE FROM branch_lanes WHERE contextId = ?').run(id);
    db.prepare('DELETE FROM checkpoint_payloads WHERE contextId = ?').run(id);
    db.prepare('DELETE FROM nodes WHERE contextId = ?').run(id);
    db.prepare('DELETE FROM checkpoints WHERE contextId = ?').run(id);
    db.prepare('DELETE FROM contexts WHERE id = ?').run(id);
}
