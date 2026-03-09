import { getConfigValue, setConfigValue, type AppConfig, type DataPolicySummary, type Graph, type SyncPolicy } from '@0ctx/core';

export interface DataPolicyUpdate {
    contextId?: string | null;
    syncPolicy?: SyncPolicy | null;
    captureRetentionDays?: number | null;
    debugRetentionDays?: number | null;
    debugArtifactsEnabled?: boolean | null;
}

export function getHookDumpRetentionDays(): number {
    const configured = getConfigValue('capture.retentionDays');
    return Number.isFinite(configured) && configured > 0 ? configured : 14;
}

export function getHookDebugRetentionDays(): number {
    const configured = getConfigValue('capture.debugRetentionDays');
    return Number.isFinite(configured) && configured > 0 ? configured : 7;
}

export function isHookDebugArtifactsEnabled(): boolean {
    return getConfigValue('capture.debugArtifacts') === true;
}

export function buildDataPolicySummary(graph: Graph, contextId: string | null): DataPolicySummary {
    const syncPolicy = contextId
        ? graph.getContextSyncPolicy(contextId) ?? 'metadata_only'
        : 'metadata_only';
    return {
        contextId,
        workspaceResolved: Boolean(contextId),
        syncPolicy,
        captureRetentionDays: getHookDumpRetentionDays(),
        debugRetentionDays: getHookDebugRetentionDays(),
        debugArtifactsEnabled: isHookDebugArtifactsEnabled()
    };
}

export function applyDataPolicyUpdate(graph: Graph, update: DataPolicyUpdate): DataPolicySummary {
    const configUpdates: Array<[keyof AppConfig, AppConfig[keyof AppConfig]]> = [];

    if (typeof update.captureRetentionDays === 'number' && Number.isFinite(update.captureRetentionDays) && update.captureRetentionDays > 0) {
        configUpdates.push(['capture.retentionDays', Math.floor(update.captureRetentionDays)]);
    }
    if (typeof update.debugRetentionDays === 'number' && Number.isFinite(update.debugRetentionDays) && update.debugRetentionDays > 0) {
        configUpdates.push(['capture.debugRetentionDays', Math.floor(update.debugRetentionDays)]);
    }
    if (typeof update.debugArtifactsEnabled === 'boolean') {
        configUpdates.push(['capture.debugArtifacts', update.debugArtifactsEnabled]);
    }

    for (const [key, value] of configUpdates) {
        setConfigValue(key, value);
    }

    const contextId = typeof update.contextId === 'string' && update.contextId.trim().length > 0
        ? update.contextId
        : null;

    if (update.syncPolicy) {
        if (!contextId) {
            throw new Error("Workspace sync policy updates require a resolved 'contextId'.");
        }
        const updated = graph.setContextSyncPolicy(contextId, update.syncPolicy);
        if (!updated) {
            throw new Error(`Context ${contextId} not found`);
        }
    }

    return buildDataPolicySummary(graph, contextId);
}
