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
    SyncStatus,
    SyncQueueEntry,
    SyncEnvelope
} from './schema';
