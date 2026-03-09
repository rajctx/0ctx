import { sendToDaemon } from '@0ctx/mcp/dist/client';
import type { FlagMap, PolicyCommandDeps } from './types';

type DataPolicyPreset = 'lean' | 'review' | 'debug' | 'shared' | 'custom';

interface DataPolicyPayload {
    workspaceResolved: boolean;
    syncPolicy: string;
    captureRetentionDays: number;
    debugRetentionDays: number;
    debugArtifactsEnabled: boolean;
    preset: DataPolicyPreset;
}

function formatPresetLabel(preset: DataPolicyPreset): string {
    switch (preset) {
        case 'lean': return 'Lean (default)';
        case 'review': return 'Review';
        case 'debug': return 'Debug';
        case 'shared': return 'Shared (opt-in)';
        default: return 'Custom';
    }
}

function parsePreset(value: string | null): DataPolicyPreset | null {
    if (!value) return null;
    if (value === 'lean' || value === 'review' || value === 'debug' || value === 'shared' || value === 'custom') {
        return value;
    }
    return null;
}

function printPolicySummary(payload: DataPolicyPayload, formatSyncPolicyLabel: PolicyCommandDeps['formatSyncPolicyLabel'], formatDebugArtifactsLabel: PolicyCommandDeps['formatDebugArtifactsLabel']): void {
    console.log(`  Preset:                  ${formatPresetLabel(payload.preset)}`);
    console.log(`  Workspace sync:          ${payload.workspaceResolved ? formatSyncPolicyLabel(payload.syncPolicy) : `${formatSyncPolicyLabel(payload.syncPolicy)} (no workspace resolved)`}`);
    console.log(`  Local capture retention: ${payload.captureRetentionDays}d`);
    console.log(`  Debug retention:         ${payload.debugRetentionDays}d`);
    console.log(`  Debug artifacts:         ${formatDebugArtifactsLabel(payload.debugArtifactsEnabled)}`);
    console.log(`  Policy:                  ${String(payload.syncPolicy || 'metadata_only').trim().toLowerCase() === 'full_sync'
        ? 'Richer cloud sync is enabled explicitly for this workspace.'
        : 'Raw payloads stay local by default and cloud sync remains lean.'}`);
}

export function createDataPolicyCommands(deps: PolicyCommandDeps) {
    async function commandDataPolicyShow(flags: FlagMap): Promise<number> {
        const asJson = Boolean(flags.json);
        const check = await deps.ensureDaemonCapabilities(['getDataPolicy']);
        if (!check.ok) {
            deps.printCapabilityMismatch('data_policy', check);
            return 1;
        }
        const contextId = await deps.resolveCommandContextId(flags);
        const payload = await sendToDaemon('getDataPolicy', contextId ? { contextId } : {}) as DataPolicyPayload;

        return deps.printJsonOrValue(asJson, payload, () => {
            console.log('\nData Policy\n');
            printPolicySummary(payload, deps.formatSyncPolicyLabel, deps.formatDebugArtifactsLabel);
            console.log('');
        });
    }

    async function commandDataPolicySet(flags: FlagMap): Promise<number> {
        const asJson = Boolean(flags.json);
        const check = await deps.ensureDaemonCapabilities(['getDataPolicy', 'setDataPolicy']);
        if (!check.ok) {
            deps.printCapabilityMismatch('data_policy', check);
            return 1;
        }
        const preset = parsePreset(deps.parseOptionalStringFlag(flags.preset));
        const syncPolicy = deps.parseOptionalStringFlag(flags['sync-policy'] ?? flags.syncPolicy);
        const captureRetentionDays = deps.parseOptionalPositiveNumberFlag(flags['capture-retention-days'] ?? flags.captureRetentionDays);
        const debugRetentionDays = deps.parseOptionalPositiveNumberFlag(flags['debug-retention-days'] ?? flags.debugRetentionDays);
        const debugArtifactsRaw = flags['debug-artifacts'] ?? flags.debugArtifacts;
        const debugArtifactsSpecified = debugArtifactsRaw !== undefined;
        const debugArtifactsEnabled = deps.parseOptionalBooleanLikeFlag(debugArtifactsRaw);

        if (flags.preset !== undefined && !preset) {
            console.error('Invalid preset. Use lean, review, debug, or shared.');
            return 1;
        }
        if (debugArtifactsSpecified && debugArtifactsEnabled == null) {
            console.error('Invalid value for --debug-artifacts. Use on|off, true|false, or 1|0.');
            return 1;
        }

        if (!preset && !syncPolicy && captureRetentionDays == null && debugRetentionDays == null && debugArtifactsEnabled == null) {
            console.error('Usage: 0ctx data-policy set [--repo-root=<path>] [--preset=<lean|review|debug|shared>] [--sync-policy=<local_only|metadata_only|full_sync>] [--capture-retention-days=<days>] [--debug-retention-days=<days>] [--debug-artifacts=<on|off>] [--json]');
            return 1;
        }

        if (syncPolicy && !['local_only', 'metadata_only', 'full_sync'].includes(syncPolicy)) {
            console.error('Invalid sync policy. Use local_only, metadata_only, or full_sync.');
            return 1;
        }

        const needsWorkspace = Boolean(syncPolicy) || preset === 'shared';
        const contextId = needsWorkspace
            ? await deps.requireCommandContextId(flags, '0ctx data-policy set')
            : await deps.resolveCommandContextId(flags);
        if (needsWorkspace && !contextId) return 1;
        const payload = await sendToDaemon('setDataPolicy', {
            ...(contextId ? { contextId } : {}),
            ...(preset ? { preset } : {}),
            ...(syncPolicy ? { syncPolicy } : {}),
            ...(captureRetentionDays != null ? { captureRetentionDays: Math.floor(captureRetentionDays) } : {}),
            ...(debugRetentionDays != null ? { debugRetentionDays: Math.floor(debugRetentionDays) } : {}),
            ...(debugArtifactsEnabled != null ? { debugArtifactsEnabled } : {})
        }) as DataPolicyPayload;
        return deps.printJsonOrValue(asJson, payload, () => {
            console.log('\nData policy updated\n');
            printPolicySummary(payload, deps.formatSyncPolicyLabel, deps.formatDebugArtifactsLabel);
            console.log('');
        });
    }

    async function commandDataPolicyPreset(preset: Exclude<DataPolicyPreset, 'custom'>, flags: FlagMap): Promise<number> {
        return commandDataPolicySet({ ...flags, preset });
    }

    async function commandDataPolicy(subcommand: string | null | undefined, flags: FlagMap): Promise<number> {
        if (!subcommand || subcommand === 'show' || subcommand === 'get') {
            return commandDataPolicyShow(flags);
        }
        if (subcommand === 'set') {
            return commandDataPolicySet(flags);
        }
        if (subcommand === 'lean' || subcommand === 'review' || subcommand === 'debug' || subcommand === 'shared') {
            return commandDataPolicyPreset(subcommand, flags);
        }
        console.error('Usage: 0ctx data-policy [--repo-root=<path>] [--json]');
        console.error('   or: 0ctx data-policy set [--repo-root=<path>] [--preset=<lean|review|debug|shared>] [--sync-policy=<local_only|metadata_only|full_sync>] [--capture-retention-days=<days>] [--debug-retention-days=<days>] [--debug-artifacts=<on|off>] [--json]');
        console.error('   or: 0ctx data-policy <lean|review|debug|shared> [--repo-root=<path>] [--json]');
        return 1;
    }

    return {
        commandDataPolicy
    };
}
