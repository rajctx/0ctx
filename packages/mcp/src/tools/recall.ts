import { defineTool } from './define';

export const recallTools = [
    defineTool('ctx_recall', 'Unified recall before starting work. Combines temporal, topic, and graph context into one payload.', {
        mode: { type: 'string', enum: ['auto', 'temporal', 'topic', 'graph'], description: 'Recall mode (default auto).' },
        query: { type: 'string', description: 'Optional topic query for topic/graph recall.' },
        sinceHours: { type: 'number', description: 'Lookback window in hours (default 24).' },
        limit: { type: 'number', description: 'Max hits/sessions to return (default 10).' },
        depth: { type: 'number', description: 'Graph traversal depth for graph recall (default 2).' },
        maxNodes: { type: 'number', description: 'Max graph nodes for graph recall (default 30).' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }),
    defineTool('ctx_recall_temporal', 'Reconstruct a recent activity timeline from audit/session history.', {
        sinceHours: { type: 'number', description: 'Lookback window in hours (default 24).' },
        limit: { type: 'number', description: 'Max sessions to return (default 10).' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }),
    defineTool('ctx_recall_topic', 'BM25-ranked topic recall over context nodes with reasoned ranking metadata.', {
        query: { type: 'string', description: 'Topic query for ranked recall.' },
        sinceHours: { type: 'number', description: 'Recency window in hours (default 24).' },
        limit: { type: 'number', description: 'Max hits to return (default 10).' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }, ['query']),
    defineTool('ctx_recall_graph', 'Graph-oriented recall from top topic anchors or explicit anchor nodes.', {
        query: { type: 'string', description: 'Optional query used to pick anchor nodes.' },
        anchorNodeIds: { type: 'array', items: { type: 'string' }, description: 'Optional explicit anchor node IDs.' },
        sinceHours: { type: 'number', description: 'Recency window in hours (default 24).' },
        limit: { type: 'number', description: 'Max anchors to use (default 6).' },
        depth: { type: 'number', description: 'Traversal depth (default 2).' },
        maxNodes: { type: 'number', description: 'Max nodes to include (default 30).' },
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    })
];
