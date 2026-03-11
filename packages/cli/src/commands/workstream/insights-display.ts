type ExtractionItem = {
    type?: string;
    content?: string;
    action?: string;
    confidence?: number;
    reason?: string | null;
    evidenceSummary?: string | null;
    reviewTier?: 'strong' | 'review' | 'weak';
    reviewSummary?: string | null;
    autoPersist?: boolean;
    autoPersistSummary?: string | null;
    trustFlags?: string[];
    distinctSessionCount?: number;
    trustSummary?: string | null;
    promotionState?: 'ready' | 'review' | 'blocked';
    promotionSummary?: string | null;
};

type ExtractionResultShape = {
    createdCount?: number;
    reusedCount?: number;
    nodeCount?: number;
    createCount?: number;
    reuseCount?: number;
    candidateCount?: number;
    nodes?: ExtractionItem[];
    candidates?: ExtractionItem[];
};

function short(value: string, max = 132): string {
    return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function humanizeLabel(value: string): string {
    return value
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatConfidence(value: unknown): string | null {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? `${Math.round(numeric * 100)}% confidence` : null;
}

function summarizeFlags(flags: unknown): string | null {
    if (!Array.isArray(flags) || flags.length === 0) return null;
    const items = flags
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .slice(0, 3)
        .map(humanizeLabel);
    return items.length > 0 ? items.join(', ') : null;
}

function detailLines(item: ExtractionItem, preview: boolean): string[] {
    const details: string[] = [];
    if (preview) {
        const confidence = formatConfidence(item.confidence);
        if (confidence) details.push(`confidence: ${confidence}`);
        if (item.reviewTier) details.push(`review: ${humanizeLabel(item.reviewTier)}`);
        if (typeof item.autoPersist === 'boolean') {
            details.push(`write mode: ${item.autoPersist ? 'auto write' : 'review only'}`);
        }
    }
    const flags = summarizeFlags(item.trustFlags);
    if (flags) details.push(`trust flags: ${flags}`);
    if (preview && typeof item.distinctSessionCount === 'number' && item.distinctSessionCount > 0) {
        details.push(`sessions: ${item.distinctSessionCount}`);
    }
    if (item.evidenceSummary) details.push(`evidence: ${item.evidenceSummary}`);
    if (preview && item.trustSummary) details.push(`trust: ${item.trustSummary}`);
    if (preview && item.reviewSummary) details.push(`review note: ${item.reviewSummary}`);
    if (preview && item.promotionSummary) details.push(`promote: ${item.promotionSummary}`);
    if (preview && item.autoPersistSummary) details.push(`write note: ${item.autoPersistSummary}`);
    if (preview && item.reason) details.push(`why: ${humanizeLabel(item.reason)}`);
    return details;
}

export function renderExtractionResultLines(
    heading: string,
    subjectLine: string,
    result: ExtractionResultShape
): string[] {
    const preview = heading.includes('Preview');
    const lines = [heading, subjectLine];
    lines.push(`  Created: ${String(result.createdCount ?? result.createCount ?? 0)}`);
    lines.push(`  Reused: ${String(result.reusedCount ?? result.reuseCount ?? 0)}`);
    lines.push(`  ${preview ? 'Candidates' : 'Nodes'}: ${String(result.nodeCount ?? result.candidateCount ?? 0)}`);

    const items: ExtractionItem[] = preview
        ? (result.candidates ?? [])
        : (result.nodes ?? []);
    for (const item of items.slice(0, 8)) {
        const labels = [
            String(item.type ?? 'node'),
            preview && item.action ? String(item.action).toUpperCase() : null,
            preview && item.reviewTier ? humanizeLabel(item.reviewTier) : null,
            preview && item.promotionState ? `PROMOTE ${humanizeLabel(item.promotionState)}` : null,
            preview && typeof item.autoPersist === 'boolean' ? (item.autoPersist ? 'AUTO WRITE' : 'REVIEW ONLY') : null
        ].filter(Boolean);
        lines.push(`    - [${labels.join(' | ')}] ${short(String(item.content ?? '-'))}`);
        for (const detail of detailLines(item, preview)) {
            lines.push(`      ${detail}`);
        }
    }
    lines.push('');
    return lines;
}
