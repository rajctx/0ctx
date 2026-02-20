import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type { ContextNode, ContextEdge, NodeType, EdgeType, Checkpoint, Context } from './schema';

export class Graph {
    constructor(private db: Database.Database) { }

    // ── Context Management ─────────────────────────────────────────

    createContext(name: string, paths: string[] = []): Context {
        const ctx: Context = { id: randomUUID(), name, paths, createdAt: Date.now() };
        this.db.prepare(`
      INSERT INTO contexts (id, name, paths, createdAt)
      VALUES (@id, @name, @paths, @createdAt)
    `).run({ ...ctx, paths: JSON.stringify(ctx.paths) });
        return ctx;
    }

    getContext(id: string): Context | null {
        const row = this.db.prepare('SELECT * FROM contexts WHERE id = ?').get(id) as any;
        return row ? { ...row, paths: JSON.parse(row.paths) } : null;
    }

    listContexts(): Context[] {
        const rows = this.db.prepare('SELECT * FROM contexts ORDER BY createdAt DESC').all() as any[];
        return rows.map(row => ({ ...row, paths: JSON.parse(row.paths) }));
    }

    deleteContext(id: string): void {
        const nodeIds = (this.db.prepare('SELECT id FROM nodes WHERE contextId = ?').all(id) as any[]).map(r => r.id);

        for (const nodeId of nodeIds) {
            this.db.prepare('DELETE FROM nodes_fts WHERE id = ?').run(nodeId);
            this.db.prepare('DELETE FROM edges WHERE fromId = ? OR toId = ?').run(nodeId, nodeId);
        }

        this.db.prepare('DELETE FROM nodes WHERE contextId = ?').run(id);
        this.db.prepare('DELETE FROM checkpoints WHERE contextId = ?').run(id);
        this.db.prepare('DELETE FROM contexts WHERE id = ?').run(id);
    }

    // ── Nodes ──────────────────────────────────────────────────────
    addNode(params: Omit<ContextNode, 'id' | 'createdAt'>): ContextNode {
        const node: ContextNode = { ...params, id: randomUUID(), createdAt: Date.now() };
        this.db.prepare(`
      INSERT INTO nodes (id, contextId, thread, type, content, key, tags, source, createdAt)
      VALUES (@id, @contextId, @thread, @type, @content, @key, @tags, @source, @createdAt)
    `).run({
            id: node.id,
            contextId: node.contextId,
            thread: node.thread || null,
            type: node.type,
            content: node.content,
            key: node.key || null,
            tags: JSON.stringify(node.tags ?? []),
            source: node.source || null,
            createdAt: node.createdAt
        });

        this.db.prepare(`
      INSERT INTO nodes_fts (id, content, tags) VALUES (?, ?, ?)
    `).run(node.id, node.content, (node.tags ?? []).join(' '));

        return node;
    }

    getNode(id: string): ContextNode | null {
        const row = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as any;
        return row ? { ...row, tags: JSON.parse(row.tags) } : null;
    }

    getByKey(contextId: string, key: string): ContextNode | null {
        const row = this.db.prepare(
            'SELECT * FROM nodes WHERE contextId = ? AND key = ? ORDER BY createdAt DESC LIMIT 1'
        ).get(contextId, key) as any;
        return row ? { ...row, tags: JSON.parse(row.tags) } : null;
    }

    deleteNode(id: string): void {
        this.db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
        this.db.prepare('DELETE FROM nodes_fts WHERE id = ?').run(id);
        this.db.prepare('DELETE FROM edges WHERE fromId = ? OR toId = ?').run(id, id);
    }

    updateNode(id: string, updates: Partial<Pick<ContextNode, 'content' | 'tags'>>): ContextNode | null {
        const node = this.getNode(id);
        if (!node) return null;

        const newContent = updates.content !== undefined ? updates.content : node.content;
        const newTags = updates.tags !== undefined ? updates.tags : node.tags;

        this.db.prepare('UPDATE nodes SET content = ?, tags = ? WHERE id = ?').run(newContent, JSON.stringify(newTags), id);
        this.db.prepare('UPDATE nodes_fts SET content = ?, tags = ? WHERE id = ?').run(newContent, (newTags ?? []).join(' '), id);

        return this.getNode(id);
    }

    // ── Edges ──────────────────────────────────────────────────────
    addEdge(fromId: string, toId: string, relation: EdgeType): ContextEdge {
        const edge: ContextEdge = { id: randomUUID(), fromId, toId, relation, createdAt: Date.now() };
        this.db.prepare(`
      INSERT INTO edges (id, fromId, toId, relation, createdAt)
      VALUES (@id, @fromId, @toId, @relation, @createdAt)
    `).run(edge);
        return edge;
    }

    getEdges(nodeId: string): ContextEdge[] {
        return this.db.prepare(
            'SELECT * FROM edges WHERE fromId = ? OR toId = ?'
        ).all(nodeId, nodeId) as ContextEdge[];
    }

    // ── Subgraph traversal & Relevance Pruning ─────────────────────

    // Gets a subgraph starting from rootId, constrained by depth, and pruned by relevance limits.
    getSubgraph(rootId: string, depth = 2, maxNodes = 20): { nodes: ContextNode[]; edges: ContextEdge[] } {
        const visited = new Set<string>();
        const nodeScores = new Map<string, number>();
        const nodes: ContextNode[] = [];
        const edges: ContextEdge[] = [];
        const now = Date.now();

        const traverse = (id: string, d: number) => {
            if (visited.has(id)) return;
            visited.add(id);

            const node = this.getNode(id);
            if (!node) return;

            const nodeEdges = this.getEdges(id);

            // Relevance Score = (Recency factor) + (Structural factor)
            // Newer nodes get higher default scores.
            const ageHours = (now - node.createdAt) / (1000 * 60 * 60);
            const recencyScore = Math.max(0, 100 - ageHours); // Decays over ~4 days to 0 base score.
            const structuralScore = nodeEdges.length * 5;     // Highly connected nodes are important contexts.

            let finalScore = recencyScore + structuralScore;

            // Penalty/Boost based on relationships (e.g., if a node is superseded, tank its score).
            for (const edge of nodeEdges) {
                if (edge.relation === 'supersedes' && edge.fromId !== id) {
                    // This node has been superseded by something else -> drastic penalty.
                    finalScore -= 200;
                }
            }

            nodeScores.set(id, finalScore);
            nodes.push(node);

            for (const edge of nodeEdges) {
                if (!edges.some(e => e.id === edge.id)) {
                    edges.push(edge);
                }
                if (d > 0 && finalScore > 0) { // Don't traverse from practically dead nodes.
                    const nextId = edge.fromId === id ? edge.toId : edge.fromId;
                    traverse(nextId, d - 1);
                }
            }
        };

        traverse(rootId, depth);

        // Prune by sorting on relevance and slicing.
        nodes.sort((a, b) => (nodeScores.get(b.id) || 0) - (nodeScores.get(a.id) || 0));
        const prunedNodes = nodes.slice(0, maxNodes);
        const prunedNodeIds = new Set(prunedNodes.map(n => n.id));

        // Only return edges where both connected nodes survived the pruning.
        const prunedEdges = edges.filter(e => prunedNodeIds.has(e.fromId) && prunedNodeIds.has(e.toId));

        return { nodes: prunedNodes, edges: prunedEdges };
    }

    // ── Search ─────────────────────────────────────────────────────
    search(contextId: string, query: string, limit = 20): ContextNode[] {
        const rows = this.db.prepare(`
      SELECT n.* FROM nodes n
      JOIN nodes_fts f ON n.id = f.id
      WHERE n.contextId = ? AND nodes_fts MATCH ?
      ORDER BY rank LIMIT ?
    `).all(contextId, query, limit) as any[];
        return rows.map(r => ({ ...r, tags: JSON.parse(r.tags) }));
    }

    getGraphData(contextId: string) {
        const nodesRows = this.db.prepare('SELECT * FROM nodes WHERE contextId = ? ORDER BY createdAt DESC').all(contextId) as any[];
        const edgesRows = this.db.prepare(`SELECT e.* FROM edges e JOIN nodes n ON e.fromId = n.id WHERE n.contextId = ?`).all(contextId) as any[];
        return {
            nodes: nodesRows.map(r => ({ ...r, tags: JSON.parse(r.tags) })),
            edges: edgesRows
        };
    }

    // ── Checkpoints ────────────────────────────────────────────────
    saveCheckpoint(contextId: string, name: string): Checkpoint {
        const nodeIds = (this.db.prepare(
            'SELECT id FROM nodes WHERE contextId = ?'
        ).all(contextId) as any[]).map(r => r.id);

        const cp: Checkpoint = { id: randomUUID(), contextId, name, nodeIds, createdAt: Date.now() };
        this.db.prepare(`
      INSERT INTO checkpoints (id, contextId, name, nodeIds, createdAt)
      VALUES (@id, @contextId, @name, @nodeIds, @createdAt)
    `).run({ ...cp, nodeIds: JSON.stringify(cp.nodeIds) });
        return cp;
    }

    rewind(checkpointId: string): void {
        const cp = this.db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(checkpointId) as any;
        if (!cp) throw new Error(`Checkpoint ${checkpointId} not found`);
        const allowed = new Set<string>(JSON.parse(cp.nodeIds));
        const current = (this.db.prepare(
            'SELECT id FROM nodes WHERE contextId = ?'
        ).all(cp.contextId) as any[]).map(r => r.id);

        for (const id of current) {
            if (!allowed.has(id)) this.deleteNode(id);
        }
    }

    listCheckpoints(contextId: string): Checkpoint[] {
        return (this.db.prepare(
            'SELECT * FROM checkpoints WHERE contextId = ? ORDER BY createdAt DESC'
        ).all(contextId) as any[]).map(r => ({ ...r, nodeIds: JSON.parse(r.nodeIds) }));
    }
}
