import type Database from 'better-sqlite3';

export function getSchemaVersion(db: Database.Database): number {
    const row = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('schema_version') as { value: string } | undefined;
    if (!row) return 0;

    const value = Number(row.value);
    return Number.isNaN(value) ? 0 : value;
}

export function setSchemaVersion(db: Database.Database, version: number): void {
    db.prepare(`
      INSERT INTO schema_meta (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run('schema_version', String(version));
}

export function hasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
    const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    return rows.some((row) => row.name === columnName);
}
