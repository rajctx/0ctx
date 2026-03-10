import type Database from 'better-sqlite3';
import { getSchemaVersion, hasColumn, setSchemaVersion } from './meta';

export const CURRENT_SCHEMA_VERSION = 10;

export function migrate(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    const version = getSchemaVersion(db);
    if (version < 1) {
        migrateToV1(db);
        setSchemaVersion(db, 1);
    }
    if (version < 2) {
        migrateToV2(db);
        setSchemaVersion(db, 2);
    }
    if (version < 3) {
        migrateToV3(db);
        setSchemaVersion(db, 3);
    }
    if (version < 4) {
        migrateToV4(db);
        setSchemaVersion(db, 4);
    }
    if (version < 5) {
        migrateToV5(db);
        setSchemaVersion(db, 5);
    }
    if (version < 6) {
        migrateToV6(db);
        setSchemaVersion(db, 6);
    }
    if (version < 7) {
        migrateToV7(db);
        setSchemaVersion(db, 7);
    }
    if (version < 8) {
        migrateToV8(db);
        setSchemaVersion(db, 8);
    }
    if (version < 9) {
        migrateToV9(db);
        setSchemaVersion(db, 9);
    }
    if (version < 10) {
        migrateToV10(db);
        setSchemaVersion(db, 10);
    }
}

function migrateToV1(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS contexts (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        paths      TEXT NOT NULL DEFAULT '[]',
        createdAt  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS nodes (
        id           TEXT PRIMARY KEY,
        contextId    TEXT NOT NULL,
        thread       TEXT,
        type         TEXT NOT NULL,
        content      TEXT NOT NULL,
        key          TEXT,
        tags         TEXT NOT NULL DEFAULT '[]',
        source       TEXT,
        hidden       INTEGER NOT NULL DEFAULT 0,
        createdAt    INTEGER NOT NULL,
        checkpointId TEXT,
        FOREIGN KEY (contextId) REFERENCES contexts(id)
      );

      CREATE TABLE IF NOT EXISTS edges (
        id        TEXT PRIMARY KEY,
        fromId    TEXT NOT NULL,
        toId      TEXT NOT NULL,
        relation  TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (fromId) REFERENCES nodes(id),
        FOREIGN KEY (toId)   REFERENCES nodes(id)
      );

      CREATE TABLE IF NOT EXISTS checkpoints (
        id        TEXT PRIMARY KEY,
        contextId TEXT NOT NULL,
        name      TEXT NOT NULL,
        nodeIds   TEXT NOT NULL DEFAULT '[]',
        createdAt INTEGER NOT NULL,
        FOREIGN KEY (contextId) REFERENCES contexts(id)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts
        USING fts5(id UNINDEXED, content, tags, tokenize='porter ascii');
    `);
}

function migrateToV2(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id            TEXT PRIMARY KEY,
        action        TEXT NOT NULL,
        contextId     TEXT,
        payload       TEXT NOT NULL DEFAULT '{}',
        result        TEXT,
        actor         TEXT,
        source        TEXT,
        sessionToken  TEXT,
        connectionId  TEXT,
        requestId     TEXT,
        createdAt     INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_logs_context_created
        ON audit_logs(contextId, createdAt DESC);

      CREATE INDEX IF NOT EXISTS idx_audit_logs_created
        ON audit_logs(createdAt DESC);
    `);
}

function migrateToV3(db: Database.Database): void {
    if (!hasColumn(db, 'contexts', 'syncPolicy')) {
        db.exec(`
          ALTER TABLE contexts
          ADD COLUMN syncPolicy TEXT NOT NULL DEFAULT 'metadata_only'
        `);
    }
}

function migrateToV4(db: Database.Database): void {
    if (!hasColumn(db, 'audit_logs', 'entryHash')) {
        db.exec(`ALTER TABLE audit_logs ADD COLUMN entryHash TEXT`);
    }
    if (!hasColumn(db, 'audit_logs', 'prevHash')) {
        db.exec(`ALTER TABLE audit_logs ADD COLUMN prevHash TEXT`);
    }
}

function migrateToV5(db: Database.Database): void {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_nodes_context_created
        ON nodes(contextId, createdAt DESC);

      CREATE INDEX IF NOT EXISTS idx_audit_logs_session_created
        ON audit_logs(sessionToken, createdAt DESC);
    `);
}

function migrateToV6(db: Database.Database): void {
    if (!hasColumn(db, 'nodes', 'hidden')) {
        db.exec(`ALTER TABLE nodes ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`);
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS node_payloads (
        nodeId       TEXT PRIMARY KEY,
        contextId    TEXT NOT NULL,
        contentType  TEXT NOT NULL DEFAULT 'application/json',
        compression  TEXT NOT NULL DEFAULT 'gzip',
        payload      BLOB NOT NULL,
        byteLength   INTEGER NOT NULL DEFAULT 0,
        createdAt    INTEGER NOT NULL,
        updatedAt    INTEGER NOT NULL,
        FOREIGN KEY (nodeId) REFERENCES nodes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_context_hidden_created
        ON nodes(contextId, hidden, createdAt DESC);

      CREATE INDEX IF NOT EXISTS idx_nodes_context_key_created
        ON nodes(contextId, key, createdAt DESC);

      CREATE INDEX IF NOT EXISTS idx_node_payloads_context_created
        ON node_payloads(contextId, createdAt DESC);
    `);
}

function migrateToV7(db: Database.Database): void {
    db.exec(`
      UPDATE nodes
      SET hidden = 1
      WHERE hidden = 0
        AND type = 'artifact'
        AND (
          key LIKE 'chat_session:%'
          OR key LIKE 'chat_turn:%'
          OR key LIKE 'chat_commit:%'
        );
    `);
}

function migrateToV8(db: Database.Database): void {
    const checkpointColumns = [
        ['kind', `ALTER TABLE checkpoints ADD COLUMN kind TEXT NOT NULL DEFAULT 'legacy'`],
        ['sessionId', `ALTER TABLE checkpoints ADD COLUMN sessionId TEXT`],
        ['branch', `ALTER TABLE checkpoints ADD COLUMN branch TEXT`],
        ['worktreePath', `ALTER TABLE checkpoints ADD COLUMN worktreePath TEXT`],
        ['commitSha', `ALTER TABLE checkpoints ADD COLUMN commitSha TEXT`],
        ['summary', `ALTER TABLE checkpoints ADD COLUMN summary TEXT`],
        ['agentSet', `ALTER TABLE checkpoints ADD COLUMN agentSet TEXT NOT NULL DEFAULT '[]'`]
    ] as const;

    for (const [columnName, statement] of checkpointColumns) {
        if (!hasColumn(db, 'checkpoints', columnName)) {
            db.exec(statement);
        }
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoint_payloads (
        checkpointId  TEXT PRIMARY KEY,
        contextId     TEXT NOT NULL,
        contentType   TEXT NOT NULL DEFAULT 'application/json',
        compression   TEXT NOT NULL DEFAULT 'gzip',
        payload       BLOB NOT NULL,
        byteLength    INTEGER NOT NULL DEFAULT 0,
        createdAt     INTEGER NOT NULL,
        updatedAt     INTEGER NOT NULL,
        FOREIGN KEY (checkpointId) REFERENCES checkpoints(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS branch_lanes (
        contextId       TEXT NOT NULL,
        branch          TEXT NOT NULL,
        worktreePath    TEXT NOT NULL DEFAULT '',
        lastAgent       TEXT,
        lastCommitSha   TEXT,
        lastActivityAt  INTEGER NOT NULL,
        sessionCount    INTEGER NOT NULL DEFAULT 0,
        checkpointCount INTEGER NOT NULL DEFAULT 0,
        agentSet        TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (contextId, branch, worktreePath),
        FOREIGN KEY (contextId) REFERENCES contexts(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_checkpoints_context_created
        ON checkpoints(contextId, createdAt DESC);

      CREATE INDEX IF NOT EXISTS idx_checkpoints_context_branch_created
        ON checkpoints(contextId, branch, createdAt DESC);

      CREATE INDEX IF NOT EXISTS idx_checkpoints_context_session_created
        ON checkpoints(contextId, sessionId, createdAt DESC);

      CREATE INDEX IF NOT EXISTS idx_checkpoint_payloads_context_created
        ON checkpoint_payloads(contextId, createdAt DESC);

      CREATE INDEX IF NOT EXISTS idx_branch_lanes_context_last_activity
        ON branch_lanes(contextId, lastActivityAt DESC);

      CREATE INDEX IF NOT EXISTS idx_branch_lanes_context_branch
        ON branch_lanes(contextId, branch);

      UPDATE checkpoints
      SET kind = CASE
        WHEN kind IS NULL OR TRIM(kind) = '' THEN 'legacy'
        ELSE kind
      END,
          agentSet = CASE
        WHEN agentSet IS NULL OR TRIM(agentSet) = '' THEN '[]'
        ELSE agentSet
      END;
    `);
}

function migrateToV9(db: Database.Database): void {
    const syncPolicyColumn = db.prepare(`PRAGMA table_info(contexts)`).all() as Array<{
        name: string;
        dflt_value: string | null;
    }>;
    const defaultValue = syncPolicyColumn.find((column) => column.name === 'syncPolicy')?.dflt_value ?? null;
    if (defaultValue === "'metadata_only'") {
        db.exec(`
          UPDATE contexts
          SET syncPolicy = 'metadata_only'
          WHERE syncPolicy IS NULL OR TRIM(syncPolicy) = ''
        `);
        return;
    }

    db.exec(`
      PRAGMA foreign_keys = OFF;

      CREATE TABLE contexts_v9 (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        paths      TEXT NOT NULL DEFAULT '[]',
        createdAt  INTEGER NOT NULL,
        syncPolicy TEXT NOT NULL DEFAULT 'metadata_only'
      );

      INSERT INTO contexts_v9 (id, name, paths, createdAt, syncPolicy)
      SELECT
        id,
        name,
        paths,
        createdAt,
        CASE
          WHEN syncPolicy IN ('local_only', 'metadata_only', 'full_sync') THEN syncPolicy
          ELSE 'metadata_only'
        END
      FROM contexts;

      DROP TABLE contexts;
      ALTER TABLE contexts_v9 RENAME TO contexts;

      PRAGMA foreign_keys = ON;
    `);
}

function migrateToV10(db: Database.Database): void {
    db.exec(`
      UPDATE contexts
      SET syncPolicy = 'metadata_only'
      WHERE syncPolicy IS NULL
         OR TRIM(syncPolicy) = ''
         OR syncPolicy = 'full_sync'
    `);
}
