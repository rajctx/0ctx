import type { ToolDispatchContext, ToolResponse } from './tool-dispatch-types';
import { jsonToolResult, textToolResult } from './tool-results';

export async function handleOpsToolCall(
    name: string,
    args: Record<string, unknown>,
    context: ToolDispatchContext
): Promise<ToolResponse | null> {
    const contextId = context.pickContextId(args);
    switch (name) {
        case 'ctx_health':
            return jsonToolResult(await context.callDaemon('health', {}));
        case 'ctx_metrics':
            return jsonToolResult(await context.callDaemon('metricsSnapshot', {}));
        case 'ctx_get_data_policy':
            return jsonToolResult(await context.callDaemon('getDataPolicy', { contextId }));
        case 'ctx_sync_policy_get':
            return jsonToolResult(await context.callDaemon('getSyncPolicy', { contextId }));
        case 'ctx_sync_policy_set':
            return jsonToolResult(await context.callDaemon('setSyncPolicy', { contextId, syncPolicy: args.syncPolicy }));
        case 'ctx_audit_recent':
            return jsonToolResult(await context.callDaemon('listAuditEvents', { contextId, limit: args.limit ?? 25 }));
        case 'ctx_backup_create': {
            const backup = await context.callDaemon('createBackup', {
                contextId,
                name: args.name,
                encrypted: args.encrypted ?? true
            });
            return textToolResult(`Backup created: ${backup.fileName}`);
        }
        case 'ctx_backup_list':
            return jsonToolResult(await context.callDaemon('listBackups', {}));
        case 'ctx_backup_restore': {
            const restored = await context.callDaemon('restoreBackup', { fileName: args.fileName, name: args.name });
            await context.switchSessionContext(restored.id);
            return textToolResult(`Restored to context: ${restored.id} (${restored.name})`);
        }
        case 'ctx_runtime_status':
            return jsonToolResult(await buildRuntimeStatus(context));
        case 'ctx_blackboard_subscribe':
            return jsonToolResult(await context.callDaemon('subscribeEvents', {
                contextId,
                types: args.types,
                afterSequence: args.afterSequence
            }));
        case 'ctx_blackboard_poll':
            return jsonToolResult(await context.callDaemon('pollEvents', {
                subscriptionId: args.subscriptionId,
                afterSequence: args.afterSequence,
                limit: args.limit
            }));
        case 'ctx_blackboard_ack':
            return jsonToolResult(await context.callDaemon('ackEvent', {
                subscriptionId: args.subscriptionId,
                eventId: args.eventId,
                sequence: args.sequence
            }));
        case 'ctx_blackboard_state':
            return jsonToolResult(await context.callDaemon('getBlackboardState', { contextId, limit: args.limit }));
        case 'ctx_blackboard_completion':
            return jsonToolResult(await context.callDaemon('evaluateCompletion', {
                contextId,
                cooldownMs: args.cooldownMs,
                requiredGates: args.requiredGates
            }));
        case 'ctx_task_claim':
            return jsonToolResult(await context.callDaemon('claimTask', {
                taskId: args.taskId,
                contextId,
                leaseMs: args.leaseMs
            }));
        case 'ctx_task_release':
            return jsonToolResult(await context.callDaemon('releaseTask', { taskId: args.taskId }));
        case 'ctx_gate_resolve':
            return jsonToolResult(await context.callDaemon('resolveGate', {
                gateId: args.gateId,
                contextId,
                severity: args.severity,
                status: args.status,
                message: args.message
            }));
        case 'ctx_auth_status':
            return jsonToolResult(await context.callDaemon('auth/status', {}));
        case 'ctx_sync_status':
            return jsonToolResult(await context.callDaemon('syncStatus', {}));
        case 'ctx_sync_now':
            return jsonToolResult(await context.callDaemon('syncNow', {}));
        default:
            return null;
    }
}

async function buildRuntimeStatus(context: ToolDispatchContext): Promise<unknown> {
    const health = await context.callDaemon('health', {}) as {
        auth?: { authenticated?: boolean; tokenExpired?: boolean; email?: string; tenantId?: string };
        sync?: {
            enabled?: boolean;
            running?: boolean;
            lastPushAt?: number | null;
            lastPullAt?: number | null;
            lastError?: string | null;
            queue?: { pending?: number; inFlight?: number; failed?: number; done?: number };
        } | null;
    };

    const auth = health.auth ?? {};
    const sync = health.sync ?? {};
    let posture: 'connected' | 'degraded' | 'offline' = 'offline';
    if (auth.authenticated && !auth.tokenExpired) {
        posture = (sync.enabled && sync.running) ? 'connected' : 'degraded';
    } else if (auth.authenticated && auth.tokenExpired) {
        posture = 'degraded';
    }

    return {
        posture,
        capabilities: [
            'graph', 'search', 'checkpoints', 'audit', 'backups',
            ...(auth.authenticated ? ['auth'] : []),
            ...(sync.enabled ? ['sync'] : [])
        ],
        auth: {
            authenticated: auth.authenticated ?? false,
            email: auth.email ?? null,
            tenantId: auth.tenantId ?? null,
            tokenExpired: auth.tokenExpired ?? false
        },
        sync: {
            enabled: sync.enabled ?? false,
            running: sync.running ?? false,
            lastPushAt: sync.lastPushAt ?? null,
            lastPullAt: sync.lastPullAt ?? null,
            lastError: sync.lastError ?? null,
            queue: sync.queue ?? { pending: 0, inFlight: 0, failed: 0, done: 0 }
        }
    };
}
