import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

const DB_PATH = path.join(os.homedir(), '.0ctx', '0ctx.db');

export function openDb(): Database.Database {
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
    return db;
}

function migrate(db: Database.Database) {
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
