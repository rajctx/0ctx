import type { ContextDump, SyncPolicy } from '@0ctx/core';
import {
    PATH_KEY_PATTERN,
    REDACTED_PATH,
    REDACTED_SECRET,
    SECRET_KEY_PATTERN,
    SECRET_VALUE_PATTERNS
} from './constants';

export function buildFullSyncPayload(dump: ContextDump): ContextDump {
    return {
        ...dump,
        context: {
            ...dump.context,
            paths: []
        },
        nodes: dump.nodes.map((node) => ({
            ...node,
            content: sanitize(node.content, 'content') as string
        })),
        checkpoints: dump.checkpoints.map((checkpoint) => ({
            ...checkpoint,
            name: sanitize(checkpoint.name, 'name') as string,
            summary: sanitize(checkpoint.summary ?? null, 'summary') as string | null
        })),
        nodePayloads: [],
        checkpointPayloads: []
    };
}

export function buildMetadataOnlyPayload(dump: ContextDump): Record<string, unknown> {
    const nodeTypeCounts: Record<string, number> = {};
    for (const node of dump.nodes) {
        nodeTypeCounts[node.type] = (nodeTypeCounts[node.type] ?? 0) + 1;
    }

    const latestNode = dump.nodes[dump.nodes.length - 1] ?? null;
    const latestCheckpoint = dump.checkpoints[dump.checkpoints.length - 1] ?? null;

    return {
        version: 1,
        mode: 'metadata_only',
        exportedAt: dump.exportedAt,
        context: {
            id: dump.context.id,
            name: dump.context.name,
            createdAt: dump.context.createdAt,
            syncPolicy: 'metadata_only' as SyncPolicy
        },
        graph: {
            nodeCount: dump.nodes.length,
            edgeCount: dump.edges.length,
            checkpointCount: dump.checkpoints.length,
            nodeTypes: nodeTypeCounts
        },
        pointers: {
            latestNodeId: latestNode?.id ?? null,
            latestNodeAt: latestNode?.createdAt ?? null,
            latestCheckpointId: latestCheckpoint?.id ?? null,
            latestCheckpointAt: latestCheckpoint?.createdAt ?? null
        }
    };
}

function sanitize(value: unknown, key: string | null = null): unknown {
    if (Array.isArray(value)) {
        if (key === 'paths') {
            return [];
        }
        return value.map((entry) => sanitize(entry, key));
    }

    if (value && typeof value === 'object') {
        const source = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const [childKey, childValue] of Object.entries(source)) {
            if (childKey === 'paths') {
                out[childKey] = [];
                continue;
            }
            if (PATH_KEY_PATTERN.test(childKey)) {
                out[childKey] = childValue == null ? childValue : REDACTED_PATH;
                continue;
            }
            if (SECRET_KEY_PATTERN.test(childKey)) {
                out[childKey] = childValue == null ? childValue : REDACTED_SECRET;
                continue;
            }
            out[childKey] = sanitize(childValue, childKey);
        }
        return out;
    }

    if (typeof value === 'string') {
        if (key && PATH_KEY_PATTERN.test(key)) {
            return REDACTED_PATH;
        }
        if (key && SECRET_KEY_PATTERN.test(key)) {
            return REDACTED_SECRET;
        }

        let redacted = value;
        for (const pattern of SECRET_VALUE_PATTERNS) {
            redacted = redacted.replace(pattern, REDACTED_SECRET);
        }
        return redacted;
    }

    return value;
}
