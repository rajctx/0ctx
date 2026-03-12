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
        syncPolicy: 'local_only',
        captureRetentionDays: 14,
        debugRetentionDays: 7,
        debugArtifactsEnabled: false
    },
    review: {
        syncPolicy: 'local_only',
        captureRetentionDays: 30,
        debugRetentionDays: 7,
        debugArtifactsEnabled: false
    },
    debug: {
        syncPolicy: 'local_only',
        captureRetentionDays: 30,
        debugRetentionDays: 14,
        debugArtifactsEnabled: true
    },
    shared: {
        syncPolicy: 'metadata_only',
        captureRetentionDays: 14,
        debugRetentionDays: 7,
        debugArtifactsEnabled: false
    }
};

function formatWorkspaceSyncSummary(syncPolicy: SyncPolicy, workspaceResolved: boolean): {
    summary: string;
    hint: string;
} {
    const syncLabel = syncPolicy === 'full_sync'
        ? 'full_sync (opt-in)'
        : syncPolicy === 'metadata_only'
            ? 'metadata_only (opt-in)'
            : 'local_only (default)';
    if (workspaceResolved) {
        return {
            summary: syncLabel,
            hint: ''
        };
    }
    return {
        summary: 'No active workspace yet',
        hint: `${syncLabel} becomes the workspace default after a workspace is active.`
    };
}

function formatMachineCaptureSummary(options: {
    captureRetentionDays: number;
    debugRetentionDays: number;
    debugArtifactsEnabled: boolean;
}): string {
    if (options.debugArtifactsEnabled) {
        return `${options.captureRetentionDays}d local capture; ${options.debugRetentionDays}d debug trails enabled`;
    }
    return `${options.captureRetentionDays}d local capture; debug trails off by default (${options.debugRetentionDays}d if enabled)`;
}

function formatDebugUtilitySummary(options: {
    debugRetentionDays: number;
    debugArtifactsEnabled: boolean;
}): string {
    return options.debugArtifactsEnabled
        ? `Enabled locally for troubleshooting (${options.debugRetentionDays}d retention)`
        : `Off in the normal path (${options.debugRetentionDays}d retention if enabled)`;
}

function buildDataPolicyActionHint(summary: {
    workspaceResolved: boolean;
    syncPolicy: SyncPolicy;
    captureRetentionDays: number;
    debugRetentionDays: number;
    debugArtifactsEnabled: boolean;
    preset: DataPolicyPreset;
}): string | null {
    if (!summary.workspaceResolved) {
        return 'Full sync is available only after a workspace is active.';
    }
    if (summary.preset === 'custom') {
        return 'Choose Lean, Review, or Debug to return machine defaults to a supported path. Use Shared only when a workspace explicitly needs richer cloud sync.';
    }
    if (summary.preset === 'shared' || summary.syncPolicy === 'metadata_only' || summary.syncPolicy === 'full_sync') {
        return 'Return this workspace to local_only when cloud sync is no longer needed.';
    }
    if (summary.preset === 'debug' || summary.debugArtifactsEnabled) {
        return 'Turn off debug trails when troubleshooting is complete.';
    }
    if (summary.preset === 'review' || summary.captureRetentionDays > 14 || summary.debugRetentionDays > 7) {
        return 'Return this machine to Lean when the longer local review window is no longer needed.';
    }
    return null;
}

function buildNormalPathSummary(summary: {
    workspaceResolved: boolean;
    syncPolicy: SyncPolicy;
    preset: DataPolicyPreset;
    debugArtifactsEnabled: boolean;
}): string {
    if (!summary.workspaceResolved) {
        return 'No active workspace yet. Machine capture defaults are ready, and workspace sync stays local_only once a workspace is active.';
    }
    if (summary.syncPolicy === 'full_sync') {
        return 'Workspace sync is explicitly opted into full_sync. Machine capture defaults remain local.';
    }
    if (summary.preset === 'shared' || summary.syncPolicy === 'metadata_only') {
        return 'Workspace sync is explicitly opted into metadata_only. Machine capture defaults remain local.';
    }
    if (summary.preset === 'custom') {
        return 'Workspace sync and machine capture defaults use a custom combination.';
    }
    if (summary.preset === 'debug' || summary.debugArtifactsEnabled) {
        return 'Workspace sync stays local_only. Machine capture defaults are tuned for local debugging.';
    }
    if (summary.preset === 'review') {
        return 'Workspace sync stays local_only. Machine capture defaults are tuned for a longer local review window.';
    }
    return 'Lean is the normal default. Workspace sync stays local_only and machine capture defaults stay local.';
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
        ? graph.getContextSyncPolicy(contextId) ?? 'local_only'
        : 'local_only';
    const captureRetentionDays = getHookDumpRetentionDays();
    const debugRetentionDays = getHookDebugRetentionDays();
    const debugArtifactsEnabled = isHookDebugArtifactsEnabled();
    const workspaceResolved = Boolean(contextId);
    const preset = inferDataPolicyPreset({
        syncPolicy,
        captureRetentionDays,
        debugRetentionDays,
        debugArtifactsEnabled
    });
    const workspaceSync = formatWorkspaceSyncSummary(syncPolicy, workspaceResolved);
    const machineCaptureSummary = formatMachineCaptureSummary({
        captureRetentionDays,
        debugRetentionDays,
        debugArtifactsEnabled
    });
    const debugUtilitySummary = formatDebugUtilitySummary({
        debugRetentionDays,
        debugArtifactsEnabled
    });
    const policyActionHint = buildDataPolicyActionHint({
        workspaceResolved,
        syncPolicy,
        captureRetentionDays,
        debugRetentionDays,
        debugArtifactsEnabled,
        preset
    });
    return {
        contextId,
        workspaceResolved,
        syncScope: 'workspace',
        captureScope: 'machine',
        debugScope: 'machine',
        syncPolicy,
        captureRetentionDays,
        debugRetentionDays,
        debugArtifactsEnabled,
        preset,
        normalPathSummary: buildNormalPathSummary({
            workspaceResolved,
            syncPolicy,
            preset,
            debugArtifactsEnabled
        }),
        workspaceSyncSummary: workspaceSync.summary,
        workspaceSyncHint: workspaceSync.hint,
        machineCaptureSummary,
        debugUtilitySummary,
        policyActionHint
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
