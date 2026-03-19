import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEnableCommands } from '../src/commands/product/enable';
import { deriveEnableMcpClientsFromHookClients, parseEnableMcpClients, parseHookClients, validateExplicitPreviewSelection, validatePreviewOptIn } from '../src/cli-core/clients';
import { parseOptionalStringFlag, parsePositiveIntegerFlag, parsePositiveNumberFlag } from '../src/cli-core/args';

describe('commandEnable data policy output', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('applies a supported local-only preset in the json payload', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const sendToDaemon = vi.fn(async (method: string) => {
            switch (method) {
                case 'listContexts':
                    return [];
                case 'createContext':
                    return { id: 'ctx-1' };
                case 'switchContext':
                    return { ok: true };
                case 'setDataPolicy':
                    return {
                        preset: 'review',
                        syncScope: 'workspace',
                        captureScope: 'machine',
                        debugScope: 'machine',
                        syncPolicy: 'local_only',
                        captureRetentionDays: 30,
                        debugRetentionDays: 7,
                        debugArtifactsEnabled: false
                    };
                default:
                    return null;
            }
        });

        const deps = {
            validateExplicitPreviewSelection,
            validatePreviewOptIn,
            detectPreviewSelections: vi.fn(() => []),
            parseHookClients,
            parseEnableMcpClients,
            deriveEnableMcpClientsFromHookClients,
            parseOptionalStringFlag,
            parsePositiveIntegerFlag,
            parsePositiveNumberFlag,
            resolveRepoRoot: () => 'C:\\repo',
            isDaemonReachable: vi.fn(async () => ({ ok: true })),
            startDaemonDetached: vi.fn(),
            waitForDaemon: vi.fn(async () => true),
            commandBootstrap: vi.fn(async () => 0),
            sendToDaemon,
            selectHookContextId: vi.fn(() => null),
            runBootstrap: vi.fn(() => []),
            installHooks: vi.fn(() => ({ changed: false, statePath: 'hook-state.json', projectConfigPath: '.0ctx/settings.local.json' })),
            collectHookHealth: vi.fn(async () => ({ details: { agents: [] } })),
            collectRepoReadiness: vi.fn(async () => ({
                repoRoot: 'C:\\repo',
                contextId: 'ctx-1',
                workspaceName: 'repo',
                workstream: 'main',
                sessionCount: 0,
                checkpointCount: 0,
                captureManagedForRepo: false,
                captureReadyAgents: [],
                captureMissingAgents: [],
                autoContextAgents: [],
                autoContextMissingAgents: [],
                sessionStartMissingAgents: [],
                mcpRegistrationMissingAgents: [],
                syncPolicy: 'local_only',
                syncScope: 'workspace',
                captureScope: 'machine',
                debugScope: 'machine',
                zeroTouchReady: false,
                nextActionHint: null,
                dataPolicyPreset: 'review',
                dataPolicyActionHint: 'Return this machine to Lean when the longer local review window is no longer needed.',
                captureRetentionDays: 30,
                debugRetentionDays: 7,
                debugArtifactsEnabled: false
            })),
            detectInstalledGaHookClients: vi.fn(() => []),
            detectInstalledGaMcpClients: vi.fn(() => []),
            printBootstrapResults: vi.fn(async () => {}),
            formatAgentList: (agents: string[]) => agents.join(', '),
            formatLabelValue: (label: string, value: string) => `${label}: ${value}`,
            formatRetentionLabel: () => '30d capture, 7d debug',
            formatSyncPolicyLabel: (policy: string | null | undefined) => {
                if (policy === 'metadata_only') return 'metadata_only (legacy)';
                if (policy === 'full_sync') return 'full_sync (legacy)';
                if (policy === 'local_only') return 'local_only (default)';
                return policy ?? 'none';
            }
        };

        const { commandEnable } = createEnableCommands(deps as never);
        const exitCode = await commandEnable({
            json: true,
            'data-policy': 'review',
            'skip-bootstrap': true,
            'skip-hooks': true
        });

        expect(exitCode).toBe(0);
        expect(sendToDaemon).toHaveBeenCalledWith('setDataPolicy', { contextId: 'ctx-1', preset: 'review' });

        const payload = JSON.parse(String(consoleSpy.mock.calls[0]?.[0] ?? '{}'));
        expect(payload.steps.find((step: { id: string }) => step.id === 'data_policy')).toMatchObject({
            status: 'pass',
            message: 'Applied the review data policy preset.'
        });
        expect(payload.dataPolicy).toMatchObject({
            preset: 'review',
            syncPolicy: 'local_only (default)',
            syncScope: 'workspace',
            captureScope: 'machine',
            debugScope: 'machine'
        });
    });
});
