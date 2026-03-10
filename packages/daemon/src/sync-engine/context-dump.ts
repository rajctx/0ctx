import type Database from 'better-sqlite3';
import type {
    ContextDump,
    EncryptedPayload,
    Graph,
    SyncEnvelope,
    SyncPolicy
} from '@0ctx/core';
import { decryptJson } from '@0ctx/core';
import { log } from '../logger';

export function decodeFullSyncDump(envelope: SyncEnvelope): ContextDump | null {
    const dump = envelope.encrypted
        ? decryptJson<ContextDump>(envelope.payload as EncryptedPayload)
        : envelope.payload as ContextDump;

    if (
        !dump
        || dump.version !== 1
        || !dump.context
        || !Array.isArray(dump.nodes)
        || !Array.isArray(dump.edges)
        || !Array.isArray(dump.checkpoints)
    ) {
        log('warn', 'sync_pull_invalid_dump', { contextId: envelope.contextId });
        return null;
    }

    if (dump.context.id !== envelope.contextId) {
        log('warn', 'sync_pull_context_mismatch', {
            envelopeContextId: envelope.contextId,
            dumpContextId: dump.context.id
        });
        return null;
    }

    return dump;
}

export function replaceContextFromDump(
    graph: Graph,
    db: Database.Database,
    contextId: string,
    dump: ContextDump
): void {
    const tx = db.transaction(() => {
        if (graph.getContext(contextId)) {
            graph.deleteContext(contextId);
        }

        const syncPolicy: SyncPolicy =
            dump.context.syncPolicy === 'local_only'
                || dump.context.syncPolicy === 'metadata_only'
                || dump.context.syncPolicy === 'full_sync'
                ? dump.context.syncPolicy
                : 'metadata_only';

        db.prepare(`
          INSERT INTO contexts (id, name, paths, syncPolicy, createdAt)
          VALUES (@id, @name, @paths, @syncPolicy, @createdAt)
        `).run({
            id: contextId,
            name: dump.context.name,
            paths: JSON.stringify(dump.context.paths ?? []),
            syncPolicy,
            createdAt: dump.context.createdAt
        });

        const insertNode = db.prepare(`
          INSERT INTO nodes (id, contextId, thread, type, content, key, tags, source, hidden, createdAt, checkpointId)
          VALUES (@id, @contextId, @thread, @type, @content, @key, @tags, @source, @hidden, @createdAt, @checkpointId)
        `);
        const insertNodeFts = db.prepare(`
          INSERT INTO nodes_fts (id, content, tags) VALUES (?, ?, ?)
        `);
        const nodeIds = new Set<string>();
        for (const node of dump.nodes) {
            if (typeof node.id !== 'string' || node.id.length === 0) continue;
            const tags = Array.isArray(node.tags)
                ? node.tags.filter((tag): tag is string => typeof tag === 'string')
                : [];
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

        const insertEdge = db.prepare(`
          INSERT INTO edges (id, fromId, toId, relation, createdAt)
          VALUES (@id, @fromId, @toId, @relation, @createdAt)
        `);
        for (const edge of dump.edges) {
            if (!nodeIds.has(edge.fromId) || !nodeIds.has(edge.toId)) continue;
            insertEdge.run({
                id: edge.id,
                fromId: edge.fromId,
                toId: edge.toId,
                relation: edge.relation,
                createdAt: edge.createdAt
            });
        }

        const insertCheckpoint = db.prepare(`
          INSERT INTO checkpoints (id, contextId, name, nodeIds, createdAt)
          VALUES (@id, @contextId, @name, @nodeIds, @createdAt)
        `);
        for (const checkpoint of dump.checkpoints) {
            const checkpointNodeIds = Array.isArray(checkpoint.nodeIds)
                ? checkpoint.nodeIds.filter(
                    (nodeId): nodeId is string => typeof nodeId === 'string' && nodeIds.has(nodeId)
                )
                : [];
            insertCheckpoint.run({
                id: checkpoint.id,
                contextId,
                name: checkpoint.name,
                nodeIds: JSON.stringify(checkpointNodeIds),
                createdAt: checkpoint.createdAt
            });
        }

        for (const payload of dump.nodePayloads ?? []) {
            if (!nodeIds.has(payload.nodeId)) continue;
            graph.setNodePayload(
                payload.nodeId,
                contextId,
                payload.payload,
                {
                    contentType: payload.contentType,
                    compression: payload.compression,
                    createdAt: payload.createdAt,
                    updatedAt: payload.updatedAt
                }
            );
        }
    });

    tx();
}
