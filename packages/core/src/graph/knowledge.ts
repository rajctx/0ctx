import { createHash } from 'crypto';
import type { NodeType } from '../schema';
import { canonicalizeKnowledgeCandidateText } from '../knowledge-scoring';

export function boostKnowledgeCandidateConfidence(
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

export function buildKnowledgeEvidenceReason(
    baseReason: string,
    evidenceCount: number,
    distinctEvidenceCount: number,
    roles: Set<string>
): string {
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

export function buildKnowledgeEvidenceSummary(
    evidenceCount: number,
    distinctEvidenceCount: number,
    roles: Set<string>
): string {
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

export function classifyKnowledgeReviewTier(
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

export function buildKnowledgeKey(
    contextId: string,
    type: Exclude<NodeType, 'artifact'>,
    content: string,
    options: {
        branch?: string | null;
        worktreePath?: string | null;
        normalizeBranch: (branch: string | null | undefined) => string;
        normalizeWorktreePath: (worktreePath: string | null | undefined) => string;
    }
): string {
    const normalizedWorktree = options.normalizeWorktreePath(options.worktreePath);
    const normalizedBranch = options.normalizeBranch(options.branch);
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

export function sanitizePromotedInsightTags(
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
