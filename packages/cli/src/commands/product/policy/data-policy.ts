import { sendToDaemon } from '@0ctx/mcp/dist/client';
import type { FlagMap, PolicyCommandDeps } from './types';
import {
    describeDataPolicyScope,
    describePolicyNormalPath,
    formatScopedDataPolicyPresetLabel
} from '../../../cli-core/data-policy-display';

type DataPolicyPreset = 'lean' | 'review' | 'debug' | 'shared' | 'custom';

interface DataPolicyPayload {
    workspaceResolved: boolean;
    syncScope?: 'workspace';
    captureScope?: 'machine';
    debugScope?: 'machine';
    syncPolicy: string;
    captureRetentionDays: number;
    debugRetentionDays: number;
    debugArtifactsEnabled: boolean;
    preset: DataPolicyPreset;
}

interface DataPolicyCleanupResult {
    policy: DataPolicyPayload;
    prune: ReturnType<PolicyCommandDeps['pruneHookDumps']>;
}

interface DataPolicyPresetDefinition {
    preset: Exclude<DataPolicyPreset, 'custom'>;
    syncPolicy: 'metadata_only' | 'full_sync';
    captureRetentionDays: number;
    debugRetentionDays: number;
    debugArtifactsEnabled: boolean;
    recommendation: string;
}

const DATA_POLICY_PRESETS: DataPolicyPresetDefinition[] = [
    {
        preset: 'lean',
        syncPolicy: 'metadata_only',
        captureRetentionDays: 14,
        debugRetentionDays: 7,
        debugArtifactsEnabled: false,
        recommendation: 'Best for most repos. Keep sync lean and keep raw capture local.'
    },
    {
        preset: 'review',
        syncPolicy: 'metadata_only',
        captureRetentionDays: 30,
        debugRetentionDays: 7,
        debugArtifactsEnabled: false,
        recommendation: 'Use when you want longer local history for session and checkpoint review.'
    },
    {
        preset: 'debug',
        syncPolicy: 'metadata_only',
        captureRetentionDays: 30,
        debugRetentionDays: 14,
        debugArtifactsEnabled: true,
        recommendation: 'Use temporarily when troubleshooting capture or adapter behavior.'
    },
    {
        preset: 'shared',
        syncPolicy: 'full_sync',
        captureRetentionDays: 14,
        debugRetentionDays: 7,
        debugArtifactsEnabled: false,
        recommendation: 'Use only when you explicitly want richer cloud sync for this workspace.'
    }
];

function getPresetDefinition(preset: Exclude<DataPolicyPreset, 'custom'>): DataPolicyPresetDefinition {
    return DATA_POLICY_PRESETS.find((definition) => definition.preset === preset)!;
}

function parsePreset(value: string | null): DataPolicyPreset | null {
    if (!value) return null;
    if (value === 'lean' || value === 'review' || value === 'debug' || value === 'shared' || value === 'custom') {
        return value;
    }
    return null;
}

function printPolicySummary(payload: DataPolicyPayload, formatSyncPolicyLabel: PolicyCommandDeps['formatSyncPolicyLabel'], formatDebugArtifactsLabel: PolicyCommandDeps['formatDebugArtifactsLabel']): void {
    console.log(`  Policy mode:             ${formatScopedDataPolicyPresetLabel(payload.preset)}`);
    console.log(`  Normal path:             ${describePolicyNormalPath(payload)}`);
    console.log(`  Workspace sync:          ${payload.workspaceResolved ? formatSyncPolicyLabel(payload.syncPolicy) : `${formatSyncPolicyLabel(payload.syncPolicy)} (no workspace resolved)`}`);
    console.log(`  Machine capture:         ${payload.captureRetentionDays}d local retention`);
    console.log(`  Machine debug:           ${payload.debugRetentionDays}d retention; ${formatDebugArtifactsLabel(payload.debugArtifactsEnabled)}`);
    console.log(`  Scope:                   ${describeDataPolicyScope(payload)}`);
}

function printPresetCatalog(
    formatSyncPolicyLabel: PolicyCommandDeps['formatSyncPolicyLabel'],
    formatDebugArtifactsLabel: PolicyCommandDeps['formatDebugArtifactsLabel']
): void {
    console.log('Preset catalog\n');
    const machinePresets = DATA_POLICY_PRESETS.filter((definition) => definition.preset !== 'shared');
    const workspaceOverrides = DATA_POLICY_PRESETS.filter((definition) => definition.preset === 'shared');

    console.log('Machine presets\n');
    for (const definition of machinePresets) {
        console.log(`  ${formatScopedDataPolicyPresetLabel(definition.preset)}`);
        console.log(`    Workspace sync:    ${formatSyncPolicyLabel(definition.syncPolicy)}`);
        console.log(`    Machine capture:   ${definition.captureRetentionDays}d`);
        console.log(`    Machine debug:     ${definition.debugRetentionDays}d; ${formatDebugArtifactsLabel(definition.debugArtifactsEnabled)}`);
        console.log(`    Use when:          ${definition.recommendation}`);
        console.log('');
    }

    console.log('Workspace override\n');
    for (const definition of workspaceOverrides) {
        console.log(`  ${formatScopedDataPolicyPresetLabel(definition.preset)}`);
        console.log(`    Workspace sync:    ${formatSyncPolicyLabel(definition.syncPolicy)}`);
        console.log(`    Machine capture:   ${definition.captureRetentionDays}d`);
        console.log(`    Machine debug:     ${definition.debugRetentionDays}d; ${formatDebugArtifactsLabel(definition.debugArtifactsEnabled)}`);
        console.log(`    Use when:          ${definition.recommendation}`);
        console.log('');
    }

    console.log('  Apply machine presets with: 0ctx data-policy <lean|review|debug> [--repo-root=<path>] [--json]');
    console.log('  Opt a workspace into richer cloud sync with: 0ctx data-policy shared --repo-root=<path> --confirm-full-sync [--json]');
    console.log('');
}

function printPolicyGuidance(payload: DataPolicyPayload): void {
    if (payload.preset === 'custom') {
        console.log('  Next step:               Normalize machine defaults with `0ctx data-policy lean|review|debug`. Use `0ctx data-policy shared --repo-root=<path> --confirm-full-sync` only when a workspace explicitly needs richer cloud sync.');
        console.log('  Need presets?:           Run `0ctx data-policy presets`.');
        return;
    }

    const definition = getPresetDefinition(payload.preset);
    console.log(`  Recommended for:         ${definition.recommendation}`);

    if (payload.preset === 'shared') {
        console.log('  Next step:               Keep Shared only for workspaces that explicitly need richer cloud sync, then return this workspace to Lean when that is no longer needed.');
        return;
    }

    if (payload.preset === 'debug') {
        console.log('  Next step:               Return this machine to Lean after troubleshooting is complete.');
        return;
    }

    if (payload.preset === 'review') {
        console.log('  Next step:               Return this machine to Lean when the longer local review window is no longer needed.');
        return;
    }

    console.log('  Next step:               Stay on Lean unless this machine needs longer local review retention or temporary debug trails.');
}

function printCleanupSummary(
    result: DataPolicyCleanupResult,
    formatSyncPolicyLabel: PolicyCommandDeps['formatSyncPolicyLabel'],
    formatDebugArtifactsLabel: PolicyCommandDeps['formatDebugArtifactsLabel']
): void {
    console.log('\nData policy cleaned up\n');
    printPolicySummary(result.policy, formatSyncPolicyLabel, formatDebugArtifactsLabel);
    console.log('');
    console.log(`  Pruned files:             ${result.prune.deletedFiles}`);
    console.log(`  Pruned folders:           ${result.prune.deletedDirs}`);
    console.log(`  Reclaimed bytes:          ${result.prune.reclaimedBytes}`);
    console.log(`  Debug artifacts:          ${formatDebugArtifactsLabel(result.prune.debugArtifactsEnabled)}`);
    console.log('');
    console.log('  Next step:               Stay on Lean unless this machine or workspace explicitly needs a richer policy.');
    console.log('');
}

export function createDataPolicyCommands(deps: PolicyCommandDeps) {
    async function commandDataPolicyPresets(flags: FlagMap): Promise<number> {
        const asJson = Boolean(flags.json);
        const payload = {
            presets: DATA_POLICY_PRESETS,
            recommended: 'lean'
        };
        return deps.printJsonOrValue(asJson, payload, () => {
            console.log('\nData Policy Presets\n');
            printPresetCatalog(deps.formatSyncPolicyLabel, deps.formatDebugArtifactsLabel);
        });
    }

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
            printPolicyGuidance(payload);
            console.log('  Need presets?:           Run `0ctx data-policy presets` for the catalog.');
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
            console.error('Usage: 0ctx data-policy set [--repo-root=<path>] [--preset=<lean|review|debug|shared>] [--sync-policy=<local_only|metadata_only|full_sync>] [--capture-retention-days=<days>] [--debug-retention-days=<days>] [--debug-artifacts=<on|off>] [--confirm-full-sync] [--json]');
            console.error('       Use lean|review|debug for normal machine defaults. Use shared only as an explicit workspace override.');
            return 1;
        }

        if (syncPolicy && !['local_only', 'metadata_only', 'full_sync'].includes(syncPolicy)) {
            console.error('Invalid sync policy. Use local_only, metadata_only, or full_sync.');
            return 1;
        }
        const confirmFullSync = Boolean(flags['confirm-full-sync']) || Boolean(flags.confirmFullSync);
        const enablingFullSync = syncPolicy === 'full_sync' || preset === 'shared';
        if (enablingFullSync && !confirmFullSync) {
            console.error('full_sync requires explicit confirmation. Re-run with --confirm-full-sync if this workspace should send richer metadata to the cloud.');
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
            printPolicyGuidance(payload);
            console.log('');
        });
    }

    async function commandDataPolicyPreset(preset: Exclude<DataPolicyPreset, 'custom'>, flags: FlagMap): Promise<number> {
        return commandDataPolicySet({ ...flags, preset });
    }

    async function commandDataPolicyCleanup(flags: FlagMap): Promise<number> {
        const asJson = Boolean(flags.json);
        const check = await deps.ensureDaemonCapabilities(['getDataPolicy', 'setDataPolicy']);
        if (!check.ok) {
            deps.printCapabilityMismatch('data_policy', check);
            return 1;
        }

        const contextId = await deps.resolveCommandContextId(flags);
        const leanPreset = getPresetDefinition('lean');
        const policy = await sendToDaemon('setDataPolicy', contextId
            ? { contextId, preset: 'lean' }
            : {
                captureRetentionDays: leanPreset.captureRetentionDays,
                debugRetentionDays: leanPreset.debugRetentionDays,
                debugArtifactsEnabled: leanPreset.debugArtifactsEnabled
            }
        ) as DataPolicyPayload;

        const prune = deps.pruneHookDumps({
            maxAgeDays: policy.captureRetentionDays,
            debugMaxAgeDays: policy.debugRetentionDays,
            debugArtifactsEnabled: policy.debugArtifactsEnabled
        });
        const result: DataPolicyCleanupResult = { policy, prune };

        return deps.printJsonOrValue(asJson, result, () => {
            printCleanupSummary(result, deps.formatSyncPolicyLabel, deps.formatDebugArtifactsLabel);
        });
    }

    async function commandDataPolicy(subcommand: string | null | undefined, flags: FlagMap): Promise<number> {
        if (!subcommand || subcommand === 'show' || subcommand === 'get') {
            return commandDataPolicyShow(flags);
        }
        if (subcommand === 'presets' || subcommand === 'catalog') {
            return commandDataPolicyPresets(flags);
        }
        if (subcommand === 'set') {
            return commandDataPolicySet(flags);
        }
        if (subcommand === 'cleanup') {
            return commandDataPolicyCleanup(flags);
        }
        if (subcommand === 'lean' || subcommand === 'review' || subcommand === 'debug' || subcommand === 'shared') {
            return commandDataPolicyPreset(subcommand, flags);
        }
        console.error('Usage: 0ctx data-policy [--repo-root=<path>] [--json]');
        console.error('   or: 0ctx data-policy presets [--json]');
        console.error('   or: 0ctx data-policy cleanup [--repo-root=<path>] [--json]');
        console.error('   or: 0ctx data-policy set [--repo-root=<path>] [--preset=<lean|review|debug|shared>] [--sync-policy=<local_only|metadata_only|full_sync>] [--capture-retention-days=<days>] [--debug-retention-days=<days>] [--debug-artifacts=<on|off>] [--confirm-full-sync] [--json]');
        console.error('   or: 0ctx data-policy <lean|review|debug> [--repo-root=<path>] [--json]');
        console.error('   or: 0ctx data-policy shared --repo-root=<path> --confirm-full-sync [--json]');
        return 1;
    }

    return {
        commandDataPolicy
    };
}
