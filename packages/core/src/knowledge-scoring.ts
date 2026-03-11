import type { NodeType } from './schema';

export interface KnowledgeCandidateClassification {
    type: Exclude<NodeType, 'artifact'>;
    confidence: number;
    reason: string;
}

const attributedSourcePattern =
    '(?:linear issue|issue|ticket|spec|docs?|document|design doc|brief|roadmap|plan|summary|checkpoint|session|transcript|thread|comment|email|message|slack|user|assistant|agent|customer|reviewer)';
const attributedVerbPattern =
    '(?:says|said|states?|stated|notes?|noted|reads?|read|mentions?|mentioned|writes?|wrote|quotes?|quoted|asks?|asked|told|tells)';

export function cleanupExtractionText(text: string): string {
    return String(text ?? '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`]*`/g, ' ')
        .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/[_*~>#]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function splitExtractionCandidates(text: string): string[] {
    const withoutCode = String(text ?? '').replace(/```[\s\S]*?```/g, ' ');
    const rough = withoutCode
        .split(/\r?\n+/)
        .flatMap((part) => part.split(/(?<=[.?!])\s+/))
        .filter((part) => !isQuotedExcerpt(part))
        .map((part) => cleanupExtractionText(part))
        .map((part) => part.replace(/^[\-\u2022•\d.)\s]+/, '').trim())
        .filter((part) => part.length >= 24 && part.length <= 280);

    return Array.from(new Set(rough));
}

export function sourceExcerpt(text: string): string {
    return cleanupExtractionText(text)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
}

export function canonicalizeKnowledgeCandidateText(
    type: Exclude<NodeType, 'artifact'>,
    text: string
): string {
    let normalized = cleanupExtractionText(text).toLowerCase().trim();
    normalized = normalized.replace(/[.?!;:,]+$/g, '').trim();

    switch (type) {
        case 'goal':
            normalized = normalized.replace(/^(?:we|i)\s+(?:need|want|must|should)\s+to\s+/, '');
            normalized = normalized.replace(/^(?:need|want|must|should)\s+to\s+/, '');
            normalized = normalized.replace(/^(?:the\s+)?(?:goal|objective|aim)\s+is\s+to\s+/, '');
            break;
        case 'decision':
            normalized = normalized.replace(/^(?:we\s+)?(?:decided|choose|chose)\s+to\s+/, '');
            normalized = normalized.replace(
                /^(?:we\s+are\s+going\s+with|going\s+with|default\s+to|standardize\s+on|adopt(?:ed)?(?:\s+on)?)\s+/,
                ''
            );
            break;
        case 'assumption':
            normalized = normalized.replace(
                /^(?:we\s+)?(?:assume|assuming|likely|probably|maybe|hypothesis(?:\s+is)?)(?:\s+that)?\s+/,
                ''
            );
            break;
        default:
            break;
    }

    return normalized.replace(/\s+/g, ' ').trim();
}

function isExtractionNoise(text: string): boolean {
    const normalized = text.toLowerCase();
    if (/^(hi|hello|thanks|thank you|ok|okay|sure|done|great|awesome|please|you'?re welcome)\b/.test(normalized)) return true;
    if (/^[a-z]:\\/.test(text) || text.includes('\\\\') || normalized.includes('.jsonl') || normalized.includes('.json')) return true;
    if (normalized.startsWith('select ') || normalized.startsWith('choose ') || normalized.startsWith('click ')) return true;
    if (/^(run|open|refresh|restart|copy|paste|install|reinstall)\b/.test(normalized)) return true;
    if (/\b(bridge error|runtime issue|runtime unavailable|preview knowledge failed|extract knowledge failed|preview insights failed|save insights failed|save checkpoint insights failed|create checkpoint failed)\b/.test(normalized)) return true;
    if (/^(next (best )?move|natural next steps?|what changed)\b/.test(normalized)) return true;
    if (/\b(test|tests|build|builds|validation|smoke|lint|typecheck|compile|compiled|installer|msi|nsis)\b/.test(normalized) && /\b(passed|green|successful|succeeded|completed|done)\b/.test(normalized)) return true;
    if (/^(?:npm|pnpm|yarn|node|git|0ctx)\b/.test(normalized) && !/\b(should|must|default|normal path|golden path|recommended|policy|workstream|workspace|checkpoint|session)\b/.test(normalized)) return true;
    if (/\b(linear|issue|ticket|backlog|roadmap)\b/.test(normalized) && /\b(created|updated|closed|tracked|logged|moved)\b/.test(normalized)) return true;
    if (/\b(roadmap|execution order|next move|next correct move|remaining roadmap|current product state|where we are|not done yet|still remains|still remaining|best next move|highest[- ]value (work|move|slice)|remaining work|remaining roadmap)\b/.test(normalized) && !/\b(decided|decision|must|need to|goal|constraint|assume|open question|default|policy)\b/.test(normalized)) return true;
    if (/\b(the right (path|direction|move)|the correct move|continue (with|on)|keep going on|execution target|next slice|follow[- ]on work|remaining items?)\b/.test(normalized) && !/\b(decided|decision|must|need to|goal|constraint|default|policy|required)\b/.test(normalized)) return true;
    if (/\b(done enough|current status|product status|what remains|what is still open|what is still remaining)\b/.test(normalized) && !/\b(default|policy|must|should|constraint|decision)\b/.test(normalized)) return true;
    if (/^(implemented|updated|patched|validated|verified|compiled|built|installed|restarted|refreshed|copied|selected|created|closed|logged|tracked)\b/.test(normalized) && !/\b(decided|decision|must|need to|goal|constraint|assume|open question)\b/.test(normalized)) return true;
    return false;
}

function isOperationalProcedure(text: string): boolean {
    const normalized = text.toLowerCase().trim();
    if (!normalized) return false;
    if (/^(please\s+)?(run|open|click|choose|select|copy|paste|refresh|restart|reinstall|install|debug|repair|check|verify|review|inspect|show|switch|reopen|commit|checkpoint|merge|rebase|stash|create)\b/.test(normalized)) return true;
    if (/\b(if the issue remains|if needed|then refresh|then reopen|then rerun|before handing|before continuing|after reinstall)\b/.test(normalized)) return true;
    if (/\b(before relying on this workstream|before handing this workstream|open the checked-out worktree|resolve conflicts before|rebase onto|merge main before|checkpoint local changes before|commit local changes before)\b/.test(normalized)) return true;
    return /\b(connector|daemon|runtime|payload|debug payload|install command|smoke test|utilities|setup screen|desktop app)\b/.test(normalized)
        && /\b(refresh|restart|repair|rerun|copy|open|show|check|inspect|review|reinstall|install)\b/.test(normalized);
}

function isImplementationStatus(text: string): boolean {
    const normalized = text.toLowerCase().trim();
    if (!normalized) return false;
    const hasImplementationSubject = /\b(app|desktop|desktop app|ui|screen|view|page|panel|reader|sidebar|setup|utility|graph|daemon|runtime|connector|cli|command|mcp|tool|workstream compare|compare panel|session-start|session start)\b/.test(normalized);
    const hasStatusVerb = /\b(shows?|renders?|loads?|displays?|returns?|prints?|writes?|stores?|captures?|installs?|supports?|exposes?|uses?|includes?|contains?|lists?|promotes?|loads)\b/.test(normalized);
    const hasTemporalMarker = /\b(now|currently|already|no longer|is now|are now|was updated|were updated)\b/.test(normalized);
    const hasStableIntentLanguage = /\b(decided|decision|must|should|need to|goal|constraint|default|policy|required|requirement|never|cannot|can't)\b/.test(normalized);

    if (hasImplementationSubject && hasStatusVerb && hasTemporalMarker && !hasStableIntentLanguage) return true;
    if (/^(the|this)\s+(desktop|desktop app|app|daemon|runtime|cli|ui|screen|view|panel|reader|graph|setup)\b/.test(normalized)) {
        return /\b(now|currently|already|no longer)\b/.test(normalized) && !hasStableIntentLanguage;
    }
    return false;
}

function isDesignOrLayoutChatter(text: string): boolean {
    const normalized = text.toLowerCase().trim();
    if (!normalized) return false;
    const hasUiSurface = /\b(sidebar|topbar|toolbar|breadcrumb|header|footer|rail|drawer|modal|dialog|panel|card|grid|layout|shell|reader body|reader header|hero|accent|gradient|spacing|typography|chrome|button|search bar|search strip|empty state|utility dock|setup screen)\b/.test(normalized);
    const hasDesignVerb = /\b(move|moved|remove|removed|rewrite|rewrote|redesign|redesigned|restyle|restyled|flatten|flattened|tighten|tightened|shrink|shrunk|reduce|reduced|demote|demoted|simplify|simplified|rename|renamed|split|split out|quiet|quieter|tune|tuned|align|aligned)\b/.test(normalized);
    const hasProductPolicy = /\b(default|policy|must|should|need to|required|local-first|metadata_only|full_sync|workspace|workstream|session|checkpoint|insight|capture|retrieval|agent context|project memory)\b/.test(normalized);

    return hasUiSurface && hasDesignVerb && !hasProductPolicy;
}

function isExecutionPlanningChatter(text: string): boolean {
    const normalized = text.toLowerCase().trim();
    if (!normalized) return false;
    const startsWithSequencing = /^(?:the\s+)?(?:next|best next|first|then|after that|afterwards|finally|follow[- ]on)\b/.test(normalized);
    const hasSequencingPhrase = /\b(next step|next move|next slice|execution target|execution order|follow[- ]on work|remaining work|remaining items?|after that|then finalize|then tighten|then improve|then validate|continue (with|on)|keep going on)\b/.test(normalized);
    const hasPlanningVerb = /\b(should|need to|must|continue|finish|finalize|tighten|improve|validate|review|check|keep)\b/.test(normalized);
    const hasDurablePolicyClaim = /\b(should remain|must remain|default sync policy|required by default|disabled by default|local-first|strict repo routing|explicit promotion|workspace isolation)\b/.test(normalized);

    if (hasDurablePolicyClaim && !startsWithSequencing) return false;
    return (startsWithSequencing || hasSequencingPhrase) && hasPlanningVerb;
}

function isProgressOrCoordinationChatter(text: string): boolean {
    const normalized = text.toLowerCase().trim();
    if (!normalized) return false;

    if (/^(please\s+)?continue\b/.test(normalized)) return true;
    if (/^(please\s+)?go ahead\b/.test(normalized)) return true;
    if (/^(please\s+)?keep going\b/.test(normalized)) return true;
    if (/^(are we done|is it done|is this done|how much .*remain|how much .*remaining|what remains|what is remaining|what's remaining)\b/.test(normalized)) return true;
    if (/^(can you|could you|please)\s+(update|track|split|plan|create)\b.*\b(linear|backlog|issues?|tasks?|child tasks?)\b/.test(normalized)) return true;
    if (/\b(update|track|split|plan|create)\b.*\b(linear|backlog|issues?|tasks?|child tasks?)\b/.test(normalized)) return true;
    if (/\b(progress|status)\b/.test(normalized) && /\b(remaining|done|complete|completed|in progress)\b/.test(normalized)) return true;
    if (/\b(thank you|thanks)\b/.test(normalized) && /\b(please continue|continue|go ahead|keep going)\b/.test(normalized)) return true;
    return false;
}

function isReadinessOrStatusChatter(text: string): boolean {
    const normalized = text.toLowerCase().trim();
    if (!normalized) return false;
    if (/^(ready|next step|capture readiness|automatic context|context retrieval|mcp retrieval|repo readiness)\s*[:\-]/.test(normalized)) {
        return true;
    }
    if (/\b(zero-touch|one-time setup|automatic context is ready|capture is ready|retrieval is ready|mcp registration)\b/.test(normalized)) {
        return true;
    }
    if (/\b(register mcp retrieval|register automatic context|install supported integrations)\b/.test(normalized)) {
        return true;
    }
    return false;
}

function isSystemContextChatter(text: string): boolean {
    const normalized = cleanupExtractionText(text).toLowerCase().trim();
    if (!normalized) return false;

    if (/^(workspace|current workstream|recent sessions|latest checkpoints?|capture readiness|automatic context|sync policy|debug artifacts|capture retention|debug retention)\s*:/i.test(text)) {
        return true;
    }

    if (/^no captured sessions or checkpoints for this workstream yet\b/.test(normalized)) return true;
    if (/^checked out here\b/.test(normalized)) return true;
    if (/^checked out elsewhere\b/.test(normalized)) return true;
    if (/^not checked out in a known worktree\b/.test(normalized)) return true;
    if (/^working tree has local uncommitted changes\b/.test(normalized)) return true;
    if (/^detached head\b/.test(normalized)) return true;
    if (/^in sync with\b/.test(normalized)) return true;
    if (/^\d+\s+ahead of\b/.test(normalized)) return true;
    if (/^\d+\s+behind\b/.test(normalized)) return true;
    if (/^\d+\s+ahead\s*\/\s*\d+\s+behind\b/.test(normalized)) return true;

    if (/\b(current checkout|active repo path|workstream compare|capture drift|head ref|checked-out head)\b/.test(normalized)
        && !/\b(must|should|need to|default|policy|decision|decided|decide|constraint|goal)\b/.test(normalized)) {
        return true;
    }

    return false;
}

function isQuotedExcerpt(text: string): boolean {
    const raw = String(text ?? '').trim().replace(/^[\-\u2022•\d.)\s]+/, '');
    const normalized = cleanupExtractionText(raw);
    if (!normalized || normalized.length < 24) return false;
    if (/^(?:>\s*)+/.test(raw)) return true;
    if (/^(?:quote|quoted|excerpt)\s*:\s*["“][^"”]{24,}["”][.?!;:]*$/i.test(normalized)) return true;
    return /^["“][^"”]{24,}["”][.?!;:]*$/.test(normalized);
}

function isSourceAttributedKnowledgeCandidate(text: string): boolean {
    const normalized = cleanupExtractionText(text).toLowerCase();
    if (!normalized) return false;
    const attributedSourceMention = new RegExp(`\\b(?:from|according to|per|based on|quoted from|copied from|as noted in|as written in|in|on)\\s+(?:the\\s+)?(?:${attributedSourcePattern})\\b`);
    if (new RegExp(`^(?:from|according to|per|based on|quoted from|copied from|as noted in|as written in|in|on)\\s+(?:the\\s+)?(?:${attributedSourcePattern})\\b`).test(normalized)) return true;
    if (attributedSourceMention.test(normalized)) return true;
    if (new RegExp(`^(?:the\\s+)?(?:${attributedSourcePattern})\\b.*\\b${attributedVerbPattern}\\b`).test(normalized)) return true;
    return new RegExp(`^(?:user|assistant|agent|customer|reviewer)\\b.*\\b${attributedVerbPattern}\\b`).test(normalized);
}

export function scoreKnowledgeCandidate(
    text: string,
    role: string | null | undefined
): KnowledgeCandidateClassification | null {
    const normalized = text.toLowerCase().trim();
    if (!normalized || isExtractionNoise(text)) return null;
    if (isOperationalProcedure(text)) return null;
    if (isImplementationStatus(text)) return null;
    if (isDesignOrLayoutChatter(text)) return null;
    if (isExecutionPlanningChatter(text)) return null;
    if (isProgressOrCoordinationChatter(text)) return null;
    if (isReadinessOrStatusChatter(text)) return null;
    if (isSystemContextChatter(text)) return null;
    if (isQuotedExcerpt(text)) return null;
    if (isSourceAttributedKnowledgeCandidate(text)) return null;

    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    if (wordCount < 5) return null;
    if (/^(this|that|it|there)\s+(is|was|are|were)\b/.test(normalized)) return null;
    if (/(^|\s)(click|choose|select|open|refresh|restart|copy|paste)\b/.test(normalized)) return null;
    const lowerRole = (role ?? '').toLowerCase();

    if ((normalized.endsWith('?') || /^(why|what|how|when|where|which|who)\b/.test(normalized)) && !/^(can|could|would|will)\s+you\b/.test(normalized) && !/^do you want\b/.test(normalized) && !/^please\b/.test(normalized)) {
        return { type: 'open_question', confidence: 0.92, reason: 'explicit-question' };
    }
    if (/\b(we need to|need to|we want to|want to|goal is to|aim is to|objective is to|build a|build an|create a|create an|implement a|implement an|add support for)\b/.test(normalized)) {
        if (/\b(test|tests|smoke|refresh|restart|rerun|validate|repair|debug|click|open|copy|paste|command|button|screen|reload|review|check|verify|inspect)\b/.test(normalized)) return null;
        if (lowerRole === 'assistant' && /\b(next move|next slice|execution target|keep going on|continue with|continue on|remaining work|remaining items?|follow[- ]on)\b/.test(normalized)) return null;
        return { type: 'goal', confidence: lowerRole === 'user' ? 0.88 : 0.64, reason: 'goal-language' };
    }
    if (/\b(must|cannot|can't|should not|should stay|should remain|do not|don't|required|requirement|never|enabled by default|disabled by default|local-first)\b/.test(normalized)) {
        if (/\b(click|open|refresh|restart|repair|reinstall|review|check|verify|inspect|copy|paste|button|screen)\b/.test(normalized)) return null;
        return { type: 'constraint', confidence: 0.84, reason: 'constraint-language' };
    }
    if (/\b(decided|decision|going with|adopt|adopted|chosen|choose to|chose to|switched to|default to|standardize|migrate to)\b/.test(normalized)) {
        if (/\b(test|tests|smoke|refresh|restart|rerun|validate|repair|debug|build|compiled|verified|installed|review|check|verify|inspect|button|screen)\b/.test(normalized)) return null;
        return { type: 'decision', confidence: lowerRole === 'assistant' ? 0.86 : 0.74, reason: 'decision-language' };
    }
    if (/\b(assume|assuming|likely|probably|seems|appears|maybe|hypothesis)\b/.test(normalized)) {
        return { type: 'assumption', confidence: 0.66, reason: 'assumption-language' };
    }
    if (lowerRole === 'user' && (/\b(i|we)\s+(need|want)\s+to\b/.test(normalized) || /\b(problem|issue)\s+is\b/.test(normalized) || /\b(goal|objective)\s+is\s+to\b/.test(normalized))) {
        if (/\b(roadmap|remaining|next step|next move|execution order|status)\b/.test(normalized)) return null;
        return { type: 'goal', confidence: 0.78, reason: 'user-stated-goal' };
    }
    return null;
}
