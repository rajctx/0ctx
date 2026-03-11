import type { RepoReadinessSummary } from '@0ctx/core';
import { formatScopedDataPolicyPresetLabel } from '../../cli-core/data-policy-display';

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
        options.formatLabelValue('Policy mode', formatScopedDataPolicyPresetLabel(repoReadiness.dataPolicyPreset)),
        options.formatLabelValue('Capture', captureLine),
        options.formatLabelValue('Context', autoContextLine),
        options.formatLabelValue('History', historySummary),
        options.formatLabelValue('Workspace sync', options.formatSyncPolicyLabel(repoReadiness.syncPolicy)),
        options.formatLabelValue('Machine capture', options.formatRetentionLabel(repoReadiness)),
        options.formatLabelValue(
            'Utility debug',
            repoReadiness.debugArtifactsEnabled
                ? `enabled (${repoReadiness.debugRetentionDays}d retention)`
                : `off in the normal path (${repoReadiness.debugRetentionDays}d retention if enabled)`
        ),
        ...(repoReadiness.dataPolicyActionHint ? [options.formatLabelValue('Policy step', repoReadiness.dataPolicyActionHint)] : []),
        ...(repoReadiness.nextActionHint ? [options.formatLabelValue('Next step', repoReadiness.nextActionHint)] : [])
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
    return 'Run 0ctx enable to install automatic context injection for supported agents';
}

function buildAutoContextSetupGaps(options: {
    repoReadiness: RepoReadinessSummary;
    formatAgentList: (agents: string[]) => string;
}): string[] {
    const parts: string[] = [];
    if (options.repoReadiness.sessionStartMissingAgents.length > 0) {
        parts.push(`${options.formatAgentList(options.repoReadiness.sessionStartMissingAgents)} need automatic context injection`);
    }
    if (options.repoReadiness.mcpRegistrationMissingAgents.length > 0) {
        parts.push(`${options.formatAgentList(options.repoReadiness.mcpRegistrationMissingAgents)} need MCP retrieval registration`);
    }
    return parts;
}
