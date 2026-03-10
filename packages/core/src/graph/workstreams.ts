import type Database from 'better-sqlite3';
import type {
    AgentSessionSummary,
    BranchLaneSummary,
    Checkpoint,
    CheckpointSummary,
    HandoffTimelineEntry
} from '../schema';

type WorkstreamDeps = {
    db: Database.Database;
    parseCheckpointRow: (row: any) => Checkpoint;
    toCheckpointSummary: (checkpoint: Checkpoint) => CheckpointSummary;
    listChatSessions: (contextId: string, limit?: number) => AgentSessionSummary[];
    listCheckpoints: (contextId: string) => Checkpoint[];
    normalizeBranch: (branch: string | null | undefined) => string;
    normalizeWorktreePath: (worktreePath: string | null | undefined) => string;
    branchLaneKey: (branch: string | null | undefined, worktreePath: string | null | undefined) => string;
};

export function refreshBranchLaneProjectionRecord(deps: WorkstreamDeps, contextId: string): void {
    const sessions = deps.listChatSessions(contextId, 5000);
    const checkpoints = deps.listCheckpoints(contextId);
    const lanes = new Map<string, {
        branch: string;
        worktreePath: string;
        lastAgent: string | null;
        lastCommitSha: string | null;
        lastActivityAt: number;
        sessionCount: number;
        checkpointCount: number;
        agentSet: Set<string>;
    }>();

    const ensureLane = (branch: string | null | undefined, worktreePath: string | null | undefined) => {
        const normalizedBranch = deps.normalizeBranch(branch);
        const normalizedWorktree = deps.normalizeWorktreePath(worktreePath);
        const key = deps.branchLaneKey(normalizedBranch, normalizedWorktree);
        let lane = lanes.get(key);
        if (!lane) {
            lane = {
                branch: normalizedBranch,
                worktreePath: normalizedWorktree,
                lastAgent: null,
                lastCommitSha: null,
                lastActivityAt: 0,
                sessionCount: 0,
                checkpointCount: 0,
                agentSet: new Set<string>()
            };
            lanes.set(key, lane);
        }
        return lane;
    };

    for (const session of sessions) {
        const lane = ensureLane(session.branch, session.worktreePath);
        lane.sessionCount += 1;
        if (session.agent) lane.agentSet.add(session.agent);
        if (session.lastTurnAt >= lane.lastActivityAt) {
            lane.lastActivityAt = session.lastTurnAt;
            lane.lastAgent = session.agent ?? lane.lastAgent;
            lane.lastCommitSha = session.commitSha ?? lane.lastCommitSha;
        }
    }

    for (const checkpoint of checkpoints) {
        const lane = ensureLane(checkpoint.branch, checkpoint.worktreePath);
        lane.checkpointCount += 1;
        for (const agent of checkpoint.agentSet ?? []) {
            if (agent) lane.agentSet.add(agent);
        }
        if (checkpoint.createdAt >= lane.lastActivityAt) {
            lane.lastActivityAt = checkpoint.createdAt;
            lane.lastCommitSha = checkpoint.commitSha ?? lane.lastCommitSha;
            lane.lastAgent = (checkpoint.agentSet ?? [])[0] ?? lane.lastAgent;
        }
    }

    const upsert = deps.db.prepare(`
      INSERT INTO branch_lanes (
        contextId, branch, worktreePath, lastAgent, lastCommitSha, lastActivityAt, sessionCount, checkpointCount, agentSet
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = deps.db.transaction(() => {
        deps.db.prepare('DELETE FROM branch_lanes WHERE contextId = ?').run(contextId);
        for (const lane of lanes.values()) {
            upsert.run(
                contextId,
                lane.branch,
                lane.worktreePath,
                lane.lastAgent,
                lane.lastCommitSha,
                lane.lastActivityAt,
                lane.sessionCount,
                lane.checkpointCount,
                JSON.stringify(Array.from(lane.agentSet))
            );
        }
    });
    tx();
}

export function listBranchLanesRecord(
    deps: WorkstreamDeps,
    contextId: string,
    limit = 200
): BranchLaneSummary[] {
    refreshBranchLaneProjectionRecord(deps, contextId);
    const safeLimit = Math.max(1, Math.min(limit, 1000));
    const rows = deps.db.prepare(`
      SELECT *
      FROM branch_lanes
      WHERE contextId = ?
      ORDER BY lastActivityAt DESC, branch ASC, worktreePath ASC
      LIMIT ?
    `).all(contextId, safeLimit) as Array<any>;

    return rows.map((row): BranchLaneSummary => ({
        contextId: row.contextId,
        branch: row.branch,
        worktreePath: row.worktreePath || null,
        repositoryRoot: null,
        currentHeadSha: null,
        currentHeadRef: null,
        isDetachedHead: null,
        headDiffersFromCaptured: null,
        lastAgent: row.lastAgent ?? null,
        lastCommitSha: row.lastCommitSha ?? null,
        lastActivityAt: row.lastActivityAt,
        sessionCount: row.sessionCount,
        checkpointCount: row.checkpointCount,
        agentSet: row.agentSet ? JSON.parse(row.agentSet) : [],
        upstream: null,
        aheadCount: null,
        behindCount: null,
        mergeBaseSha: null,
        isCurrent: null,
        hasUncommittedChanges: null,
        stagedChangeCount: null,
        unstagedChangeCount: null,
        untrackedCount: null,
        baseline: null
    }));
}

export function listBranchSessionsRecord(
    deps: WorkstreamDeps,
    contextId: string,
    branch: string,
    options: { worktreePath?: string | null; limit?: number } = {}
): AgentSessionSummary[] {
    const targetBranch = deps.normalizeBranch(branch);
    const targetWorktree = deps.normalizeWorktreePath(options.worktreePath);
    return deps.listChatSessions(contextId, options.limit ?? 5000).filter((session) => {
        if (deps.normalizeBranch(session.branch) !== targetBranch) return false;
        if (!targetWorktree) return true;
        return deps.normalizeWorktreePath(session.worktreePath) === targetWorktree;
    });
}

export function listBranchCheckpointsRecord(
    deps: WorkstreamDeps,
    contextId: string,
    branch: string,
    options: { worktreePath?: string | null; limit?: number } = {}
): CheckpointSummary[] {
    const safeLimit = Math.max(1, Math.min(options.limit ?? 500, 5000));
    const targetBranch = deps.normalizeBranch(branch);
    const targetWorktree = deps.normalizeWorktreePath(options.worktreePath);
    const rows = deps.db.prepare(`
      SELECT *
      FROM checkpoints
      WHERE contextId = ?
      ORDER BY createdAt DESC
      LIMIT ?
    `).all(contextId, safeLimit) as any[];

    return rows
        .map((row) => deps.parseCheckpointRow(row))
        .filter((checkpoint) => deps.normalizeBranch(checkpoint.branch) === targetBranch)
        .filter((checkpoint) => !targetWorktree || deps.normalizeWorktreePath(checkpoint.worktreePath) === targetWorktree)
        .map((checkpoint) => deps.toCheckpointSummary(checkpoint));
}

export function getHandoffTimelineRecord(
    deps: WorkstreamDeps,
    contextId: string,
    branch?: string,
    worktreePath?: string | null,
    limit = 100
): HandoffTimelineEntry[] {
    const safeLimit = Math.max(1, Math.min(limit, 1000));
    const sessions = deps.listChatSessions(contextId, 5000)
        .filter((session) => !branch || deps.normalizeBranch(session.branch) === deps.normalizeBranch(branch))
        .filter((session) => !worktreePath || deps.normalizeWorktreePath(session.worktreePath) === deps.normalizeWorktreePath(worktreePath))
        .sort((left, right) => right.lastTurnAt - left.lastTurnAt)
        .slice(0, safeLimit);

    return sessions.map((session) => ({
        branch: deps.normalizeBranch(session.branch),
        worktreePath: session.worktreePath ?? null,
        sessionId: session.sessionId,
        agent: session.agent ?? null,
        summary: session.summary,
        startedAt: session.startedAt,
        lastTurnAt: session.lastTurnAt,
        commitSha: session.commitSha ?? null
    }));
}
