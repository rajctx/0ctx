import { describe, expect, it, vi } from 'vitest';
import * as client from '@0ctx/mcp/dist/client';
import { createDataPolicyCommands } from '../src/commands/product/policy/data-policy';

describe('data-policy command surface', () => {
    it('returns the preset catalog for the presets subcommand', async () => {
        let captured: unknown = null;
        const { commandDataPolicy } = createDataPolicyCommands({
            requireCommandContextId: async () => null,
            resolveCommandContextId: async () => null,
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
            printJsonOrValue: (_asJson, value) => {
                captured = value;
                return 0;
            }
        });

        const code = await commandDataPolicy('presets', { json: true });

        expect(code).toBe(0);
        expect(captured).toMatchObject({
            recommended: 'lean'
        });
        expect((captured as { presets: Array<{ preset: string }> }).presets.map((item) => item.preset)).toEqual([
            'lean',
            'review',
            'debug',
            'shared'
        ]);
    });

    it('prints a single normal-path summary for human output', async () => {
        const lines: string[] = [];
        const log = vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
            lines.push(String(value ?? ''));
        });

        const { commandDataPolicy } = createDataPolicyCommands({
            requireCommandContextId: async () => null,
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
            printJsonOrValue: (_asJson, _value, render) => {
                render();
                return 0;
            }
        });

        const sendToDaemon = vi.spyOn(client, 'sendToDaemon').mockResolvedValue({
            workspaceResolved: true,
            syncPolicy: 'metadata_only',
            captureRetentionDays: 14,
            debugRetentionDays: 7,
            debugArtifactsEnabled: false,
            preset: 'lean'
        });

        const code = await commandDataPolicy('show', {});

        expect(code).toBe(0);
        expect(lines.some((line) => line.includes('Normal path:') && line.includes('Active | lean metadata sync plus local capture'))).toBe(true);
        sendToDaemon.mockRestore();
        log.mockRestore();
    });
});
