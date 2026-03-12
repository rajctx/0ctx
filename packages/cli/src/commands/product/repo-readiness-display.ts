import type { RepoReadinessSummary } from '@0ctx/core';
import { describePolicyNormalPath, formatScopedDataPolicyPresetLabel } from '../../cli-core/data-policy-display';

type DisplayMode = 'enable' | 'status';

export function buildRepoReadinessLines(options: {
    mode: DisplayMode;
    repoReadiness: RepoReadinessSummary;
    formatAgentList: (agents: string[]) => string;
    formatLabelValue: (label: string, value: string) => string;
    formatRetentionLabel: (summary: RepoReadinessSummary) => string;
    formatSyncPolicyLabel: (policy: string | null | undefined) => string;
    detectedHookClients?: string[];
    detectedMcpClients?: string[];
}): string[] {
    const { repoReadiness } = options;
    const captureLine = buildCaptureLine(options);
    const autoContextLine = buildAutoContextLine(options);
    const historySummary = repoReadiness.sessionCount === null
        ? 'No workstream history yet'
        : `${repoReadiness.sessionCount} sessions, ${repoReadiness.checkpointCount ?? 0} checkpoints`;

    return [
        options.formatLabelValue('Repo', repoReadiness.repoRoot),
        options.formatLabelValue('Workspace', repoReadiness.workspaceName ?? '-'),
        options.formatLabelValue('Workstream', repoReadiness.workstream ?? '-'),
        options.formatLabelValue('Ready', repoReadiness.zeroTouchReady ? 'zero-touch for supported agents' : 'needs one-time setup'),
        options.formatLabelValue('Policy', repoReadiness.normalPathSummary || describePolicyNormalPath({
            workspaceResolved: Boolean(repoReadiness.contextId),
            syncPolicy: repoReadiness.syncPolicy
        })),
        options.formatLabelValue('Policy mode', formatScopedDataPolicyPresetLabel(repoReadiness.dataPolicyPreset)),
        options.formatLabelValue('Capture', captureLine),
        options.formatLabelValue('Context', autoContextLine),
        options.formatLabelValue('History', historySummary),
        options.formatLabelValue('Workspace sync', repoReadiness.workspaceSyncSummary || options.formatSyncPolicyLabel(repoReadiness.syncPolicy)),
        options.formatLabelValue('Machine capture', repoReadiness.machineCaptureSummary || options.formatRetentionLabel(repoReadiness)),
        ...buildUtilityDebugLines(options),
        ...(repoReadiness.dataPolicyActionHint ? [options.formatLabelValue('Policy step', repoReadiness.dataPolicyActionHint)] : []),
        ...(repoReadiness.nextActionHint ? [options.formatLabelValue('Next step', repoReadiness.nextActionHint)] : [])
    ];
}

function buildUtilityDebugLines(options: {
    repoReadiness: RepoReadinessSummary;
    formatLabelValue: (label: string, value: string) => string;
}): string[] {
    const preset = String(options.repoReadiness.dataPolicyPreset || '').trim().toLowerCase();
    if (!options.repoReadiness.debugArtifactsEnabled && preset !== 'debug' && preset !== 'custom') {
        return [];
    }

    return [
        options.formatLabelValue(
            'Utility debug',
            options.repoReadiness.debugUtilitySummary
                || (options.repoReadiness.debugArtifactsEnabled
                    ? `enabled (${options.repoReadiness.debugRetentionDays}d retention)`
                    : `off in the normal path (${options.repoReadiness.debugRetentionDays}d retention if enabled)`)
        )
    ];
}

function buildCaptureLine(options: {
    mode: DisplayMode;
    repoReadiness: RepoReadinessSummary;
    formatAgentList: (agents: string[]) => string;
    detectedHookClients?: string[];
}): string {
    const { repoReadiness } = options;
    if (repoReadiness.captureManagedForRepo && repoReadiness.captureReadyAgents.length > 0) {
        return repoReadiness.captureMissingAgents.length === 0
            ? `${options.formatAgentList(repoReadiness.captureReadyAgents)} ready`
            : `${options.formatAgentList(repoReadiness.captureReadyAgents)} ready; ${options.formatAgentList(repoReadiness.captureMissingAgents)} not installed`;
    }
    if (options.mode === 'enable') {
        return (options.detectedHookClients ?? []).length > 0
            ? 'Detected supported agents but capture is not installed yet'
            : 'No supported capture integrations detected on this machine yet';
    }
    return 'Run 0ctx enable to install supported capture integrations';
}

function buildAutoContextLine(options: {
    mode: DisplayMode;
    repoReadiness: RepoReadinessSummary;
    formatAgentList: (agents: string[]) => string;
    detectedMcpClients?: string[];
}): string {
    const { repoReadiness } = options;
    const setupGaps = buildAutoContextSetupGaps(options);
    if (repoReadiness.autoContextAgents.length > 0) {
        return setupGaps.length === 0
            ? `${options.formatAgentList(repoReadiness.autoContextAgents)} inject current workstream context automatically`
            : `${options.formatAgentList(repoReadiness.autoContextAgents)} inject current workstream context automatically; ${setupGaps.join('; ')}`;
    }
    if (setupGaps.length > 0) {
        return setupGaps.join('; ');
    }
    if (options.mode === 'enable') {
        return (options.detectedMcpClients ?? []).length > 0
            ? 'Detected supported agents but automatic context is not enabled yet'
            : 'No supported context-enabled agents detected on this machine yet';
    }
    return 'Run 0ctx enable to finish one-time context setup for supported agents';
}

function buildAutoContextSetupGaps(options: {
    repoReadiness: RepoReadinessSummary;
    formatAgentList: (agents: string[]) => string;
}): string[] {
    const missingAgents = [...new Set([
        ...options.repoReadiness.sessionStartMissingAgents,
        ...options.repoReadiness.mcpRegistrationMissingAgents
    ])];
    return missingAgents.length > 0
        ? [`${options.formatAgentList(missingAgents)} need one-time setup`]
        : [];
}
