import { createHash, randomUUID, randomBytes } from 'crypto';
import { gzipSync, gunzipSync } from 'zlib';
import type Database from 'better-sqlite3';
import type {
    ContextNode,
    NodeType,
    ContextEdge,
    EdgeType,
    Checkpoint,
    CheckpointKind,
    Context,
    AuditEntry,
    AuditAction,
    AuditMetadata,
    ContextDump,
    CheckpointPayloadRecord,
    NodePayloadRecord,
    NodePayloadCompression,
    BranchLaneSummary,
    AgentSessionSummary,
    SessionMessage,
    CheckpointSummary,
    SessionDetail,
    CheckpointDetail,
    HandoffTimelineEntry,
    InsightSummary,
    KnowledgeCandidate,
    KnowledgePreviewResult,
    KnowledgeExtractionResult,
    InsightPromotionResult,
    ChatSessionSummary,
    ChatTurnSummary,
    SyncPolicy,
    SearchAdvancedOptions,
    SearchMatchReason,
    SearchResult
} from './schema';
import { getConfigValue, setConfigValue } from './config';
import {
    canonicalizeKnowledgeCandidateText,
    cleanupExtractionText,
    scoreKnowledgeCandidate,
    sourceExcerpt,
    splitExtractionCandidates
} from './knowledge-scoring';

export class Graph {
    constructor(private db: Database.Database) { }

    private parseNodeRow(row: any): ContextNode {
        return {
            ...row,
            tags: row.tags ? JSON.parse(row.tags) : [],
            hidden: row.hidden === 1 || row.hidden === true
        };
    }

    private parseCheckpointRow(row: any): Checkpoint {
        return {
            ...row,
            kind: (row.kind === 'manual' || row.kind === 'session' || row.kind === 'legacy') ? row.kind : 'legacy',
            nodeIds: row.nodeIds ? JSON.parse(row.nodeIds) : [],
            agentSet: row.agentSet ? JSON.parse(row.agentSet) : []
        };
    }

    private toCheckpointSummary(checkpoint: Checkpoint): CheckpointSummary {
        return {
            checkpointId: checkpoint.id,
            contextId: checkpoint.contextId,
            branch: checkpoint.branch ?? null,
            worktreePath: checkpoint.worktreePath ?? null,
            sessionId: checkpoint.sessionId ?? null,
            commitSha: checkpoint.commitSha ?? null,
            createdAt: checkpoint.createdAt,
            summary: checkpoint.summary ?? checkpoint.name,
            kind: checkpoint.kind,
            name: checkpoint.name,
            agentSet: checkpoint.agentSet ?? []
        };
    }

    private parsePayloadValue(raw: string, contentType: string): unknown {
        if (contentType.toLowerCase().includes('json')) {
            try {
                return JSON.parse(raw);
            } catch {
                return raw;
            }
        }
        return raw;
    }

    private extractString(record: unknown, path: string[]): string | null {
        let current: unknown = record;
        for (const key of path) {
            if (!current || typeof current !== 'object' || Array.isArray(current)) return null;
            current = (current as Record<string, unknown>)[key];
        }
        return typeof current === 'string' && current.trim().length > 0 ? current.trim() : null;
    }

    private extractTimestampValue(record: unknown, path: string[]): number | null {
        let current: unknown = record;
        for (const key of path) {
            if (!current || typeof current !== 'object' || Array.isArray(current)) return null;
            current = (current as Record<string, unknown>)[key];
        }
        if (typeof current === 'number' && Number.isFinite(current)) {
            return current;
        }
        if (typeof current === 'string' && current.trim().length > 0) {
            const parsed = Date.parse(current.trim());
            if (Number.isFinite(parsed)) return parsed;
            const asNumber = Number(current.trim());
            if (Number.isFinite(asNumber)) return asNumber;
        }
        return null;
    }

    private extractAgentFromKey(key: string | null | undefined): string | null {
        if (!key) return null;
        const parts = key.split(':');
        return parts.length >= 2 ? (parts[1] || null) : null;
    }

    private extractAgentFromTags(tags: string[] | null | undefined): string | null {
        const tag = (tags ?? []).find(value => typeof value === 'string' && value.startsWith('agent:'));
        return tag ? tag.slice('agent:'.length) : null;
    }

    private extractTagValue(tags: string[] | null | undefined, prefix: string): string | null {
        const tag = (tags ?? []).find(value => typeof value === 'string' && value.startsWith(prefix));
        return tag ? tag.slice(prefix.length) : null;
    }

    private extractMessageIdFromKey(key: string | null | undefined): string | null {
        if (!key) return null;
        const parts = key.split(':');
        return parts.length >= 4 ? parts.slice(3).join(':') : null;
    }

    private normalizeBranch(branch: string | null | undefined): string {
        const normalized = typeof branch === 'string' ? branch.trim() : '';
        return normalized.length > 0 ? normalized : 'detached';
    }

    private normalizeWorktreePath(worktreePath: string | null | undefined): string {
        return typeof worktreePath === 'string' ? worktreePath.trim() : '';
    }

    private branchLaneKey(branch: string | null | undefined, worktreePath: string | null | undefined): string {
        return `${this.normalizeBranch(branch)}::${this.normalizeWorktreePath(worktreePath)}`;
    }

    private extractTurnMetadata(payload: unknown): {
        branch: string | null;
        commitSha: string | null;
        role: string | null;
        occurredAt: number | null;
        agent: string | null;
        worktreePath: string | null;
        repositoryRoot: string | null;
        captureSource: string | null;
        sessionTitle: string | null;
        messageId: string | null;
        parentId: string | null;
    } {
        const commitSha =
            this.extractString(payload, ['commitSha'])
            ?? this.extractString(payload, ['commit'])
            ?? this.extractString(payload, ['gitCommit'])
            ?? this.extractString(payload, ['git', 'commitSha'])
            ?? this.extractString(payload, ['git', 'commit'])
            ?? this.extractString(payload, ['meta', 'git', 'commitSha'])
            ?? this.extractString(payload, ['meta', 'git', 'commit']);
        const branch =
            this.extractString(payload, ['branch'])
            ?? this.extractString(payload, ['gitBranch'])
            ?? this.extractString(payload, ['git', 'branch'])
            ?? this.extractString(payload, ['meta', 'git', 'branch']);
        const role =
            this.extractString(payload, ['role'])
            ?? this.extractString(payload, ['meta', 'role'])
            ?? this.extractString(payload, ['message', 'role']);
        const occurredAt =
            this.extractTimestampValue(payload, ['occurredAt'])
            ?? this.extractTimestampValue(payload, ['timestamp'])
            ?? this.extractTimestampValue(payload, ['meta', 'occurredAt'])
            ?? this.extractTimestampValue(payload, ['meta', 'timestamp']);
        const agent =
            this.extractString(payload, ['agent'])
            ?? this.extractString(payload, ['meta', 'agent']);
        const worktreePath =
            this.extractString(payload, ['worktreePath'])
            ?? this.extractString(payload, ['git', 'worktreePath'])
            ?? this.extractString(payload, ['meta', 'worktreePath'])
            ?? this.extractString(payload, ['meta', 'git', 'worktreePath'])
            ?? this.extractString(payload, ['cwd']);
        const repositoryRoot =
            this.extractString(payload, ['repositoryRoot'])
            ?? this.extractString(payload, ['repoRoot'])
            ?? this.extractString(payload, ['repo_root'])
            ?? this.extractString(payload, ['meta', 'repositoryRoot'])
            ?? this.extractString(payload, ['meta', 'repoRoot'])
            ?? this.extractString(payload, ['meta', 'repository', 'root'])
            ?? worktreePath;
        const captureSource =
            this.extractString(payload, ['captureSource'])
            ?? this.extractString(payload, ['meta', 'captureSource']);
        const sessionTitle =
            this.extractString(payload, ['sessionTitle'])
            ?? this.extractString(payload, ['title'])
            ?? this.extractString(payload, ['summary'])
            ?? this.extractString(payload, ['meta', 'sessionTitle']);
        const messageId =
            this.extractString(payload, ['messageId'])
            ?? this.extractString(payload, ['message', 'id'])
            ?? this.extractString(payload, ['id']);
        const parentId =
            this.extractString(payload, ['parentId'])
            ?? this.extractString(payload, ['parent_id'])
            ?? this.extractString(payload, ['parent', 'id']);
        return { branch, commitSha, role, occurredAt, agent, worktreePath, repositoryRoot, captureSource, sessionTitle, messageId, parentId };
    }

    private boostKnowledgeCandidateConfidence(
        type: Exclude<NodeType, 'artifact'> | null | undefined,
        baseConfidence: number,
        evidenceCount: number,
        distinctEvidenceCount: number,
        roles: Set<string>
    ): number {
        const assistantOnlySingle = distinctEvidenceCount === 1 && roles.size === 1 && roles.has('assistant');
        let adjusted = baseConfidence;

        if (assistantOnlySingle) {
            if (type === 'goal') adjusted = Math.min(adjusted, 0.64);
            if (type === 'decision') adjusted = Math.min(adjusted, 0.68);
            if (type === 'constraint') adjusted = Math.min(adjusted, 0.69);
        }

        if (distinctEvidenceCount > 1) {
            adjusted += Math.min(0.12, (distinctEvidenceCount - 1) * 0.04);
        }
        if (roles.has('assistant') && roles.has('user')) {
            adjusted += 0.04;
        } else if (roles.has('assistant') && !assistantOnlySingle) {
            adjusted += 0.02;
        }
        return Math.min(0.98, adjusted);
    }

    private buildKnowledgeEvidenceReason(baseReason: string, evidenceCount: number, distinctEvidenceCount: number, roles: Set<string>): string {
        const reasonParts = [baseReason];
        if (evidenceCount > 1) {
            reasonParts.push(`repeated-${evidenceCount}-times`);
        }
        if (evidenceCount > distinctEvidenceCount) {
            reasonParts.push(`distinct-${distinctEvidenceCount}`);
        }
        if (roles.has('assistant') && roles.has('user')) {
            reasonParts.push('corroborated-across-roles');
        } else if (roles.has('assistant')) {
            reasonParts.push('assistant-confirmed');
        }
        return reasonParts.join(', ');
    }

    private buildKnowledgeEvidenceSummary(evidenceCount: number, distinctEvidenceCount: number, roles: Set<string>): string {
        const crossRole = roles.has('assistant') && roles.has('user');
        const assistantOnly = roles.size === 1 && roles.has('assistant');
        const userOnly = roles.size === 1 && roles.has('user');

        let summary = 'Single captured mention.';
        if (evidenceCount > 1 && crossRole) {
            summary = `Repeated ${evidenceCount} times across user and assistant messages.`;
        } else if (evidenceCount > 1) {
            summary = `Repeated ${evidenceCount} times in captured messages.`;
        } else if (crossRole) {
            summary = 'Backed by both user and assistant messages.';
        } else if (assistantOnly) {
            summary = 'Single assistant-only statement.';
        } else if (userOnly) {
            summary = 'Single user-stated signal.';
        }

        if (distinctEvidenceCount > 0 && evidenceCount > distinctEvidenceCount) {
            summary += ` Distinct supporting statements: ${distinctEvidenceCount}.`;
        }
        return summary;
    }

    private classifyKnowledgeReviewTier(
        type: Exclude<NodeType, 'artifact'> | null | undefined,
        confidence: number,
        evidenceCount: number,
        distinctEvidenceCount: number,
        roles: Set<string>
    ): {
        reviewTier: 'strong' | 'review' | 'weak';
        reviewSummary: string;
    } {
        const crossRole = roles.has('assistant') && roles.has('user');
        const assistantOnlySingle = distinctEvidenceCount === 1 && roles.size === 1 && roles.has('assistant');
        if (confidence >= 0.8 && distinctEvidenceCount >= 2 && crossRole) {
            return {
                reviewTier: 'strong',
                reviewSummary: 'Strong signal backed by repeated cross-role evidence.'
            };
        }
        if (confidence >= 0.9 && (distinctEvidenceCount >= 2 || crossRole)) {
            return {
                reviewTier: 'strong',
                reviewSummary: 'Strong signal backed by repeated or cross-role evidence.'
            };
        }
        if (
            assistantOnlySingle
            && (
                ((type === 'goal' || type === 'decision' || type === 'constraint') && confidence >= 0.64)
                || confidence >= 0.8
            )
        ) {
            return {
                reviewTier: 'review',
                reviewSummary: 'Single assistant-only signal. Review before promoting it into shared memory.'
            };
        }
        if (confidence >= 0.78 || distinctEvidenceCount >= 2 || crossRole) {
            return {
                reviewTier: 'review',
                reviewSummary: 'Good candidate. Review before promoting it into shared memory.'
            };
        }
        return {
            reviewTier: 'weak',
            reviewSummary: 'Tentative signal. Keep in review until more evidence appears.'
        };
    }

    private ensureEdge(fromId: string, toId: string, relation: EdgeType): void {
        const row = this.db.prepare(`
      SELECT id
      FROM edges
      WHERE fromId = ? AND toId = ? AND relation = ?
      LIMIT 1
    `).get(fromId, toId, relation) as { id: string } | undefined;
        if (!row) {
            this.addEdge(fromId, toId, relation);
        }
    }

    private buildKnowledgeKey(
        contextId: string,
        type: Exclude<NodeType, 'artifact'>,
        content: string,
        options: { branch?: string | null; worktreePath?: string | null } = {}
    ): string {
        const normalizedWorktree = this.normalizeWorktreePath(options.worktreePath);
        const normalizedBranch = this.normalizeBranch(options.branch);
        const scope = normalizedWorktree
            ? `worktree:${normalizedWorktree.toLowerCase()}`
            : normalizedBranch !== 'detached'
                ? `branch:${normalizedBranch.toLowerCase()}`
                : `workspace:${contextId}`;
        const scopeDigest = createHash('sha1').update(scope).digest('hex').slice(0, 12);
        const canonical = canonicalizeKnowledgeCandidateText(type, content) || content.toLowerCase();
        const digest = createHash('sha1').update(`${type}\n${canonical}`).digest('hex').slice(0, 16);
        return `knowledge:${type}:${scopeDigest}:${digest}`;
    }

    private sanitizePromotedInsightTags(
        tags: string[] | null | undefined,
        sourceContextId: string,
        sourceNodeId: string,
        branch: string | null,
        worktreePath: string | null
    ): string[] {
        const prefixesToStrip = [
            'session:',
            'checkpoint:',
            'agent:',
            'branch:',
            'worktree:',
            'source:',
            'origin_context:',
            'origin_node:'
        ];
        const kept = (tags ?? []).filter((tag): tag is string => {
            if (typeof tag !== 'string' || tag.trim().length === 0) return false;
            return !prefixesToStrip.some((prefix) => tag.startsWith(prefix));
        });
        const merged = [
            ...kept,
            'knowledge',
            'promoted',
            `origin_context:${sourceContextId}`,
            `origin_node:${sourceNodeId}`,
            branch ? `branch:${branch}` : null,
            worktreePath ? `worktree:${worktreePath}` : null
        ].filter((value): value is string => Boolean(value));
        return Array.from(new Set(merged));
    }

    private tokenizeQuery(query: string): string[] {
        const matches = query.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
        return Array.from(new Set(matches));
    }

    private buildFtsQuery(query: string): string {
        const terms = this.tokenizeQuery(query);
        if (terms.length === 0) {
            return `"${query.replace(/"/g, '""')}"`;
        }
        return terms.map(term => `"${term.replace(/"/g, '""')}"*`).join(' OR ');
    }

    private escapeRegex(input: string): string {
        return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * SEC-001: Resolve the per-machine audit HMAC secret.
     * Priority: CTX_AUDIT_HMAC_SECRET env var → persisted ~/.0ctx/config.json value → auto-generated.
     * Auto-generated secrets are saved to config.json so the chain stays verifiable across restarts.
     */
    private resolveAuditSecret(): string {
        // 1. Explicit env var override (enterprise/CI)
        const envSecret = process.env.CTX_AUDIT_HMAC_SECRET;
        if (envSecret && envSecret.length > 0) return envSecret;

        // 2. Persisted per-machine secret
        const stored = getConfigValue('audit.hmacSecret');
        if (stored && stored.length > 0) return stored;

        // 3. First run — generate, persist, and return
        const generated = randomBytes(32).toString('hex');
        try {
            setConfigValue('audit.hmacSecret', generated);
        } catch {
            // Config dir not writable — use in-memory for this session only
        }
        return generated;
    }

    // ── Context Management ─────────────────────────────────────────

    createContext(name: string, paths: string[] = [], syncPolicy: SyncPolicy = 'metadata_only'): Context {
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
            this.db.prepare('DELETE FROM node_payloads WHERE nodeId = ?').run(nodeId);
            this.db.prepare('DELETE FROM edges WHERE fromId = ? OR toId = ?').run(nodeId, nodeId);
        }

        this.db.prepare('DELETE FROM branch_lanes WHERE contextId = ?').run(id);
        this.db.prepare('DELETE FROM checkpoint_payloads WHERE contextId = ?').run(id);
        this.db.prepare('DELETE FROM nodes WHERE contextId = ?').run(id);
        this.db.prepare('DELETE FROM checkpoints WHERE contextId = ?').run(id);
        this.db.prepare('DELETE FROM contexts WHERE id = ?').run(id);
    }

    // ── Nodes ──────────────────────────────────────────────────────
    addNode(params: Omit<ContextNode, 'id' | 'createdAt'> & { rawPayload?: unknown; payloadContentType?: string; createdAtOverride?: number }): ContextNode {
        const { rawPayload, payloadContentType, createdAtOverride, ...nodeParams } = params;
        const createdAt = typeof createdAtOverride === 'number' && Number.isFinite(createdAtOverride)
            ? createdAtOverride
            : Date.now();
        const node: ContextNode = { ...nodeParams, id: randomUUID(), createdAt };
        this.db.prepare(`
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

        this.db.prepare(`
      INSERT INTO nodes_fts (id, content, tags) VALUES (?, ?, ?)
    `).run(node.id, nodeParams.content, (nodeParams.tags ?? []).join(' '));

        if (rawPayload !== undefined) {
            this.setNodePayload(node.id, nodeParams.contextId, rawPayload, {
                contentType: payloadContentType
            });
        }

        return this.getNode(node.id)!;
    }

    getNode(id: string): ContextNode | null {
        const row = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as any;
        return row ? this.parseNodeRow(row) : null;
    }

    getByKey(contextId: string, key: string, options: { includeHidden?: boolean } = {}): ContextNode | null {
        const includeHidden = options.includeHidden ?? false;
        const row = includeHidden
            ? this.db.prepare(
                'SELECT * FROM nodes WHERE contextId = ? AND key = ? ORDER BY createdAt DESC LIMIT 1'
            ).get(contextId, key) as any
            : this.db.prepare(
                'SELECT * FROM nodes WHERE contextId = ? AND key = ? AND hidden = 0 ORDER BY createdAt DESC LIMIT 1'
            ).get(contextId, key) as any;
        return row ? this.parseNodeRow(row) : null;
    }

    deleteNode(id: string): void {
        this.db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
        this.db.prepare('DELETE FROM nodes_fts WHERE id = ?').run(id);
        this.db.prepare('DELETE FROM node_payloads WHERE nodeId = ?').run(id);
        this.db.prepare('DELETE FROM edges WHERE fromId = ? OR toId = ?').run(id, id);
    }

    updateNode(id: string, updates: Partial<Pick<ContextNode, 'content' | 'tags' | 'hidden'>>): ContextNode | null {
        const node = this.getNode(id);
        if (!node) return null;

        const newContent = updates.content !== undefined ? updates.content : node.content;
        const newTags = updates.tags !== undefined ? updates.tags : node.tags;
        const newHidden = updates.hidden !== undefined ? updates.hidden : (node.hidden ?? false);

        this.db.prepare('UPDATE nodes SET content = ?, tags = ?, hidden = ? WHERE id = ?').run(newContent, JSON.stringify(newTags), newHidden ? 1 : 0, id);
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
    searchAdvanced(contextId: string, query: string, options: SearchAdvancedOptions = {}): SearchResult[] {
        const normalizedQuery = query.trim();
        if (!normalizedQuery) return [];

        const limit = Math.max(1, Math.min(options.limit ?? 20, 200));
        const sinceMs = Math.max(1, Math.floor(options.sinceMs ?? 24 * 60 * 60 * 1000));
        const includeSuperseded = options.includeSuperseded ?? false;
        const includeHidden = options.includeHidden ?? false;
        const now = Date.now();
        const queryTerms = this.tokenizeQuery(normalizedQuery);
        const ftsQuery = this.buildFtsQuery(normalizedQuery);
        const hiddenFilterSql = includeHidden ? '' : ' AND n.hidden = 0';

        let rows: any[] = [];
        try {
            rows = this.db.prepare(`
          SELECT n.*, bm25(nodes_fts, 5.0, 1.5) AS bm25Rank
          FROM nodes n
          JOIN nodes_fts ON n.id = nodes_fts.id
          WHERE n.contextId = ? ${hiddenFilterSql} AND nodes_fts MATCH ?
          ORDER BY bm25Rank ASC
          LIMIT ?
        `).all(contextId, ftsQuery, Math.max(limit * 5, limit)) as any[];
        } catch {
            rows = includeHidden
                ? this.db.prepare(`
          SELECT * FROM nodes
          WHERE contextId = ?
            AND (content LIKE ? OR tags LIKE ?)
          ORDER BY createdAt DESC
          LIMIT ?
        `).all(contextId, `%${normalizedQuery}%`, `%${normalizedQuery}%`, Math.max(limit * 5, limit)) as any[]
                : this.db.prepare(`
          SELECT * FROM nodes
          WHERE contextId = ?
            AND hidden = 0
            AND (content LIKE ? OR tags LIKE ?)
          ORDER BY createdAt DESC
          LIMIT ?
        `).all(contextId, `%${normalizedQuery}%`, `%${normalizedQuery}%`, Math.max(limit * 5, limit)) as any[];
        }

        const supersededRows = this.db.prepare(`
      SELECT DISTINCT e.toId AS id
      FROM edges e
      JOIN nodes n ON n.id = e.toId
      WHERE n.contextId = ? AND e.relation = 'supersedes'
    `).all(contextId) as Array<{ id: string }>;
        const supersededNodeIds = new Set(supersededRows.map(row => row.id));

        const candidateIds = rows
            .map(row => (typeof row.id === 'string' ? row.id : ''))
            .filter((id): id is string => id.length > 0);
        const degreeByNode = new Map<string, number>();
        if (candidateIds.length > 0) {
            const placeholders = candidateIds.map(() => '?').join(', ');
            const degreeRows = this.db.prepare(`
        SELECT nodeId, SUM(cnt) AS degree FROM (
          SELECT fromId AS nodeId, COUNT(*) AS cnt
          FROM edges
          WHERE fromId IN (${placeholders})
          GROUP BY fromId
          UNION ALL
          SELECT toId AS nodeId, COUNT(*) AS cnt
          FROM edges
          WHERE toId IN (${placeholders})
          GROUP BY toId
        )
        GROUP BY nodeId
      `).all(...candidateIds, ...candidateIds) as Array<{ nodeId: string; degree: number }>;
            for (const row of degreeRows) {
                degreeByNode.set(row.nodeId, row.degree ?? 0);
            }
        }

        const results: SearchResult[] = [];
        for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i];
            const node: ContextNode = this.parseNodeRow(row);
            const isSuperseded = supersededNodeIds.has(node.id);
            if (!includeSuperseded && isSuperseded) {
                continue;
            }

            const tagsLower = (node.tags ?? []).map(tag => tag.toLowerCase());
            const contentLower = node.content.toLowerCase();

            const matchedTerms = queryTerms.filter(
                term => contentLower.includes(term) || tagsLower.some(tag => tag.includes(term))
            );
            const exactTermMatches = queryTerms.filter(term => new RegExp(`\\b${this.escapeRegex(term)}\\b`, 'i').test(node.content));
            const exactTermMatch = exactTermMatches.length > 0;
            const exactPhraseMatch = normalizedQuery.length >= 3 && contentLower.includes(normalizedQuery.toLowerCase());
            const tagMatch = queryTerms.some(term => tagsLower.some(tag => tag.includes(term)));
            const tagTermMatches = queryTerms.filter(term => tagsLower.some(tag => tag.includes(term))).length;
            const recentMutation = (now - node.createdAt) <= sinceMs;
            const degree = degreeByNode.get(node.id) ?? 0;
            const connectedToHotNode = degree >= 3;

            let matchReason: SearchMatchReason = 'exact_term';
            if (exactPhraseMatch || exactTermMatch) {
                matchReason = 'exact_term';
            } else if (tagMatch) {
                matchReason = 'tag_match';
            } else if (recentMutation) {
                matchReason = 'recent_mutation';
            } else if (connectedToHotNode) {
                matchReason = 'connected_to_hot_node';
            }

            const rankScore = Math.max(0, 110 - (i * 4));
            const bm25Rank = typeof row.bm25Rank === 'number' ? row.bm25Rank : null;
            let bm25Score = 0;
            if (bm25Rank !== null) {
                bm25Score = bm25Rank < 0
                    ? 30
                    : Math.max(0, 30 - (bm25Rank * 12));
            }
            const termCoverageScore = matchedTerms.length * 5;
            const exactTermScore = exactTermMatches.length * 4;

            let score = rankScore + bm25Score + termCoverageScore + exactTermScore;
            if (exactPhraseMatch) score += 12;
            if (tagMatch) score += 5 + Math.min(9, tagTermMatches * 3);
            if (recentMutation) score += 4;
            if (connectedToHotNode) score += 3;
            if (isSuperseded) score -= 45;
            score = Math.max(0, Number(score.toFixed(2)));

            results.push({
                node,
                score,
                matchReason,
                matchedTerms
            });
        }

        results.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return b.node.createdAt - a.node.createdAt;
        });

        return results.slice(0, limit);
    }

    search(contextId: string, query: string, limit = 20, options: { includeHidden?: boolean } = {}): ContextNode[] {
        return this.searchAdvanced(contextId, query, {
            limit,
            includeSuperseded: true,
            includeHidden: options.includeHidden ?? false
        }).map(result => result.node);
    }

    getGraphData(contextId: string, options: { includeHidden?: boolean } = {}) {
        const includeHidden = options.includeHidden ?? false;
        const nodesRows = includeHidden
            ? this.db.prepare('SELECT * FROM nodes WHERE contextId = ? ORDER BY createdAt DESC').all(contextId) as any[]
            : this.db.prepare('SELECT * FROM nodes WHERE contextId = ? AND hidden = 0 ORDER BY createdAt DESC').all(contextId) as any[];
        const edgesRows = includeHidden
            ? this.db.prepare(`
          SELECT e.*
          FROM edges e
          JOIN nodes nf ON e.fromId = nf.id
          JOIN nodes nt ON e.toId = nt.id
          WHERE nf.contextId = ? AND nt.contextId = ?
        `).all(contextId, contextId) as any[]
            : this.db.prepare(`
          SELECT e.*
          FROM edges e
          JOIN nodes nf ON e.fromId = nf.id
          JOIN nodes nt ON e.toId = nt.id
          WHERE nf.contextId = ? AND nt.contextId = ? AND nf.hidden = 0 AND nt.hidden = 0
        `).all(contextId, contextId) as any[];
        return {
            nodes: nodesRows.map(r => this.parseNodeRow(r)),
            edges: edgesRows
        };
    }

    setNodePayload(
        nodeId: string,
        contextId: string,
        payload: unknown,
        options: {
            contentType?: string;
            compression?: NodePayloadCompression;
            createdAt?: number;
            updatedAt?: number;
        } = {}
    ): NodePayloadRecord {
        const contentType = options.contentType ?? 'application/json';
        const compression = options.compression ?? 'gzip';
        const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
        const serializedBuffer = Buffer.from(serialized, 'utf8');
        const encoded = compression === 'gzip' ? gzipSync(serializedBuffer) : serializedBuffer;
        const createdAt = options.createdAt ?? Date.now();
        const updatedAt = options.updatedAt ?? Date.now();

        this.db.prepare(`
      INSERT INTO node_payloads (nodeId, contextId, contentType, compression, payload, byteLength, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(nodeId) DO UPDATE SET
        contextId = excluded.contextId,
        contentType = excluded.contentType,
        compression = excluded.compression,
        payload = excluded.payload,
        byteLength = excluded.byteLength,
        updatedAt = excluded.updatedAt
    `).run(nodeId, contextId, contentType, compression, encoded, serializedBuffer.length, createdAt, updatedAt);

        return this.getNodePayload(nodeId)!;
    }

    getNodePayload(nodeId: string): NodePayloadRecord | null {
        const row = this.db.prepare(`
      SELECT nodeId, contextId, contentType, compression, payload, byteLength, createdAt, updatedAt
      FROM node_payloads
      WHERE nodeId = ?
    `).get(nodeId) as {
        nodeId: string;
        contextId: string;
        contentType: string;
        compression: NodePayloadCompression;
        payload: Buffer;
        byteLength: number;
        createdAt: number;
        updatedAt: number;
    } | undefined;
        if (!row) return null;

        const decodedBuffer = row.compression === 'gzip'
            ? gunzipSync(row.payload)
            : Buffer.from(row.payload);
        const decoded = decodedBuffer.toString('utf8');
        const parsed = this.parsePayloadValue(decoded, row.contentType);

        return {
            nodeId: row.nodeId,
            contextId: row.contextId,
            contentType: row.contentType,
            compression: row.compression,
            byteLength: row.byteLength,
            payload: parsed,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt
        };
    }

    setCheckpointPayload(
        checkpointId: string,
        contextId: string,
        payload: unknown,
        options: {
            contentType?: string;
            compression?: NodePayloadCompression;
            createdAt?: number;
            updatedAt?: number;
        } = {}
    ): CheckpointPayloadRecord {
        const contentType = options.contentType ?? 'application/json';
        const compression = options.compression ?? 'gzip';
        const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
        const serializedBuffer = Buffer.from(serialized, 'utf8');
        const encoded = compression === 'gzip' ? gzipSync(serializedBuffer) : serializedBuffer;
        const createdAt = options.createdAt ?? Date.now();
        const updatedAt = options.updatedAt ?? Date.now();

        this.db.prepare(`
      INSERT INTO checkpoint_payloads (checkpointId, contextId, contentType, compression, payload, byteLength, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(checkpointId) DO UPDATE SET
        contextId = excluded.contextId,
        contentType = excluded.contentType,
        compression = excluded.compression,
        payload = excluded.payload,
        byteLength = excluded.byteLength,
        updatedAt = excluded.updatedAt
    `).run(checkpointId, contextId, contentType, compression, encoded, serializedBuffer.length, createdAt, updatedAt);

        return this.getCheckpointPayload(checkpointId)!;
    }

    getCheckpointPayload(checkpointId: string): CheckpointPayloadRecord | null {
        const row = this.db.prepare(`
      SELECT checkpointId, contextId, contentType, compression, payload, byteLength, createdAt, updatedAt
      FROM checkpoint_payloads
      WHERE checkpointId = ?
    `).get(checkpointId) as {
            checkpointId: string;
            contextId: string;
            contentType: string;
            compression: NodePayloadCompression;
            payload: Buffer;
            byteLength: number;
            createdAt: number;
            updatedAt: number;
        } | undefined;
        if (!row) return null;

        const decodedBuffer = row.compression === 'gzip'
            ? gunzipSync(row.payload)
            : Buffer.from(row.payload);
        const decoded = decodedBuffer.toString('utf8');
        const parsed = this.parsePayloadValue(decoded, row.contentType);

        return {
            checkpointId: row.checkpointId,
            contextId: row.contextId,
            contentType: row.contentType,
            compression: row.compression,
            byteLength: row.byteLength,
            payload: parsed,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt
        };
    }

    private refreshBranchLaneProjection(contextId: string): void {
        const sessions = this.listChatSessions(contextId, 5000) as AgentSessionSummary[];
        const checkpoints = this.listCheckpoints(contextId);
        const lanes = new Map<string, {
            branch: string;
            worktreePath: string;
            lastAgent: string | null;
            lastCommitSha: string | null;
            lastActivityAt: number;
            sessionCount: number;
            checkpointCount: number;
            agentSet: Set<string>;
        }>();

        const ensureLane = (branch: string | null | undefined, worktreePath: string | null | undefined) => {
            const normalizedBranch = this.normalizeBranch(branch);
            const normalizedWorktree = this.normalizeWorktreePath(worktreePath);
            const key = this.branchLaneKey(normalizedBranch, normalizedWorktree);
            let lane = lanes.get(key);
            if (!lane) {
                lane = {
                    branch: normalizedBranch,
                    worktreePath: normalizedWorktree,
                    lastAgent: null,
                    lastCommitSha: null,
                    lastActivityAt: 0,
                    sessionCount: 0,
                    checkpointCount: 0,
                    agentSet: new Set<string>()
                };
                lanes.set(key, lane);
            }
            return lane;
        };

        for (const session of sessions) {
            const lane = ensureLane(session.branch, session.worktreePath);
            lane.sessionCount += 1;
            if (session.agent) lane.agentSet.add(session.agent);
            if (session.lastTurnAt >= lane.lastActivityAt) {
                lane.lastActivityAt = session.lastTurnAt;
                lane.lastAgent = session.agent ?? lane.lastAgent;
                lane.lastCommitSha = session.commitSha ?? lane.lastCommitSha;
            }
        }

        for (const checkpoint of checkpoints) {
            const lane = ensureLane(checkpoint.branch, checkpoint.worktreePath);
            lane.checkpointCount += 1;
            for (const agent of checkpoint.agentSet ?? []) {
                if (agent) lane.agentSet.add(agent);
            }
            if (checkpoint.createdAt >= lane.lastActivityAt) {
                lane.lastActivityAt = checkpoint.createdAt;
                lane.lastCommitSha = checkpoint.commitSha ?? lane.lastCommitSha;
                lane.lastAgent = (checkpoint.agentSet ?? [])[0] ?? lane.lastAgent;
            }
        }

        const upsert = this.db.prepare(`
      INSERT INTO branch_lanes (
        contextId, branch, worktreePath, lastAgent, lastCommitSha, lastActivityAt, sessionCount, checkpointCount, agentSet
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

        const tx = this.db.transaction(() => {
            this.db.prepare('DELETE FROM branch_lanes WHERE contextId = ?').run(contextId);
            for (const lane of lanes.values()) {
                upsert.run(
                    contextId,
                    lane.branch,
                    lane.worktreePath,
                    lane.lastAgent,
                    lane.lastCommitSha,
                    lane.lastActivityAt,
                    lane.sessionCount,
                    lane.checkpointCount,
                    JSON.stringify(Array.from(lane.agentSet))
                );
            }
        });
        tx();
    }

    listChatSessions(contextId: string, limit = 50): ChatSessionSummary[] {
        const safeLimit = Math.max(1, Math.min(limit, 5000));
        const rows = this.db.prepare(`
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
            const latestRow = this.db.prepare(`
        SELECT *
        FROM nodes
        WHERE contextId = ? AND thread = ? AND key LIKE 'chat_turn:%'
        ORDER BY createdAt DESC
        LIMIT 1
      `).get(contextId, row.sessionId) as any;

            const sessionRow = this.db.prepare(`
        SELECT *
        FROM nodes
        WHERE contextId = ? AND thread = ? AND key LIKE 'chat_session:%'
        ORDER BY createdAt DESC
        LIMIT 1
      `).get(contextId, row.sessionId) as any;

            const firstRow = this.db.prepare(`
        SELECT *
        FROM nodes
        WHERE contextId = ? AND thread = ? AND key LIKE 'chat_turn:%'
        ORDER BY createdAt ASC
        LIMIT 1
      `).get(contextId, row.sessionId) as any;

            const latestNode = latestRow ? this.parseNodeRow(latestRow) : null;
            const sessionNode = sessionRow ? this.parseNodeRow(sessionRow) : null;
            const firstNode = firstRow ? this.parseNodeRow(firstRow) : null;

            const latestPayload = latestNode ? this.getNodePayload(latestNode.id) : null;
            const firstPayload = firstNode ? this.getNodePayload(firstNode.id) : null;
            const sessionPayload = sessionNode ? this.getNodePayload(sessionNode.id) : null;
            const latestMetadata = this.extractTurnMetadata(latestPayload?.payload);
            const firstMetadata = this.extractTurnMetadata(firstPayload?.payload);
            const sessionMetadata = this.extractTurnMetadata(sessionPayload?.payload);

            const agent =
                latestMetadata.agent
                ?? firstMetadata.agent
                ?? sessionMetadata.agent
                ?? this.extractAgentFromKey(sessionNode?.key ?? latestNode?.key)
                ?? this.extractAgentFromTags(sessionNode?.tags ?? latestNode?.tags);

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

    listBranchLanes(contextId: string, limit = 200): BranchLaneSummary[] {
        this.refreshBranchLaneProjection(contextId);
        const safeLimit = Math.max(1, Math.min(limit, 1000));
        const rows = this.db.prepare(`
      SELECT *
      FROM branch_lanes
      WHERE contextId = ?
      ORDER BY lastActivityAt DESC, branch ASC, worktreePath ASC
      LIMIT ?
    `).all(contextId, safeLimit) as Array<any>;

        return rows.map((row): BranchLaneSummary => ({
            contextId: row.contextId,
            branch: row.branch,
            worktreePath: row.worktreePath || null,
            repositoryRoot: null,
            currentHeadSha: null,
            currentHeadRef: null,
            isDetachedHead: null,
            headDiffersFromCaptured: null,
            lastAgent: row.lastAgent ?? null,
            lastCommitSha: row.lastCommitSha ?? null,
            lastActivityAt: row.lastActivityAt,
            sessionCount: row.sessionCount,
            checkpointCount: row.checkpointCount,
            agentSet: row.agentSet ? JSON.parse(row.agentSet) : [],
            upstream: null,
            aheadCount: null,
            behindCount: null,
            mergeBaseSha: null,
            isCurrent: null,
            hasUncommittedChanges: null,
            stagedChangeCount: null,
            unstagedChangeCount: null,
            untrackedCount: null,
            baseline: null
        }));
    }

    listBranchSessions(
        contextId: string,
        branch: string,
        options: { worktreePath?: string | null; limit?: number } = {}
    ): AgentSessionSummary[] {
        const targetBranch = this.normalizeBranch(branch);
        const targetWorktree = this.normalizeWorktreePath(options.worktreePath);
        return (this.listChatSessions(contextId, options.limit ?? 5000) as AgentSessionSummary[]).filter((session) => {
            if (this.normalizeBranch(session.branch) !== targetBranch) return false;
            if (!targetWorktree) return true;
            return this.normalizeWorktreePath(session.worktreePath) === targetWorktree;
        });
    }

    listChatTurns(contextId: string, sessionId: string, limit = 200): ChatTurnSummary[] {
        const safeLimit = Math.max(1, Math.min(limit, 5000));
        const rows = this.db.prepare(`
      SELECT n.*, np.nodeId AS payloadNodeId, np.byteLength AS payloadByteLength
      FROM nodes n
      LEFT JOIN node_payloads np ON np.nodeId = n.id
      WHERE n.contextId = ? AND n.thread = ? AND n.key LIKE 'chat_turn:%'
      ORDER BY n.createdAt ASC
      LIMIT ?
    `).all(contextId, sessionId, safeLimit) as Array<any>;

        return rows.map((row): ChatTurnSummary => {
            const node = this.parseNodeRow(row);
            const payload = row.payloadNodeId ? this.getNodePayload(node.id) : null;
            const metadata = this.extractTurnMetadata(payload?.payload);
            const roleTag = (node.tags ?? []).find(tag => tag.startsWith('role:'));
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
                messageId: metadata.messageId ?? this.extractMessageIdFromKey(node.key) ?? node.id,
                parentId: metadata.parentId ?? null,
                agent: metadata.agent ?? this.extractAgentFromKey(node.key) ?? this.extractAgentFromTags(node.tags),
                worktreePath: metadata.worktreePath ?? null,
                repositoryRoot: metadata.repositoryRoot ?? null,
                captureSource: metadata.captureSource ?? node.source ?? null,
                sessionTitle: metadata.sessionTitle ?? null,
                hasPayload: Boolean(row.payloadNodeId),
                payloadBytes: typeof row.payloadByteLength === 'number' ? row.payloadByteLength : null
            };
        });
    }

    listSessionMessages(contextId: string, sessionId: string, limit = 500): SessionMessage[] {
        const session = (this.listChatSessions(contextId, 5000) as AgentSessionSummary[]).find((entry) => entry.sessionId === sessionId) ?? null;
        return this.listChatTurns(contextId, sessionId, limit).map((turn): SessionMessage => ({
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

    getSessionDetail(contextId: string, sessionId: string): SessionDetail {
        const session = (this.listChatSessions(contextId, 5000) as AgentSessionSummary[]).find((entry) => entry.sessionId === sessionId) ?? null;
        const messages = this.listSessionMessages(contextId, sessionId, 5000);
        const checkpoints = (this.db.prepare(`
      SELECT *
      FROM checkpoints
      WHERE contextId = ? AND sessionId = ?
      ORDER BY createdAt DESC
    `).all(contextId, sessionId) as any[]).map(row => this.parseCheckpointRow(row));
        return {
            session,
            messages,
            checkpointCount: checkpoints.length,
            latestCheckpoint: checkpoints[0] ? this.toCheckpointSummary(checkpoints[0]) : null
        };
    }

    listBranchCheckpoints(
        contextId: string,
        branch: string,
        options: { worktreePath?: string | null; limit?: number } = {}
    ): CheckpointSummary[] {
        const safeLimit = Math.max(1, Math.min(options.limit ?? 500, 5000));
        const targetBranch = this.normalizeBranch(branch);
        const targetWorktree = this.normalizeWorktreePath(options.worktreePath);
        const rows = this.db.prepare(`
      SELECT *
      FROM checkpoints
      WHERE contextId = ?
      ORDER BY createdAt DESC
      LIMIT ?
    `).all(contextId, safeLimit) as any[];

        return rows
            .map(row => this.parseCheckpointRow(row))
            .filter((checkpoint) => this.normalizeBranch(checkpoint.branch) === targetBranch)
            .filter((checkpoint) => !targetWorktree || this.normalizeWorktreePath(checkpoint.worktreePath) === targetWorktree)
            .map(checkpoint => this.toCheckpointSummary(checkpoint));
    }

    getCheckpointDetail(checkpointId: string): CheckpointDetail | null {
        const row = this.db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(checkpointId) as any;
        if (!row) return null;
        const checkpoint = this.parseCheckpointRow(row);
        const payload = this.getCheckpointPayload(checkpointId);
        const dump = payload?.payload && typeof payload.payload === 'object' ? payload.payload as Partial<ContextDump> : null;
        return {
            checkpoint,
            snapshotNodeCount: Array.isArray(dump?.nodes) ? dump.nodes.length : checkpoint.nodeIds.length,
            snapshotEdgeCount: Array.isArray(dump?.edges) ? dump.edges.length : 0,
            snapshotCheckpointCount: Array.isArray(dump?.checkpoints) ? dump.checkpoints.length : 0,
            payloadAvailable: Boolean(payload)
        };
    }

    getHandoffTimeline(contextId: string, branch?: string, worktreePath?: string | null, limit = 100): HandoffTimelineEntry[] {
        const safeLimit = Math.max(1, Math.min(limit, 1000));
        const sessions = (this.listChatSessions(contextId, 5000) as AgentSessionSummary[])
            .filter((session) => !branch || this.normalizeBranch(session.branch) === this.normalizeBranch(branch))
            .filter((session) => !worktreePath || this.normalizeWorktreePath(session.worktreePath) === this.normalizeWorktreePath(worktreePath))
            .sort((a, b) => b.lastTurnAt - a.lastTurnAt)
            .slice(0, safeLimit);

        return sessions.map((session) => ({
            branch: this.normalizeBranch(session.branch),
            worktreePath: session.worktreePath ?? null,
            sessionId: session.sessionId,
            agent: session.agent ?? null,
            summary: session.summary,
            startedAt: session.startedAt,
            lastTurnAt: session.lastTurnAt,
            commitSha: session.commitSha ?? null
        }));
    }

    private getInsightEvidence(nodeId: string): {
        evidenceCount: number;
        distinctEvidenceCount: number;
        corroboratedRoles: string[];
        latestEvidenceAt: number | null;
        trustTier: 'strong' | 'review' | 'weak';
        trustSummary: string;
    } {
        const insight = this.getNode(nodeId);
        const insightType = insight?.type && insight.type !== 'artifact' ? insight.type : undefined;
        const edges = this.db.prepare(`
      SELECT toId
      FROM edges
      WHERE fromId = ? AND relation = 'caused_by'
    `).all(nodeId) as Array<{ toId: string }>;

        const roles = new Set<string>();
        const distinctEvidence = new Set<string>();
        let latestEvidenceAt: number | null = null;
        let evidenceCount = 0;

        for (const edge of edges) {
            const sourceNode = this.getNode(edge.toId);
            if (!sourceNode) continue;
            evidenceCount += 1;
            if (latestEvidenceAt === null || sourceNode.createdAt > latestEvidenceAt) {
                latestEvidenceAt = sourceNode.createdAt;
            }
            const role = this.extractTagValue(sourceNode.tags, 'role:');
            if (role) {
                roles.add(role);
            }
            const excerpt = sourceExcerpt(sourceNode.content);
            const distinctKey = `${(role ?? 'unknown').toLowerCase()}:${excerpt || sourceNode.id}`;
            distinctEvidence.add(distinctKey);
        }

        const distinctEvidenceCount = distinctEvidence.size;

        if (evidenceCount === 0) {
            return {
                evidenceCount: 0,
                distinctEvidenceCount: 0,
                corroboratedRoles: [],
                latestEvidenceAt: null,
                trustTier: 'weak',
                trustSummary: 'No linked evidence messages yet.'
            };
        }

        const confidence = this.boostKnowledgeCandidateConfidence(insightType, 0.72, evidenceCount, distinctEvidenceCount, roles);
        const review = this.classifyKnowledgeReviewTier(insightType, confidence, evidenceCount, distinctEvidenceCount, roles);
        const evidenceSummary = this.buildKnowledgeEvidenceSummary(evidenceCount, distinctEvidenceCount, roles);
        return {
            evidenceCount,
            distinctEvidenceCount,
            corroboratedRoles: Array.from(roles).sort(),
            latestEvidenceAt,
            trustTier: review.reviewTier,
            trustSummary: `${review.reviewSummary} ${evidenceSummary}`.trim()
        };
    }

    listWorkstreamInsights(
        contextId: string,
        options: {
            branch?: string | null;
            worktreePath?: string | null;
            limit?: number;
        } = {}
    ): InsightSummary[] {
        const safeLimit = Math.max(1, Math.min(options.limit ?? 25, 500));
        const targetBranch = this.normalizeBranch(options.branch);
        const targetWorktree = this.normalizeWorktreePath(options.worktreePath);
        const rows = this.db.prepare(`
      SELECT *
      FROM nodes
      WHERE contextId = ? AND hidden = 0 AND type != 'artifact'
      ORDER BY createdAt DESC
      LIMIT ?
    `).all(contextId, Math.max(safeLimit * 8, safeLimit)) as any[];

        const results: InsightSummary[] = [];
        for (const row of rows) {
            const node = this.parseNodeRow(row);
            const branch = this.extractTagValue(node.tags, 'branch:');
            const worktreePath = this.extractTagValue(node.tags, 'worktree:');
            if (targetWorktree) {
                if (this.normalizeWorktreePath(worktreePath) !== targetWorktree) continue;
            } else if (options.branch) {
                if (this.normalizeBranch(branch) !== targetBranch) continue;
            }

            const originContextId = this.extractTagValue(node.tags, 'origin_context:');
            const originNodeId = this.extractTagValue(node.tags, 'origin_node:');
            const evidence = this.getInsightEvidence(node.id);
            const trustSummary = evidence.evidenceCount === 0 && (originContextId || originNodeId)
                ? 'Promoted from another workspace. No local corroboration yet.'
                : evidence.trustSummary;
            const trustTier = evidence.evidenceCount === 0 && (originContextId || originNodeId)
                ? 'review'
                : evidence.trustTier;

            results.push({
                contextId,
                nodeId: node.id,
                type: node.type as Exclude<NodeType, 'artifact'>,
                content: node.content,
                createdAt: node.createdAt,
                branch: branch ?? null,
                worktreePath: worktreePath ?? null,
                source: node.source ?? null,
                key: node.key ?? null,
                evidenceCount: evidence.evidenceCount,
                distinctEvidenceCount: evidence.distinctEvidenceCount,
                corroboratedRoles: evidence.corroboratedRoles,
                latestEvidenceAt: evidence.latestEvidenceAt,
                trustTier,
                trustSummary,
                originContextId: originContextId ?? null,
                originNodeId: originNodeId ?? null
            });

            if (results.length >= safeLimit) break;
        }

        return results;
    }

    promoteInsightNode(
        sourceContextId: string,
        sourceNodeId: string,
        targetContextId: string,
        options: { branch?: string | null; worktreePath?: string | null } = {}
    ): InsightPromotionResult {
        const sourceNode = this.getNode(sourceNodeId);
        if (!sourceNode || sourceNode.contextId !== sourceContextId) {
            throw new Error(`Insight ${sourceNodeId} was not found in context ${sourceContextId}.`);
        }
        if (sourceNode.hidden) {
            throw new Error(`Insight ${sourceNodeId} is hidden and cannot be promoted.`);
        }
        if (sourceNode.type === 'artifact') {
            throw new Error(`Node ${sourceNodeId} is an artifact and cannot be promoted as an insight.`);
        }

        const branch = options.branch === undefined
            ? this.extractTagValue(sourceNode.tags, 'branch:')
            : (options.branch ?? null);
        const worktreePath = options.worktreePath === undefined
            ? this.extractTagValue(sourceNode.tags, 'worktree:')
            : (options.worktreePath ?? null);
        const type = sourceNode.type as Exclude<NodeType, 'artifact'>;
        const key = this.buildKnowledgeKey(targetContextId, type, sourceNode.content, {
            branch,
            worktreePath
        });
        const existing = this.getByKey(targetContextId, key, { includeHidden: true });
        if (existing) {
            return {
                sourceContextId,
                targetContextId,
                sourceNodeId,
                targetNodeId: existing.id,
                type,
                content: sourceNode.content,
                branch,
                worktreePath,
                key,
                created: false,
                reused: true
            };
        }

        const promoted = this.addNode({
            contextId: targetContextId,
            type,
            content: sourceNode.content,
            key,
            tags: this.sanitizePromotedInsightTags(sourceNode.tags, sourceContextId, sourceNodeId, branch, worktreePath),
            source: 'promote:workspace',
            hidden: false
        });

        return {
            sourceContextId,
            targetContextId,
            sourceNodeId,
            targetNodeId: promoted.id,
            type,
            content: sourceNode.content,
            branch,
            worktreePath,
            key,
            created: true,
            reused: false
        };
    }
    private collectSessionKnowledgeCandidates(
        contextId: string,
        sessionId: string,
        options: {
            checkpointId?: string | null;
            maxNodes?: number;
            source?: 'session' | 'checkpoint';
            allowedKeys?: string[] | null;
            minConfidence?: number;
        } = {}
    ): {
        session: AgentSessionSummary | null;
        source: 'session' | 'checkpoint';
        checkpointId: string | null;
        candidates: Array<KnowledgeCandidate & { existingNode: ContextNode | null }>;
    } {
        const detail = this.getSessionDetail(contextId, sessionId);
        const session = detail.session;
        const safeLimit = Math.max(1, Math.min(options.maxNodes ?? 12, 50));
        const source = options.source ?? 'session';
        const checkpointId = options.checkpointId ?? null;
        const minConfidence = Math.max(0, Math.min(options.minConfidence ?? 0.55, 1));
        const allowedKeys = Array.isArray(options.allowedKeys)
            ? new Set(options.allowedKeys.map((value) => String(value || '').trim()).filter(Boolean))
            : null;
        const candidates: Array<KnowledgeCandidate & { existingNode: ContextNode | null }> = [];

        if (!session) {
            return { session: null, source, checkpointId, candidates };
        }

        const aggregated = new Map<string, {
            type: Exclude<NodeType, 'artifact'>;
            content: string;
            key: string;
            sourceNodeId: string | null;
            messageId: string | null;
            role: string | null;
            createdAt: number;
            bestConfidence: number;
            bestReason: string;
            evidenceCount: number;
            distinctEvidenceKeys: Set<string>;
            roles: Set<string>;
            evidencePreview: string[];
        }>();

        for (const message of detail.messages) {
            const extracted = splitExtractionCandidates(message.content);
            for (const candidateText of extracted) {
                const classified = scoreKnowledgeCandidate(candidateText, message.role);
                if (!classified) continue;
                const type = classified.type;
                const canonicalText = canonicalizeKnowledgeCandidateText(type, candidateText) || candidateText.toLowerCase();
                const dedupeKey = `${type}:${canonicalText}`;
                const key = this.buildKnowledgeKey(contextId, type, candidateText, {
                    branch: session.branch,
                    worktreePath: session.worktreePath
                });
                if (allowedKeys && !allowedKeys.has(key)) continue;
                const excerpt = sourceExcerpt(message.content);
                const distinctEvidenceKey = `${(message.role ?? 'unknown').toLowerCase()}:${excerpt || canonicalText}`;

                const existing = aggregated.get(dedupeKey);
                if (!existing) {
                    aggregated.set(dedupeKey, {
                        type,
                        content: candidateText,
                        key,
                        sourceNodeId: message.nodeId ?? null,
                        messageId: message.messageId ?? null,
                        role: message.role ?? null,
                        createdAt: message.createdAt,
                        bestConfidence: classified.confidence,
                        bestReason: classified.reason,
                        evidenceCount: 1,
                        distinctEvidenceKeys: new Set([distinctEvidenceKey]),
                        roles: new Set((message.role ?? '').trim() ? [(message.role ?? '').toLowerCase()] : []),
                        evidencePreview: excerpt ? [excerpt] : []
                    });
                    continue;
                }

                existing.evidenceCount += 1;
                existing.distinctEvidenceKeys.add(distinctEvidenceKey);
                if ((message.role ?? '').trim()) existing.roles.add((message.role ?? '').toLowerCase());
                if (excerpt && !existing.evidencePreview.includes(excerpt) && existing.evidencePreview.length < 2) {
                    existing.evidencePreview.push(excerpt);
                }
                if (classified.confidence > existing.bestConfidence) {
                    existing.bestConfidence = classified.confidence;
                    existing.bestReason = classified.reason;
                    existing.sourceNodeId = message.nodeId ?? null;
                    existing.messageId = message.messageId ?? null;
                    existing.role = message.role ?? null;
                    existing.createdAt = message.createdAt;
                }
            }
        }

        const ranked = Array.from(aggregated.values())
            .map((candidate) => {
                const distinctEvidenceCount = candidate.distinctEvidenceKeys.size;
                const confidence = this.boostKnowledgeCandidateConfidence(candidate.type, candidate.bestConfidence, candidate.evidenceCount, distinctEvidenceCount, candidate.roles);
                const existingNode = this.getByKey(contextId, candidate.key, { includeHidden: true });
                const review = this.classifyKnowledgeReviewTier(candidate.type, confidence, candidate.evidenceCount, distinctEvidenceCount, candidate.roles);
                const evidenceSummary = this.buildKnowledgeEvidenceSummary(candidate.evidenceCount, distinctEvidenceCount, candidate.roles);
                return {
                    contextId,
                    source,
                    sessionId,
                    checkpointId,
                    type: candidate.type,
                    content: candidate.content,
                    key: candidate.key,
                    action: (existingNode ? 'reuse' : 'create') as KnowledgeCandidate['action'],
                    existingNodeId: existingNode?.id ?? null,
                    sourceNodeId: candidate.sourceNodeId,
                    messageId: candidate.messageId,
                    role: candidate.role,
                    createdAt: candidate.createdAt,
                    confidence,
                    reason: this.buildKnowledgeEvidenceReason(candidate.bestReason, candidate.evidenceCount, distinctEvidenceCount, candidate.roles),
                    evidenceCount: candidate.evidenceCount,
                    distinctEvidenceCount,
                    evidenceSummary,
                    sourceExcerpt: candidate.evidencePreview[0] ?? null,
                    evidencePreview: candidate.evidencePreview,
                    corroboratedRoles: Array.from(candidate.roles),
                    reviewTier: review.reviewTier,
                    reviewSummary: review.reviewSummary,
                    existingNode
                };
            })
            .filter((candidate) => candidate.confidence >= minConfidence)
            .sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0) || (right.evidenceCount ?? 0) - (left.evidenceCount ?? 0) || right.createdAt - left.createdAt)
            .slice(0, safeLimit);

        candidates.push(...ranked);
        return { session, source, checkpointId, candidates };
    }

    previewKnowledgeFromSession(
        contextId: string,
        sessionId: string,
        options: { checkpointId?: string | null; maxNodes?: number; source?: 'session' | 'checkpoint'; minConfidence?: number } = {}
    ): KnowledgePreviewResult {
        const { source, checkpointId, candidates } = this.collectSessionKnowledgeCandidates(contextId, sessionId, options);
        const createCount = candidates.filter((candidate) => candidate.action === 'create').length;
        const reuseCount = candidates.length - createCount;
        return {
            contextId,
            source,
            sessionId,
            checkpointId,
            candidateCount: candidates.length,
            createCount,
            reuseCount,
            candidates: candidates.map(({ existingNode, ...candidate }) => candidate)
        };
    }

    extractKnowledgeFromSession(
        contextId: string,
        sessionId: string,
        options: {
            checkpointId?: string | null;
            maxNodes?: number;
            source?: 'session' | 'checkpoint';
            allowedKeys?: string[] | null;
            minConfidence?: number;
        } = {}
    ): KnowledgeExtractionResult {
        const extractionOptions = options.minConfidence == null
            ? { ...options, minConfidence: 0.7 }
            : options;
        const { session, source, checkpointId, candidates } = this.collectSessionKnowledgeCandidates(contextId, sessionId, extractionOptions);
        const resultNodes: ContextNode[] = [];
        const resultIds = new Set<string>();
        let createdCount = 0;
        let reusedCount = 0;

        if (!session) {
            return {
                contextId,
                source,
                sessionId,
                checkpointId,
                createdCount: 0,
                reusedCount: 0,
                nodeCount: 0,
                nodes: []
            };
        }

        const baseTags = [
            'knowledge',
            'derived',
            `session:${sessionId}`,
            session.agent ? `agent:${session.agent}` : null,
            session.branch ? `branch:${session.branch}` : null,
            session.worktreePath ? `worktree:${session.worktreePath}` : null,
            checkpointId ? `checkpoint:${checkpointId}` : null
        ].filter((value): value is string => Boolean(value));

        for (const candidate of candidates) {
            let node = candidate.existingNode;
            if (!node) {
                node = this.addNode({
                    contextId,
                    thread: sessionId,
                    type: candidate.type,
                    content: candidate.content,
                    key: candidate.key,
                    tags: [...baseTags, `source:${source}`],
                    source: `extractor:${source}`,
                    hidden: false,
                    checkpointId: checkpointId ?? undefined,
                    createdAtOverride: candidate.createdAt
                });
                createdCount += 1;
            } else {
                reusedCount += 1;
            }

            if (candidate.sourceNodeId) {
                this.ensureEdge(node.id, candidate.sourceNodeId, 'caused_by');
            }
            if (!resultIds.has(node.id)) {
                resultIds.add(node.id);
                resultNodes.push(node);
            }
        }

        return {
            contextId,
            source,
            sessionId,
            checkpointId,
            createdCount,
            reusedCount,
            nodeCount: resultNodes.length,
            nodes: resultNodes
        };
    }

    previewKnowledgeFromCheckpoint(
        checkpointId: string,
        options: { maxNodes?: number; minConfidence?: number } = {}
    ): KnowledgePreviewResult {
        const row = this.db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(checkpointId) as any;
        if (!row) {
            throw new Error(`Checkpoint ${checkpointId} not found`);
        }
        const checkpoint = this.parseCheckpointRow(row);
        if (checkpoint.sessionId) {
            return this.previewKnowledgeFromSession(checkpoint.contextId, checkpoint.sessionId, {
                checkpointId,
                maxNodes: options.maxNodes,
                minConfidence: options.minConfidence,
                source: 'checkpoint'
            });
        }

        const summary = cleanupExtractionText(checkpoint.summary ?? checkpoint.name ?? '');
        const classified = scoreKnowledgeCandidate(summary, 'assistant');
        if (!summary || !classified || classified.confidence < (options.minConfidence ?? 0.55)) {
            return {
                contextId: checkpoint.contextId,
                source: 'checkpoint',
                sessionId: null,
                checkpointId,
                candidateCount: 0,
                createCount: 0,
                reuseCount: 0,
                candidates: []
            };
        }

        const type = classified.type;
        const key = this.buildKnowledgeKey(checkpoint.contextId, type, summary, {
            branch: checkpoint.branch,
            worktreePath: checkpoint.worktreePath
        });
        const existingNode = this.getByKey(checkpoint.contextId, key, { includeHidden: true });
        const roles = new Set<string>(['assistant']);
        const review = this.classifyKnowledgeReviewTier(classified.type, classified.confidence, 1, 1, roles);
        return {
            contextId: checkpoint.contextId,
            source: 'checkpoint',
            sessionId: null,
            checkpointId,
            candidateCount: 1,
            createCount: existingNode ? 0 : 1,
            reuseCount: existingNode ? 1 : 0,
            candidates: [{
                contextId: checkpoint.contextId,
                source: 'checkpoint',
                sessionId: null,
                checkpointId,
                type,
                content: summary,
                key,
                action: existingNode ? 'reuse' : 'create',
                existingNodeId: existingNode?.id ?? null,
                sourceNodeId: null,
                messageId: null,
                role: 'assistant',
                createdAt: checkpoint.createdAt,
                confidence: classified.confidence,
                reason: classified.reason,
                evidenceCount: 1,
                distinctEvidenceCount: 1,
                evidenceSummary: this.buildKnowledgeEvidenceSummary(1, 1, roles),
                corroboratedRoles: ['assistant'],
                reviewTier: review.reviewTier,
                reviewSummary: review.reviewSummary
            }]
        };
    }

    extractKnowledgeFromCheckpoint(
        checkpointId: string,
        options: { maxNodes?: number; allowedKeys?: string[] | null; minConfidence?: number } = {}
    ): KnowledgeExtractionResult {
        const row = this.db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(checkpointId) as any;
        if (!row) {
            throw new Error(`Checkpoint ${checkpointId} not found`);
        }
        const checkpoint = this.parseCheckpointRow(row);
        if (checkpoint.sessionId) {
            return this.extractKnowledgeFromSession(checkpoint.contextId, checkpoint.sessionId, {
                checkpointId,
                maxNodes: options.maxNodes,
                source: 'checkpoint',
                allowedKeys: options.allowedKeys,
                minConfidence: options.minConfidence
            });
        }

        const preview = this.previewKnowledgeFromCheckpoint(checkpointId, options);
        if (preview.candidates.length === 0) {
            return {
                contextId: checkpoint.contextId,
                source: 'checkpoint',
                sessionId: null,
                checkpointId,
                createdCount: 0,
                reusedCount: 0,
                nodeCount: 0,
                nodes: []
            };
        }

        const candidate = preview.candidates[0];
        if (Array.isArray(options.allowedKeys) && options.allowedKeys.length > 0 && !options.allowedKeys.includes(candidate.key)) {
            return {
                contextId: checkpoint.contextId,
                source: 'checkpoint',
                sessionId: null,
                checkpointId,
                createdCount: 0,
                reusedCount: 0,
                nodeCount: 0,
                nodes: []
            };
        }
        let node = candidate.existingNodeId ? this.getNode(candidate.existingNodeId) : null;
        let createdCount = 0;
        let reusedCount = 0;
        if (!node) {
            node = this.addNode({
                contextId: checkpoint.contextId,
                type: candidate.type,
                content: candidate.content,
                key: candidate.key,
                tags: [
                    'knowledge',
                    'derived',
                    'source:checkpoint',
                    `checkpoint:${checkpointId}`,
                    checkpoint.branch ? `branch:${checkpoint.branch}` : null,
                    checkpoint.worktreePath ? `worktree:${checkpoint.worktreePath}` : null
                ].filter((value): value is string => Boolean(value)),
                source: 'extractor:checkpoint',
                hidden: false,
                checkpointId,
                createdAtOverride: candidate.createdAt
            });
            createdCount = 1;
        } else {
            reusedCount = 1;
        }

        return {
            contextId: checkpoint.contextId,
            source: 'checkpoint',
            sessionId: null,
            checkpointId,
            createdCount,
            reusedCount,
            nodeCount: 1,
            nodes: [node]
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
        const auditSecret = this.resolveAuditSecret();
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
        const auditSecret = this.resolveAuditSecret();

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
            .map(row => this.parseNodeRow(row));

        const nodeIds = nodes.map(node => node.id);
        const idPlaceholders = nodeIds.map(() => '?').join(', ');

        const nodePayloads = nodeIds
            .map(nodeId => this.getNodePayload(nodeId))
            .filter((payload): payload is NodePayloadRecord => Boolean(payload));

        const edges = nodeIds.length === 0
            ? []
            : this.db.prepare(`
          SELECT * FROM edges
          WHERE fromId IN (${idPlaceholders}) OR toId IN (${idPlaceholders})
          ORDER BY createdAt ASC
        `).all(...nodeIds, ...nodeIds) as ContextEdge[];

        const checkpoints = this.listCheckpoints(contextId);
        const checkpointPayloads = checkpoints
            .map(checkpoint => this.getCheckpointPayload(checkpoint.id))
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
        const checkpointIdMap = new Map<string, string>();

        const insertNode = this.db.prepare(`
      INSERT INTO nodes (id, contextId, thread, type, content, key, tags, source, hidden, createdAt, checkpointId)
      VALUES (@id, @contextId, @thread, @type, @content, @key, @tags, @source, @hidden, @createdAt, @checkpointId)
    `);

        const insertNodeFts = this.db.prepare(`
      INSERT INTO nodes_fts (id, content, tags) VALUES (?, ?, ?)
    `);

        const insertEdge = this.db.prepare(`
      INSERT INTO edges (id, fromId, toId, relation, createdAt)
      VALUES (@id, @fromId, @toId, @relation, @createdAt)
    `);

        const insertCheckpoint = this.db.prepare(`
      INSERT INTO checkpoints (id, contextId, name, nodeIds, kind, sessionId, branch, worktreePath, commitSha, summary, agentSet, createdAt)
      VALUES (@id, @contextId, @name, @nodeIds, @kind, @sessionId, @branch, @worktreePath, @commitSha, @summary, @agentSet, @createdAt)
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

            if (Array.isArray(dump.nodePayloads)) {
                for (const payload of dump.nodePayloads) {
                    const mappedNodeId = nodeIdMap.get(payload.nodeId);
                    if (!mappedNodeId) continue;
                    this.setNodePayload(
                        mappedNodeId,
                        context.id,
                        payload.payload,
                        {
                            contentType: payload.contentType,
                            compression: payload.compression,
                            createdAt: payload.createdAt,
                            updatedAt: payload.updatedAt
                        }
                    );
                }
            }

            if (Array.isArray(dump.checkpointPayloads)) {
                for (const payload of dump.checkpointPayloads) {
                    const mappedCheckpointId = checkpointIdMap.get(payload.checkpointId);
                    if (!mappedCheckpointId) continue;
                    this.setCheckpointPayload(
                        mappedCheckpointId,
                        context.id,
                        payload.payload,
                        {
                            contentType: payload.contentType,
                            compression: payload.compression,
                            createdAt: payload.createdAt,
                            updatedAt: payload.updatedAt
                        }
                    );
                }
            }
        });

        tx();
        this.refreshBranchLaneProjection(context.id);
        return context;
    }

    // ── Checkpoints ────────────────────────────────────────────────
    private insertCheckpoint(checkpoint: Checkpoint): void {
        this.db.prepare(`
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

    private replaceContextFromDump(contextId: string, dump: ContextDump): void {
        const tx = this.db.transaction(() => {
            if (this.getContext(contextId)) {
                this.deleteContext(contextId);
            }

            const syncPolicy: SyncPolicy =
                dump.context.syncPolicy === 'local_only'
                    || dump.context.syncPolicy === 'metadata_only'
                    || dump.context.syncPolicy === 'full_sync'
                    ? dump.context.syncPolicy
                    : 'metadata_only';

            this.db.prepare(`
        INSERT INTO contexts (id, name, paths, syncPolicy, createdAt)
        VALUES (@id, @name, @paths, @syncPolicy, @createdAt)
      `).run({
                id: contextId,
                name: dump.context.name,
                paths: JSON.stringify(dump.context.paths ?? []),
                syncPolicy,
                createdAt: dump.context.createdAt
            });

            const insertNode = this.db.prepare(`
        INSERT INTO nodes (id, contextId, thread, type, content, key, tags, source, hidden, createdAt, checkpointId)
        VALUES (@id, @contextId, @thread, @type, @content, @key, @tags, @source, @hidden, @createdAt, @checkpointId)
      `);
            const insertNodeFts = this.db.prepare(`
        INSERT INTO nodes_fts (id, content, tags) VALUES (?, ?, ?)
      `);
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

            const insertEdge = this.db.prepare(`
        INSERT INTO edges (id, fromId, toId, relation, createdAt)
        VALUES (@id, @fromId, @toId, @relation, @createdAt)
      `);
            for (const edge of dump.edges) {
                if (!nodeIds.has(edge.fromId) || !nodeIds.has(edge.toId)) continue;
                insertEdge.run(edge);
            }

            for (const checkpoint of dump.checkpoints) {
                const checkpointNodeIds = Array.isArray(checkpoint.nodeIds)
                    ? checkpoint.nodeIds.filter((nodeId): nodeId is string => typeof nodeId === 'string' && nodeIds.has(nodeId))
                    : [];
                this.insertCheckpoint({
                    ...checkpoint,
                    contextId,
                    nodeIds: checkpointNodeIds,
                    kind: checkpoint.kind ?? 'legacy',
                    agentSet: checkpoint.agentSet ?? []
                });
            }

            for (const payload of dump.nodePayloads ?? []) {
                if (!nodeIds.has(payload.nodeId)) continue;
                this.setNodePayload(payload.nodeId, contextId, payload.payload, {
                    contentType: payload.contentType,
                    compression: payload.compression,
                    createdAt: payload.createdAt,
                    updatedAt: payload.updatedAt
                });
            }

            const checkpointIds = new Set(dump.checkpoints.map(checkpoint => checkpoint.id));
            for (const payload of dump.checkpointPayloads ?? []) {
                if (!checkpointIds.has(payload.checkpointId)) continue;
                this.setCheckpointPayload(payload.checkpointId, contextId, payload.payload, {
                    contentType: payload.contentType,
                    compression: payload.compression,
                    createdAt: payload.createdAt,
                    updatedAt: payload.updatedAt
                });
            }
        });

        tx();
        this.refreshBranchLaneProjection(contextId);
    }

    saveCheckpoint(contextId: string, name: string): Checkpoint {
        const nodeIds = (this.db.prepare(
            'SELECT id FROM nodes WHERE contextId = ?'
        ).all(contextId) as any[]).map(r => r.id);

        const cp: Checkpoint = {
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
        this.insertCheckpoint(cp);
        const snapshot = this.exportContextDump(contextId);
        this.setCheckpointPayload(cp.id, contextId, snapshot, {
            createdAt: cp.createdAt,
            updatedAt: cp.createdAt
        });
        this.refreshBranchLaneProjection(contextId);
        return this.getCheckpointDetail(cp.id)?.checkpoint ?? cp;
    }

    createSessionCheckpoint(
        contextId: string,
        sessionId: string,
        options: {
            name?: string;
            summary?: string;
            kind?: CheckpointKind;
        } = {}
    ): Checkpoint {
        const session = (this.listChatSessions(contextId, 5000) as AgentSessionSummary[]).find((entry) => entry.sessionId === sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const nodeIds = (this.db.prepare('SELECT id FROM nodes WHERE contextId = ?').all(contextId) as any[]).map(r => r.id);
        const checkpoint: Checkpoint = {
            id: randomUUID(),
            contextId,
            name: options.name ?? `${session.agent ?? 'agent'} ${this.normalizeBranch(session.branch)} checkpoint`,
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
        this.insertCheckpoint(checkpoint);
        const snapshot = this.exportContextDump(contextId);
        this.setCheckpointPayload(checkpoint.id, contextId, snapshot, {
            createdAt: checkpoint.createdAt,
            updatedAt: checkpoint.createdAt
        });
        this.refreshBranchLaneProjection(contextId);
        return this.getCheckpointDetail(checkpoint.id)?.checkpoint ?? checkpoint;
    }

    rewind(checkpointId: string): void {
        this.rewindCheckpoint(checkpointId);
    }

    rewindCheckpoint(checkpointId: string): CheckpointDetail {
        const payload = this.getCheckpointPayload(checkpointId);
        if (!payload) {
            throw new Error(`Checkpoint ${checkpointId} has no snapshot payload`);
        }
        const detail = this.getCheckpointDetail(checkpointId);
        if (!detail) {
            throw new Error(`Checkpoint ${checkpointId} not found`);
        }
        const dump = payload.payload as ContextDump;
        this.replaceContextFromDump(detail.checkpoint.contextId, dump);
        this.setCheckpointPayload(checkpointId, detail.checkpoint.contextId, dump, {
            contentType: payload.contentType,
            compression: payload.compression,
            createdAt: payload.createdAt,
            updatedAt: Date.now()
        });
        return this.getCheckpointDetail(checkpointId)!;
    }

    resumeSession(contextId: string, sessionId: string): SessionDetail {
        return this.getSessionDetail(contextId, sessionId);
    }

    explainCheckpoint(checkpointId: string): CheckpointDetail | null {
        return this.getCheckpointDetail(checkpointId);
    }

    listCheckpoints(contextId: string): Checkpoint[] {
        return (this.db.prepare(
            'SELECT * FROM checkpoints WHERE contextId = ? ORDER BY createdAt DESC'
        ).all(contextId) as any[]).map(r => this.parseCheckpointRow(r));
    }
}
