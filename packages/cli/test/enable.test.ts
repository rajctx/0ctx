import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEnableCommands } from '../src/commands/product/enable';
import { parseEnableMcpClients, parseHookClients, validateExplicitPreviewSelection } from '../src/cli-core/clients';
import { parseOptionalStringFlag, parsePositiveIntegerFlag, parsePositiveNumberFlag } from '../src/cli-core/args';

describe('commandEnable', () => {
    const originalLog = console.log;

    afterEach(() => {
        console.log = originalLog;
        vi.restoreAllMocks();
    });

    it('defaults to the GA integrations detected on this machine when no clients are specified', async () => {
        const installHooks = vi.fn(() => ({
            changed: true,
            statePath: 'hook-state.json',
            projectConfigPath: '.0ctx/settings.local.json'
        }));
        const runBootstrap = vi.fn(() => ([
            { client: 'claude', status: 'created', configPath: 'claude.json' },
            { client: 'antigravity', status: 'skipped', configPath: 'antigravity.json' }
        ]));
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        const deps = {
            validateExplicitPreviewSelection,
            parseHookClients,
            parseEnableMcpClients,
            parseOptionalStringFlag,
            parsePositiveIntegerFlag,
            parsePositiveNumberFlag,
            resolveRepoRoot: () => 'C:\\repo',
            isDaemonReachable: vi.fn(async () => ({ ok: true })),
            startDaemonDetached: vi.fn(),
            waitForDaemon: vi.fn(async () => true),
            commandBootstrap: vi.fn(async () => 0),
            sendToDaemon: vi.fn(async (method: string) => {
                switch (method) {
                    case 'listContexts':
                        return [];
                    case 'createContext':
                        return { id: 'ctx-1' };
                    case 'switchContext':
                        return { ok: true };
                    case 'getDataPolicy':
                        return {
                            preset: 'lean',
                            syncScope: 'workspace',
                            captureScope: 'machine',
                            debugScope: 'machine',
                            syncPolicy: 'metadata_only',
                            captureRetentionDays: 14,
                            debugRetentionDays: 7,
                            debugArtifactsEnabled: false
                        };
                    case 'setDataPolicy':
                        return {
                            preset: 'lean',
                            syncScope: 'workspace',
                            captureScope: 'machine',
                            debugScope: 'machine',
                            syncPolicy: 'metadata_only',
                            captureRetentionDays: 14,
                            debugRetentionDays: 7,
                            debugArtifactsEnabled: false
                        };
                    default:
                        return null;
                }
            }),
            selectHookContextId: vi.fn(() => null),
            runBootstrap,
            installHooks,
            collectHookHealth: vi.fn(async () => ({ details: { agents: [] } })),
            collectRepoReadiness: vi.fn(async () => ({
                repoRoot: 'C:\\repo',
                contextId: 'ctx-1',
                workspaceName: 'repo',
                workstream: 'main',
                sessionCount: 0,
                checkpointCount: 0,
                captureManagedForRepo: true,
                captureReadyAgents: ['claude', 'factory', 'antigravity'],
                captureMissingAgents: [],
                autoContextAgents: ['claude', 'factory', 'antigravity'],
                syncPolicy: 'metadata_only',
                syncScope: 'workspace',
                captureScope: 'machine',
                debugScope: 'machine',
                zeroTouchReady: true,
                nextActionHint: null,
                dataPolicyActionHint: null,
                captureRetentionDays: 14,
                debugRetentionDays: 7,
                debugArtifactsEnabled: false
            })),
            detectInstalledGaHookClients: vi.fn(() => ['claude', 'factory']),
            detectInstalledGaMcpClients: vi.fn(() => ['claude']),
            printBootstrapResults: vi.fn(async () => {}),
            formatAgentList: (agents: string[]) => agents.join(', '),
            formatLabelValue: (label: string, value: string) => `${label}: ${value}`,
            formatRetentionLabel: () => '14d capture, 7d debug',
            formatSyncPolicyLabel: (policy: string | null | undefined) => policy ?? 'none'
        };

        const { commandEnable } = createEnableCommands(deps as never);
        const exitCode = await commandEnable({ json: true });

        expect(exitCode).toBe(0);
        expect(runBootstrap).toHaveBeenCalledWith(['claude'], false, undefined, 'core');
        expect(installHooks).toHaveBeenCalledWith(expect.objectContaining({
            projectRoot: 'C:\\repo',
            contextId: 'ctx-1',
            clients: ['claude', 'factory']
        }));
        const payload = JSON.parse(String(consoleSpy.mock.calls[0]?.[0] ?? '{}'));
        expect(payload.hookClients).toEqual(['claude', 'factory']);
        expect(payload.mcpClients).toEqual(['claude']);
        expect(payload.steps.find((step: { id: string }) => step.id === 'data_policy')).toMatchObject({
            status: 'pass',
            message: 'Applied the default lean data policy for this new workspace.'
        });
    });

    it('falls back to the full GA defaults when no supported clients are detected on this machine', async () => {
        const installHooks = vi.fn(() => ({
            changed: true,
            statePath: 'hook-state.json',
            projectConfigPath: '.0ctx/settings.local.json'
        }));
        const runBootstrap = vi.fn(() => ([
            { client: 'claude', status: 'created', configPath: 'claude.json' },
            { client: 'antigravity', status: 'created', configPath: 'antigravity.json' }
        ]));
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        const deps = {
            validateExplicitPreviewSelection,
            parseHookClients,
            parseEnableMcpClients,
            parseOptionalStringFlag,
            parsePositiveIntegerFlag,
            parsePositiveNumberFlag,
            resolveRepoRoot: () => 'C:\\repo',
            isDaemonReachable: vi.fn(async () => ({ ok: true })),
            startDaemonDetached: vi.fn(),
            waitForDaemon: vi.fn(async () => true),
            commandBootstrap: vi.fn(async () => 0),
            sendToDaemon: vi.fn(async (method: string) => {
                switch (method) {
                    case 'listContexts':
                        return [];
                    case 'createContext':
                        return { id: 'ctx-1' };
                    case 'switchContext':
                        return { ok: true };
                    case 'getDataPolicy':
                    case 'setDataPolicy':
                        return {
                            preset: 'lean',
                            syncScope: 'workspace',
                            captureScope: 'machine',
                            debugScope: 'machine',
                            syncPolicy: 'metadata_only',
                            captureRetentionDays: 14,
                            debugRetentionDays: 7,
                            debugArtifactsEnabled: false
                        };
                    default:
                        return null;
                }
            }),
            selectHookContextId: vi.fn(() => null),
            runBootstrap,
            installHooks,
            collectHookHealth: vi.fn(async () => ({ details: { agents: [] } })),
            collectRepoReadiness: vi.fn(async () => ({
                repoRoot: 'C:\\repo',
                contextId: 'ctx-1',
                workspaceName: 'repo',
                workstream: 'main',
                sessionCount: 0,
                checkpointCount: 0,
                captureManagedForRepo: true,
                captureReadyAgents: ['claude', 'factory', 'antigravity'],
                captureMissingAgents: [],
                autoContextAgents: ['claude', 'factory', 'antigravity'],
                syncPolicy: 'metadata_only',
                syncScope: 'workspace',
                captureScope: 'machine',
                debugScope: 'machine',
                zeroTouchReady: true,
                nextActionHint: null,
                dataPolicyActionHint: null,
                captureRetentionDays: 14,
                debugRetentionDays: 7,
                debugArtifactsEnabled: false
            })),
            detectInstalledGaHookClients: vi.fn(() => []),
            detectInstalledGaMcpClients: vi.fn(() => []),
            printBootstrapResults: vi.fn(async () => {}),
            formatAgentList: (agents: string[]) => agents.join(', '),
            formatLabelValue: (label: string, value: string) => `${label}: ${value}`,
            formatRetentionLabel: () => '14d capture, 7d debug',
            formatSyncPolicyLabel: (policy: string | null | undefined) => policy ?? 'none'
        };

        const { commandEnable } = createEnableCommands(deps as never);
        const exitCode = await commandEnable({ json: true });

        expect(exitCode).toBe(0);
        expect(runBootstrap).toHaveBeenCalledWith(['claude', 'antigravity'], false, undefined, 'core');
        expect(installHooks).toHaveBeenCalledWith(expect.objectContaining({
            projectRoot: 'C:\\repo',
            contextId: 'ctx-1',
            clients: ['claude', 'factory', 'antigravity']
        }));
        const payload = JSON.parse(String(consoleSpy.mock.calls[0]?.[0] ?? '{}'));
        expect(payload.hookClients).toEqual(['claude', 'factory', 'antigravity']);
        expect(payload.mcpClients).toEqual(['claude', 'antigravity']);
    });

    it('normalizes a custom policy to lean when enabling an existing workspace without an explicit preset', async () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const sendToDaemon = vi.fn(async (method: string, params?: Record<string, unknown>) => {
            switch (method) {
                case 'listContexts':
                    return [{ id: 'ctx-1', name: 'repo', paths: ['C:\\repo'] }];
                case 'switchContext':
                    return { ok: true };
                case 'getDataPolicy':
                    return {
                        preset: 'custom',
                        syncScope: 'workspace',
                        captureScope: 'machine',
                        debugScope: 'machine',
                        syncPolicy: 'metadata_only',
                        captureRetentionDays: 21,
                        debugRetentionDays: 11,
                        debugArtifactsEnabled: true
                    };
                case 'setDataPolicy':
                    return {
                        preset: 'lean',
                        syncScope: 'workspace',
                        captureScope: 'machine',
                        debugScope: 'machine',
                        syncPolicy: 'metadata_only',
                        captureRetentionDays: 14,
                        debugRetentionDays: 7,
                        debugArtifactsEnabled: false
                    };
                default:
                    return null;
            }
        });

        const deps = {
            validateExplicitPreviewSelection,
            parseHookClients,
            parseEnableMcpClients,
            parseOptionalStringFlag,
            parsePositiveIntegerFlag,
            parsePositiveNumberFlag,
            resolveRepoRoot: () => 'C:\\repo',
            isDaemonReachable: vi.fn(async () => ({ ok: true })),
            startDaemonDetached: vi.fn(),
            waitForDaemon: vi.fn(async () => true),
            commandBootstrap: vi.fn(async () => 0),
            sendToDaemon,
            selectHookContextId: vi.fn(() => 'ctx-1'),
            runBootstrap: vi.fn(() => []),
            installHooks: vi.fn(() => ({ changed: true, statePath: 'hook-state.json', projectConfigPath: '.0ctx/settings.local.json' })),
            collectHookHealth: vi.fn(async () => ({ details: { agents: [] } })),
            collectRepoReadiness: vi.fn(async () => ({
                repoRoot: 'C:\\repo',
                contextId: 'ctx-1',
                workspaceName: 'repo',
                workstream: 'main',
                sessionCount: 0,
                checkpointCount: 0,
                captureManagedForRepo: true,
                captureReadyAgents: ['claude', 'factory', 'antigravity'],
                captureMissingAgents: [],
                autoContextAgents: ['claude', 'factory', 'antigravity'],
                syncPolicy: 'metadata_only',
                syncScope: 'workspace',
                captureScope: 'machine',
                debugScope: 'machine',
                zeroTouchReady: true,
                nextActionHint: null,
                dataPolicyActionHint: null,
                captureRetentionDays: 14,
                debugRetentionDays: 7,
                debugArtifactsEnabled: false
            })),
            detectInstalledGaHookClients: vi.fn(() => []),
            detectInstalledGaMcpClients: vi.fn(() => []),
            printBootstrapResults: vi.fn(async () => {}),
            formatAgentList: (agents: string[]) => agents.join(', '),
            formatLabelValue: (label: string, value: string) => `${label}: ${value}`,
            formatRetentionLabel: () => '14d capture, 7d debug',
            formatSyncPolicyLabel: (policy: string | null | undefined) => policy ?? 'none'
        };

        const { commandEnable } = createEnableCommands(deps as never);
        const exitCode = await commandEnable({ json: true });

        expect(exitCode).toBe(0);
        expect(sendToDaemon).toHaveBeenCalledWith('setDataPolicy', { contextId: 'ctx-1', preset: 'lean' });
        const payload = JSON.parse(String(consoleSpy.mock.calls[0]?.[0] ?? '{}'));
        expect(payload.steps.find((step: { id: string }) => step.id === 'data_policy')).toMatchObject({
            status: 'pass',
            message: 'Normalized the current custom data policy to the lean default.'
        });
    });
});
