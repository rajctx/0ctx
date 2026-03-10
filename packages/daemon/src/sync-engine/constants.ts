export const DEFAULT_INTERVAL_MS = 30_000;
export const DEFAULT_BATCH_SIZE = 5;
export const MAX_SYNC_AUDIT_NODE_DIFFS = 25;
export const REDACTED_SECRET = '[REDACTED_SECRET]';
export const REDACTED_PATH = '[REDACTED_PATH]';
export const SECRET_KEY_PATTERN = /(token|secret|password|api[_-]?key|client[_-]?secret|access[_-]?key|private[_-]?key|bearer|authorization|cookie|session[_-]?token)/i;
export const PATH_KEY_PATTERN = /(path|cwd|repo|root|worktree|transcript|socket|dir)$/i;
export const SECRET_VALUE_PATTERNS = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    /\bsk-[A-Za-z0-9]{20,}\b/g,
    /\bghp_[A-Za-z0-9]{20,}\b/g,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    /\bAIza[0-9A-Za-z\-_]{35}\b/g,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
];
export const MERGE_MUTATION_AUDIT_ACTIONS = [
    'create_context',
    'delete_context',
    'switch_context',
    'add_node',
    'update_node',
    'delete_node',
    'add_edge',
    'save_checkpoint',
    'rewind',
    'create_backup',
    'restore_backup',
    'set_sync_policy'
] as const;
