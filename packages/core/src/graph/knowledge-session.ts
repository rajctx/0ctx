import type {
    ContextNode,
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

type AddNodeInput = Omit<ContextNode, 'id' | 'createdAt'> & {
    rawPayload?: unknown;
    payloadContentType?: string;
    createdAtOverride?: number;
};

type KnowledgeSessionDeps = {
    getSessionDetail: (contextId: string, sessionId: string) => SessionDetail;
    getByKey: (contextId: string, key: string, options?: { includeHidden?: boolean }) => ContextNode | null;
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
        roles: Set<string>
    ) => { reviewTier: 'strong' | 'review' | 'weak'; reviewSummary: string };
    buildKnowledgeEvidenceSummary: (
        evidenceCount: number,
        distinctEvidenceCount: number,
        roles: Set<string>
    ) => string;
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

    const candidates = Array.from(aggregated.values())
        .map((candidate) => {
            const distinctEvidenceCount = candidate.distinctEvidenceKeys.size;
            const confidence = deps.boostKnowledgeCandidateConfidence(
                candidate.type,
                candidate.bestConfidence,
                candidate.evidenceCount,
                distinctEvidenceCount,
                candidate.roles
            );
            const existingNode = deps.getByKey(contextId, candidate.key, { includeHidden: true });
            const review = deps.classifyKnowledgeReviewTier(candidate.type, confidence, candidate.evidenceCount, distinctEvidenceCount, candidate.roles);
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
                reason: deps.buildKnowledgeEvidenceReason(candidate.bestReason, candidate.evidenceCount, distinctEvidenceCount, candidate.roles),
                evidenceCount: candidate.evidenceCount,
                distinctEvidenceCount,
                evidenceSummary: deps.buildKnowledgeEvidenceSummary(candidate.evidenceCount, distinctEvidenceCount, candidate.roles),
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
