import type Database from 'better-sqlite3';
import { MERGE_MUTATION_AUDIT_ACTIONS } from './constants';

export function createSyncMergeStateTable(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sync_merge_state (
        contextId            TEXT PRIMARY KEY,
        lastRemoteTimestamp  INTEGER NOT NULL DEFAULT 0,
        updatedAt            INTEGER NOT NULL
      )
    `);
}

export function getLastRemoteTimestamp(db: Database.Database, contextId: string): number {
    const row = db
        .prepare('SELECT lastRemoteTimestamp FROM sync_merge_state WHERE contextId = ?')
        .get(contextId) as { lastRemoteTimestamp?: number } | undefined;
    return typeof row?.lastRemoteTimestamp === 'number' ? row.lastRemoteTimestamp : 0;
}

export function setLastRemoteTimestamp(
    db: Database.Database,
    contextId: string,
    lastRemoteTimestamp: number
): void {
    db.prepare(`
      INSERT INTO sync_merge_state (contextId, lastRemoteTimestamp, updatedAt)
      VALUES (?, ?, ?)
      ON CONFLICT(contextId) DO UPDATE SET
        lastRemoteTimestamp = excluded.lastRemoteTimestamp,
        updatedAt = excluded.updatedAt
    `).run(contextId, lastRemoteTimestamp, Date.now());
}

export function getLatestLocalMutationAt(db: Database.Database, contextId: string): number {
    try {
        const placeholders = MERGE_MUTATION_AUDIT_ACTIONS.map(() => '?').join(', ');
        const row = db.prepare(`
          SELECT MAX(createdAt) AS maxCreatedAt
          FROM audit_logs
          WHERE contextId = ?
            AND action IN (${placeholders})
        `).get(contextId, ...MERGE_MUTATION_AUDIT_ACTIONS) as { maxCreatedAt?: number } | undefined;
        return typeof row?.maxCreatedAt === 'number' ? row.maxCreatedAt : 0;
    } catch {
        return 0;
    }
}
