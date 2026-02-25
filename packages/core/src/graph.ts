import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type {
    ContextNode,
    ContextEdge,
    NodeType,
    EdgeType,
    Checkpoint,
    Context,
    AuditEntry,
    AuditAction,
    AuditMetadata,
    ContextDump,
    SyncPolicy
} from './schema';

export class Graph {
    constructor(private db: Database.Database) { }

    // ── Context Management ─────────────────────────────────────────

    createContext(name: string, paths: string[] = [], syncPolicy: SyncPolicy = 'full_sync'): Context {
        const ctx: Context = { id: randomUUID(), name, paths, syncPolicy, createdAt: Date.now() };
        this.db.prepare(`
      INSERT INTO contexts (id, name, paths, syncPolicy, createdAt)
      VALUES (@id, @name, @paths, @syncPolicy, @createdAt)
    `).run({ ...ctx, paths: JSON.stringify(ctx.paths) });
        return ctx;
    }

    getContext(id: string): Context | null {
        const row = this.db.prepare('SELECT * FROM contexts WHERE id = ?').get(id) as any;
        return row ? { ...row, paths: JSON.parse(row.paths), syncPolicy: row.syncPolicy ?? 'metadata_only' } : null;
    }

    listContexts(): Context[] {
        const rows = this.db.prepare('SELECT * FROM contexts ORDER BY createdAt DESC').all() as any[];
        return rows.map(row => ({ ...row, paths: JSON.parse(row.paths), syncPolicy: row.syncPolicy ?? 'metadata_only' }));
    }

    getContextSyncPolicy(contextId: string): SyncPolicy | null {
        const row = this.db.prepare('SELECT syncPolicy FROM contexts WHERE id = ?').get(contextId) as { syncPolicy?: string } | undefined;
        if (!row) return null;
        if (row.syncPolicy === 'local_only' || row.syncPolicy === 'full_sync' || row.syncPolicy === 'metadata_only') {
            return row.syncPolicy;
        }
        return 'metadata_only';
    }

    setContextSyncPolicy(contextId: string, policy: SyncPolicy): Context | null {
        const context = this.getContext(contextId);
        if (!context) return null;

        this.db.prepare('UPDATE contexts SET syncPolicy = ? WHERE id = ?').run(policy, contextId);
        return this.getContext(contextId);
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

    // ── Audit ─────────────────────────────────────────────────────
    recordAuditEvent(params: {
        action: AuditAction;
        contextId?: string | null;
        payload?: Record<string, unknown>;
        result?: Record<string, unknown> | null;
        metadata?: AuditMetadata;
    }): AuditEntry {
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

        // SEC-001: Compute HMAC chain — each entry's hash includes the previous entry's hash
        const prevHash = this.getLastAuditHash();
        const hmacData = `${prevHash}|${entry.id}|${entry.action}|${entry.createdAt}`;
        const { createHmac } = require('crypto');
        const auditSecret = process.env.CTX_AUDIT_HMAC_SECRET || 'default-audit-key';
        const entryHash = createHmac('sha256', auditSecret).update(hmacData).digest('hex');

        this.db.prepare(`
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

    /** SEC-001: Get the hash of the most recent audit entry for HMAC chain continuity. */
    private getLastAuditHash(): string {
        try {
            const row = this.db.prepare(
                'SELECT entryHash FROM audit_logs ORDER BY rowid DESC LIMIT 1'
            ).get() as { entryHash?: string } | undefined;
            return row?.entryHash ?? 'genesis';
        } catch {
            // Column may not exist yet in older DBs — return genesis
            return 'genesis';
        }
    }

    /** SEC-001: Verify the HMAC chain integrity of audit logs. */
    verifyAuditChain(limit = 1000): { valid: boolean; checked: number; brokenAt?: string } {
        const { createHmac } = require('crypto');
        const auditSecret = process.env.CTX_AUDIT_HMAC_SECRET || 'default-audit-key';

        let rows: Array<{ id: string; action: string; createdAt: number; entryHash: string; prevHash: string }>;
        try {
            rows = this.db.prepare(
                'SELECT id, action, createdAt, entryHash, prevHash FROM audit_logs ORDER BY rowid ASC LIMIT ?'
            ).all(limit) as any[];
        } catch {
            return { valid: false, checked: 0, brokenAt: 'schema_missing_hash_columns' };
        }

        if (rows.length === 0) return { valid: true, checked: 0 };

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row.entryHash) continue; // Pre-SEC-001 entries without hashes are skipped

            const expectedPrev = i === 0 ? 'genesis' : (rows[i - 1].entryHash ?? 'genesis');
            if (row.prevHash !== expectedPrev) {
                return { valid: false, checked: i + 1, brokenAt: row.id };
            }

            const hmacData = `${row.prevHash}|${row.id}|${row.action}|${row.createdAt}`;
            const computed = createHmac('sha256', auditSecret).update(hmacData).digest('hex');
            if (computed !== row.entryHash) {
                return { valid: false, checked: i + 1, brokenAt: row.id };
            }
        }

        return { valid: true, checked: rows.length };
    }

    listAuditEvents(contextId?: string, limit = 50): AuditEntry[] {
        const normalizedLimit = Math.max(1, Math.min(limit, 500));
        const rows = contextId
            ? this.db.prepare(`
          SELECT * FROM audit_logs
          WHERE contextId = ?
          ORDER BY createdAt DESC
          LIMIT ?
        `).all(contextId, normalizedLimit) as any[]
            : this.db.prepare(`
          SELECT * FROM audit_logs
          ORDER BY createdAt DESC
          LIMIT ?
        `).all(normalizedLimit) as any[];

        return rows.map((row): AuditEntry => ({
            id: row.id,
            action: row.action as AuditAction,
            contextId: row.contextId ?? null,
            payload: row.payload ? JSON.parse(row.payload) : {},
            result: row.result ? JSON.parse(row.result) : null,
            actor: row.actor ?? null,
            source: row.source ?? null,
            sessionToken: row.sessionToken ?? null,
            connectionId: row.connectionId ?? null,
            requestId: row.requestId ?? null,
            createdAt: row.createdAt
        }));
    }

    // ── Backup / Restore ──────────────────────────────────────────
    exportContextDump(contextId: string): ContextDump {
        const context = this.getContext(contextId);
        if (!context) {
            throw new Error(`Context ${contextId} not found`);
        }

        const nodes = (this.db.prepare('SELECT * FROM nodes WHERE contextId = ? ORDER BY createdAt ASC').all(contextId) as any[])
            .map(row => ({ ...row, tags: JSON.parse(row.tags) }));

        const nodeIds = nodes.map(node => node.id);
        const idPlaceholders = nodeIds.map(() => '?').join(', ');

        const edges = nodeIds.length === 0
            ? []
            : this.db.prepare(`
          SELECT * FROM edges
          WHERE fromId IN (${idPlaceholders}) OR toId IN (${idPlaceholders})
          ORDER BY createdAt ASC
        `).all(...nodeIds, ...nodeIds) as ContextEdge[];

        const checkpoints = this.listCheckpoints(contextId);

        return {
            version: 1,
            exportedAt: Date.now(),
            context,
            nodes,
            edges,
            checkpoints
        };
    }

    importContextDump(dump: ContextDump, options?: { name?: string }): Context {
        if (dump.version !== 1) {
            throw new Error(`Unsupported dump version ${dump.version}`);
        }

        const context = this.createContext(
            options?.name || dump.context.name,
            dump.context.paths,
            (dump.context as Partial<Context>).syncPolicy ?? 'metadata_only'
        );
        const nodeIdMap = new Map<string, string>();

        const insertNode = this.db.prepare(`
      INSERT INTO nodes (id, contextId, thread, type, content, key, tags, source, createdAt)
      VALUES (@id, @contextId, @thread, @type, @content, @key, @tags, @source, @createdAt)
    `);

        const insertNodeFts = this.db.prepare(`
      INSERT INTO nodes_fts (id, content, tags) VALUES (?, ?, ?)
    `);

        const insertEdge = this.db.prepare(`
      INSERT INTO edges (id, fromId, toId, relation, createdAt)
      VALUES (@id, @fromId, @toId, @relation, @createdAt)
    `);

        const insertCheckpoint = this.db.prepare(`
      INSERT INTO checkpoints (id, contextId, name, nodeIds, createdAt)
      VALUES (@id, @contextId, @name, @nodeIds, @createdAt)
    `);

        const tx = this.db.transaction(() => {
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
                    createdAt: node.createdAt
                });

                insertNodeFts.run(newId, node.content, (node.tags ?? []).join(' '));
            }

            for (const edge of dump.edges) {
                const fromId = nodeIdMap.get(edge.fromId);
                const toId = nodeIdMap.get(edge.toId);
                if (!fromId || !toId) continue;

                insertEdge.run({
                    id: randomUUID(),
                    fromId,
                    toId,
                    relation: edge.relation,
                    createdAt: edge.createdAt
                });
            }

            for (const checkpoint of dump.checkpoints) {
                const mappedNodeIds = checkpoint.nodeIds
                    .map(nodeId => nodeIdMap.get(nodeId))
                    .filter((nodeId): nodeId is string => Boolean(nodeId));

                insertCheckpoint.run({
                    id: randomUUID(),
                    contextId: context.id,
                    name: checkpoint.name,
                    nodeIds: JSON.stringify(mappedNodeIds),
                    createdAt: checkpoint.createdAt
                });
            }
        });

        tx();
        return context;
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
