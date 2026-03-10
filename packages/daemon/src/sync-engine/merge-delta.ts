import type { ContextDump, ContextNode } from '@0ctx/core';
import { MAX_SYNC_AUDIT_NODE_DIFFS } from './constants';
import type {
    SyncContextSummary,
    SyncMergeDelta,
    SyncNodeAuditProjection,
    SyncNodeDiff
} from './types';

export function summarizeContextDump(dump: ContextDump): SyncContextSummary {
    return {
        contextId: dump.context.id,
        name: dump.context.name,
        syncPolicy: dump.context.syncPolicy,
        createdAt: dump.context.createdAt,
        nodeCount: dump.nodes.length,
        edgeCount: dump.edges.length,
        checkpointCount: dump.checkpoints.length
    };
}

export function buildMergeDelta(beforeDump: ContextDump | null, afterDump: ContextDump): SyncMergeDelta {
    const afterSummary = summarizeContextDump(afterDump);
    if (!beforeDump) {
        return {
            before: null,
            after: afterSummary,
            changes: {
                addedNodeCount: afterDump.nodes.length,
                removedNodeCount: 0,
                updatedNodeCount: 0,
                addedEdgeCount: afterDump.edges.length,
                removedEdgeCount: 0,
                addedCheckpointCount: afterDump.checkpoints.length,
                removedCheckpointCount: 0,
                overwrittenNodes: []
            }
        };
    }

    const beforeNodes = new Map(beforeDump.nodes.map((node) => [node.id, node]));
    const afterNodes = new Map(afterDump.nodes.map((node) => [node.id, node]));
    const overwrittenNodes: SyncNodeDiff[] = [];
    let addedNodeCount = 0;
    let removedNodeCount = 0;
    let updatedNodeCount = 0;

    for (const [nodeId, afterNode] of afterNodes) {
        const beforeNode = beforeNodes.get(nodeId);
        if (!beforeNode) {
            addedNodeCount += 1;
            continue;
        }
        if (!nodeEquivalent(beforeNode, afterNode)) {
            updatedNodeCount += 1;
            if (overwrittenNodes.length < MAX_SYNC_AUDIT_NODE_DIFFS) {
                overwrittenNodes.push({
                    nodeId,
                    before: projectNodeForAudit(beforeNode),
                    after: projectNodeForAudit(afterNode)
                });
            }
        }
    }

    for (const nodeId of beforeNodes.keys()) {
        if (!afterNodes.has(nodeId)) {
            removedNodeCount += 1;
        }
    }

    const beforeEdgeIds = new Set(beforeDump.edges.map((edge) => edge.id));
    const afterEdgeIds = new Set(afterDump.edges.map((edge) => edge.id));
    let addedEdgeCount = 0;
    let removedEdgeCount = 0;
    for (const edgeId of afterEdgeIds) {
        if (!beforeEdgeIds.has(edgeId)) addedEdgeCount += 1;
    }
    for (const edgeId of beforeEdgeIds) {
        if (!afterEdgeIds.has(edgeId)) removedEdgeCount += 1;
    }

    const beforeCheckpointIds = new Set(beforeDump.checkpoints.map((checkpoint) => checkpoint.id));
    const afterCheckpointIds = new Set(afterDump.checkpoints.map((checkpoint) => checkpoint.id));
    let addedCheckpointCount = 0;
    let removedCheckpointCount = 0;
    for (const checkpointId of afterCheckpointIds) {
        if (!beforeCheckpointIds.has(checkpointId)) addedCheckpointCount += 1;
    }
    for (const checkpointId of beforeCheckpointIds) {
        if (!afterCheckpointIds.has(checkpointId)) removedCheckpointCount += 1;
    }

    return {
        before: summarizeContextDump(beforeDump),
        after: afterSummary,
        changes: {
            addedNodeCount,
            removedNodeCount,
            updatedNodeCount,
            addedEdgeCount,
            removedEdgeCount,
            addedCheckpointCount,
            removedCheckpointCount,
            overwrittenNodes
        }
    };
}

function nodeEquivalent(a: ContextNode, b: ContextNode): boolean {
    if (a.content !== b.content) return false;
    if (a.type !== b.type) return false;
    if ((a.key ?? null) !== (b.key ?? null)) return false;
    if ((a.source ?? null) !== (b.source ?? null)) return false;
    if ((a.thread ?? null) !== (b.thread ?? null)) return false;
    if (Boolean(a.hidden) !== Boolean(b.hidden)) return false;

    const aTags = Array.isArray(a.tags) ? a.tags : [];
    const bTags = Array.isArray(b.tags) ? b.tags : [];
    if (aTags.length !== bTags.length) return false;
    for (let index = 0; index < aTags.length; index += 1) {
        if (aTags[index] !== bTags[index]) return false;
    }
    return true;
}

function projectNodeForAudit(node: ContextNode): SyncNodeAuditProjection {
    return {
        content: node.content,
        tags: Array.isArray(node.tags) ? node.tags : [],
        type: node.type,
        key: node.key ?? null,
        source: node.source ?? null,
        hidden: Boolean(node.hidden)
    };
}
