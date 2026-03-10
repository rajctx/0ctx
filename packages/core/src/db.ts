import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { migrate, CURRENT_SCHEMA_VERSION } from './db/migrations';
import { getSchemaVersion } from './db/meta';

const DB_PATH = path.join(os.homedir(), '.0ctx', '0ctx.db');

export interface OpenDbOptions {
    dbPath?: string;
}

export { CURRENT_SCHEMA_VERSION, getSchemaVersion };

export function openDb(options?: OpenDbOptions): Database.Database {
    const dbPath = options?.dbPath || process.env.CTX_DB_PATH || DB_PATH;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
    return db;
}
