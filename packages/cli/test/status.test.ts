import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStatusCommands } from '../src/commands/product/status';

describe('commandStatus', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('includes repo readiness and data policy details in json output', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const deps = {
            isDaemonReachable: vi.fn(async () => ({ ok: true, health: { sync: { enabled: true, running: false } } })),
            startDaemonDetached: vi.fn(),
            waitForDaemon: vi.fn(async () => true),
            inferDaemonRecoverySteps: vi.fn(() => []),
            sendToDaemon: vi.fn(async (method: string) => {
                if (method === 'getCapabilities') {
                    return { apiVersion: '2', methods: ['recall', 'getCapabilities'] };
                }
                return null;
            }),
            findGitRepoRoot: vi.fn(() => 'C:\\repo'),
            collectRepoReadiness: vi.fn(async () => ({
                repoRoot: 'C:\\repo',
                contextId: 'ctx-1',
                workspaceName: 'repo',
                workstream: 'main',
                sessionCount: 2,
                checkpointCount: 1,
                syncPolicy: 'metadata_only',
                syncScope: 'workspace',
                captureScope: 'machine',
                debugScope: 'machine',
                captureReadyAgents: ['claude', 'factory'],
                autoContextAgents: ['claude'],
                autoContextMissingAgents: [],
                sessionStartMissingAgents: [],
                mcpRegistrationMissingAgents: [],
                captureMissingAgents: [],
                captureManagedForRepo: true,
                zeroTouchReady: true,
                nextActionHint: null,
                dataPolicyPreset: 'lean',
                dataPolicyActionHint: null,
                captureRetentionDays: 14,
                debugRetentionDays: 7,
                debugArtifactsEnabled: false
            })),
            SOCKET_PATH: '\\\\.\\pipe\\0ctx.sock',
            DB_PATH: 'C:\\Users\\Rajesh\\.0ctx\\0ctx.db',
            KEY_PATH: 'C:\\Users\\Rajesh\\.0ctx\\master.key',
            formatLabelValue: (label: string, value: string) => `${label}: ${value}`,
            formatAgentList: (agents: string[]) => agents.join(', '),
            formatRetentionLabel: () => '14d capture, 7d debug',
            formatSyncPolicyLabel: (policy: string | null | undefined) => {
                if (policy === 'metadata_only') return 'metadata_only (default)';
                if (policy === 'full_sync') return 'full_sync (opt-in)';
                return policy ?? 'none';
            }
        };

        const { commandStatus } = createStatusCommands(deps as never);
        const code = await commandStatus({ json: true });

        expect(code).toBe(0);
        const payload = JSON.parse(String(log.mock.calls[0]?.[0] ?? '{}'));
        expect(payload.repo).toMatchObject({
            insideRepo: true,
            repoRoot: 'C:\\repo'
        });
        expect(payload.repo.readiness).toMatchObject({
            workspaceName: 'repo',
            zeroTouchReady: true,
            syncPolicy: 'metadata_only',
            captureRetentionDays: 14,
            debugRetentionDays: 7,
            debugArtifactsEnabled: false
        });
    });

    it('includes repo readiness and utility debug state in compact output', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const deps = {
            isDaemonReachable: vi.fn(async () => ({ ok: true, health: { sync: { enabled: true, running: true } } })),
            startDaemonDetached: vi.fn(),
            waitForDaemon: vi.fn(async () => true),
            inferDaemonRecoverySteps: vi.fn(() => []),
            sendToDaemon: vi.fn(async () => ({ apiVersion: '2', methods: ['recall', 'getCapabilities'] })),
            findGitRepoRoot: vi.fn(() => 'C:\\repo'),
            collectRepoReadiness: vi.fn(async () => ({
                repoRoot: 'C:\\repo',
                contextId: 'ctx-1',
                workspaceName: 'repo',
                workstream: 'main',
                sessionCount: 0,
                checkpointCount: 0,
                syncPolicy: 'full_sync',
                syncScope: 'workspace',
                captureScope: 'machine',
                debugScope: 'machine',
                captureReadyAgents: ['claude'],
                autoContextAgents: [],
                autoContextMissingAgents: ['claude'],
                sessionStartMissingAgents: [],
                mcpRegistrationMissingAgents: ['claude'],
                captureMissingAgents: [],
                captureManagedForRepo: true,
                zeroTouchReady: false,
                nextActionHint: 'Register MCP retrieval for Claude.',
                dataPolicyPreset: 'shared',
                dataPolicyActionHint: 'Return this workspace to metadata_only when richer cloud sync is no longer needed.',
                captureRetentionDays: 14,
                debugRetentionDays: 7,
                debugArtifactsEnabled: true
            })),
            SOCKET_PATH: '\\\\.\\pipe\\0ctx.sock',
            DB_PATH: 'C:\\Users\\Rajesh\\.0ctx\\0ctx.db',
            KEY_PATH: 'C:\\Users\\Rajesh\\.0ctx\\master.key',
            formatLabelValue: (label: string, value: string) => `${label}: ${value}`,
            formatAgentList: (agents: string[]) => agents.join(', '),
            formatRetentionLabel: () => '14d capture, 7d debug',
            formatSyncPolicyLabel: (policy: string | null | undefined) => {
                if (policy === 'metadata_only') return 'metadata_only (default)';
                if (policy === 'full_sync') return 'full_sync (opt-in)';
                return policy ?? 'none';
            }
        };

        const { commandStatus } = createStatusCommands(deps as never);
        const code = await commandStatus({ compact: true });

        expect(code).toBe(0);
        const line = String(log.mock.calls[0]?.[0] ?? '');
        expect(line).toContain('workspace="repo"');
        expect(line).toContain('zero_touch=false');
        expect(line).toContain('policy="full_sync (opt-in)"');
        expect(line).toContain('debug="on:7d"');
    });
});
