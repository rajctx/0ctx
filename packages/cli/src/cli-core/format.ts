import color from 'picocolors';
import type { RepoReadinessSummary } from '@0ctx/core';

export function formatLabelValue(label: string, value: string): string {
    return `${color.dim(label.padEnd(12))} : ${value}`;
}

function formatAgentName(agent: string): string {
    switch (agent) {
        case 'claude':
            return 'Claude';
        case 'factory':
            return 'Factory';
        case 'antigravity':
            return 'Antigravity';
        case 'codex':
            return 'Codex';
        case 'cursor':
            return 'Cursor';
        case 'windsurf':
            return 'Windsurf';
        default:
            return agent;
    }
}

export function formatAgentList(agents: string[]): string {
    if (agents.length === 0) return 'none';
    return agents.map(formatAgentName).join(', ');
}

export function formatSyncPolicyLabel(policy: string | null | undefined): string {
    const normalized = String(policy ?? 'metadata_only').trim().toLowerCase();
    if (normalized === 'metadata_only') return 'metadata_only (default)';
    if (normalized === 'full_sync') return 'full_sync (opt-in)';
    if (normalized === 'local_only') return 'local_only';
    return normalized;
}

export function formatRetentionLabel(readiness: Pick<RepoReadinessSummary, 'captureRetentionDays'>): string {
    return `${readiness.captureRetentionDays}d local capture retained`;
}

export function formatDebugArtifactsLabel(enabled: boolean): string {
    return enabled ? 'enabled' : 'disabled by default';
}
