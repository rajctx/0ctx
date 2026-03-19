export function formatScopedDataPolicyPresetLabel(preset: string | null | undefined): string {
    switch (String(preset || '').trim().toLowerCase()) {
        case 'lean':
            return 'Lean (machine default)';
        case 'review':
            return 'Review (machine default)';
        case 'debug':
            return 'Debug (machine default)';
        case 'shared':
            return 'Legacy Remote Sync (workspace override)';
        case 'custom':
            return 'Custom';
        default:
            return 'Unknown';
    }
}

export function describePolicyNormalPath(options: {
    workspaceResolved: boolean;
    syncPolicy: string | null | undefined;
}): string {
    const syncPolicy = String(options.syncPolicy || 'local_only').trim().toLowerCase();
    if (!options.workspaceResolved) return 'Needs workspace binding';
    return syncPolicy === 'full_sync'
        ? 'Active | workspace still carries a legacy full_sync setting; machine defaults remain local'
        : syncPolicy === 'metadata_only'
            ? 'Active | workspace still carries a legacy metadata_only setting; machine defaults remain local'
            : 'Active | workspace sync is local_only; machine defaults remain local';
}

export function describeDataPolicyScope(options: {
    workspaceResolved: boolean;
    preset: string | null | undefined;
    syncPolicy: string | null | undefined;
}): string {
    const preset = String(options.preset || '').trim().toLowerCase();
    const syncPolicy = String(options.syncPolicy || 'local_only').trim().toLowerCase();

    if (!options.workspaceResolved) {
        return 'Machine capture and debug defaults are resolved, but no workspace is currently bound.';
    }
    if (preset === 'shared' || syncPolicy === 'full_sync') {
            return 'This workspace still carries a legacy remote-sync setting. Machine capture and debug defaults remain local.';
    }
    if (preset === 'review') {
        return 'Workspace sync stays local_only for this workspace. Machine capture and debug defaults come from the Review machine preset.';
    }
    if (preset === 'debug') {
        return 'Workspace sync stays local_only for this workspace. Machine capture and debug defaults come from the Debug machine preset.';
    }
    if (preset === 'lean') {
        return 'Workspace sync stays local_only for this workspace. Machine capture and debug defaults come from the Lean machine preset.';
    }
    return 'Custom policy mixes workspace sync with machine-local capture and debug defaults.';
}
