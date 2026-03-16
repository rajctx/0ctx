export interface TurnMetadata {
    branch: string | null;
    commitSha: string | null;
    role: string | null;
    occurredAt: number | null;
    agent: string | null;
    worktreePath: string | null;
    repositoryRoot: string | null;
    captureSource: string | null;
    sessionTitle: string | null;
    messageId: string | null;
    parentId: string | null;
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

export function extractString(record: unknown, path: string[]): string | null {
    let current: unknown = record;
    for (const key of path) {
        if (!current || typeof current !== 'object' || Array.isArray(current)) return null;
        current = (current as Record<string, unknown>)[key];
    }
    return typeof current === 'string' && current.trim().length > 0 ? current.trim() : null;
}

export function extractTimestampValue(record: unknown, path: string[]): number | null {
    let current: unknown = record;
    for (const key of path) {
        if (!current || typeof current !== 'object' || Array.isArray(current)) return null;
        current = (current as Record<string, unknown>)[key];
    }
    if (typeof current === 'number' && Number.isFinite(current)) {
        return current;
    }
    if (typeof current === 'string' && current.trim().length > 0) {
        const parsed = Date.parse(current.trim());
        if (Number.isFinite(parsed)) return parsed;
        const asNumber = Number(current.trim());
        if (Number.isFinite(asNumber)) return asNumber;
    }
    return null;
}

export function extractAgentFromKey(key: string | null | undefined): string | null {
    if (!key) return null;
    const parts = key.split(':');
    return parts.length >= 2 ? (parts[1] || null) : null;
}

export function extractAgentFromTags(tags: string[] | null | undefined): string | null {
    const tag = (tags ?? []).find((value) => typeof value === 'string' && value.startsWith('agent:'));
    return tag ? tag.slice('agent:'.length) : null;
}

export function extractTagValue(tags: string[] | null | undefined, prefix: string): string | null {
    const tag = (tags ?? []).find((value) => typeof value === 'string' && value.startsWith(prefix));
    return tag ? tag.slice(prefix.length) : null;
}

export function extractMessageIdFromKey(key: string | null | undefined): string | null {
    if (!key) return null;
    const parts = key.split(':');
    return parts.length >= 4 ? parts.slice(3).join(':') : null;
}

export function normalizeBranch(branch: string | null | undefined): string {
    const normalized = typeof branch === 'string' ? branch.trim() : '';
    return normalized.length > 0 ? normalized : 'detached';
}

export function normalizeWorktreePath(worktreePath: string | null | undefined): string {
    return typeof worktreePath === 'string' ? worktreePath.trim() : '';
}

export function branchLaneKey(branch: string | null | undefined, worktreePath: string | null | undefined): string {
    return `${normalizeBranch(branch)}::${normalizeWorktreePath(worktreePath)}`;
}

export function extractTurnMetadata(payload: unknown): TurnMetadata {
    const commitSha =
        extractString(payload, ['commitSha'])
        ?? extractString(payload, ['commit'])
        ?? extractString(payload, ['gitCommit'])
        ?? extractString(payload, ['git', 'commitSha'])
        ?? extractString(payload, ['git', 'commit'])
        ?? extractString(payload, ['meta', 'git', 'commitSha'])
        ?? extractString(payload, ['meta', 'git', 'commit']);
    const branch =
        extractString(payload, ['branch'])
        ?? extractString(payload, ['gitBranch'])
        ?? extractString(payload, ['git', 'branch'])
        ?? extractString(payload, ['meta', 'git', 'branch']);
    const role =
        extractString(payload, ['role'])
        ?? extractString(payload, ['meta', 'role'])
        ?? extractString(payload, ['message', 'role']);
    const occurredAt =
        extractTimestampValue(payload, ['occurredAt'])
        ?? extractTimestampValue(payload, ['timestamp'])
        ?? extractTimestampValue(payload, ['meta', 'occurredAt'])
        ?? extractTimestampValue(payload, ['meta', 'timestamp']);
    const agent =
        extractString(payload, ['agent'])
        ?? extractString(payload, ['meta', 'agent']);
    const worktreePath =
        extractString(payload, ['worktreePath'])
        ?? extractString(payload, ['git', 'worktreePath'])
        ?? extractString(payload, ['meta', 'worktreePath'])
        ?? extractString(payload, ['meta', 'git', 'worktreePath'])
        ?? extractString(payload, ['cwd']);
    const repositoryRoot =
        extractString(payload, ['repositoryRoot'])
        ?? extractString(payload, ['repoRoot'])
        ?? extractString(payload, ['repo_root'])
        ?? extractString(payload, ['meta', 'repositoryRoot'])
        ?? extractString(payload, ['meta', 'repoRoot'])
        ?? extractString(payload, ['meta', 'repository', 'root'])
        ?? worktreePath;
    const captureSource =
        extractString(payload, ['captureSource'])
        ?? extractString(payload, ['meta', 'captureSource']);
    const sessionTitle =
        extractString(payload, ['sessionTitle'])
        ?? extractString(payload, ['title'])
        ?? extractString(payload, ['summary'])
        ?? extractString(payload, ['meta', 'sessionTitle']);
    const messageId =
        extractString(payload, ['messageId'])
        ?? extractString(payload, ['message', 'id'])
        ?? extractString(payload, ['id']);
    const parentId =
        extractString(payload, ['parentId'])
        ?? extractString(payload, ['parent_id'])
        ?? extractString(payload, ['parent', 'id']);
    return { branch, commitSha, role, occurredAt, agent, worktreePath, repositoryRoot, captureSource, sessionTitle, messageId, parentId };
}
