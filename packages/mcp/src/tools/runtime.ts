import { defineTool } from './define';

export const runtimeTools = [
    defineTool('ctx_health', 'Check local daemon health and protocol status.'),
    defineTool('ctx_metrics', 'Get daemon request metrics snapshot for operations and latency trends.'),
    defineTool('ctx_get_data_policy', 'Get the current workspace data policy, including sync mode, capture retention, and debug-artifact settings.', {
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }),
    defineTool('ctx_sync_policy_get', 'Get the active context sync policy (`local_only`, `metadata_only`, `full_sync`).', {
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' }
    }),
    defineTool('ctx_sync_policy_set', 'Set the active context sync policy (`local_only`, `metadata_only`, `full_sync`).', {
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
        syncPolicy: { type: 'string', enum: ['local_only', 'metadata_only', 'full_sync'] }
    }, ['syncPolicy']),
    defineTool('ctx_audit_recent', 'List recent audit events for the active context (or a specific contextId).', {
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
        limit: { type: 'number', description: 'Max results (default 25).' }
    }),
    defineTool('ctx_backup_create', 'Create an encrypted local backup file for the active context.', {
        contextId: { type: 'string', description: 'Optional explicit context ID override for this operation.' },
        name: { type: 'string', description: 'Optional backup name.' },
        encrypted: { type: 'boolean', description: 'Whether to encrypt the backup payload (default true).' }
    }),
    defineTool('ctx_backup_list', 'List available local backup files.'),
    defineTool('ctx_backup_restore', 'Restore a context from a local backup file. Creates a new context.', {
        fileName: { type: 'string', description: 'Backup filename from ctx_backup_list.' },
        name: { type: 'string', description: 'Optional name override for the restored context.' }
    }, ['fileName']),
    defineTool('ctx_auth_status', 'Get the current authentication status (logged in/out, email, tenant, token expiry).'),
    defineTool('ctx_sync_status', 'Get the sync engine status including enabled state, queue counts, last push/pull timestamps, and errors.'),
    defineTool('ctx_sync_now', 'Trigger an immediate sync cycle (push pending changes then pull remote updates).')
];
