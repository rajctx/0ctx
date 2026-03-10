import { readContextBackup, writeContextBackup } from '../backup';
import { applyDataPolicyUpdate, buildDataPolicySummary } from '../data-policy';
import { handled, NOT_HANDLED, type HandlerMethodContext, type MethodDispatchResult } from './types';
import {
    getContextIdFromParams,
    parseSyncPolicy,
    recordMutationAudit,
    recordMutationEvent,
    resolveContextId
} from './shared';

export function dispatchOpsRequest(context: HandlerMethodContext): MethodDispatchResult {
    const { graph, connectionId, req, params, contextId, sessionContextId, auditMetadata, runtime } = context;

    switch (req.method) {
        case 'getSyncPolicy': {
            const policy = graph.getContextSyncPolicy(contextId!);
            if (!policy) throw new Error(`Context ${contextId} not found`);
            return handled({ contextId: contextId!, syncPolicy: policy });
        }
        case 'getDataPolicy': {
            const explicitContextId = getContextIdFromParams(params);
            const targetContextId = explicitContextId ?? resolveContextId(connectionId, params, sessionContextId) ?? null;
            if (explicitContextId && !graph.getContextSyncPolicy(explicitContextId)) {
                throw new Error(`Context ${explicitContextId} not found`);
            }
            return handled(buildDataPolicySummary(graph, targetContextId));
        }
        case 'setDataPolicy': {
            const explicitContextId = getContextIdFromParams(params);
            const targetContextId = explicitContextId ?? resolveContextId(connectionId, params, sessionContextId) ?? null;
            if (explicitContextId && !graph.getContextSyncPolicy(explicitContextId)) {
                throw new Error(`Context ${explicitContextId} not found`);
            }
            const syncPolicy = parseSyncPolicy(params.syncPolicy);
            if (params.syncPolicy !== undefined && !syncPolicy) {
                throw new Error('Invalid syncPolicy. Expected one of: local_only, metadata_only, full_sync.');
            }
            const preset = typeof params.preset === 'string' && ['lean', 'review', 'debug', 'shared', 'custom'].includes(params.preset)
                ? params.preset as 'lean' | 'review' | 'debug' | 'shared' | 'custom'
                : null;
            const result = applyDataPolicyUpdate(graph, {
                contextId: targetContextId,
                preset,
                syncPolicy,
                captureRetentionDays: typeof params.captureRetentionDays === 'number' ? params.captureRetentionDays : null,
                debugRetentionDays: typeof params.debugRetentionDays === 'number' ? params.debugRetentionDays : null,
                debugArtifactsEnabled: typeof params.debugArtifactsEnabled === 'boolean' ? params.debugArtifactsEnabled : null
            });
            recordMutationAudit(graph, req, 'set_data_policy', result.contextId, params, result as unknown as Record<string, unknown>, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, result.contextId, params, result as unknown as Record<string, unknown>);
            return handled(result);
        }
        case 'shutdown':
            runtime.requestShutdown?.();
            return handled({ status: 'shutting_down' });
        case 'setSyncPolicy': {
            const syncPolicy = parseSyncPolicy(params.syncPolicy);
            if (!syncPolicy) throw new Error('Invalid syncPolicy. Expected one of: local_only, metadata_only, full_sync.');
            const updated = graph.setContextSyncPolicy(contextId!, syncPolicy);
            if (!updated) throw new Error(`Context ${contextId} not found`);
            const result = { contextId: updated.id, syncPolicy: updated.syncPolicy };
            recordMutationAudit(graph, req, 'set_sync_policy', updated.id, params, result, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, updated.id, params, result);
            return handled(result);
        }
        case 'createBackup': {
            const backup = writeContextBackup({
                dump: graph.exportContextDump(contextId!),
                backupName: typeof params.name === 'string' ? params.name : undefined,
                encrypted: typeof params.encrypted === 'boolean' ? params.encrypted : true
            });
            const result = { fileName: backup.fileName };
            recordMutationAudit(graph, req, 'create_backup', contextId, params, result, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, contextId, params, result);
            return handled(backup);
        }
        case 'restoreBackup': {
            const fileName = typeof params.fileName === 'string' ? params.fileName : null;
            if (!fileName) throw new Error("Missing required 'fileName' for restoreBackup.");
            const restoredContext = graph.importContextDump(readContextBackup(fileName), {
                name: typeof params.name === 'string' ? params.name : undefined
            });
            const result = { contextId: restoredContext.id };
            recordMutationAudit(graph, req, 'restore_backup', restoredContext.id, params, result, auditMetadata);
            recordMutationEvent(runtime, connectionId, req, restoredContext.id, params, result);
            return handled(restoredContext);
        }
        default:
            return NOT_HANDLED;
    }
}
