import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type {
    AgentSessionSummary,
    Checkpoint,
    CheckpointDetail,
    CheckpointKind,
    CheckpointPayloadRecord,
    ContextDump
} from '../schema';

type CheckpointDeps = {
    db: Database.Database;
    parseCheckpointRow: (row: any) => Checkpoint;
    getCheckpointPayload: (checkpointId: string) => CheckpointPayloadRecord | null;
    setCheckpointPayload: (
        checkpointId: string,
        contextId: string,
        payload: unknown,
        options?: { contentType?: string; compression?: any; createdAt?: number; updatedAt?: number }
    ) => CheckpointPayloadRecord;
    exportContextDump: (contextId: string) => ContextDump;
    refreshBranchLaneProjection: (contextId: string) => void;
    replaceContextFromDump: (contextId: string, dump: ContextDump) => void;
    listChatSessions: (contextId: string, limit?: number) => AgentSessionSummary[];
    normalizeBranch: (branch: string | null | undefined) => string;
};

export function insertCheckpointRecord(db: Database.Database, checkpoint: Checkpoint): void {
    db.prepare(`
      INSERT INTO checkpoints (
        id, contextId, name, nodeIds, kind, sessionId, branch, worktreePath, commitSha, summary, agentSet, createdAt
      )
      VALUES (
        @id, @contextId, @name, @nodeIds, @kind, @sessionId, @branch, @worktreePath, @commitSha, @summary, @agentSet, @createdAt
      )
    `).run({
        ...checkpoint,
        nodeIds: JSON.stringify(checkpoint.nodeIds),
        agentSet: JSON.stringify(checkpoint.agentSet ?? [])
    });
}

export function listCheckpointsRecord(
    db: Database.Database,
    parseCheckpointRow: (row: any) => Checkpoint,
    contextId: string
): Checkpoint[] {
    return (db.prepare(
        'SELECT * FROM checkpoints WHERE contextId = ? ORDER BY createdAt DESC'
    ).all(contextId) as any[]).map((row) => parseCheckpointRow(row));
}

export function getCheckpointDetailRecord(
    db: Database.Database,
    parseCheckpointRow: (row: any) => Checkpoint,
    getCheckpointPayload: (checkpointId: string) => CheckpointPayloadRecord | null,
    checkpointId: string
): CheckpointDetail | null {
    const row = db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(checkpointId) as any;
    if (!row) return null;

    const checkpoint = parseCheckpointRow(row);
    const payload = getCheckpointPayload(checkpointId);
    const dump = payload?.payload && typeof payload.payload === 'object' ? payload.payload as Partial<ContextDump> : null;
    return {
        checkpoint,
        snapshotNodeCount: Array.isArray(dump?.nodes) ? dump.nodes.length : checkpoint.nodeIds.length,
        snapshotEdgeCount: Array.isArray(dump?.edges) ? dump.edges.length : 0,
        snapshotCheckpointCount: Array.isArray(dump?.checkpoints) ? dump.checkpoints.length : 0,
        payloadAvailable: Boolean(payload)
    };
}

export function saveCheckpointRecord(
    deps: CheckpointDeps,
    contextId: string,
    name: string
): Checkpoint {
    const nodeIds = (deps.db.prepare('SELECT id FROM nodes WHERE contextId = ?').all(contextId) as any[]).map((row) => row.id);
    const checkpoint: Checkpoint = {
        id: randomUUID(),
        contextId,
        name,
        nodeIds,
        kind: 'manual',
        sessionId: null,
        branch: null,
        worktreePath: null,
        commitSha: null,
        summary: name,
        agentSet: [],
        createdAt: Date.now()
    };

    insertCheckpointRecord(deps.db, checkpoint);
    const snapshot = deps.exportContextDump(contextId);
    deps.setCheckpointPayload(checkpoint.id, contextId, snapshot, {
        createdAt: checkpoint.createdAt,
        updatedAt: checkpoint.createdAt
    });
    deps.refreshBranchLaneProjection(contextId);
    return getCheckpointDetailRecord(deps.db, deps.parseCheckpointRow, deps.getCheckpointPayload, checkpoint.id)?.checkpoint ?? checkpoint;
}

export function createSessionCheckpointRecord(
    deps: CheckpointDeps,
    contextId: string,
    sessionId: string,
    options: { name?: string; summary?: string; kind?: CheckpointKind } = {}
): Checkpoint {
    const session = deps.listChatSessions(contextId, 5000).find((entry) => entry.sessionId === sessionId);
    if (!session) {
        throw new Error(`Session ${sessionId} not found`);
    }

    const nodeIds = (deps.db.prepare('SELECT id FROM nodes WHERE contextId = ?').all(contextId) as any[]).map((row) => row.id);
    const checkpoint: Checkpoint = {
        id: randomUUID(),
        contextId,
        name: options.name ?? `${session.agent ?? 'agent'} ${deps.normalizeBranch(session.branch)} checkpoint`,
        nodeIds,
        kind: options.kind ?? 'session',
        sessionId,
        branch: session.branch ?? null,
        worktreePath: session.worktreePath ?? null,
        commitSha: session.commitSha ?? null,
        summary: options.summary ?? session.summary,
        agentSet: session.agent ? [session.agent] : [],
        createdAt: Date.now()
    };

    insertCheckpointRecord(deps.db, checkpoint);
    const snapshot = deps.exportContextDump(contextId);
    deps.setCheckpointPayload(checkpoint.id, contextId, snapshot, {
        createdAt: checkpoint.createdAt,
        updatedAt: checkpoint.createdAt
    });
    deps.refreshBranchLaneProjection(contextId);
    return getCheckpointDetailRecord(deps.db, deps.parseCheckpointRow, deps.getCheckpointPayload, checkpoint.id)?.checkpoint ?? checkpoint;
}

export function rewindCheckpointRecord(
    deps: CheckpointDeps,
    checkpointId: string
): CheckpointDetail {
    const payload = deps.getCheckpointPayload(checkpointId);
    if (!payload) {
        throw new Error(`Checkpoint ${checkpointId} has no snapshot payload`);
    }
    const detail = getCheckpointDetailRecord(deps.db, deps.parseCheckpointRow, deps.getCheckpointPayload, checkpointId);
    if (!detail) {
        throw new Error(`Checkpoint ${checkpointId} not found`);
    }

    const dump = payload.payload as ContextDump;
    deps.replaceContextFromDump(detail.checkpoint.contextId, dump);
    deps.setCheckpointPayload(checkpointId, detail.checkpoint.contextId, dump, {
        contentType: payload.contentType,
        compression: payload.compression,
        createdAt: payload.createdAt,
        updatedAt: Date.now()
    });
    return getCheckpointDetailRecord(deps.db, deps.parseCheckpointRow, deps.getCheckpointPayload, checkpointId)!;
}
