import type {
    ContextNode,
    InsightSummary,
    KnowledgeCandidate,
    KnowledgeExtractionResult,
    KnowledgePreviewResult,
    NodeType,
    SessionDetail
} from '../schema';
import {
    canonicalizeKnowledgeCandidateText,
    scoreKnowledgeCandidate,
    sourceExcerpt,
    splitExtractionCandidates
} from '../knowledge-scoring';
import { buildKnowledgePreviewSummary } from './knowledge';

type AddNodeInput = Omit<ContextNode, 'id' | 'createdAt'> & {
    rawPayload?: unknown;
    payloadContentType?: string;
    createdAtOverride?: number;
};

type KnowledgeSessionDeps = {
    getSessionDetail: (contextId: string, sessionId: string) => SessionDetail;
    getByKey: (contextId: string, key: string, options?: { includeHidden?: boolean }) => ContextNode | null;
    getInsightSummary: (nodeId: string) => InsightSummary | null;
    getInsightEvidence: (nodeId: string) => {
        evidenceCount: number;
        distinctEvidenceCount: number;
        distinctSessionCount: number;
        evidenceKeys: string[];
        sessionIds: string[];
        corroboratedRoles: string[];
    };
    buildKnowledgeKey: (
        contextId: string,
        type: Exclude<NodeType, 'artifact'>,
        content: string,
        options?: { branch?: string | null; worktreePath?: string | null }
    ) => string;
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
        corroboratedRoles?: string[] | null;
        originContextId: string | null;
        originNodeId: string | null;
    }) => {
        promotionState: 'ready' | 'review' | 'blocked';
        promotionSummary: string;
    };
    buildKnowledgeEvidenceReason: (
        baseReason: string,
        evidenceCount: number,
        distinctEvidenceCount: number,
        roles: Set<string>
    ) => string;
    addNode: (params: AddNodeInput) => ContextNode;
    ensureEdge: (fromId: string, toId: string, relation: 'caused_by') => void;
};

type CandidateWithNode = KnowledgeCandidate & { existingNode: ContextNode | null };

function mergeExistingInsightEvidence(
    candidate: {
        type: Exclude<NodeType, 'artifact'>;
        bestConfidence: number;
        bestReason: string;
        evidenceCount: number;
        distinctEvidenceCount: number;
        evidenceKeys: Set<string>;
        roles: Set<string>;
    },
    sessionId: string,
    existingInsight: InsightSummary | null,
    existingEvidence: ReturnType<KnowledgeSessionDeps['getInsightEvidence']> | null
) {
    if (!existingInsight) {
        return {
            confidence: candidate.bestConfidence,
            evidenceCount: candidate.evidenceCount,
            distinctEvidenceCount: candidate.distinctEvidenceCount,
            distinctSessionCount: candidate.evidenceCount > 0 ? 1 : 0,
            roles: new Set(candidate.roles),
            reason: candidate.bestReason
        };
    }

    const mergedRoles = new Set(candidate.roles);
    for (const role of existingInsight.corroboratedRoles ?? []) {
        if (typeof role === 'string' && role.trim()) mergedRoles.add(role.toLowerCase());
    }

    const mergedSessionIds = new Set(existingEvidence?.sessionIds ?? []);
    const normalizedSessionId = sessionId.trim();
    const sessionAlreadyRepresented = normalizedSessionId.length > 0 && mergedSessionIds.has(normalizedSessionId);
    if (normalizedSessionId.length > 0) mergedSessionIds.add(normalizedSessionId);

    const mergedEvidenceKeys = new Set(existingEvidence?.evidenceKeys ?? []);
    if (!sessionAlreadyRepresented) {
        for (const key of candidate.evidenceKeys) mergedEvidenceKeys.add(key);
    }

    const corroboratesWithExistingEvidence = !sessionAlreadyRepresented
        && (Math.max(existingInsight.evidenceCount, 0) > 0 || Math.max(existingInsight.distinctSessionCount, 0) > 0);

    return {
        confidence: candidate.bestConfidence + (corroboratesWithExistingEvidence ? 0.04 : 0),
        evidenceCount: Math.max(existingInsight.evidenceCount, 0) + (sessionAlreadyRepresented ? 0 : candidate.evidenceCount),
        distinctEvidenceCount: mergedEvidenceKeys.size > 0
            ? mergedEvidenceKeys.size
            : Math.max(candidate.distinctEvidenceCount, existingInsight.distinctEvidenceCount),
        distinctSessionCount: mergedSessionIds.size > 0
            ? mergedSessionIds.size
            : Math.max(1, existingInsight.distinctSessionCount),
        roles: mergedRoles,
        reason: `${candidate.bestReason}, corroborated-by-existing-insight`
    };
}

function collectSessionKnowledgeCandidates(
    deps: KnowledgeSessionDeps,
    contextId: string,
    sessionId: string,
    options: {
        checkpointId?: string | null;
        maxNodes?: number;
        source?: 'session' | 'checkpoint';
        allowedKeys?: string[] | null;
        minConfidence?: number;
        autoPersistOnly?: boolean;
    } = {}
): {
    source: 'session' | 'checkpoint';
    checkpointId: string | null;
    session: SessionDetail['session'];
    candidates: CandidateWithNode[];
} {
    const detail = deps.getSessionDetail(contextId, sessionId);
    const session = detail.session;
    const safeLimit = Math.max(1, Math.min(options.maxNodes ?? 12, 50));
    const source = options.source ?? 'session';
    const checkpointId = options.checkpointId ?? null;
    const minConfidence = Math.max(0, Math.min(options.minConfidence ?? 0.55, 1));
    const allowedKeys = Array.isArray(options.allowedKeys)
        ? new Set(options.allowedKeys.map((value) => String(value || '').trim()).filter(Boolean))
        : null;
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

    if (!session) return { session: null, source, checkpointId, candidates: [] };

    for (const message of detail.messages) {
        for (const candidateText of splitExtractionCandidates(message.content)) {
            const classified = scoreKnowledgeCandidate(candidateText, message.role);
            if (!classified) continue;

            const type = classified.type;
            const canonicalText = canonicalizeKnowledgeCandidateText(type, candidateText) || candidateText.toLowerCase();
            const dedupeKey = `${type}:${canonicalText}`;
            const key = deps.buildKnowledgeKey(contextId, type, candidateText, {
                branch: session.branch,
                worktreePath: session.worktreePath
            });
            if (allowedKeys && !allowedKeys.has(key)) continue;

            const excerpt = sourceExcerpt(message.content);
            const distinctEvidenceKey = excerpt || canonicalText;
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

    const candidates = Array.from(aggregated.values())
        .map((candidate) => {
            const localDistinctEvidenceCount = candidate.distinctEvidenceKeys.size;
            const existingNode = deps.getByKey(contextId, candidate.key, { includeHidden: true });
            const existingInsight = existingNode ? deps.getInsightSummary(existingNode.id) : null;
            const existingEvidence = existingNode ? deps.getInsightEvidence(existingNode.id) : null;
            const mergedEvidence = mergeExistingInsightEvidence({
                type: candidate.type,
                bestConfidence: candidate.bestConfidence,
                bestReason: candidate.bestReason,
                evidenceCount: candidate.evidenceCount,
                distinctEvidenceCount: localDistinctEvidenceCount,
                evidenceKeys: candidate.distinctEvidenceKeys,
                roles: candidate.roles
            }, sessionId, existingInsight, existingEvidence);
            const confidence = deps.boostKnowledgeCandidateConfidence(
                candidate.type,
                mergedEvidence.confidence,
                mergedEvidence.evidenceCount,
                mergedEvidence.distinctEvidenceCount,
                mergedEvidence.roles
            );
            const review = deps.classifyKnowledgeReviewTier(candidate.type, confidence, mergedEvidence.evidenceCount, mergedEvidence.distinctEvidenceCount, mergedEvidence.roles, {
                distinctSessionCount: mergedEvidence.distinctSessionCount
            });
            const autoPersist = deps.classifyKnowledgeAutoPersist(
                review.reviewTier,
                mergedEvidence.evidenceCount,
                mergedEvidence.distinctEvidenceCount,
                mergedEvidence.roles,
                { distinctSessionCount: mergedEvidence.distinctSessionCount }
            );
            const evidenceSummary = deps.buildKnowledgeEvidenceSummary(
                mergedEvidence.evidenceCount,
                mergedEvidence.distinctEvidenceCount,
                mergedEvidence.roles,
                { distinctSessionCount: mergedEvidence.distinctSessionCount }
            );
            const promotion = deps.describeKnowledgePromotionState({
                trustTier: review.reviewTier,
                evidenceCount: mergedEvidence.evidenceCount,
                distinctEvidenceCount: mergedEvidence.distinctEvidenceCount,
                distinctSessionCount: mergedEvidence.distinctSessionCount,
                corroboratedRoles: Array.from(mergedEvidence.roles),
                originContextId: null,
                originNodeId: null
            });
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
                reason: deps.buildKnowledgeEvidenceReason(mergedEvidence.reason, mergedEvidence.evidenceCount, mergedEvidence.distinctEvidenceCount, mergedEvidence.roles),
                evidenceCount: mergedEvidence.evidenceCount,
                distinctEvidenceCount: mergedEvidence.distinctEvidenceCount,
                distinctSessionCount: mergedEvidence.distinctSessionCount,
                evidenceSummary,
                trustFlags: deps.buildKnowledgeTrustFlags(mergedEvidence.evidenceCount, mergedEvidence.distinctEvidenceCount, mergedEvidence.roles, {
                    distinctSessionCount: mergedEvidence.distinctSessionCount
                }),
                sourceExcerpt: candidate.evidencePreview[0] ?? null,
                evidencePreview: candidate.evidencePreview,
                corroboratedRoles: Array.from(mergedEvidence.roles),
                reviewTier: review.reviewTier,
                reviewSummary: review.reviewSummary,
                trustSummary: deps.buildKnowledgeTrustSummary(review.reviewSummary, evidenceSummary),
                promotionState: promotion.promotionState,
                promotionSummary: promotion.promotionSummary,
                autoPersist: autoPersist.autoPersist,
                autoPersistSummary: autoPersist.autoPersistSummary,
                existingNode
            };
        })
        .filter((candidate) => candidate.confidence >= minConfidence)
        .filter((candidate) => !options.autoPersistOnly || candidate.autoPersist === true)
        .sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0) || (right.evidenceCount ?? 0) - (left.evidenceCount ?? 0) || right.createdAt - left.createdAt)
        .slice(0, safeLimit);

    return { session, source, checkpointId, candidates };
}

export function previewKnowledgeFromSessionRecord(
    deps: KnowledgeSessionDeps,
    contextId: string,
    sessionId: string,
    options: { checkpointId?: string | null; maxNodes?: number; source?: 'session' | 'checkpoint'; minConfidence?: number } = {}
): KnowledgePreviewResult {
    const { source, checkpointId, candidates } = collectSessionKnowledgeCandidates(deps, contextId, sessionId, options);
    const createCount = candidates.filter((candidate) => candidate.action === 'create').length;
    return {
        contextId,
        source,
        sessionId,
        checkpointId,
        candidateCount: candidates.length,
        createCount,
        reuseCount: candidates.length - createCount,
        summary: buildKnowledgePreviewSummary(candidates),
        candidates: candidates.map(({ existingNode, ...candidate }) => candidate)
    };
}

export function extractKnowledgeFromSessionRecord(
    deps: KnowledgeSessionDeps,
    contextId: string,
    sessionId: string,
    options: {
        checkpointId?: string | null;
        maxNodes?: number;
        source?: 'session' | 'checkpoint';
        allowedKeys?: string[] | null;
        minConfidence?: number;
        autoPersistOnly?: boolean;
    } = {}
): KnowledgeExtractionResult {
    const extractionOptions = options.minConfidence == null ? { ...options, minConfidence: 0.7 } : options;
    const { session, source, checkpointId, candidates } = collectSessionKnowledgeCandidates(deps, contextId, sessionId, extractionOptions);
    if (!session) {
        return { contextId, source, sessionId, checkpointId, createdCount: 0, reusedCount: 0, nodeCount: 0, nodes: [] };
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

    const resultNodes: ContextNode[] = [];
    const resultIds = new Set<string>();
    let createdCount = 0;
    let reusedCount = 0;

    for (const candidate of candidates) {
        let node = candidate.existingNode;
        if (!node) {
            node = deps.addNode({
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

        if (candidate.sourceNodeId) deps.ensureEdge(node.id, candidate.sourceNodeId, 'caused_by');
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
