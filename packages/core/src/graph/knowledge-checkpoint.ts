import type Database from 'better-sqlite3';
import type {
    Checkpoint,
    ContextNode,
    KnowledgeExtractionResult,
    KnowledgePreviewResult,
    NodeType
} from '../schema';
import { cleanupExtractionText, scoreKnowledgeCandidate } from '../knowledge-scoring';

type AddNodeInput = Omit<ContextNode, 'id' | 'createdAt'> & {
    rawPayload?: unknown;
    payloadContentType?: string;
    createdAtOverride?: number;
};

type KnowledgeCheckpointDeps = {
    db: Database.Database;
    parseCheckpointRow: (row: any) => Checkpoint;
    previewKnowledgeFromSession: (
        contextId: string,
        sessionId: string,
        options?: { checkpointId?: string | null; maxNodes?: number; source?: 'session' | 'checkpoint'; minConfidence?: number; autoPersistOnly?: boolean }
    ) => KnowledgePreviewResult;
    extractKnowledgeFromSession: (
        contextId: string,
        sessionId: string,
        options?: {
            checkpointId?: string | null;
            maxNodes?: number;
            source?: 'session' | 'checkpoint';
            allowedKeys?: string[] | null;
            minConfidence?: number;
            autoPersistOnly?: boolean;
        }
    ) => KnowledgeExtractionResult;
    getByKey: (contextId: string, key: string, options?: { includeHidden?: boolean }) => ContextNode | null;
    getNode: (id: string) => ContextNode | null;
    buildKnowledgeKey: (
        contextId: string,
        type: Exclude<NodeType, 'artifact'>,
        content: string,
        options?: { branch?: string | null; worktreePath?: string | null }
    ) => string;
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
    classifyKnowledgeAutoPersist: (
        reviewTier: 'strong' | 'review' | 'weak',
        evidenceCount: number,
        distinctEvidenceCount: number,
        roles: Set<string>,
        options?: {
            distinctSessionCount?: number;
        }
    ) => { autoPersist: boolean; autoPersistSummary: string };
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
            distinctSessionCount?: number;
        }
    ) => string[];
    buildKnowledgeTrustSummary: (
        reviewSummary: string | null | undefined,
        evidenceSummary: string | null | undefined
    ) => string;
    describeKnowledgePromotionState: (input: {
        trustTier: 'strong' | 'review' | 'weak';
        evidenceCount: number;
        distinctEvidenceCount: number;
        distinctSessionCount: number;
        originContextId: string | null;
        originNodeId: string | null;
    }) => {
        promotionState: 'ready' | 'review' | 'blocked';
        promotionSummary: string;
    };
    addNode: (params: AddNodeInput) => ContextNode;
};

function getCheckpoint(deps: KnowledgeCheckpointDeps, checkpointId: string): Checkpoint {
    const row = deps.db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(checkpointId) as any;
    if (!row) throw new Error(`Checkpoint ${checkpointId} not found`);
    return deps.parseCheckpointRow(row);
}

export function previewKnowledgeFromCheckpointRecord(
    deps: KnowledgeCheckpointDeps,
    checkpointId: string,
    options: { maxNodes?: number; minConfidence?: number; autoPersistOnly?: boolean } = {}
): KnowledgePreviewResult {
    const checkpoint = getCheckpoint(deps, checkpointId);
    if (checkpoint.sessionId) {
        return deps.previewKnowledgeFromSession(checkpoint.contextId, checkpoint.sessionId, {
            checkpointId,
            maxNodes: options.maxNodes,
            minConfidence: options.minConfidence,
            autoPersistOnly: options.autoPersistOnly,
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
    const key = deps.buildKnowledgeKey(checkpoint.contextId, type, summary, {
        branch: checkpoint.branch,
        worktreePath: checkpoint.worktreePath
    });
    const existingNode = deps.getByKey(checkpoint.contextId, key, { includeHidden: true });
    const roles = new Set<string>(['assistant']);
    const review = deps.classifyKnowledgeReviewTier(classified.type, classified.confidence, 1, 1, roles, {
        distinctSessionCount: 1
    });
    const autoPersist = deps.classifyKnowledgeAutoPersist(review.reviewTier, 1, 1, roles, {
        distinctSessionCount: 1
    });
    const evidenceSummary = deps.buildKnowledgeEvidenceSummary(1, 1, roles, {
        distinctSessionCount: 1
    });
    const promotion = deps.describeKnowledgePromotionState({
        trustTier: review.reviewTier,
        evidenceCount: 1,
        distinctEvidenceCount: 1,
        distinctSessionCount: 1,
        originContextId: null,
        originNodeId: null
    });
    if (options.autoPersistOnly && !autoPersist.autoPersist) {
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
            distinctSessionCount: 1,
            evidenceSummary,
            trustFlags: deps.buildKnowledgeTrustFlags(1, 1, roles, {
                distinctSessionCount: 1
            }),
            corroboratedRoles: ['assistant'],
            reviewTier: review.reviewTier,
            reviewSummary: review.reviewSummary,
            trustSummary: deps.buildKnowledgeTrustSummary(review.reviewSummary, evidenceSummary),
            promotionState: promotion.promotionState,
            promotionSummary: promotion.promotionSummary,
            autoPersist: autoPersist.autoPersist,
            autoPersistSummary: autoPersist.autoPersistSummary
        }]
    };
}

export function extractKnowledgeFromCheckpointRecord(
    deps: KnowledgeCheckpointDeps,
    checkpointId: string,
    options: { maxNodes?: number; allowedKeys?: string[] | null; minConfidence?: number; autoPersistOnly?: boolean } = {}
): KnowledgeExtractionResult {
    const checkpoint = getCheckpoint(deps, checkpointId);
    if (checkpoint.sessionId) {
        return deps.extractKnowledgeFromSession(checkpoint.contextId, checkpoint.sessionId, {
            checkpointId,
            maxNodes: options.maxNodes,
            source: 'checkpoint',
            allowedKeys: options.allowedKeys,
            minConfidence: options.minConfidence,
            autoPersistOnly: options.autoPersistOnly
        });
    }

    const preview = previewKnowledgeFromCheckpointRecord(deps, checkpointId, options);
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

    let node = candidate.existingNodeId ? deps.getNode(candidate.existingNodeId) : null;
    let createdCount = 0;
    let reusedCount = 0;
    if (!node) {
        node = deps.addNode({
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
