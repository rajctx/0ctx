import type { AuditEntry, Graph } from '@0ctx/core';

export interface RecallFeedbackSignal {
    nodeId: string;
    helpful: boolean;
    reason: string | null;
    createdAt: number;
    contextId: string | null;
    actor: string | null;
    source: string | null;
}

export function parseRecallFeedbackSignal(entry: AuditEntry): RecallFeedbackSignal | null {
    if (entry.action !== 'recall_feedback' || !entry.payload || typeof entry.payload !== 'object') return null;

    const payload = entry.payload as Record<string, unknown>;
    const payloadParams = payload.params && typeof payload.params === 'object'
        ? payload.params as Record<string, unknown>
        : payload;
    const nodeId = typeof payloadParams.nodeId === 'string' ? payloadParams.nodeId.trim() : '';
    const helpful = typeof payloadParams.helpful === 'boolean' ? payloadParams.helpful : null;
    if (!nodeId || helpful === null) return null;

    return {
        nodeId,
        helpful,
        reason: typeof payloadParams.reason === 'string' && payloadParams.reason.trim().length > 0
            ? payloadParams.reason.trim()
            : null,
        createdAt: entry.createdAt,
        contextId: entry.contextId ?? null,
        actor: entry.actor ?? null,
        source: entry.source ?? null
    };
}

function extractAuditTargetId(entry: { payload?: Record<string, unknown>; result?: Record<string, unknown> | null }): string | null {
    const payload = (entry.payload && typeof entry.payload === 'object') ? entry.payload : {};
    const result = (entry.result && typeof entry.result === 'object') ? entry.result : {};
    const payloadId = typeof payload.id === 'string' ? payload.id : (typeof payload.nodeId === 'string' ? payload.nodeId : null);
    if (payloadId) return payloadId;
    return typeof result.id === 'string' ? result.id : (typeof result.nodeId === 'string' ? result.nodeId : null);
}

function isHiddenAuditEvent(entry: AuditEntry): boolean {
    const payload = (entry.payload && typeof entry.payload === 'object') ? entry.payload as Record<string, unknown> : {};
    const payloadParams = payload.params && typeof payload.params === 'object'
        ? payload.params as Record<string, unknown>
        : payload;
    const result = (entry.result && typeof entry.result === 'object') ? entry.result as Record<string, unknown> : {};
    return payloadParams.hidden === true || result.hidden === true;
}

export function collectRecallFeedbackSignals(
    graph: Graph,
    contextId: string,
    limit = 500
): Map<string, { helpful: number; notHelpful: number; netAdjustment: number; lastFeedbackAt: number }> {
    const map = new Map<string, { helpful: number; notHelpful: number; netAdjustment: number; lastFeedbackAt: number }>();

    for (const event of graph.listAuditEvents(contextId, limit)) {
        const parsed = parseRecallFeedbackSignal(event);
        if (!parsed) continue;

        const current = map.get(parsed.nodeId) ?? { helpful: 0, notHelpful: 0, netAdjustment: 0, lastFeedbackAt: 0 };
        if (parsed.helpful) current.helpful += 1;
        else current.notHelpful += 1;
        current.lastFeedbackAt = Math.max(current.lastFeedbackAt, parsed.createdAt);
        current.netAdjustment = Math.max(-30, Math.min(24, (current.helpful * 6) - (current.notHelpful * 9)));
        map.set(parsed.nodeId, current);
    }

    return map;
}

export function buildTemporalRecall(graph: Graph, contextId: string | null, sinceHours: number, limit: number) {
    const minCreatedAt = Date.now() - (sinceHours * 60 * 60 * 1000);
    const windowed = graph
        .listAuditEvents(contextId ?? undefined, Math.max(limit * 10, 100))
        .filter(event => event.createdAt >= minCreatedAt)
        .filter(event => !isHiddenAuditEvent(event))
        .slice(0, Math.max(limit * 5, limit));

    const sessions = new Map<string, Array<{ action: string; createdAt: number; targetId: string | null }>>();
    for (const event of windowed) {
        const sessionId = event.sessionToken ?? event.connectionId ?? 'unknown';
        const list = sessions.get(sessionId) ?? [];
        list.push({ action: event.action, createdAt: event.createdAt, targetId: extractAuditTargetId(event) });
        sessions.set(sessionId, list);
    }

    return {
        mode: 'temporal' as const,
        contextId,
        sinceHours,
        totalEvents: windowed.length,
        sessions: Array.from(sessions.entries())
            .map(([sessionId, events]) => {
                const sorted = [...events].sort((a, b) => b.createdAt - a.createdAt);
                const timestamps = sorted.map(event => event.createdAt);
                return {
                    sessionId,
                    startAt: Math.min(...timestamps),
                    endAt: Math.max(...timestamps),
                    eventCount: sorted.length,
                    actions: Array.from(new Set(sorted.map(event => event.action))),
                    targetIds: Array.from(new Set(sorted.map(event => event.targetId).filter((id): id is string => Boolean(id)))),
                    recentEvents: sorted.slice(0, 8)
                };
            })
            .sort((a, b) => b.endAt - a.endAt)
            .slice(0, limit)
    };
}
