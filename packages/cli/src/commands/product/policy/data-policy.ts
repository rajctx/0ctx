import { sendToDaemon } from '@0ctx/mcp/dist/client';
import type { FlagMap, PolicyCommandDeps } from './types';

interface DataPolicyPayload {
    workspaceResolved: boolean;
    syncPolicy: string;
    captureRetentionDays: number;
    debugRetentionDays: number;
    debugArtifactsEnabled: boolean;
}

function printPolicySummary(payload: DataPolicyPayload, formatSyncPolicyLabel: PolicyCommandDeps['formatSyncPolicyLabel'], formatDebugArtifactsLabel: PolicyCommandDeps['formatDebugArtifactsLabel']): void {
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
        const syncPolicy = deps.parseOptionalStringFlag(flags['sync-policy'] ?? flags.syncPolicy);
        const captureRetentionDays = deps.parseOptionalPositiveNumberFlag(flags['capture-retention-days'] ?? flags.captureRetentionDays);
        const debugRetentionDays = deps.parseOptionalPositiveNumberFlag(flags['debug-retention-days'] ?? flags.debugRetentionDays);
        const debugArtifactsRaw = flags['debug-artifacts'] ?? flags.debugArtifacts;
        const debugArtifactsSpecified = debugArtifactsRaw !== undefined;
        const debugArtifactsEnabled = deps.parseOptionalBooleanLikeFlag(debugArtifactsRaw);

        if (debugArtifactsSpecified && debugArtifactsEnabled == null) {
            console.error('Invalid value for --debug-artifacts. Use on|off, true|false, or 1|0.');
            return 1;
        }

        if (!syncPolicy && captureRetentionDays == null && debugRetentionDays == null && debugArtifactsEnabled == null) {
            console.error('Usage: 0ctx data-policy set [--repo-root=<path>] [--sync-policy=<local_only|metadata_only|full_sync>] [--capture-retention-days=<days>] [--debug-retention-days=<days>] [--debug-artifacts=<on|off>] [--json]');
            return 1;
        }

        if (syncPolicy && !['local_only', 'metadata_only', 'full_sync'].includes(syncPolicy)) {
            console.error('Invalid sync policy. Use local_only, metadata_only, or full_sync.');
            return 1;
        }

        const contextId = syncPolicy
            ? await deps.requireCommandContextId(flags, '0ctx data-policy set')
            : await deps.resolveCommandContextId(flags);
        if (syncPolicy && !contextId) return 1;
        const payload = await sendToDaemon('setDataPolicy', {
            ...(contextId ? { contextId } : {}),
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

    async function commandDataPolicy(subcommand: string | null | undefined, flags: FlagMap): Promise<number> {
        if (!subcommand || subcommand === 'show' || subcommand === 'get') {
            return commandDataPolicyShow(flags);
        }
        if (subcommand === 'set') {
            return commandDataPolicySet(flags);
        }
        console.error('Usage: 0ctx data-policy [--repo-root=<path>] [--json]');
        console.error('   or: 0ctx data-policy set [--repo-root=<path>] [--sync-policy=<local_only|metadata_only|full_sync>] [--capture-retention-days=<days>] [--debug-retention-days=<days>] [--debug-artifacts=<on|off>] [--json]');
        return 1;
    }

    return {
        commandDataPolicy
    };
}
