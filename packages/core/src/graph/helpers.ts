import type {
    Checkpoint,
    CheckpointSummary,
    ContextNode,
    SearchMatchReason
} from '../schema';

export function parseNodeRow(row: any): ContextNode {
    return {
        ...row,
        tags: row.tags ? JSON.parse(row.tags) : [],
        hidden: row.hidden === 1 || row.hidden === true
    };
}

export function parseCheckpointRow(row: any): Checkpoint {
    return {
        ...row,
        kind: (row.kind === 'manual' || row.kind === 'session' || row.kind === 'legacy') ? row.kind : 'legacy',
        nodeIds: row.nodeIds ? JSON.parse(row.nodeIds) : [],
        agentSet: row.agentSet ? JSON.parse(row.agentSet) : []
    };
}

export function toCheckpointSummary(checkpoint: Checkpoint): CheckpointSummary {
    return {
        checkpointId: checkpoint.id,
        contextId: checkpoint.contextId,
        branch: checkpoint.branch ?? null,
        worktreePath: checkpoint.worktreePath ?? null,
        sessionId: checkpoint.sessionId ?? null,
        commitSha: checkpoint.commitSha ?? null,
        createdAt: checkpoint.createdAt,
        summary: checkpoint.summary ?? checkpoint.name,
        kind: checkpoint.kind,
        name: checkpoint.name,
        agentSet: checkpoint.agentSet ?? []
    };
}

export function parsePayloadValue(raw: string, contentType: string): unknown {
    if (contentType.toLowerCase().includes('json')) {
        try {
            return JSON.parse(raw);
        } catch {
            return raw;
        }
    }
    return raw;
}

export function tokenizeQuery(query: string): string[] {
    return query.toLowerCase().split(/\s+/).map((term) => term.trim()).filter(Boolean);
}

export function buildFtsQuery(query: string): string {
    return tokenizeQuery(query)
        .map((term) => `"${term.replace(/"/g, '""')}"*`)
        .join(' OR ');
}

export function escapeRegex(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type { SearchMatchReason };
