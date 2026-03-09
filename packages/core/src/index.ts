export { openDb } from './db';
export { getSchemaVersion, CURRENT_SCHEMA_VERSION } from './db';
export { Graph } from './graph';
export { encryptJson, decryptJson } from './encryption';
export type { EncryptedPayload } from './encryption';
export { loadConfig, saveConfig, getConfigValue, setConfigValue, listConfig, isValidConfigKey, getConfigPath } from './config';
export type { AppConfig } from './config';
export type {
    ContextNode,
    ContextEdge,
    NodeType,
    EdgeType,
    Checkpoint,
    Context,
    AuditEntry,
    AuditAction,
    AuditMetadata,
    ContextDump,
    NodePayloadRecord,
    NodePayloadCompression,
    CheckpointKind,
    CheckpointPayloadRecord,
    BranchLaneSummary,
    AgentSessionSummary,
    WorkstreamBrief,
    WorkstreamBaselineComparison,
    WorkstreamComparison,
    WorkspaceComparison,
    WorkspaceComparisonSide,
    AgentContextPack,
    DataPolicyPreset,
    DataPolicySummary,
    InsightSummary,
    SessionMessage,
    CheckpointSummary,
    SessionDetail,
    CheckpointDetail,
    HandoffTimelineEntry,
    KnowledgeCandidate,
    KnowledgePreviewResult,
    KnowledgeExtractionResult,
    InsightPromotionResult,
    ChatSessionSummary,
    ChatTurnSummary,
    SearchMatchReason,
    SearchAdvancedOptions,
    SearchResult,
    SyncPolicy,
    SyncStatus,
    SyncQueueEntry,
    SyncEnvelope
} from './schema';

