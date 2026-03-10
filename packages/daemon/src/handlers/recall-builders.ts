import type { Graph, SearchResult } from '@0ctx/core';
import { buildTemporalRecall, collectRecallFeedbackSignals } from './recall-feedback';

export { buildTemporalRecall };

export function mapTopicHit(hit: SearchResult) {
    return {
        nodeId: hit.node.id,
        key: hit.node.key ?? null,
        type: hit.node.type,
        content: hit.node.content,
        tags: hit.node.tags ?? [],
        createdAt: hit.node.createdAt,
        score: hit.score,
        matchReason: hit.matchReason,
        matchedTerms: hit.matchedTerms
    };
}

export function getTopicHits(graph: Graph, contextId: string, query: string, limit: number, sinceHours: number): SearchResult[] {
    const feedbackByNode = collectRecallFeedbackSignals(graph, contextId);
    const applyFeedback = (hits: SearchResult[]): SearchResult[] => {
        if (hits.length === 0 || feedbackByNode.size === 0) return hits;
        const rescored = hits.map(hit => {
            const signal = feedbackByNode.get(hit.node.id);
            return signal
                ? { ...hit, score: Math.max(0, Number((hit.score + signal.netAdjustment).toFixed(2))) }
                : hit;
        });
        rescored.sort((a, b) => b.score - a.score || b.node.createdAt - a.node.createdAt);
        return rescored.slice(0, limit);
    };

    const withAdvanced = graph as Graph & {
        searchAdvanced?: (contextId: string, query: string, options?: { limit?: number; sinceMs?: number; includeSuperseded?: boolean }) => SearchResult[];
    };
    if (typeof withAdvanced.searchAdvanced === 'function') {
        return applyFeedback(withAdvanced.searchAdvanced(contextId, query, {
            limit,
            sinceMs: sinceHours * 60 * 60 * 1000,
            includeSuperseded: false
        }));
    }

    return applyFeedback(graph.search(contextId, query, limit).map((node, idx): SearchResult => ({
        node,
        score: Math.max(0, 100 - idx * 10),
        matchReason: 'exact_term',
        matchedTerms: query.toLowerCase().match(/[a-z0-9_]+/g) ?? []
    })));
}

export function buildGraphRecall(
    graph: Graph,
    contextId: string,
    options: { query?: string; limit: number; sinceMs: number; depth: number; maxNodes: number; anchorNodeIds?: string[] }
) {
    const anchors: Array<{ nodeId: string; score: number | null; source: 'query' | 'explicit' }> = [];

    if (options.query && options.query.trim().length > 0) {
        for (const hit of getTopicHits(graph, contextId, options.query, options.limit, Math.max(1, options.sinceMs / (60 * 60 * 1000)))) {
            anchors.push({ nodeId: hit.node.id, score: hit.score, source: 'query' });
        }
    }
    if (Array.isArray(options.anchorNodeIds)) {
        for (const nodeId of options.anchorNodeIds) {
            if (typeof nodeId !== 'string' || nodeId.length === 0 || anchors.some(anchor => anchor.nodeId === nodeId)) continue;
            anchors.push({ nodeId, score: null, source: 'explicit' });
        }
    }

    const nodeMap = new Map<string, Record<string, unknown>>();
    const edgeMap = new Map<string, Record<string, unknown>>();
    const selectedAnchors = anchors.slice(0, options.limit);

    for (const anchor of selectedAnchors) {
        const subgraph = graph.getSubgraph(anchor.nodeId, options.depth, options.maxNodes);
        for (const node of subgraph.nodes) {
            nodeMap.set(node.id, {
                id: node.id,
                contextId: node.contextId,
                type: node.type,
                content: node.content,
                key: node.key ?? null,
                tags: node.tags ?? [],
                createdAt: node.createdAt
            });
        }
        for (const edge of subgraph.edges) {
            edgeMap.set(edge.id, {
                id: edge.id,
                fromId: edge.fromId,
                toId: edge.toId,
                relation: edge.relation,
                createdAt: edge.createdAt
            });
        }
    }

    return {
        mode: 'graph' as const,
        contextId,
        anchors: selectedAnchors,
        subgraph: {
            nodes: Array.from(nodeMap.values()),
            edges: Array.from(edgeMap.values())
        }
    };
}
