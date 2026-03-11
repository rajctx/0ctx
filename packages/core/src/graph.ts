import { randomBytes } from 'crypto';
import type Database from 'better-sqlite3';
import type {
    AgentSessionSummary,
    AuditAction,
    AuditEntry,
    AuditMetadata,
    BranchLaneSummary,
    ChatSessionSummary,
    ChatTurnSummary,
    Checkpoint,
    CheckpointDetail,
    CheckpointKind,
    CheckpointPayloadRecord,
    CheckpointSummary,
    Context,
    ContextDump,
    ContextEdge,
    ContextNode,
    EdgeType,
    HandoffTimelineEntry,
    InsightPromotionResult,
    InsightSummary,
    KnowledgeExtractionResult,
    KnowledgePreviewResult,
    NodePayloadCompression,
    NodePayloadRecord,
    SearchAdvancedOptions,
    SearchResult,
    SessionDetail,
    SessionMessage,
    SyncPolicy
} from './schema';
import { getConfigValue, setConfigValue } from './config';
import { createContextRecord, deleteContextRecord, getContextRecord, getContextSyncPolicyRecord, listContextRecords, setContextSyncPolicyRecord } from './graph/contexts';
import { buildAuditDeps, buildCheckpointDeps, buildCheckpointDetail, buildDumpDeps, buildInsightDeps, buildKnowledgeCheckpointDeps, buildKnowledgeSessionDeps, buildSessionDeps, buildWorkstreamDeps } from './graph/deps';
import { exportContextDumpRecord, importContextDumpRecord, replaceContextFromDumpRecord } from './graph/dump';
import { getInsightSummaryRecord, listWorkstreamInsightsRecord, promoteInsightNodeRecord } from './graph/insights';
import { extractKnowledgeFromCheckpointRecord, previewKnowledgeFromCheckpointRecord } from './graph/knowledge-checkpoint';
import { extractKnowledgeFromSessionRecord, previewKnowledgeFromSessionRecord } from './graph/knowledge-session';
import { parseCheckpointRow } from './graph/helpers';
import { addEdgeRecord, addNodeRecord, deleteNodeRecord, ensureEdgeRecord, getByKeyRecord, getEdgesRecord, getNodeRecord, getSubgraphRecords, updateNodeRecord } from './graph/nodes';
import { getCheckpointPayloadRecord, getNodePayloadRecord, setCheckpointPayloadRecord, setNodePayloadRecord } from './graph/payloads';
import { getGraphDataRecords, searchAdvancedRecords, searchRecords } from './graph/search';
import { getSessionDetailRecord, listChatSessionsRecord, listChatTurnsRecord, listSessionMessagesRecord } from './graph/sessions';
import { createSessionCheckpointRecord, insertCheckpointRecord, listCheckpointsRecord, rewindCheckpointRecord, saveCheckpointRecord } from './graph/checkpoints';
import { listAuditEventsRecord, recordAuditEventRecord, verifyAuditChainRecord } from './graph/audit';
import { getHandoffTimelineRecord, listBranchCheckpointsRecord, listBranchLanesRecord, listBranchSessionsRecord, refreshBranchLaneProjectionRecord } from './graph/workstreams';

export class Graph {
    constructor(private db: Database.Database) { }

    private resolveAuditSecret() {
        const existing = getConfigValue('audit.hmacSecret');
        if (typeof existing === 'string' && existing.length > 0) return existing;
        const generated = randomBytes(32).toString('hex');
        setConfigValue('audit.hmacSecret', generated);
        return generated;
    }

    private refreshBranchLaneProjection(contextId: string) { refreshBranchLaneProjectionRecord(this.workstreamDeps(), contextId); }
    private insertCheckpoint(checkpoint: Checkpoint) { insertCheckpointRecord(this.db, checkpoint); }
    private replaceContextFromDump(contextId: string, dump: ContextDump) { replaceContextFromDumpRecord(this.dumpDeps(), contextId, dump); }
    private sessionDeps() { return buildSessionDeps(this.db, (nodeId) => this.getNodePayload(nodeId)); }
    private workstreamDeps() { return buildWorkstreamDeps(this.db, { listChatSessions: (contextId, limit) => this.listChatSessions(contextId, limit) as AgentSessionSummary[], listCheckpoints: (contextId) => this.listCheckpoints(contextId) }); }
    private insightDeps() { return buildInsightDeps(this.db, { getNode: (id) => this.getNode(id), getByKey: (contextId, key, options) => this.getByKey(contextId, key, options), addNode: (params) => this.addNode(params) }); }
    private knowledgeSessionDeps() { return buildKnowledgeSessionDeps({ getSessionDetail: (contextId, sessionId) => this.getSessionDetail(contextId, sessionId), getByKey: (contextId, key, options) => this.getByKey(contextId, key, options), getInsightSummary: (nodeId) => getInsightSummaryRecord(this.insightDeps(), nodeId), addNode: (params) => this.addNode(params), ensureEdge: (fromId, toId, relation) => ensureEdgeRecord(this.db, fromId, toId, relation) }); }
    private knowledgeCheckpointDeps() { return buildKnowledgeCheckpointDeps(this.db, { previewKnowledgeFromSession: (contextId, sessionId, options) => previewKnowledgeFromSessionRecord(this.knowledgeSessionDeps(), contextId, sessionId, options), extractKnowledgeFromSession: (contextId, sessionId, options) => extractKnowledgeFromSessionRecord(this.knowledgeSessionDeps(), contextId, sessionId, options), getByKey: (contextId, key, options) => this.getByKey(contextId, key, options), getNode: (id) => this.getNode(id), addNode: (params) => this.addNode(params) }); }
    private dumpDeps() { return buildDumpDeps(this.db, { getContext: (id) => this.getContext(id), listCheckpoints: (contextId) => this.listCheckpoints(contextId), getNodePayload: (nodeId) => this.getNodePayload(nodeId), getCheckpointPayload: (checkpointId) => this.getCheckpointPayload(checkpointId), createContext: (name, paths, syncPolicy) => this.createContext(name, paths, syncPolicy), setNodePayload: (nodeId, contextId, payload, options) => this.setNodePayload(nodeId, contextId, payload, options), setCheckpointPayload: (checkpointId, contextId, payload, options) => this.setCheckpointPayload(checkpointId, contextId, payload, options), refreshBranchLaneProjection: (contextId) => this.refreshBranchLaneProjection(contextId), deleteContext: (contextId) => this.deleteContext(contextId), insertCheckpoint: (checkpoint) => this.insertCheckpoint(checkpoint) }); }
    private checkpointDeps() { return buildCheckpointDeps(this.db, { getCheckpointPayload: (checkpointId) => this.getCheckpointPayload(checkpointId), setCheckpointPayload: (checkpointId, contextId, payload, options) => this.setCheckpointPayload(checkpointId, contextId, payload, options), exportContextDump: (contextId) => this.exportContextDump(contextId), refreshBranchLaneProjection: (contextId) => this.refreshBranchLaneProjection(contextId), replaceContextFromDump: (contextId, dump) => this.replaceContextFromDump(contextId, dump), listChatSessions: (contextId, limit) => this.listChatSessions(contextId, limit) as AgentSessionSummary[] }); }
    private auditDeps() { return buildAuditDeps(this.db, () => this.resolveAuditSecret()); }

    createContext(name: string, paths: string[] = [], syncPolicy: SyncPolicy = 'metadata_only'): Context { return createContextRecord(this.db, name, paths, syncPolicy); }
    getContext(id: string): Context | null { return getContextRecord(this.db, id); }
    listContexts(): Context[] { return listContextRecords(this.db); }
    getContextSyncPolicy(contextId: string): SyncPolicy | null { return getContextSyncPolicyRecord(this.db, contextId); }
    setContextSyncPolicy(contextId: string, policy: SyncPolicy): Context | null { return setContextSyncPolicyRecord(this.db, contextId, policy); }
    deleteContext(id: string): void { deleteContextRecord(this.db, id); }
    addNode(params: Omit<ContextNode, 'id' | 'createdAt'> & { rawPayload?: unknown; payloadContentType?: string; createdAtOverride?: number }): ContextNode { return addNodeRecord(this.db, params); }
    getNode(id: string): ContextNode | null { return getNodeRecord(this.db, id); }
    getByKey(contextId: string, key: string, options: { includeHidden?: boolean } = {}): ContextNode | null { return getByKeyRecord(this.db, contextId, key, options); }
    deleteNode(id: string): void { deleteNodeRecord(this.db, id); }
    updateNode(id: string, updates: Partial<Pick<ContextNode, 'content' | 'tags' | 'hidden'>>): ContextNode | null { return updateNodeRecord(this.db, id, updates); }
    addEdge(fromId: string, toId: string, relation: EdgeType): ContextEdge { return addEdgeRecord(this.db, fromId, toId, relation); }
    getEdges(nodeId: string): ContextEdge[] { return getEdgesRecord(this.db, nodeId); }
    getSubgraph(rootId: string, depth = 2, maxNodes = 20): { nodes: ContextNode[]; edges: ContextEdge[] } { return getSubgraphRecords(this.db, rootId, depth, maxNodes); }
    searchAdvanced(contextId: string, query: string, options: SearchAdvancedOptions = {}): SearchResult[] { return searchAdvancedRecords(this.db, contextId, query, options); }
    search(contextId: string, query: string, limit = 20, options: { includeHidden?: boolean } = {}): ContextNode[] { return searchRecords(this.db, contextId, query, limit, options); }
    getGraphData(contextId: string, options: { includeHidden?: boolean } = {}) { return getGraphDataRecords(this.db, contextId, options); }
    setNodePayload(nodeId: string, contextId: string, payload: unknown, options: { contentType?: string; compression?: NodePayloadCompression; createdAt?: number; updatedAt?: number } = {}): NodePayloadRecord { return setNodePayloadRecord(this.db, nodeId, contextId, payload, options); }
    getNodePayload(nodeId: string): NodePayloadRecord | null { return getNodePayloadRecord(this.db, nodeId); }
    setCheckpointPayload(checkpointId: string, contextId: string, payload: unknown, options: { contentType?: string; compression?: NodePayloadCompression; createdAt?: number; updatedAt?: number } = {}): CheckpointPayloadRecord { return setCheckpointPayloadRecord(this.db, checkpointId, contextId, payload, options); }
    getCheckpointPayload(checkpointId: string): CheckpointPayloadRecord | null { return getCheckpointPayloadRecord(this.db, checkpointId); }
    listChatSessions(contextId: string, limit = 50): ChatSessionSummary[] { return listChatSessionsRecord(this.sessionDeps(), contextId, limit); }
    listBranchLanes(contextId: string, limit = 200): BranchLaneSummary[] { return listBranchLanesRecord(this.workstreamDeps(), contextId, limit); }
    listBranchSessions(contextId: string, branch: string, options: { worktreePath?: string | null; limit?: number } = {}): AgentSessionSummary[] { return listBranchSessionsRecord(this.workstreamDeps(), contextId, branch, options); }
    listChatTurns(contextId: string, sessionId: string, limit = 200): ChatTurnSummary[] { return listChatTurnsRecord(this.sessionDeps(), contextId, sessionId, limit); }
    listSessionMessages(contextId: string, sessionId: string, limit = 500): SessionMessage[] { return listSessionMessagesRecord(this.sessionDeps(), contextId, sessionId, limit); }
    getSessionDetail(contextId: string, sessionId: string): SessionDetail { return getSessionDetailRecord(this.sessionDeps(), contextId, sessionId); }
    listBranchCheckpoints(contextId: string, branch: string, options: { worktreePath?: string | null; limit?: number } = {}): CheckpointSummary[] { return listBranchCheckpointsRecord(this.workstreamDeps(), contextId, branch, options); }
    getCheckpointDetail(checkpointId: string): CheckpointDetail | null { return buildCheckpointDetail(this.db, (id) => this.getCheckpointPayload(id), checkpointId); }
    getHandoffTimeline(contextId: string, branch?: string, worktreePath?: string | null, limit = 100): HandoffTimelineEntry[] { return getHandoffTimelineRecord(this.workstreamDeps(), contextId, branch, worktreePath, limit); }
    listWorkstreamInsights(contextId: string, options: { branch?: string | null; worktreePath?: string | null; limit?: number } = {}): InsightSummary[] { return listWorkstreamInsightsRecord(this.insightDeps(), contextId, options); }
    promoteInsightNode(sourceContextId: string, sourceNodeId: string, targetContextId: string, options: { branch?: string | null; worktreePath?: string | null } = {}): InsightPromotionResult { return promoteInsightNodeRecord(this.insightDeps(), sourceContextId, sourceNodeId, targetContextId, options); }
    previewKnowledgeFromSession(contextId: string, sessionId: string, options: { checkpointId?: string | null; maxNodes?: number; source?: 'session' | 'checkpoint'; minConfidence?: number; autoPersistOnly?: boolean } = {}): KnowledgePreviewResult { return previewKnowledgeFromSessionRecord(this.knowledgeSessionDeps(), contextId, sessionId, options); }
    extractKnowledgeFromSession(contextId: string, sessionId: string, options: { checkpointId?: string | null; maxNodes?: number; source?: 'session' | 'checkpoint'; allowedKeys?: string[] | null; minConfidence?: number; autoPersistOnly?: boolean } = {}): KnowledgeExtractionResult { return extractKnowledgeFromSessionRecord(this.knowledgeSessionDeps(), contextId, sessionId, options); }
    previewKnowledgeFromCheckpoint(checkpointId: string, options: { maxNodes?: number; minConfidence?: number; autoPersistOnly?: boolean } = {}): KnowledgePreviewResult { return previewKnowledgeFromCheckpointRecord(this.knowledgeCheckpointDeps(), checkpointId, options); }
    extractKnowledgeFromCheckpoint(checkpointId: string, options: { maxNodes?: number; allowedKeys?: string[] | null; minConfidence?: number; autoPersistOnly?: boolean } = {}): KnowledgeExtractionResult { return extractKnowledgeFromCheckpointRecord(this.knowledgeCheckpointDeps(), checkpointId, options); }
    recordAuditEvent(params: { action: AuditAction; contextId?: string | null; payload?: Record<string, unknown>; result?: Record<string, unknown> | null; metadata?: AuditMetadata }): AuditEntry { return recordAuditEventRecord(this.auditDeps(), params); }
    verifyAuditChain(limit = 1000): { valid: boolean; checked: number; brokenAt?: string } { return verifyAuditChainRecord(this.auditDeps(), limit); }
    listAuditEvents(contextId?: string, limit = 50): AuditEntry[] { return listAuditEventsRecord(this.auditDeps(), contextId, limit); }
    exportContextDump(contextId: string): ContextDump { return exportContextDumpRecord(this.dumpDeps(), contextId); }
    importContextDump(dump: ContextDump, options?: { name?: string }): Context { return importContextDumpRecord(this.dumpDeps(), dump, options); }
    saveCheckpoint(contextId: string, name: string): Checkpoint { return saveCheckpointRecord(this.checkpointDeps(), contextId, name); }
    createSessionCheckpoint(contextId: string, sessionId: string, options: { name?: string; summary?: string; kind?: CheckpointKind } = {}): Checkpoint { return createSessionCheckpointRecord(this.checkpointDeps(), contextId, sessionId, options); }
    rewind(checkpointId: string): void { this.rewindCheckpoint(checkpointId); }
    rewindCheckpoint(checkpointId: string): CheckpointDetail { return rewindCheckpointRecord(this.checkpointDeps(), checkpointId); }
    resumeSession(contextId: string, sessionId: string): SessionDetail { return this.getSessionDetail(contextId, sessionId); }
    explainCheckpoint(checkpointId: string): CheckpointDetail | null { return this.getCheckpointDetail(checkpointId); }
    listCheckpoints(contextId: string): Checkpoint[] { return listCheckpointsRecord(this.db, parseCheckpointRow, contextId); }
}
