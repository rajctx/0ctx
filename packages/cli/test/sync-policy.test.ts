import { describe, expect, it, vi } from 'vitest';
import * as client from '@0ctx/mcp/dist/client';
import { createSyncCommands } from '../src/commands/product/policy/sync';

describe('sync policy command surface', () => {
    it('requires explicit confirmation before enabling full_sync', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const sendToDaemon = vi.spyOn(client, 'sendToDaemon').mockResolvedValue({});
        const { commandSyncPolicySet } = createSyncCommands({
            requireCommandContextId: async () => 'ctx-1',
            resolveCommandContextId: async () => 'ctx-1',
            parseOptionalStringFlag: (value) => typeof value === 'string' ? value : null,
            parseOptionalPositiveNumberFlag: () => null,
            parseOptionalBooleanLikeFlag: () => null,
            ensureDaemonCapabilities: async () => ({
                ok: true,
                reachable: true,
                apiVersion: '2',
                methods: [],
                missingMethods: [],
                error: null,
                recoverySteps: []
            }),
            printCapabilityMismatch: vi.fn(),
            formatSyncPolicyLabel: (policy) => String(policy ?? ''),
            formatDebugArtifactsLabel: (enabled) => enabled ? 'enabled' : 'disabled',
            printJsonOrValue: () => 0,
            pruneHookDumps: vi.fn(() => ({
                rootDir: 'C:/tmp',
                maxAgeDays: 14,
                debugMaxAgeDays: 7,
                debugArtifactsEnabled: false,
                deletedFiles: 0,
                deletedDirs: 0,
                reclaimedBytes: 0,
                prunedPaths: []
            }))
        });

        const code = await commandSyncPolicySet('full_sync', {});

        expect(code).toBe(1);
        expect(error).toHaveBeenCalledWith(expect.stringContaining('--confirm-full-sync'));
        expect(sendToDaemon).not.toHaveBeenCalled();
        sendToDaemon.mockRestore();
        error.mockRestore();
    });
});
