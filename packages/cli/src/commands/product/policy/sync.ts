import { sendToDaemon } from '@0ctx/mcp/dist/client';
import { getConfigValue } from '@0ctx/core';
import type { FlagMap, PolicyCommandDeps } from './types';

export function createSyncCommands(deps: PolicyCommandDeps) {
    async function commandSyncStatus(): Promise<number> {
        try {
            const status = await sendToDaemon('syncStatus', {}) as {
                enabled: boolean;
                running: boolean;
                lastPushAt: number | null;
                lastPullAt: number | null;
                lastError: string | null;
                queue: { pending: number; inFlight: number; failed: number; done: number };
            };

            console.log('\nSync Status\n');
            console.log(`  Enabled:     ${status.enabled}`);
            console.log(`  Running:     ${status.running}`);
            console.log(`  Endpoint:    ${getConfigValue('sync.endpoint')}`);
            console.log(`  Last push:   ${status.lastPushAt ? new Date(status.lastPushAt).toISOString() : 'never'}`);
            console.log(`  Last pull:   ${status.lastPullAt ? new Date(status.lastPullAt).toISOString() : 'never'}`);
            if (status.lastError) {
                console.log(`  Last error:  ${status.lastError}`);
            }
            console.log('');
            console.log('  Queue:');
            console.log(`    Pending:   ${status.queue.pending}`);
            console.log(`    In-flight: ${status.queue.inFlight}`);
            console.log(`    Failed:    ${status.queue.failed}`);
            console.log(`    Done:      ${status.queue.done}`);
            console.log('');
            return 0;
        } catch (error) {
            console.error('Failed to get sync status:', error instanceof Error ? error.message : String(error));
            console.error('Is the daemon running? Try: 0ctx daemon start');
            return 1;
        }
    }

    async function commandSyncPolicyGet(flags: FlagMap): Promise<number> {
        const contextId = await deps.requireCommandContextId(flags, '0ctx sync policy get');
        if (!contextId) return 1;

        try {
            const result = await sendToDaemon('getSyncPolicy', { contextId }) as { contextId: string; syncPolicy: string };
            console.log('\nSync Policy\n');
            console.log(`  Context: ${result.contextId}`);
            console.log(`  Policy:  ${deps.formatSyncPolicyLabel(result.syncPolicy)}`);
            if (result.syncPolicy === 'metadata_only') {
                console.log('  Note:    Syncs lean metadata only. Raw payloads stay local by default.');
            } else if (result.syncPolicy === 'full_sync') {
                console.log('  Note:    Richer hosted sync is explicitly enabled for this workspace.');
            }
            console.log('');
            return 0;
        } catch (error) {
            console.error('Failed to get sync policy:', error instanceof Error ? error.message : String(error));
            console.error('Is the daemon running? Try: 0ctx daemon start');
            return 1;
        }
    }

    async function commandSyncPolicySet(policy: string | undefined, flags: FlagMap): Promise<number> {
        const contextId = await deps.requireCommandContextId(flags, '0ctx sync policy set');
        if (!contextId) return 1;

        if (policy !== 'local_only' && policy !== 'metadata_only' && policy !== 'full_sync') {
            console.error('Invalid policy. Expected one of: local_only, metadata_only, full_sync.');
            return 1;
        }
        const confirmFullSync = Boolean(flags['confirm-full-sync']) || Boolean(flags.confirmFullSync);
        if (policy === 'full_sync' && !confirmFullSync) {
            console.error('full_sync requires explicit confirmation. Re-run with --confirm-full-sync if this workspace should send richer metadata remotely.');
            return 1;
        }

        try {
            const result = await sendToDaemon('setSyncPolicy', { contextId, syncPolicy: policy }) as { contextId: string; syncPolicy: string };
            console.log(`Sync policy updated: ${result.contextId} -> ${deps.formatSyncPolicyLabel(result.syncPolicy)}`);
            if (result.syncPolicy === 'metadata_only') {
                console.log('Lean default restored: raw payloads remain local unless you opt into richer sync.');
            } else if (result.syncPolicy === 'full_sync') {
                console.log('Full sync is now enabled explicitly for this workspace.');
            }
            return 0;
        } catch (error) {
            console.error('Failed to set sync policy:', error instanceof Error ? error.message : String(error));
            console.error('Is the daemon running? Try: 0ctx daemon start');
            return 1;
        }
    }

    return {
        commandSyncStatus,
        commandSyncPolicyGet,
        commandSyncPolicySet
    };
}
