import type Database from 'better-sqlite3';
import type {
    AgentSessionSummary,
    Checkpoint,
    CheckpointPayloadRecord,
    Context,
    ContextDump,
    ContextNode,
    NodePayloadRecord,
    SyncPolicy
} from '../schema';
import { getCheckpointDetailRecord, saveCheckpointRecord } from './checkpoints';
import { exportContextDumpRecord } from './dump';
import { getInsightSummaryRecord, listWorkstreamInsightsRecord } from './insights';
import { previewKnowledgeFromCheckpointRecord } from './knowledge-checkpoint';
import { previewKnowledgeFromSessionRecord } from './knowledge-session';
import {
    buildKnowledgeEvidenceReason,
    buildKnowledgeEvidenceSummary,
    buildKnowledgeTrustFlags,
    buildKnowledgeKey,
    boostKnowledgeCandidateConfidence,
    classifyKnowledgeAutoPersist,
    classifyKnowledgeReviewTier,
    sanitizePromotedInsightTags
} from './knowledge';
import { parseCheckpointRow, parseNodeRow, toCheckpointSummary } from './helpers';
import {
    extractAgentFromKey,
    extractAgentFromTags,
    branchLaneKey,
    extractMessageIdFromKey,
    extractTagValue,
    extractTurnMetadata,
    normalizeBranch,
    normalizeWorktreePath
} from './metadata';
import { recordAuditEventRecord } from './audit';

export function buildSessionDeps(
    db: Database.Database,
    getNodePayload: (nodeId: string) => NodePayloadRecord | null
): Parameters<typeof import('./sessions').listChatSessionsRecord>[0] {
    return {
        db,
        parseNodeRow,
        parseCheckpointRow,
        toCheckpointSummary,
        getNodePayload,
        extractTurnMetadata,
        extractAgentFromKey,
        extractAgentFromTags,
        extractMessageIdFromKey
    };
}

export function buildInsightDeps(
    db: Database.Database,
    ops: {
        getNode: (id: string) => ContextNode | null;
        getByKey: (contextId: string, key: string, options?: { includeHidden?: boolean }) => ContextNode | null;
        addNode: (params: Omit<ContextNode, 'id' | 'createdAt'> & { rawPayload?: unknown; payloadContentType?: string; createdAtOverride?: number }) => ContextNode;
    }
): Parameters<typeof listWorkstreamInsightsRecord>[0] {
    return {
        db,
        getNode: ops.getNode,
        getByKey: ops.getByKey,
        addNode: ops.addNode,
        extractTagValue,
        normalizeBranch,
        normalizeWorktreePath,
        buildKnowledgeKey: (contextId, type, content, options) => buildKnowledgeKey(contextId, type, content, {
            branch: options?.branch,
            worktreePath: options?.worktreePath,
            normalizeBranch,
            normalizeWorktreePath
        }),
        sanitizePromotedInsightTags,
        boostKnowledgeCandidateConfidence,
        classifyKnowledgeReviewTier,
        buildKnowledgeEvidenceSummary,
        buildKnowledgeTrustFlags
    };
}

export function buildKnowledgeSessionDeps(
    ops: {
        getSessionDetail: (contextId: string, sessionId: string) => ReturnType<typeof import('./sessions').getSessionDetailRecord>;
        getByKey: (contextId: string, key: string, options?: { includeHidden?: boolean }) => ContextNode | null;
        getInsightSummary: (nodeId: string) => ReturnType<typeof getInsightSummaryRecord>;
        addNode: (params: Omit<ContextNode, 'id' | 'createdAt'> & { rawPayload?: unknown; payloadContentType?: string; createdAtOverride?: number }) => ContextNode;
        ensureEdge: (fromId: string, toId: string, relation: 'caused_by') => void;
    }
): Parameters<typeof previewKnowledgeFromSessionRecord>[0] {
    return {
        getSessionDetail: ops.getSessionDetail,
        getByKey: ops.getByKey,
        getInsightSummary: ops.getInsightSummary,
        buildKnowledgeKey: (contextId, type, content, options) => buildKnowledgeKey(contextId, type, content, {
            branch: options?.branch,
            worktreePath: options?.worktreePath,
            normalizeBranch,
            normalizeWorktreePath
        }),
        boostKnowledgeCandidateConfidence,
        classifyKnowledgeAutoPersist,
        classifyKnowledgeReviewTier,
        buildKnowledgeEvidenceSummary,
        buildKnowledgeEvidenceReason,
        buildKnowledgeTrustFlags,
        addNode: ops.addNode,
        ensureEdge: ops.ensureEdge
    };
}

export function buildKnowledgeCheckpointDeps(
    db: Database.Database,
    ops: {
        previewKnowledgeFromSession: (contextId: string, sessionId: string, options?: { checkpointId?: string | null; maxNodes?: number; source?: 'session' | 'checkpoint'; minConfidence?: number; autoPersistOnly?: boolean }) => ReturnType<typeof previewKnowledgeFromSessionRecord>;
        extractKnowledgeFromSession: (contextId: string, sessionId: string, options?: { checkpointId?: string | null; maxNodes?: number; source?: 'session' | 'checkpoint'; allowedKeys?: string[] | null; minConfidence?: number; autoPersistOnly?: boolean }) => ReturnType<typeof import('./knowledge-session').extractKnowledgeFromSessionRecord>;
        getByKey: (contextId: string, key: string, options?: { includeHidden?: boolean }) => ContextNode | null;
        getNode: (id: string) => ContextNode | null;
        addNode: (params: Omit<ContextNode, 'id' | 'createdAt'> & { rawPayload?: unknown; payloadContentType?: string; createdAtOverride?: number }) => ContextNode;
    }
): Parameters<typeof previewKnowledgeFromCheckpointRecord>[0] {
    return {
        db,
        parseCheckpointRow,
        previewKnowledgeFromSession: ops.previewKnowledgeFromSession,
        extractKnowledgeFromSession: ops.extractKnowledgeFromSession,
        getByKey: ops.getByKey,
        getNode: ops.getNode,
        buildKnowledgeKey: (contextId, type, content, options) => buildKnowledgeKey(contextId, type, content, {
            branch: options?.branch,
            worktreePath: options?.worktreePath,
            normalizeBranch,
            normalizeWorktreePath
        }),
        classifyKnowledgeAutoPersist,
        classifyKnowledgeReviewTier,
        buildKnowledgeEvidenceSummary,
        buildKnowledgeTrustFlags,
        addNode: ops.addNode
    };
}

export function buildDumpDeps(
    db: Database.Database,
    ops: {
        getContext: (id: string) => Context | null;
        listCheckpoints: (contextId: string) => Checkpoint[];
        getNodePayload: (nodeId: string) => NodePayloadRecord | null;
        getCheckpointPayload: (checkpointId: string) => CheckpointPayloadRecord | null;
        createContext: (name: string, paths?: string[], syncPolicy?: SyncPolicy) => Context;
        setNodePayload: (nodeId: string, contextId: string, payload: unknown, options?: any) => NodePayloadRecord;
        setCheckpointPayload: (checkpointId: string, contextId: string, payload: unknown, options?: any) => CheckpointPayloadRecord;
        refreshBranchLaneProjection: (contextId: string) => void;
        deleteContext: (contextId: string) => void;
        insertCheckpoint: (checkpoint: Checkpoint) => void;
    }
): Parameters<typeof exportContextDumpRecord>[0] {
    return {
        db,
        getContext: ops.getContext,
        parseNodeRow,
        listCheckpoints: ops.listCheckpoints,
        getNodePayload: ops.getNodePayload,
        getCheckpointPayload: ops.getCheckpointPayload,
        createContext: ops.createContext,
        setNodePayload: ops.setNodePayload,
        setCheckpointPayload: ops.setCheckpointPayload,
        refreshBranchLaneProjection: ops.refreshBranchLaneProjection,
        deleteContext: ops.deleteContext,
        insertCheckpoint: ops.insertCheckpoint
    };
}

export function buildCheckpointDeps(
    db: Database.Database,
    ops: {
        getCheckpointPayload: (checkpointId: string) => CheckpointPayloadRecord | null;
        setCheckpointPayload: (checkpointId: string, contextId: string, payload: unknown, options?: any) => CheckpointPayloadRecord;
        exportContextDump: (contextId: string) => ContextDump;
        refreshBranchLaneProjection: (contextId: string) => void;
        replaceContextFromDump: (contextId: string, dump: ContextDump) => void;
        listChatSessions: (contextId: string, limit?: number) => AgentSessionSummary[];
    }
): Parameters<typeof saveCheckpointRecord>[0] {
    return {
        db,
        parseCheckpointRow,
        getCheckpointPayload: ops.getCheckpointPayload,
        setCheckpointPayload: ops.setCheckpointPayload,
        exportContextDump: ops.exportContextDump,
        refreshBranchLaneProjection: ops.refreshBranchLaneProjection,
        replaceContextFromDump: ops.replaceContextFromDump,
        listChatSessions: ops.listChatSessions,
        normalizeBranch
    };
}

export function buildWorkstreamDeps(
    db: Database.Database,
    ops: {
        listChatSessions: (contextId: string, limit?: number) => AgentSessionSummary[];
        listCheckpoints: (contextId: string) => Checkpoint[];
    }
): Parameters<typeof import('./workstreams').listBranchLanesRecord>[0] {
    return {
        db,
        parseCheckpointRow,
        toCheckpointSummary,
        listChatSessions: ops.listChatSessions,
        listCheckpoints: ops.listCheckpoints,
        normalizeBranch,
        normalizeWorktreePath,
        branchLaneKey
    };
}

export function buildAuditDeps(
    db: Database.Database,
    resolveAuditSecret: () => string
): Parameters<typeof recordAuditEventRecord>[0] {
    return { db, resolveAuditSecret };
}

export function buildCheckpointDetail(
    db: Database.Database,
    getCheckpointPayload: (checkpointId: string) => CheckpointPayloadRecord | null,
    checkpointId: string
) {
    return getCheckpointDetailRecord(db, parseCheckpointRow, getCheckpointPayload, checkpointId);
}
