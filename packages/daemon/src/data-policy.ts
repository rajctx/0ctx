import { getConfigValue, setConfigValue, type AppConfig, type DataPolicyPreset, type DataPolicySummary, type Graph, type SyncPolicy } from '@0ctx/core';

export interface DataPolicyUpdate {
    contextId?: string | null;
    preset?: DataPolicyPreset | null;
    syncPolicy?: SyncPolicy | null;
    captureRetentionDays?: number | null;
    debugRetentionDays?: number | null;
    debugArtifactsEnabled?: boolean | null;
}

type DataPolicyPresetConfig = {
    syncPolicy: SyncPolicy;
    captureRetentionDays: number;
    debugRetentionDays: number;
    debugArtifactsEnabled: boolean;
};

const DATA_POLICY_PRESETS: Record<Exclude<DataPolicyPreset, 'custom'>, DataPolicyPresetConfig> = {
    lean: {
        syncPolicy: 'metadata_only',
        captureRetentionDays: 14,
        debugRetentionDays: 7,
        debugArtifactsEnabled: false
    },
    review: {
        syncPolicy: 'metadata_only',
        captureRetentionDays: 30,
        debugRetentionDays: 7,
        debugArtifactsEnabled: false
    },
    debug: {
        syncPolicy: 'metadata_only',
        captureRetentionDays: 30,
        debugRetentionDays: 14,
        debugArtifactsEnabled: true
    },
    shared: {
        syncPolicy: 'full_sync',
        captureRetentionDays: 14,
        debugRetentionDays: 7,
        debugArtifactsEnabled: false
    }
};

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

export function inferDataPolicyPreset(summary: {
    syncPolicy: SyncPolicy;
    captureRetentionDays: number;
    debugRetentionDays: number;
    debugArtifactsEnabled: boolean;
}): DataPolicyPreset {
    for (const [preset, config] of Object.entries(DATA_POLICY_PRESETS) as Array<[Exclude<DataPolicyPreset, 'custom'>, DataPolicyPresetConfig]>) {
        if (
            config.syncPolicy === summary.syncPolicy
            && config.captureRetentionDays === summary.captureRetentionDays
            && config.debugRetentionDays === summary.debugRetentionDays
            && config.debugArtifactsEnabled === summary.debugArtifactsEnabled
        ) {
            return preset;
        }
    }
    return 'custom';
}

export function getDataPolicyPresetConfig(preset: DataPolicyPreset | null | undefined): DataPolicyPresetConfig | null {
    if (!preset || preset === 'custom') {
        return null;
    }
    return DATA_POLICY_PRESETS[preset] ?? null;
}

export function buildDataPolicySummary(graph: Graph, contextId: string | null): DataPolicySummary {
    const syncPolicy = contextId
        ? graph.getContextSyncPolicy(contextId) ?? 'metadata_only'
        : 'metadata_only';
    const captureRetentionDays = getHookDumpRetentionDays();
    const debugRetentionDays = getHookDebugRetentionDays();
    const debugArtifactsEnabled = isHookDebugArtifactsEnabled();
    return {
        contextId,
        workspaceResolved: Boolean(contextId),
        syncScope: 'workspace',
        captureScope: 'machine',
        debugScope: 'machine',
        syncPolicy,
        captureRetentionDays,
        debugRetentionDays,
        debugArtifactsEnabled,
        preset: inferDataPolicyPreset({
            syncPolicy,
            captureRetentionDays,
            debugRetentionDays,
            debugArtifactsEnabled
        })
    };
}

export function applyDataPolicyUpdate(graph: Graph, update: DataPolicyUpdate): DataPolicySummary {
    const configUpdates: Array<[keyof AppConfig, AppConfig[keyof AppConfig]]> = [];

    const presetConfig = getDataPolicyPresetConfig(update.preset);
    if (presetConfig) {
        update = {
            ...update,
            syncPolicy: update.syncPolicy ?? presetConfig.syncPolicy,
            captureRetentionDays: update.captureRetentionDays ?? presetConfig.captureRetentionDays,
            debugRetentionDays: update.debugRetentionDays ?? presetConfig.debugRetentionDays,
            debugArtifactsEnabled: update.debugArtifactsEnabled ?? presetConfig.debugArtifactsEnabled
        };
    }

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
