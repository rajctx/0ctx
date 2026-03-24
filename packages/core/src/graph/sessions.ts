import { gunzipSync } from 'zlib';
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
import { parsePayloadValue } from './helpers';
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
    return queryChatSessionSummaries(deps, contextId, 1, sessionId)[0] ?? null;
}

type SessionSummaryRow = {
    sessionId: string;
    startedAt: number;
    lastTurnAt: number;
    turnCount: number;
    latestId: string | null;
    latestContent: string | null;
    latestKey: string | null;
    latestTags: string | null;
    latestSource: string | null;
    latestCreatedAt: number | null;
    sessionNodeId: string | null;
    sessionNodeContent: string | null;
    sessionNodeKey: string | null;
    sessionNodeTags: string | null;
    sessionNodeSource: string | null;
    sessionNodeCreatedAt: number | null;
    firstId: string | null;
    firstContent: string | null;
    firstKey: string | null;
    firstTags: string | null;
    firstSource: string | null;
    firstCreatedAt: number | null;
};

type SessionNodeSummary = {
    id: string;
    content: string;
    key: string | null;
    tags: string[] | null;
    source: string | null;
    createdAt: number;
};

function parseTags(raw: string | null): string[] | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed.filter((tag): tag is string => typeof tag === 'string')
            : [];
    } catch {
        return [];
    }
}

function toSessionNode(row: SessionSummaryRow, prefix: 'latest' | 'sessionNode' | 'first'): SessionNodeSummary | null {
    const id = row[`${prefix}Id`];
    if (!id) return null;
    return {
        id,
        content: row[`${prefix}Content`] ?? '',
        key: row[`${prefix}Key`] ?? null,
        tags: parseTags(row[`${prefix}Tags`] ?? null),
        source: row[`${prefix}Source`] ?? null,
        createdAt: row[`${prefix}CreatedAt`] ?? 0
    };
}

function loadPayloadMap(deps: SessionDeps, nodeIds: string[]): Map<string, unknown> {
    const uniqueNodeIds = Array.from(new Set(nodeIds.filter((nodeId) => typeof nodeId === 'string' && nodeId.length > 0)));
    const payloads = new Map<string, unknown>();
    if (uniqueNodeIds.length === 0) return payloads;

    const placeholders = uniqueNodeIds.map(() => '?').join(', ');
    const rows = deps.db.prepare(`
      SELECT nodeId, contentType, compression, payload
      FROM node_payloads
      WHERE nodeId IN (${placeholders})
    `).all(...uniqueNodeIds) as Array<{
        nodeId: string;
        contentType: string;
        compression: string;
        payload: Buffer;
    }>;

    for (const row of rows) {
        const decoded = row.compression === 'gzip'
            ? gunzipSync(row.payload)
            : Buffer.from(row.payload);
        payloads.set(row.nodeId, parsePayloadValue(decoded.toString('utf8'), row.contentType));
    }

    return payloads;
}

function queryChatSessionSummaries(
    deps: SessionDeps,
    contextId: string,
    limit = 50,
    sessionId?: string
): AgentSessionSummary[] {
    const safeLimit = Math.max(1, Math.min(limit, 5000));
    const sessionFilterSql = sessionId ? ' AND thread = ?' : '';
    const repeatedParams = sessionId ? [contextId, sessionId, contextId, sessionId, contextId, sessionId, contextId, sessionId, safeLimit] : [contextId, contextId, contextId, contextId, safeLimit];
    const rows = deps.db.prepare(`
      WITH turn_sessions AS (
        SELECT
          thread AS sessionId,
          MIN(createdAt) AS startedAt,
          MAX(createdAt) AS lastTurnAt,
          COUNT(*) AS turnCount
        FROM nodes
        WHERE contextId = ?
          AND type = 'artifact'
          AND thread IS NOT NULL
          AND key LIKE 'chat_turn:%'${sessionFilterSql}
        GROUP BY thread
      ),
      latest_turns AS (
        SELECT
          thread AS sessionId,
          id,
          content,
          key,
          tags,
          source,
          createdAt,
          ROW_NUMBER() OVER (PARTITION BY thread ORDER BY createdAt DESC, id DESC) AS rn
        FROM nodes
        WHERE contextId = ?
          AND thread IS NOT NULL
          AND key LIKE 'chat_turn:%'${sessionFilterSql}
      ),
      first_turns AS (
        SELECT
          thread AS sessionId,
          id,
          content,
          key,
          tags,
          source,
          createdAt,
          ROW_NUMBER() OVER (PARTITION BY thread ORDER BY createdAt ASC, id ASC) AS rn
        FROM nodes
        WHERE contextId = ?
          AND thread IS NOT NULL
          AND key LIKE 'chat_turn:%'${sessionFilterSql}
      ),
      session_nodes AS (
        SELECT
          thread AS sessionId,
          id,
          content,
          key,
          tags,
          source,
          createdAt,
          ROW_NUMBER() OVER (PARTITION BY thread ORDER BY createdAt DESC, id DESC) AS rn
        FROM nodes
        WHERE contextId = ?
          AND thread IS NOT NULL
          AND key LIKE 'chat_session:%'${sessionFilterSql}
      )
      SELECT
        sessions.sessionId,
        sessions.startedAt,
        sessions.lastTurnAt,
        sessions.turnCount,
        latest.id AS latestId,
        latest.content AS latestContent,
        latest.key AS latestKey,
        latest.tags AS latestTags,
        latest.source AS latestSource,
        latest.createdAt AS latestCreatedAt,
        sessionNode.id AS sessionNodeId,
        sessionNode.content AS sessionNodeContent,
        sessionNode.key AS sessionNodeKey,
        sessionNode.tags AS sessionNodeTags,
        sessionNode.source AS sessionNodeSource,
        sessionNode.createdAt AS sessionNodeCreatedAt,
        firstTurn.id AS firstId,
        firstTurn.content AS firstContent,
        firstTurn.key AS firstKey,
        firstTurn.tags AS firstTags,
        firstTurn.source AS firstSource,
        firstTurn.createdAt AS firstCreatedAt
      FROM turn_sessions sessions
      LEFT JOIN latest_turns latest
        ON latest.sessionId = sessions.sessionId AND latest.rn = 1
      LEFT JOIN session_nodes sessionNode
        ON sessionNode.sessionId = sessions.sessionId AND sessionNode.rn = 1
      LEFT JOIN first_turns firstTurn
        ON firstTurn.sessionId = sessions.sessionId AND firstTurn.rn = 1
      ORDER BY sessions.lastTurnAt DESC, sessions.sessionId DESC
      LIMIT ?
    `).all(...repeatedParams) as SessionSummaryRow[];

    const payloadMap = loadPayloadMap(deps, rows.flatMap((row) => [
        row.latestId,
        row.sessionNodeId,
        row.firstId
    ]).filter((nodeId): nodeId is string => typeof nodeId === 'string' && nodeId.length > 0));

    return rows.map((row): AgentSessionSummary => {
        const latestNode = toSessionNode(row, 'latest');
        const sessionNode = toSessionNode(row, 'sessionNode');
        const firstNode = toSessionNode(row, 'first');
        const latestMetadata = deps.extractTurnMetadata(payloadMap.get(latestNode?.id ?? ''));
        const firstMetadata = deps.extractTurnMetadata(payloadMap.get(firstNode?.id ?? ''));
        const sessionMetadata = deps.extractTurnMetadata(payloadMap.get(sessionNode?.id ?? ''));

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

export function listChatSessionsRecord(
    deps: SessionDeps,
    contextId: string,
    limit = 50
): AgentSessionSummary[] {
    return queryChatSessionSummaries(deps, contextId, limit);
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
