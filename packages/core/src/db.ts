import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

const DB_PATH = path.join(os.homedir(), '.0ctx', '0ctx.db');
export const CURRENT_SCHEMA_VERSION = 5;

export interface OpenDbOptions {
    dbPath?: string;
}

function resolveDbPath(options?: OpenDbOptions): string {
    return options?.dbPath || process.env.CTX_DB_PATH || DB_PATH;
}

export function openDb(options?: OpenDbOptions): Database.Database {
    const dbPath = resolveDbPath(options);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
    return db;
}

function migrate(db: Database.Database) {
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
}

function migrateToV1(db: Database.Database) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS contexts (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      paths      TEXT NOT NULL DEFAULT '[]',
      createdAt  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id          TEXT PRIMARY KEY,
      contextId   TEXT NOT NULL,
      thread      TEXT,
      type        TEXT NOT NULL,
      content     TEXT NOT NULL,
      key         TEXT,
      tags        TEXT NOT NULL DEFAULT '[]',
      source      TEXT,
      createdAt   INTEGER NOT NULL,
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

function migrateToV2(db: Database.Database) {
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

function hasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
    const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    return rows.some((row) => row.name === columnName);
}

// SEC-001: Audit log HMAC chain columns
function migrateToV4(db: Database.Database) {
    if (!hasColumn(db, 'audit_logs', 'entryHash')) {
        db.exec(`ALTER TABLE audit_logs ADD COLUMN entryHash TEXT`);
    }
    if (!hasColumn(db, 'audit_logs', 'prevHash')) {
        db.exec(`ALTER TABLE audit_logs ADD COLUMN prevHash TEXT`);
    }
}

function migrateToV3(db: Database.Database) {
    if (!hasColumn(db, 'contexts', 'syncPolicy')) {
        db.exec(`
        ALTER TABLE contexts
        ADD COLUMN syncPolicy TEXT NOT NULL DEFAULT 'metadata_only'
      `);
    }
}

function migrateToV5(db: Database.Database) {
    db.exec(`
    CREATE INDEX IF NOT EXISTS idx_nodes_context_created
      ON nodes(contextId, createdAt DESC);

    CREATE INDEX IF NOT EXISTS idx_audit_logs_session_created
      ON audit_logs(sessionToken, createdAt DESC);
  `);
}

export function getSchemaVersion(db: Database.Database): number {
    const row = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('schema_version') as { value: string } | undefined;
    if (!row) return 0;

    const value = Number(row.value);
    return Number.isNaN(value) ? 0 : value;
}

function setSchemaVersion(db: Database.Database, version: number): void {
    db.prepare(`
    INSERT INTO schema_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run('schema_version', String(version));
}
