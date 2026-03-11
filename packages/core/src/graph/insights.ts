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
        roles: Set<string>,
        options?: {
            distinctSessionCount?: number;
        }
    ) => { reviewTier: 'strong' | 'review' | 'weak'; reviewSummary: string };
    buildKnowledgeEvidenceSummary: (
        evidenceCount: number,
        distinctEvidenceCount: number,
        roles: Set<string>,
        options?: {
            distinctSessionCount?: number;
        }
    ) => string;
    buildKnowledgeTrustFlags: (
        evidenceCount: number,
        distinctEvidenceCount: number,
        roles: Set<string>,
        options?: {
            promoted?: boolean;
            noLocalEvidence?: boolean;
            distinctSessionCount?: number;
        }
    ) => string[];
};

function describeInsightPromotionState(input: {
    trustTier: 'strong' | 'review' | 'weak';
    evidenceCount: number;
    distinctEvidenceCount: number;
    distinctSessionCount: number;
    originContextId: string | null;
    originNodeId: string | null;
}): {
    promotionState: 'ready' | 'review' | 'blocked';
    promotionSummary: string;
} {
    const importedWithoutLocalEvidence = input.evidenceCount === 0 && (input.originContextId || input.originNodeId);
    if (importedWithoutLocalEvidence) {
        return {
            promotionState: 'blocked',
            promotionSummary: 'Blocked: promoted insight has no local corroboration yet. Reconfirm it in this workspace before promoting it onward.'
        };
    }
    if (input.trustTier === 'weak') {
        return {
            promotionState: 'blocked',
            promotionSummary: 'Blocked: weak insight candidates need more corroboration before they can be promoted.'
        };
    }
    if (input.distinctSessionCount <= 1 && input.evidenceCount > 1) {
        return {
            promotionState: 'review',
            promotionSummary: 'Review before promoting: corroboration comes from a single session. Reconfirm it in another run before using it across workspaces.'
        };
    }
    if (input.trustTier === 'review') {
        const evidenceLabel = input.distinctSessionCount > 1
            ? `${input.distinctSessionCount} corroborating sessions`
            : input.distinctEvidenceCount > 1
                ? `${input.distinctEvidenceCount} distinct supporting statements`
                : `${Math.max(input.evidenceCount, 1)} supporting mention`;
        return {
            promotionState: 'review',
            promotionSummary: `Review before promoting: ${evidenceLabel}. This insight is usable, but still needs human judgment.`
        };
    }
    return {
        promotionState: 'ready',
        promotionSummary: input.distinctSessionCount > 1
            ? `Ready to promote: corroborated across ${input.distinctSessionCount} sessions with enough evidence to move across workspaces.`
            : 'Ready to promote: corroborated insight with enough evidence to move across workspaces.'
    };
}

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
    const distinctSessions = new Set<string>();
    const evidencePreview: string[] = [];
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
        if (excerpt && !evidencePreview.includes(excerpt) && evidencePreview.length < 3) {
            evidencePreview.push(excerpt);
        }
        if (typeof sourceNode.thread === 'string' && sourceNode.thread.trim().length > 0) {
            distinctSessions.add(sourceNode.thread.trim());
        }
    }

    const distinctEvidenceCount = distinctEvidence.size;
    const distinctSessionCount = distinctSessions.size > 0 ? distinctSessions.size : (evidenceCount > 0 ? 1 : 0);
    if (evidenceCount === 0) {
        return {
            evidenceCount: 0,
            distinctEvidenceCount: 0,
            distinctSessionCount: 0,
            corroboratedRoles: [],
            trustFlags: [],
            latestEvidenceAt: null,
            evidencePreview: [],
            trustTier: 'weak' as const,
            trustSummary: 'No linked evidence messages yet.'
        };
    }

    const confidence = deps.boostKnowledgeCandidateConfidence(insightType, 0.72, evidenceCount, distinctEvidenceCount, roles);
    const review = deps.classifyKnowledgeReviewTier(insightType, confidence, evidenceCount, distinctEvidenceCount, roles, {
        distinctSessionCount
    });
    return {
        evidenceCount,
        distinctEvidenceCount,
        distinctSessionCount,
        corroboratedRoles: Array.from(roles).sort(),
        trustFlags: deps.buildKnowledgeTrustFlags(evidenceCount, distinctEvidenceCount, roles, {
            distinctSessionCount
        }),
        latestEvidenceAt,
        evidencePreview,
        trustTier: review.reviewTier,
        trustSummary: `${review.reviewSummary} ${deps.buildKnowledgeEvidenceSummary(evidenceCount, distinctEvidenceCount, roles, {
            distinctSessionCount
        })}`.trim()
    };
}

function buildInsightSummaryRecord(
    deps: InsightDeps,
    contextId: string,
    node: ContextNode
): InsightSummary {
    const branch = deps.extractTagValue(node.tags, 'branch:');
    const worktreePath = deps.extractTagValue(node.tags, 'worktree:');
    const originContextId = deps.extractTagValue(node.tags, 'origin_context:');
    const originNodeId = deps.extractTagValue(node.tags, 'origin_node:');
    const evidence = getInsightEvidence(deps, node.id);
    const promotedWithoutLocalEvidence = evidence.evidenceCount === 0 && (originContextId || originNodeId);
    const trustFlags = promotedWithoutLocalEvidence
        ? deps.buildKnowledgeTrustFlags(
            evidence.evidenceCount,
            evidence.distinctEvidenceCount,
            new Set(evidence.corroboratedRoles),
            { promoted: true, noLocalEvidence: true, distinctSessionCount: evidence.distinctSessionCount }
        )
        : deps.buildKnowledgeTrustFlags(
            evidence.evidenceCount,
            evidence.distinctEvidenceCount,
            new Set(evidence.corroboratedRoles),
            { promoted: Boolean(originContextId || originNodeId), distinctSessionCount: evidence.distinctSessionCount }
        );
    const promotion = describeInsightPromotionState({
        trustTier: promotedWithoutLocalEvidence ? 'review' : evidence.trustTier,
        evidenceCount: evidence.evidenceCount,
        distinctEvidenceCount: evidence.distinctEvidenceCount,
        distinctSessionCount: evidence.distinctSessionCount,
        originContextId: originContextId ?? null,
        originNodeId: originNodeId ?? null
    });

    return {
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
        distinctSessionCount: evidence.distinctSessionCount,
        corroboratedRoles: evidence.corroboratedRoles,
        trustFlags,
        latestEvidenceAt: evidence.latestEvidenceAt,
        evidencePreview: evidence.evidencePreview,
        trustTier: promotedWithoutLocalEvidence ? 'review' : evidence.trustTier,
        trustSummary: promotedWithoutLocalEvidence
            ? 'Promoted from another workspace. No local corroboration yet.'
            : evidence.trustSummary,
        promotionState: promotion.promotionState,
        promotionSummary: promotion.promotionSummary,
        originContextId: originContextId ?? null,
        originNodeId: originNodeId ?? null
    };
}

export function getInsightSummaryRecord(
    deps: InsightDeps,
    nodeId: string
): InsightSummary | null {
    const node = deps.getNode(nodeId);
    if (!node || node.hidden || node.type === 'artifact') return null;
    return buildInsightSummaryRecord(deps, node.contextId, node);
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

        results.push(buildInsightSummaryRecord(deps, contextId, node));

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
    const sourceOriginContextId = deps.extractTagValue(sourceNode.tags, 'origin_context:') ?? null;
    const sourceOriginNodeId = deps.extractTagValue(sourceNode.tags, 'origin_node:') ?? null;
    const sourceEvidence = getInsightEvidence(deps, sourceNode.id);
    const sourcePromotion = describeInsightPromotionState({
        trustTier: sourceEvidence.evidenceCount === 0 && (sourceOriginContextId || sourceOriginNodeId)
            ? 'review'
            : sourceEvidence.trustTier,
        evidenceCount: sourceEvidence.evidenceCount,
        distinctEvidenceCount: sourceEvidence.distinctEvidenceCount,
        distinctSessionCount: sourceEvidence.distinctSessionCount,
        originContextId: sourceOriginContextId,
        originNodeId: sourceOriginNodeId
    });
    if (sourcePromotion.promotionState === 'blocked') {
        throw new Error(sourcePromotion.promotionSummary);
    }
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
