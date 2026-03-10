import type Database from 'better-sqlite3';
import type {
    AgentSessionSummary,
    ChatTurnSummary,
    Checkpoint,
    CheckpointSummary,
    ContextNode,
    NodePayloadRecord,
    SessionDetail,
    SessionMessage
} from '../schema';
import type { TurnMetadata } from './metadata';

type SessionDeps = {
    db: Database.Database;
    parseNodeRow: (row: any) => ContextNode;
    parseCheckpointRow: (row: any) => Checkpoint;
    toCheckpointSummary: (checkpoint: Checkpoint) => CheckpointSummary;
    getNodePayload: (nodeId: string) => NodePayloadRecord | null;
    extractTurnMetadata: (payload: unknown) => TurnMetadata;
    extractAgentFromKey: (key: string | null | undefined) => string | null;
    extractAgentFromTags: (tags: string[] | null | undefined) => string | null;
    extractMessageIdFromKey: (key: string | null | undefined) => string | null;
};

function findSessionSummary(deps: SessionDeps, contextId: string, sessionId: string): AgentSessionSummary | null {
    return listChatSessionsRecord(deps, contextId, 5000).find((entry) => entry.sessionId === sessionId) ?? null;
}

export function listChatSessionsRecord(
    deps: SessionDeps,
    contextId: string,
    limit = 50
): AgentSessionSummary[] {
    const safeLimit = Math.max(1, Math.min(limit, 5000));
    const rows = deps.db.prepare(`
      SELECT
        thread AS sessionId,
        MIN(createdAt) AS startedAt,
        MAX(createdAt) AS lastTurnAt,
        COUNT(*) AS turnCount
      FROM nodes
      WHERE contextId = ? AND type = 'artifact' AND thread IS NOT NULL AND key LIKE 'chat_turn:%'
      GROUP BY thread
      ORDER BY lastTurnAt DESC
      LIMIT ?
    `).all(contextId, safeLimit) as Array<{
        sessionId: string;
        startedAt: number;
        lastTurnAt: number;
        turnCount: number;
    }>;

    return rows.map((row): AgentSessionSummary => {
        const latestRow = deps.db.prepare(`
        SELECT *
        FROM nodes
        WHERE contextId = ? AND thread = ? AND key LIKE 'chat_turn:%'
        ORDER BY createdAt DESC
        LIMIT 1
      `).get(contextId, row.sessionId) as any;
        const sessionRow = deps.db.prepare(`
        SELECT *
        FROM nodes
        WHERE contextId = ? AND thread = ? AND key LIKE 'chat_session:%'
        ORDER BY createdAt DESC
        LIMIT 1
      `).get(contextId, row.sessionId) as any;
        const firstRow = deps.db.prepare(`
        SELECT *
        FROM nodes
        WHERE contextId = ? AND thread = ? AND key LIKE 'chat_turn:%'
        ORDER BY createdAt ASC
        LIMIT 1
      `).get(contextId, row.sessionId) as any;

        const latestNode = latestRow ? deps.parseNodeRow(latestRow) : null;
        const sessionNode = sessionRow ? deps.parseNodeRow(sessionRow) : null;
        const firstNode = firstRow ? deps.parseNodeRow(firstRow) : null;
        const latestMetadata = deps.extractTurnMetadata(deps.getNodePayload(latestNode?.id ?? '')?.payload);
        const firstMetadata = deps.extractTurnMetadata(deps.getNodePayload(firstNode?.id ?? '')?.payload);
        const sessionMetadata = deps.extractTurnMetadata(deps.getNodePayload(sessionNode?.id ?? '')?.payload);

        const agent =
            latestMetadata.agent
            ?? firstMetadata.agent
            ?? sessionMetadata.agent
            ?? deps.extractAgentFromKey(sessionNode?.key ?? latestNode?.key)
            ?? deps.extractAgentFromTags(sessionNode?.tags ?? latestNode?.tags);

        return {
            sessionId: row.sessionId,
            sessionNodeId: sessionNode?.id ?? latestNode?.id ?? null,
            summary: (sessionNode?.content ?? latestNode?.content ?? '').trim(),
            startedAt: firstMetadata.occurredAt ?? row.startedAt,
            lastTurnAt: latestMetadata.occurredAt ?? row.lastTurnAt,
            turnCount: row.turnCount,
            branch: latestMetadata.branch ?? sessionMetadata.branch ?? firstMetadata.branch,
            commitSha: latestMetadata.commitSha ?? sessionMetadata.commitSha ?? firstMetadata.commitSha,
            agent,
            worktreePath: latestMetadata.worktreePath ?? sessionMetadata.worktreePath ?? firstMetadata.worktreePath,
            repositoryRoot: latestMetadata.repositoryRoot ?? sessionMetadata.repositoryRoot ?? firstMetadata.repositoryRoot,
            captureSource: latestMetadata.captureSource ?? sessionMetadata.captureSource ?? latestNode?.source ?? sessionNode?.source ?? null
        };
    });
}

export function listChatTurnsRecord(
    deps: SessionDeps,
    contextId: string,
    sessionId: string,
    limit = 200
): ChatTurnSummary[] {
    const safeLimit = Math.max(1, Math.min(limit, 5000));
    const rows = deps.db.prepare(`
      SELECT n.*, np.nodeId AS payloadNodeId, np.byteLength AS payloadByteLength
      FROM nodes n
      LEFT JOIN node_payloads np ON np.nodeId = n.id
      WHERE n.contextId = ? AND n.thread = ? AND n.key LIKE 'chat_turn:%'
      ORDER BY n.createdAt ASC
      LIMIT ?
    `).all(contextId, sessionId, safeLimit) as any[];

    return rows.map((row): ChatTurnSummary => {
        const node = deps.parseNodeRow(row);
        const metadata = deps.extractTurnMetadata(row.payloadNodeId ? deps.getNodePayload(node.id)?.payload : null);
        const roleTag = (node.tags ?? []).find((tag) => tag.startsWith('role:'));
        const role = roleTag ? roleTag.slice('role:'.length) : metadata.role;
        return {
            nodeId: node.id,
            contextId: node.contextId,
            sessionId: node.thread ?? sessionId,
            key: node.key ?? null,
            type: node.type,
            content: node.content,
            tags: node.tags ?? [],
            source: node.source ?? null,
            hidden: Boolean(node.hidden),
            createdAt: metadata.occurredAt ?? node.createdAt,
            role: role ?? null,
            branch: metadata.branch,
            commitSha: metadata.commitSha,
            messageId: metadata.messageId ?? deps.extractMessageIdFromKey(node.key) ?? node.id,
            parentId: metadata.parentId ?? null,
            agent: metadata.agent ?? deps.extractAgentFromKey(node.key) ?? deps.extractAgentFromTags(node.tags),
            worktreePath: metadata.worktreePath ?? null,
            repositoryRoot: metadata.repositoryRoot ?? null,
            captureSource: metadata.captureSource ?? node.source ?? null,
            sessionTitle: metadata.sessionTitle ?? null,
            hasPayload: Boolean(row.payloadNodeId),
            payloadBytes: typeof row.payloadByteLength === 'number' ? row.payloadByteLength : null
        };
    });
}

export function listSessionMessagesRecord(
    deps: SessionDeps,
    contextId: string,
    sessionId: string,
    limit = 500
): SessionMessage[] {
    const session = findSessionSummary(deps, contextId, sessionId);
    return listChatTurnsRecord(deps, contextId, sessionId, limit).map((turn): SessionMessage => ({
        ...turn,
        messageId: turn.messageId ?? turn.nodeId,
        parentId: turn.parentId ?? null,
        agent: turn.agent ?? session?.agent ?? null,
        worktreePath: turn.worktreePath ?? session?.worktreePath ?? null,
        repositoryRoot: turn.repositoryRoot ?? session?.repositoryRoot ?? null,
        captureSource: turn.captureSource ?? session?.captureSource ?? null,
        sessionTitle: turn.sessionTitle ?? session?.summary ?? null
    }));
}

export function getSessionDetailRecord(
    deps: SessionDeps,
    contextId: string,
    sessionId: string
): SessionDetail {
    const session = findSessionSummary(deps, contextId, sessionId);
    const messages = listSessionMessagesRecord(deps, contextId, sessionId, 5000);
    const checkpoints = (deps.db.prepare(`
      SELECT *
      FROM checkpoints
      WHERE contextId = ? AND sessionId = ?
      ORDER BY createdAt DESC
    `).all(contextId, sessionId) as any[]).map((row) => deps.parseCheckpointRow(row));
    return {
        session,
        messages,
        checkpointCount: checkpoints.length,
        latestCheckpoint: checkpoints[0] ? deps.toCheckpointSummary(checkpoints[0]) : null
    };
}
