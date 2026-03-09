import { describe, expect, it, vi } from 'vitest';
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
});
