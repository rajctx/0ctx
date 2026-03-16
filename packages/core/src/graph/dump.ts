import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type {
    Checkpoint,
    CheckpointPayloadRecord,
    Context,
    ContextDump,
    ContextEdge,
    NodePayloadRecord,
    SyncPolicy
} from '../schema';

type DumpDeps = {
    db: Database.Database;
    getContext: (id: string) => Context | null;
    parseNodeRow: (row: any) => any;
    listCheckpoints: (contextId: string) => Checkpoint[];
    getNodePayload: (nodeId: string) => NodePayloadRecord | null;
    getCheckpointPayload: (checkpointId: string) => CheckpointPayloadRecord | null;
    createContext: (name: string, paths?: string[], syncPolicy?: SyncPolicy) => Context;
    setNodePayload: (
        nodeId: string,
        contextId: string,
        payload: unknown,
        options?: { contentType?: string; compression?: any; createdAt?: number; updatedAt?: number }
    ) => NodePayloadRecord;
    setCheckpointPayload: (
        checkpointId: string,
        contextId: string,
        payload: unknown,
        options?: { contentType?: string; compression?: any; createdAt?: number; updatedAt?: number }
    ) => CheckpointPayloadRecord;
    refreshBranchLaneProjection: (contextId: string) => void;
    deleteContext: (contextId: string) => void;
    insertCheckpoint: (checkpoint: Checkpoint) => void;
};

function normalizeDumpSyncPolicy(syncPolicy: unknown): SyncPolicy {
    return syncPolicy === 'local_only' || syncPolicy === 'metadata_only' || syncPolicy === 'full_sync'
        ? syncPolicy
        : 'local_only';
}

export function exportContextDumpRecord(deps: DumpDeps, contextId: string): ContextDump {
    const context = deps.getContext(contextId);
    if (!context) {
        throw new Error(`Context ${contextId} not found`);
    }

    const nodes = (deps.db.prepare('SELECT * FROM nodes WHERE contextId = ? ORDER BY createdAt ASC').all(contextId) as any[])
        .map((row) => deps.parseNodeRow(row));
    const nodeIds = nodes.map((node: { id: string }) => node.id);
    const idPlaceholders = nodeIds.map(() => '?').join(', ');

    const nodePayloads = nodeIds
        .map((nodeId) => deps.getNodePayload(nodeId))
        .filter((payload): payload is NodePayloadRecord => Boolean(payload));
    const edges = nodeIds.length === 0
        ? []
        : deps.db.prepare(`
          SELECT * FROM edges
          WHERE fromId IN (${idPlaceholders}) OR toId IN (${idPlaceholders})
          ORDER BY createdAt ASC
        `).all(...nodeIds, ...nodeIds) as ContextEdge[];
    const checkpoints = deps.listCheckpoints(contextId);
    const checkpointPayloads = checkpoints
        .map((checkpoint) => deps.getCheckpointPayload(checkpoint.id))
        .filter((payload): payload is CheckpointPayloadRecord => Boolean(payload));

    return {
        version: 1,
        exportedAt: Date.now(),
        context,
        nodes,
        edges,
        checkpoints,
        nodePayloads,
        checkpointPayloads
    };
}

export function importContextDumpRecord(
    deps: DumpDeps,
    dump: ContextDump,
    options?: { name?: string }
): Context {
    if (dump.version !== 1) {
        throw new Error(`Unsupported dump version ${dump.version}`);
    }

    const context = deps.createContext(
        options?.name || dump.context.name,
        dump.context.paths,
        normalizeDumpSyncPolicy((dump.context as Partial<Context>).syncPolicy)
    );
    const nodeIdMap = new Map<string, string>();
    const checkpointIdMap = new Map<string, string>();
    const insertNode = deps.db.prepare(`
      INSERT INTO nodes (id, contextId, thread, type, content, key, tags, source, hidden, createdAt, checkpointId)
      VALUES (@id, @contextId, @thread, @type, @content, @key, @tags, @source, @hidden, @createdAt, @checkpointId)
    `);
    const insertNodeFts = deps.db.prepare('INSERT INTO nodes_fts (id, content, tags) VALUES (?, ?, ?)');
    const insertEdge = deps.db.prepare(`
      INSERT INTO edges (id, fromId, toId, relation, createdAt)
      VALUES (@id, @fromId, @toId, @relation, @createdAt)
    `);
    const insertCheckpoint = deps.db.prepare(`
      INSERT INTO checkpoints (id, contextId, name, nodeIds, kind, sessionId, branch, worktreePath, commitSha, summary, agentSet, createdAt)
      VALUES (@id, @contextId, @name, @nodeIds, @kind, @sessionId, @branch, @worktreePath, @commitSha, @summary, @agentSet, @createdAt)
    `);

    const tx = deps.db.transaction(() => {
        for (const node of dump.nodes) {
            const newId = randomUUID();
            nodeIdMap.set(node.id, newId);
            insertNode.run({
                id: newId,
                contextId: context.id,
                thread: node.thread || null,
                type: node.type,
                content: node.content,
                key: node.key || null,
                tags: JSON.stringify(node.tags ?? []),
                source: node.source || null,
                hidden: node.hidden ? 1 : 0,
                createdAt: node.createdAt,
                checkpointId: node.checkpointId ?? null
            });
            insertNodeFts.run(newId, node.content, (node.tags ?? []).join(' '));
        }

        for (const edge of dump.edges) {
            const fromId = nodeIdMap.get(edge.fromId);
            const toId = nodeIdMap.get(edge.toId);
            if (!fromId || !toId) continue;
            insertEdge.run({ id: randomUUID(), fromId, toId, relation: edge.relation, createdAt: edge.createdAt });
        }

        for (const checkpoint of dump.checkpoints) {
            const mappedNodeIds = checkpoint.nodeIds
                .map((nodeId) => nodeIdMap.get(nodeId))
                .filter((nodeId): nodeId is string => Boolean(nodeId));
            const newCheckpointId = randomUUID();
            checkpointIdMap.set(checkpoint.id, newCheckpointId);
            insertCheckpoint.run({
                id: newCheckpointId,
                contextId: context.id,
                name: checkpoint.name,
                nodeIds: JSON.stringify(mappedNodeIds),
                kind: checkpoint.kind ?? 'legacy',
                sessionId: checkpoint.sessionId ?? null,
                branch: checkpoint.branch ?? null,
                worktreePath: checkpoint.worktreePath ?? null,
                commitSha: checkpoint.commitSha ?? null,
                summary: checkpoint.summary ?? null,
                agentSet: JSON.stringify(checkpoint.agentSet ?? []),
                createdAt: checkpoint.createdAt
            });
        }

        for (const payload of dump.nodePayloads ?? []) {
            const mappedNodeId = nodeIdMap.get(payload.nodeId);
            if (!mappedNodeId) continue;
            deps.setNodePayload(mappedNodeId, context.id, payload.payload, payload);
        }

        for (const payload of dump.checkpointPayloads ?? []) {
            const mappedCheckpointId = checkpointIdMap.get(payload.checkpointId);
            if (!mappedCheckpointId) continue;
            deps.setCheckpointPayload(mappedCheckpointId, context.id, payload.payload, payload);
        }
    });

    tx();
    deps.refreshBranchLaneProjection(context.id);
    return context;
}

export function replaceContextFromDumpRecord(
    deps: DumpDeps,
    contextId: string,
    dump: ContextDump
): void {
    const tx = deps.db.transaction(() => {
        if (deps.getContext(contextId)) {
            deps.deleteContext(contextId);
        }

        deps.db.prepare(`
        INSERT INTO contexts (id, name, paths, syncPolicy, createdAt)
        VALUES (@id, @name, @paths, @syncPolicy, @createdAt)
      `).run({
            id: contextId,
            name: dump.context.name,
            paths: JSON.stringify(dump.context.paths ?? []),
            syncPolicy: normalizeDumpSyncPolicy(dump.context.syncPolicy),
            createdAt: dump.context.createdAt
        });

        const insertNode = deps.db.prepare(`
        INSERT INTO nodes (id, contextId, thread, type, content, key, tags, source, hidden, createdAt, checkpointId)
        VALUES (@id, @contextId, @thread, @type, @content, @key, @tags, @source, @hidden, @createdAt, @checkpointId)
      `);
        const insertNodeFts = deps.db.prepare('INSERT INTO nodes_fts (id, content, tags) VALUES (?, ?, ?)');
        const nodeIds = new Set<string>();
        for (const node of dump.nodes) {
            const tags = Array.isArray(node.tags) ? node.tags.filter((tag): tag is string => typeof tag === 'string') : [];
            insertNode.run({
                id: node.id,
                contextId,
                thread: node.thread ?? null,
                type: node.type,
                content: node.content,
                key: node.key ?? null,
                tags: JSON.stringify(tags),
                source: node.source ?? null,
                hidden: node.hidden ? 1 : 0,
                createdAt: node.createdAt,
                checkpointId: node.checkpointId ?? null
            });
            insertNodeFts.run(node.id, node.content, tags.join(' '));
            nodeIds.add(node.id);
        }

        const insertEdge = deps.db.prepare(`
        INSERT INTO edges (id, fromId, toId, relation, createdAt)
        VALUES (@id, @fromId, @toId, @relation, @createdAt)
      `);
        for (const edge of dump.edges) {
            if (!nodeIds.has(edge.fromId) || !nodeIds.has(edge.toId)) continue;
            insertEdge.run(edge);
        }

        for (const checkpoint of dump.checkpoints) {
            deps.insertCheckpoint({
                ...checkpoint,
                contextId,
                nodeIds: Array.isArray(checkpoint.nodeIds)
                    ? checkpoint.nodeIds.filter((nodeId): nodeId is string => typeof nodeId === 'string' && nodeIds.has(nodeId))
                    : [],
                kind: checkpoint.kind ?? 'legacy',
                agentSet: checkpoint.agentSet ?? []
            });
        }

        for (const payload of dump.nodePayloads ?? []) {
            if (nodeIds.has(payload.nodeId)) deps.setNodePayload(payload.nodeId, contextId, payload.payload, payload);
        }

        const checkpointIds = new Set(dump.checkpoints.map((checkpoint) => checkpoint.id));
        for (const payload of dump.checkpointPayloads ?? []) {
            if (checkpointIds.has(payload.checkpointId)) {
                deps.setCheckpointPayload(payload.checkpointId, contextId, payload.payload, payload);
            }
        }
    });

    tx();
    deps.refreshBranchLaneProjection(contextId);
}
