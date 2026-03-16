import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type {
    ContextEdge,
    ContextNode,
    EdgeType,
    NodePayloadCompression
} from '../schema';
import { parseNodeRow } from './helpers';
import { setNodePayloadRecord } from './payloads';

export type AddNodeParams = Omit<ContextNode, 'id' | 'createdAt'> & {
    rawPayload?: unknown;
    payloadContentType?: string;
    createdAtOverride?: number;
};

export function addNodeRecord(
    db: Database.Database,
    params: AddNodeParams
): ContextNode {
    const { rawPayload, payloadContentType, createdAtOverride, ...nodeParams } = params;
    const createdAt = typeof createdAtOverride === 'number' && Number.isFinite(createdAtOverride)
        ? createdAtOverride
        : Date.now();
    const node: ContextNode = { ...nodeParams, id: randomUUID(), createdAt };

    db.prepare(`
      INSERT INTO nodes (id, contextId, thread, type, content, key, tags, source, hidden, createdAt, checkpointId)
      VALUES (@id, @contextId, @thread, @type, @content, @key, @tags, @source, @hidden, @createdAt, @checkpointId)
    `).run({
        id: node.id,
        contextId: nodeParams.contextId,
        thread: nodeParams.thread || null,
        type: nodeParams.type,
        content: nodeParams.content,
        key: nodeParams.key || null,
        tags: JSON.stringify(nodeParams.tags ?? []),
        source: nodeParams.source || null,
        hidden: nodeParams.hidden ? 1 : 0,
        createdAt: node.createdAt,
        checkpointId: nodeParams.checkpointId ?? null
    });

    db.prepare(`
      INSERT INTO nodes_fts (id, content, tags) VALUES (?, ?, ?)
    `).run(node.id, nodeParams.content, (nodeParams.tags ?? []).join(' '));

    if (rawPayload !== undefined) {
        setNodePayloadRecord(db, node.id, nodeParams.contextId, rawPayload, {
            contentType: payloadContentType
        });
    }

    return getNodeRecord(db, node.id)!;
}

export function getNodeRecord(db: Database.Database, id: string): ContextNode | null {
    const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as any;
    return row ? parseNodeRow(row) : null;
}

export function getByKeyRecord(
    db: Database.Database,
    contextId: string,
    key: string,
    options: { includeHidden?: boolean } = {}
): ContextNode | null {
    const includeHidden = options.includeHidden ?? false;
    const row = includeHidden
        ? db.prepare(
            'SELECT * FROM nodes WHERE contextId = ? AND key = ? ORDER BY createdAt DESC LIMIT 1'
        ).get(contextId, key) as any
        : db.prepare(
            'SELECT * FROM nodes WHERE contextId = ? AND key = ? AND hidden = 0 ORDER BY createdAt DESC LIMIT 1'
        ).get(contextId, key) as any;
    return row ? parseNodeRow(row) : null;
}

export function deleteNodeRecord(db: Database.Database, id: string): void {
    db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
    db.prepare('DELETE FROM nodes_fts WHERE id = ?').run(id);
    db.prepare('DELETE FROM node_payloads WHERE nodeId = ?').run(id);
    db.prepare('DELETE FROM edges WHERE fromId = ? OR toId = ?').run(id, id);
}

export function updateNodeRecord(
    db: Database.Database,
    id: string,
    updates: Partial<Pick<ContextNode, 'content' | 'tags' | 'hidden'>>
): ContextNode | null {
    const node = getNodeRecord(db, id);
    if (!node) return null;

    const newContent = updates.content !== undefined ? updates.content : node.content;
    const newTags = updates.tags !== undefined ? updates.tags : node.tags;
    const newHidden = updates.hidden !== undefined ? updates.hidden : (node.hidden ?? false);

    db.prepare('UPDATE nodes SET content = ?, tags = ?, hidden = ? WHERE id = ?')
        .run(newContent, JSON.stringify(newTags), newHidden ? 1 : 0, id);
    db.prepare('UPDATE nodes_fts SET content = ?, tags = ? WHERE id = ?')
        .run(newContent, (newTags ?? []).join(' '), id);

    return getNodeRecord(db, id);
}

export function addEdgeRecord(
    db: Database.Database,
    fromId: string,
    toId: string,
    relation: EdgeType
): ContextEdge {
    const edge: ContextEdge = { id: randomUUID(), fromId, toId, relation, createdAt: Date.now() };
    db.prepare(`
      INSERT INTO edges (id, fromId, toId, relation, createdAt)
      VALUES (@id, @fromId, @toId, @relation, @createdAt)
    `).run(edge);
    return edge;
}

export function ensureEdgeRecord(
    db: Database.Database,
    fromId: string,
    toId: string,
    relation: EdgeType
): void {
    const exists = db.prepare(
        'SELECT id FROM edges WHERE fromId = ? AND toId = ? AND relation = ? LIMIT 1'
    ).get(fromId, toId, relation) as { id?: string } | undefined;
    if (!exists) {
        addEdgeRecord(db, fromId, toId, relation);
    }
}

export function getEdgesRecord(db: Database.Database, nodeId: string): ContextEdge[] {
    return db.prepare(
        'SELECT * FROM edges WHERE fromId = ? OR toId = ?'
    ).all(nodeId, nodeId) as ContextEdge[];
}

export function getSubgraphRecords(
    db: Database.Database,
    rootId: string,
    depth = 2,
    maxNodes = 20
): { nodes: ContextNode[]; edges: ContextEdge[] } {
    const visited = new Set<string>();
    const nodeScores = new Map<string, number>();
    const nodes: ContextNode[] = [];
    const edges: ContextEdge[] = [];
    const now = Date.now();

    const traverse = (id: string, remainingDepth: number) => {
        if (visited.has(id)) return;
        visited.add(id);

        const node = getNodeRecord(db, id);
        if (!node) return;

        const nodeEdges = getEdgesRecord(db, id);
        const ageHours = (now - node.createdAt) / (1000 * 60 * 60);
        const recencyScore = Math.max(0, 100 - ageHours);
        const structuralScore = nodeEdges.length * 5;
        let finalScore = recencyScore + structuralScore;

        for (const edge of nodeEdges) {
            if (edge.relation === 'supersedes' && edge.fromId !== id) {
                finalScore -= 200;
            }
        }

        nodeScores.set(id, finalScore);
        nodes.push(node);

        for (const edge of nodeEdges) {
            if (!edges.some((entry) => entry.id === edge.id)) {
                edges.push(edge);
            }
            if (remainingDepth > 0 && finalScore > 0) {
                const nextId = edge.fromId === id ? edge.toId : edge.fromId;
                traverse(nextId, remainingDepth - 1);
            }
        }
    };

    traverse(rootId, depth);

    nodes.sort((left, right) => (nodeScores.get(right.id) || 0) - (nodeScores.get(left.id) || 0));
    const prunedNodes = nodes.slice(0, maxNodes);
    const prunedNodeIds = new Set(prunedNodes.map((node) => node.id));
    const prunedEdges = edges.filter((edge) => prunedNodeIds.has(edge.fromId) && prunedNodeIds.has(edge.toId));

    return { nodes: prunedNodes, edges: prunedEdges };
}
