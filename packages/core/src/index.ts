export { openDb } from './db';
export { getSchemaVersion, CURRENT_SCHEMA_VERSION } from './db';
export { Graph } from './graph';
export { encryptJson, decryptJson } from './encryption';
export type { EncryptedPayload } from './encryption';
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
    ContextDump
} from './schema';
