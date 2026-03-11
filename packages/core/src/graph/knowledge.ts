import { createHash } from 'crypto';
import type { NodeType } from '../schema';
import { canonicalizeKnowledgeCandidateText } from '../knowledge-scoring';

export function buildKnowledgeTrustSummary(
    reviewSummary: string | null | undefined,
    evidenceSummary: string | null | undefined
): string {
    return [String(reviewSummary || '').trim(), String(evidenceSummary || '').trim()]
        .filter(Boolean)
        .join(' ')
        .trim();
}

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
    roles: Set<string>,
    options: {
        distinctSessionCount?: number;
    } = {}
): string {
    const crossRole = roles.has('assistant') && roles.has('user');
    const assistantOnly = roles.size === 1 && roles.has('assistant');
    const userOnly = roles.size === 1 && roles.has('user');
    const distinctSessionCount = Math.max(0, Number(options.distinctSessionCount || 0));

    let summary = 'Single captured mention.';
    if (evidenceCount > 1 && crossRole && distinctSessionCount > 1) {
        summary = `Repeated ${evidenceCount} times across user and assistant messages in ${distinctSessionCount} sessions.`;
    } else if (evidenceCount > 1 && crossRole) {
        summary = `Repeated ${evidenceCount} times across user and assistant messages.`;
    } else if (evidenceCount > 1 && distinctSessionCount > 1) {
        summary = `Repeated ${evidenceCount} times across ${distinctSessionCount} sessions.`;
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
    if (evidenceCount > 1 && distinctSessionCount === 1) {
        summary += ' All corroboration comes from one session.';
    }
    return summary;
}

export function buildKnowledgeTrustFlags(
    evidenceCount: number,
    distinctEvidenceCount: number,
    roles: Set<string>,
    options: {
        promoted?: boolean;
        noLocalEvidence?: boolean;
        distinctSessionCount?: number;
    } = {}
): string[] {
    const flags = new Set<string>();
    const crossRole = roles.has('assistant') && roles.has('user');
    const assistantOnly = roles.size === 1 && roles.has('assistant');
    const userOnly = roles.size === 1 && roles.has('user');
    const distinctSessionCount = Math.max(0, Number(options.distinctSessionCount || 0));

    if (evidenceCount > 1) flags.add('repeated');
    if (distinctEvidenceCount > 1) flags.add('distinct_support');
    if (evidenceCount > 1 && distinctSessionCount === 1) flags.add('same_session_only');
    if (distinctSessionCount > 1) flags.add('cross_session');
    if (crossRole) flags.add('cross_role');
    if (assistantOnly) flags.add('assistant_only');
    if (userOnly) flags.add('user_only');
    if (evidenceCount > distinctEvidenceCount && distinctEvidenceCount <= 1) flags.add('duplicate_only');
    if (options.promoted) flags.add('promoted');
    if (options.noLocalEvidence) flags.add('no_local_evidence');

    return Array.from(flags);
}

export function classifyKnowledgeReviewTier(
    type: Exclude<NodeType, 'artifact'> | null | undefined,
    confidence: number,
    evidenceCount: number,
    distinctEvidenceCount: number,
    roles: Set<string>,
    options: {
        distinctSessionCount?: number;
    } = {}
): {
    reviewTier: 'strong' | 'review' | 'weak';
    reviewSummary: string;
} {
    const crossRole = roles.has('assistant') && roles.has('user');
    const singleRoleOnly = roles.size === 1;
    const assistantOnlySingle = distinctEvidenceCount === 1 && roles.size === 1 && roles.has('assistant');
    const distinctSessionCount = Math.max(0, Number(options.distinctSessionCount || 0));
    const sameSessionOnly = distinctSessionCount <= 1 && evidenceCount > 1;

    if (sameSessionOnly && crossRole && confidence >= 0.8) {
        return {
            reviewTier: 'review',
            reviewSummary: 'Repeated within one session only. Review before treating it as durable project memory.'
        };
    }
    if (confidence >= 0.8 && distinctEvidenceCount >= 2 && crossRole) {
        if (distinctSessionCount <= 1) {
            return {
                reviewTier: 'review',
                reviewSummary: 'Strong wording, but the corroboration still comes from one session. Review before promoting it into shared memory.'
            };
        }
        return {
            reviewTier: 'strong',
            reviewSummary: distinctSessionCount > 1
                ? 'Strong signal corroborated across sessions and roles.'
                : 'Strong signal backed by repeated cross-role evidence.'
        };
    }
    if (confidence >= 0.9 && crossRole) {
        if (distinctSessionCount <= 1) {
            return {
                reviewTier: 'review',
                reviewSummary: 'High-confidence signal, but it only appears inside one session. Review before promoting it beyond this run.'
            };
        }
        return {
            reviewTier: 'strong',
            reviewSummary: distinctSessionCount > 1
                ? 'Strong signal backed by repeated or cross-role evidence across sessions.'
                : 'Strong signal backed by repeated or cross-role evidence.'
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
            reviewSummary: singleRoleOnly && distinctEvidenceCount >= 2
                ? 'Repeated single-role signal. Review before promoting it into shared memory.'
                : distinctSessionCount === 1 && evidenceCount > 1
                    ? 'Single-session signal. Review before promoting it beyond this workstream.'
                    : 'Good candidate. Review before promoting it into shared memory.'
        };
    }
    return {
        reviewTier: 'weak',
        reviewSummary: 'Tentative signal. Keep in review until more evidence appears.'
    };
}

export function classifyKnowledgeAutoPersist(
    reviewTier: 'strong' | 'review' | 'weak',
    evidenceCount: number,
    distinctEvidenceCount: number,
    roles: Set<string>,
    options: {
        distinctSessionCount?: number;
    } = {}
): {
    autoPersist: boolean;
    autoPersistSummary: string;
} {
    const crossRole = roles.has('assistant') && roles.has('user');
    const assistantOnly = roles.size === 1 && roles.has('assistant');
    const distinctSessionCount = Math.max(0, Number(options.distinctSessionCount || 0));
    const sameSessionOnly = distinctSessionCount <= 1 && evidenceCount > 1;

    if (assistantOnly) {
        return {
            autoPersist: false,
            autoPersistSummary: 'Assistant-only signals stay out of automatic checkpoint extraction until they are corroborated.'
        };
    }

    if (sameSessionOnly) {
        return {
            autoPersist: false,
            autoPersistSummary: 'Single-session corroboration stays manual until another session confirms the same signal.'
        };
    }

    if (reviewTier !== 'strong') {
        return {
            autoPersist: false,
            autoPersistSummary: 'Review-only candidate. Keep it manual until corroboration is stronger.'
        };
    }

    if (!crossRole && distinctSessionCount <= 1 && distinctEvidenceCount < 3) {
        return {
            autoPersist: false,
            autoPersistSummary: 'Strong wording, but still too narrow in source coverage for automatic writing.'
        };
    }

    if (evidenceCount >= 2 && (crossRole || distinctSessionCount > 1 || distinctEvidenceCount >= 3)) {
        return {
            autoPersist: true,
            autoPersistSummary: 'Auto-persistable. Evidence is strong enough for checkpoint-time writing.'
        };
    }

    return {
        autoPersist: false,
        autoPersistSummary: 'Keep this reviewed manually until corroboration broadens.'
    };
}

export function describeKnowledgePromotionState(input: {
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
