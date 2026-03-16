import { handled, NOT_HANDLED, type HandlerMethodContext, type MethodDispatchResult } from './types';
import {
    getContextIdFromParams,
    parseDepth,
    parsePositiveHours,
    parsePositiveInt
} from './shared';
import { buildGraphRecall, buildTemporalRecall, getTopicHits, mapTopicHit } from './recall-builders';
import { type RecallFeedbackSignal, parseRecallFeedbackSignal } from './recall-feedback';

export function dispatchRecallRequest(context: HandlerMethodContext): MethodDispatchResult {
    const { graph, connectionId, req, params, contextId, auditMetadata } = context;

    if (req.method === 'listAuditEvents') {
        const explicitContextId = getContextIdFromParams(params);
        return handled(graph.listAuditEvents(explicitContextId ?? undefined, typeof params.limit === 'number' ? params.limit : undefined));
    }

    if (req.method === 'listRecallFeedback') {
        const feedbackContextId = getContextIdFromParams(params) ?? contextId ?? undefined;
        const limit = parsePositiveInt(params.limit, 50, 500);
        const nodeIdFilter = typeof params.nodeId === 'string' && params.nodeId.trim().length > 0 ? params.nodeId.trim() : null;
        const helpfulFilter = typeof params.helpful === 'boolean' ? params.helpful : null;
        const items = graph
            .listAuditEvents(feedbackContextId, Math.max(limit * 10, 200))
            .filter(event => event.action === 'recall_feedback')
            .map(parseRecallFeedbackSignal)
            .filter((signal): signal is RecallFeedbackSignal => Boolean(signal))
            .filter(signal => (nodeIdFilter ? signal.nodeId === nodeIdFilter : true))
            .filter(signal => (helpfulFilter === null ? true : signal.helpful === helpfulFilter))
            .slice(0, limit);

        const nodeSummary = new Map<string, { nodeId: string; helpful: number; notHelpful: number; netScore: number; lastFeedbackAt: number }>();
        for (const item of items) {
            const current = nodeSummary.get(item.nodeId) ?? { nodeId: item.nodeId, helpful: 0, notHelpful: 0, netScore: 0, lastFeedbackAt: 0 };
            if (item.helpful) current.helpful += 1;
            else current.notHelpful += 1;
            current.netScore = current.helpful - current.notHelpful;
            current.lastFeedbackAt = Math.max(current.lastFeedbackAt, item.createdAt);
            nodeSummary.set(item.nodeId, current);
        }

        return handled({
            contextId: feedbackContextId ?? null,
            total: items.length,
            helpfulCount: items.filter(item => item.helpful).length,
            notHelpfulCount: items.filter(item => !item.helpful).length,
            nodeSummary: Array.from(nodeSummary.values()).sort((a, b) => b.netScore - a.netScore || b.lastFeedbackAt - a.lastFeedbackAt).slice(0, 20),
            items
        });
    }

    if (req.method === 'recallTemporal') {
        return handled(buildTemporalRecall(graph, contextId, parsePositiveHours(params.sinceHours, 24), parsePositiveInt(params.limit, 10, 100)));
    }

    if (req.method === 'recallTopic') {
        if (!contextId) throw new Error("No active context set for recallTopic. Call 'switchContext' or provide contextId.");
        const query = typeof params.query === 'string' ? params.query.trim() : '';
        if (!query) throw new Error("Missing required 'query' for recallTopic.");
        const sinceHours = parsePositiveHours(params.sinceHours, 24);
        return handled({ mode: 'topic', contextId, query, sinceHours, hits: getTopicHits(graph, contextId, query, parsePositiveInt(params.limit, 10, 100), sinceHours).map(mapTopicHit) });
    }

    if (req.method === 'recallGraph') {
        if (!contextId) throw new Error("No active context set for recallGraph. Call 'switchContext' or provide contextId.");
        return handled(buildGraphRecall(graph, contextId, {
            query: typeof params.query === 'string' ? params.query.trim() : undefined,
            limit: parsePositiveInt(params.limit, 6, 40),
            sinceMs: parsePositiveHours(params.sinceHours, 24) * 60 * 60 * 1000,
            depth: parseDepth(params.depth, 2),
            maxNodes: parsePositiveInt(params.maxNodes, 30, 200),
            anchorNodeIds: Array.isArray(params.anchorNodeIds) ? params.anchorNodeIds.filter((id): id is string => typeof id === 'string') : undefined
        }));
    }

    if (req.method === 'recall') {
        const mode = typeof params.mode === 'string' ? params.mode : 'auto';
        if (mode === 'temporal') return handled(buildTemporalRecall(graph, contextId, parsePositiveHours(params.sinceHours, 24), parsePositiveInt(params.limit, 10, 100)));
        if (mode === 'topic') {
            if (!contextId) throw new Error("No active context set for recall topic mode. Call 'switchContext' or provide contextId.");
            const query = typeof params.query === 'string' ? params.query.trim() : '';
            if (!query) throw new Error("Missing required 'query' for recall topic mode.");
            const sinceHours = parsePositiveHours(params.sinceHours, 24);
            return handled({ mode: 'topic', contextId, query, sinceHours, hits: getTopicHits(graph, contextId, query, parsePositiveInt(params.limit, 10, 100), sinceHours).map(mapTopicHit) });
        }
        if (mode === 'graph') {
            if (!contextId) throw new Error("No active context set for recall graph mode. Call 'switchContext' or provide contextId.");
            return handled(buildGraphRecall(graph, contextId, {
                query: typeof params.query === 'string' ? params.query.trim() : undefined,
                limit: parsePositiveInt(params.limit, 6, 40),
                sinceMs: parsePositiveHours(params.sinceHours, 24) * 60 * 60 * 1000,
                depth: parseDepth(params.depth, 2),
                maxNodes: parsePositiveInt(params.maxNodes, 30, 200),
                anchorNodeIds: Array.isArray(params.anchorNodeIds) ? params.anchorNodeIds.filter((id): id is string => typeof id === 'string') : undefined
            }));
        }

        const sinceHours = parsePositiveHours(params.sinceHours, 24);
        const limit = parsePositiveInt(params.limit, 10, 100);
        const query = typeof params.query === 'string' ? params.query.trim() : '';
        const temporal = buildTemporalRecall(graph, contextId, sinceHours, limit);
        const topic = (contextId && query)
            ? { mode: 'topic' as const, contextId, query, sinceHours, hits: getTopicHits(graph, contextId, query, limit, sinceHours).map(mapTopicHit) }
            : null;
        const graphRecall = (contextId && query)
            ? buildGraphRecall(graph, contextId, { query, limit: Math.min(limit, 8), sinceMs: sinceHours * 60 * 60 * 1000, depth: parseDepth(params.depth, 2), maxNodes: parsePositiveInt(params.maxNodes, 30, 200) })
            : null;
        return handled({
            mode: 'auto',
            contextId,
            summary: {
                query: query || null,
                sessionCount: temporal.sessions.length,
                recentEventCount: temporal.totalEvents,
                topicHitCount: topic?.hits.length ?? 0,
                graphNodeCount: graphRecall?.subgraph.nodes.length ?? 0
            },
            temporal,
            topic,
            graph: graphRecall,
            recommendations: topic ? topic.hits.slice(0, 3).map(hit => ({ kind: 'node', nodeId: hit.nodeId, score: hit.score, reason: hit.matchReason })) : []
        });
    }

    if (req.method === 'recallFeedback') {
        const nodeId = typeof params.nodeId === 'string' ? params.nodeId.trim() : '';
        const helpful = typeof params.helpful === 'boolean' ? params.helpful : null;
        if (!nodeId) throw new Error("Missing required 'nodeId' for recallFeedback.");
        if (helpful === null) throw new Error("Missing required boolean 'helpful' for recallFeedback.");
        const reason = typeof params.reason === 'string' && params.reason.trim().length > 0 ? params.reason.trim() : null;
        const feedbackContextId = getContextIdFromParams(params) ?? contextId;
        const recordedAt = Date.now();
        graph.recordAuditEvent({
            action: 'recall_feedback',
            contextId: feedbackContextId,
            payload: { method: req.method, params: { nodeId, helpful, reason, contextId: feedbackContextId } },
            result: { accepted: true, recordedAt },
            metadata: auditMetadata
        });
        return handled({ ok: true, nodeId, helpful, reason, contextId: feedbackContextId, recordedAt });
    }

    if (req.method === 'auditVerify') {
        return handled(graph.verifyAuditChain(typeof params.limit === 'number' ? params.limit : 1000));
    }

    return NOT_HANDLED;
}
