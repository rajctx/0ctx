import type Database from 'better-sqlite3';
import type {
    ContextNode,
    InsightPromotionResult,
    InsightSummary,
    NodeType
} from '../schema';
import { sourceExcerpt } from '../knowledge-scoring';

type AddNodeInput = Omit<ContextNode, 'id' | 'createdAt'> & {
    rawPayload?: unknown;
    payloadContentType?: string;
    createdAtOverride?: number;
};

type InsightDeps = {
    db: Database.Database;
    getNode: (id: string) => ContextNode | null;
    getByKey: (contextId: string, key: string, options?: { includeHidden?: boolean }) => ContextNode | null;
    addNode: (params: AddNodeInput) => ContextNode;
    extractTagValue: (tags: string[] | null | undefined, prefix: string) => string | null;
    normalizeBranch: (branch: string | null | undefined) => string;
    normalizeWorktreePath: (worktreePath: string | null | undefined) => string;
    buildKnowledgeKey: (
        contextId: string,
        type: Exclude<NodeType, 'artifact'>,
        content: string,
        options?: { branch?: string | null; worktreePath?: string | null }
    ) => string;
    sanitizePromotedInsightTags: (
        tags: string[] | null | undefined,
        sourceContextId: string,
        sourceNodeId: string,
        branch: string | null,
        worktreePath: string | null
    ) => string[];
    boostKnowledgeCandidateConfidence: (
        type: Exclude<NodeType, 'artifact'> | null | undefined,
        baseConfidence: number,
        evidenceCount: number,
        distinctEvidenceCount: number,
        roles: Set<string>
    ) => number;
    classifyKnowledgeReviewTier: (
        type: Exclude<NodeType, 'artifact'> | null | undefined,
        confidence: number,
        evidenceCount: number,
        distinctEvidenceCount: number,
        roles: Set<string>
    ) => { reviewTier: 'strong' | 'review' | 'weak'; reviewSummary: string };
    buildKnowledgeEvidenceSummary: (
        evidenceCount: number,
        distinctEvidenceCount: number,
        roles: Set<string>
    ) => string;
};

function getInsightEvidence(deps: InsightDeps, nodeId: string) {
    const insight = deps.getNode(nodeId);
    const insightType = insight?.type && insight.type !== 'artifact' ? insight.type : undefined;
    const edges = deps.db.prepare(`
      SELECT toId
      FROM edges
      WHERE fromId = ? AND relation = 'caused_by'
    `).all(nodeId) as Array<{ toId: string }>;

    const roles = new Set<string>();
    const distinctEvidence = new Set<string>();
    let latestEvidenceAt: number | null = null;
    let evidenceCount = 0;

    for (const edge of edges) {
        const sourceNode = deps.getNode(edge.toId);
        if (!sourceNode) continue;
        evidenceCount += 1;
        if (latestEvidenceAt === null || sourceNode.createdAt > latestEvidenceAt) {
            latestEvidenceAt = sourceNode.createdAt;
        }
        const role = deps.extractTagValue(sourceNode.tags, 'role:');
        if (role) roles.add(role);
        const excerpt = sourceExcerpt(sourceNode.content);
        distinctEvidence.add(`${(role ?? 'unknown').toLowerCase()}:${excerpt || sourceNode.id}`);
    }

    const distinctEvidenceCount = distinctEvidence.size;
    if (evidenceCount === 0) {
        return {
            evidenceCount: 0,
            distinctEvidenceCount: 0,
            corroboratedRoles: [],
            latestEvidenceAt: null,
            trustTier: 'weak' as const,
            trustSummary: 'No linked evidence messages yet.'
        };
    }

    const confidence = deps.boostKnowledgeCandidateConfidence(insightType, 0.72, evidenceCount, distinctEvidenceCount, roles);
    const review = deps.classifyKnowledgeReviewTier(insightType, confidence, evidenceCount, distinctEvidenceCount, roles);
    return {
        evidenceCount,
        distinctEvidenceCount,
        corroboratedRoles: Array.from(roles).sort(),
        latestEvidenceAt,
        trustTier: review.reviewTier,
        trustSummary: `${review.reviewSummary} ${deps.buildKnowledgeEvidenceSummary(evidenceCount, distinctEvidenceCount, roles)}`.trim()
    };
}

export function listWorkstreamInsightsRecord(
    deps: InsightDeps,
    contextId: string,
    options: { branch?: string | null; worktreePath?: string | null; limit?: number } = {}
): InsightSummary[] {
    const safeLimit = Math.max(1, Math.min(options.limit ?? 25, 500));
    const targetBranch = deps.normalizeBranch(options.branch);
    const targetWorktree = deps.normalizeWorktreePath(options.worktreePath);
    const rows = deps.db.prepare(`
      SELECT id
      FROM nodes
      WHERE contextId = ? AND hidden = 0 AND type != 'artifact'
      ORDER BY createdAt DESC
      LIMIT ?
    `).all(contextId, Math.max(safeLimit * 8, safeLimit)) as Array<{ id: string }>;

    const results: InsightSummary[] = [];
    for (const row of rows) {
        const node = deps.getNode(row.id);
        if (!node) continue;

        const branch = deps.extractTagValue(node.tags, 'branch:');
        const worktreePath = deps.extractTagValue(node.tags, 'worktree:');
        if (targetWorktree) {
            if (deps.normalizeWorktreePath(worktreePath) !== targetWorktree) continue;
        } else if (options.branch && deps.normalizeBranch(branch) !== targetBranch) {
            continue;
        }

        const originContextId = deps.extractTagValue(node.tags, 'origin_context:');
        const originNodeId = deps.extractTagValue(node.tags, 'origin_node:');
        const evidence = getInsightEvidence(deps, node.id);
        const promotedWithoutLocalEvidence = evidence.evidenceCount === 0 && (originContextId || originNodeId);

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
            trustTier: promotedWithoutLocalEvidence ? 'review' : evidence.trustTier,
            trustSummary: promotedWithoutLocalEvidence
                ? 'Promoted from another workspace. No local corroboration yet.'
                : evidence.trustSummary,
            originContextId: originContextId ?? null,
            originNodeId: originNodeId ?? null
        });

        if (results.length >= safeLimit) break;
    }

    return results;
}

export function promoteInsightNodeRecord(
    deps: InsightDeps,
    sourceContextId: string,
    sourceNodeId: string,
    targetContextId: string,
    options: { branch?: string | null; worktreePath?: string | null } = {}
): InsightPromotionResult {
    const sourceNode = deps.getNode(sourceNodeId);
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
        ? deps.extractTagValue(sourceNode.tags, 'branch:')
        : (options.branch ?? null);
    const worktreePath = options.worktreePath === undefined
        ? deps.extractTagValue(sourceNode.tags, 'worktree:')
        : (options.worktreePath ?? null);
    const type = sourceNode.type as Exclude<NodeType, 'artifact'>;
    const key = deps.buildKnowledgeKey(targetContextId, type, sourceNode.content, { branch, worktreePath });
    const existing = deps.getByKey(targetContextId, key, { includeHidden: true });
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

    const promoted = deps.addNode({
        contextId: targetContextId,
        type,
        content: sourceNode.content,
        key,
        tags: deps.sanitizePromotedInsightTags(sourceNode.tags, sourceContextId, sourceNodeId, branch, worktreePath),
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
