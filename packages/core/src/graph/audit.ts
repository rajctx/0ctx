import { createHmac, randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type { AuditAction, AuditEntry, AuditMetadata } from '../schema';

type AuditDeps = {
    db: Database.Database;
    resolveAuditSecret: () => string;
};

function getLastAuditHash(db: Database.Database): string {
    const row = db.prepare(`
      SELECT entryHash
      FROM audit_logs
      ORDER BY createdAt DESC, id DESC
      LIMIT 1
    `).get() as { entryHash?: string } | undefined;
    return row?.entryHash ?? '';
}

export function recordAuditEventRecord(
    deps: AuditDeps,
    params: {
        action: AuditAction;
        contextId?: string | null;
        payload?: Record<string, unknown>;
        result?: Record<string, unknown> | null;
        metadata?: AuditMetadata;
    }
): AuditEntry {
    const entry: AuditEntry = {
        id: randomUUID(),
        action: params.action,
        contextId: params.contextId ?? null,
        payload: params.payload ?? {},
        result: params.result ?? null,
        actor: params.metadata?.actor ?? null,
        source: params.metadata?.source ?? null,
        sessionToken: params.metadata?.sessionToken ?? null,
        connectionId: params.metadata?.connectionId ?? null,
        requestId: params.metadata?.requestId ?? null,
        createdAt: Date.now()
    };

    const prevHash = getLastAuditHash(deps.db);
    const hmacData = `${prevHash}|${entry.id}|${entry.action}|${entry.createdAt}`;
    const entryHash = createHmac('sha256', deps.resolveAuditSecret()).update(hmacData).digest('hex');

    deps.db.prepare(`
      INSERT INTO audit_logs (
        id, action, contextId, payload, result, actor, source, sessionToken, connectionId, requestId, createdAt, entryHash, prevHash
      ) VALUES (
        @id, @action, @contextId, @payload, @result, @actor, @source, @sessionToken, @connectionId, @requestId, @createdAt, @entryHash, @prevHash
      )
    `).run({
        ...entry,
        payload: JSON.stringify(entry.payload),
        result: entry.result ? JSON.stringify(entry.result) : null,
        entryHash,
        prevHash
    });

    return { ...entry, entryHash, prevHash } as AuditEntry;
}

export function verifyAuditChainRecord(
    deps: AuditDeps,
    limit = 1000
): { valid: boolean; checked: number; brokenAt?: string } {
    const rows = deps.db.prepare(`
      SELECT *
      FROM audit_logs
      ORDER BY createdAt ASC, id ASC
      LIMIT ?
    `).all(Math.max(1, Math.min(limit, 100000))) as any[];

    let previousHash = '';
    let checked = 0;
    for (const row of rows) {
        const hmacData = `${row.prevHash ?? ''}|${row.id}|${row.action}|${row.createdAt}`;
        const expectedHash = createHmac('sha256', deps.resolveAuditSecret()).update(hmacData).digest('hex');
        if ((row.prevHash ?? '') !== previousHash || row.entryHash !== expectedHash) {
            return { valid: false, checked, brokenAt: row.id };
        }
        previousHash = row.entryHash;
        checked += 1;
    }

    return { valid: true, checked };
}

export function listAuditEventsRecord(
    deps: AuditDeps,
    contextId?: string,
    limit = 50
): AuditEntry[] {
    const safeLimit = Math.max(1, Math.min(limit, 5000));
    const rows = (contextId
        ? deps.db.prepare(`
          SELECT *
          FROM audit_logs
          WHERE contextId = ?
          ORDER BY createdAt DESC, id DESC
          LIMIT ?
        `).all(contextId, safeLimit)
        : deps.db.prepare(`
          SELECT *
          FROM audit_logs
          ORDER BY createdAt DESC, id DESC
          LIMIT ?
        `).all(safeLimit)) as any[];

    return rows.map((row): AuditEntry => ({
        id: row.id,
        action: row.action,
        contextId: row.contextId ?? null,
        payload: row.payload ? JSON.parse(row.payload) : {},
        result: row.result ? JSON.parse(row.result) : null,
        actor: row.actor ?? null,
        source: row.source ?? null,
        sessionToken: row.sessionToken ?? null,
        connectionId: row.connectionId ?? null,
        requestId: row.requestId ?? null,
        createdAt: row.createdAt,
        entryHash: row.entryHash,
        prevHash: row.prevHash
    } as AuditEntry));
}
