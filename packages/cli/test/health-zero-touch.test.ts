import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHealthCommands } from '../src/commands/lifecycle/health';

function buildRepoReadiness(overrides: Record<string, unknown> = {}) {
    return {
        repoRoot: 'C:\\repo',
        contextId: 'ctx-1',
        workspaceName: 'Repo',
        workstream: 'main',
        sessionCount: 1,
        checkpointCount: 0,
        syncPolicy: 'metadata_only',
        syncScope: 'workspace',
        captureScope: 'machine',
        debugScope: 'machine',
        captureReadyAgents: ['claude'],
        autoContextAgents: [],
        autoContextMissingAgents: ['claude'],
        sessionStartMissingAgents: ['claude'],
        mcpRegistrationMissingAgents: ['claude'],
        captureMissingAgents: [],
        captureManagedForRepo: true,
        zeroTouchReady: false,
        nextActionHint: 'Complete one-time context setup for claude.',
        dataPolicyPreset: 'lean',
        dataPolicyActionHint: null,
        captureRetentionDays: 14,
        debugRetentionDays: 7,
        debugArtifactsEnabled: false,
        normalPathSummary: 'Lean default.',
        workspaceSyncSummary: 'metadata_only',
        workspaceSyncHint: '',
        machineCaptureSummary: '14d local capture',
        debugUtilitySummary: 'Off by default',
        ...overrides
    };
}

describe('lifecycle zero-touch repair', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('adds a repo_zero_touch doctor warning when the current repo still needs one-time setup', async () => {
        const { collectDoctorChecks } = createHealthCommands({
            DB_PATH: 'C:\\db',
            KEY_PATH: 'C:\\key',
            isDaemonReachable: vi.fn(async () => ({ ok: true, health: {} })),
            inferDaemonRecoverySteps: vi.fn(() => []),
            findGitRepoRoot: vi.fn(() => 'C:\\repo'),
            collectRepoReadiness: vi.fn(async () => buildRepoReadiness()),
            getCliOpsLogPath: vi.fn(() => 'C:\\ops.log'),
            runBootstrap: vi.fn(() => []),
            parseClients: vi.fn(() => []),
            collectHookHealth: vi.fn(async () => ({
                check: { id: 'hook_health', status: 'pass', message: 'ok' },
                dumpCheck: { id: 'hook_dumps', status: 'pass', message: 'ok' }
            })),
            readHookInstallState: vi.fn(() => ({ projectRoot: null, contextId: null, agents: [] })),
            getHookStatePath: vi.fn(() => 'C:\\hooks-state.json'),
            resolveContextIdForHookIngest: vi.fn(async () => null),
            installHooks: vi.fn(() => ({ warnings: [], state: { agents: [] } })),
            commandBootstrap: vi.fn(async () => 0),
            waitForDaemon: vi.fn(async () => true),
            startDaemonDetached: vi.fn(),
            ensureDaemonCapabilities: vi.fn(async () => ({ ok: true, methods: ['recall'], recoverySteps: [], error: null })),
        } as any);

        const { checks } = await collectDoctorChecks({});
        expect(checks.some((check) => check.id === 'repo_zero_touch' && check.status === 'warn')).toBe(true);
    });

    it('repairs current-repo zero-touch readiness in JSON mode', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const installHooks = vi.fn(() => ({
            warnings: [],
            state: { agents: [{ agent: 'claude', installed: true }] }
        }));
        const commandBootstrap = vi.fn(async () => 0);
        const collectRepoReadiness = vi
            .fn()
            .mockResolvedValueOnce(buildRepoReadiness())
            .mockResolvedValueOnce(buildRepoReadiness({
                autoContextAgents: ['claude'],
                autoContextMissingAgents: [],
                sessionStartMissingAgents: [],
                mcpRegistrationMissingAgents: [],
                zeroTouchReady: true,
                nextActionHint: null
            }))
            .mockResolvedValueOnce(buildRepoReadiness({
                autoContextAgents: ['claude'],
                autoContextMissingAgents: [],
                sessionStartMissingAgents: [],
                mcpRegistrationMissingAgents: [],
                zeroTouchReady: true,
                nextActionHint: null
            }));

        const { commandRepair } = createHealthCommands({
            DB_PATH: 'C:\\db',
            KEY_PATH: 'C:\\key',
            isDaemonReachable: vi.fn(async () => ({ ok: true, health: {} })),
            inferDaemonRecoverySteps: vi.fn(() => []),
            findGitRepoRoot: vi.fn(() => 'C:\\repo'),
            collectRepoReadiness,
            getCliOpsLogPath: vi.fn(() => 'C:\\ops.log'),
            runBootstrap: vi.fn(() => []),
            parseClients: vi.fn(() => []),
            collectHookHealth: vi.fn(async () => ({
                check: { id: 'hook_health', status: 'pass', message: 'ok' },
                dumpCheck: { id: 'hook_dumps', status: 'pass', message: 'ok' }
            })),
            readHookInstallState: vi.fn(() => ({ projectRoot: null, contextId: null, agents: [] })),
            getHookStatePath: vi.fn(() => 'C:\\hooks-state.json'),
            resolveContextIdForHookIngest: vi.fn(async () => 'ctx-1'),
            installHooks,
            commandBootstrap,
            waitForDaemon: vi.fn(async () => true),
            startDaemonDetached: vi.fn(),
            ensureDaemonCapabilities: vi.fn(async () => ({ ok: true, methods: ['recall'], recoverySteps: [], error: null })),
        } as any);

        const exitCode = await commandRepair({ json: true });
        const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0] ?? '{}'));

        expect(exitCode).toBe(0);
        expect(installHooks).toHaveBeenCalledWith(expect.objectContaining({
            projectRoot: 'C:\\repo',
            contextId: 'ctx-1',
            clients: ['claude']
        }));
        expect(commandBootstrap).toHaveBeenCalledTimes(2);
        expect(commandBootstrap).toHaveBeenLastCalledWith(expect.objectContaining({
            clients: 'claude',
            quiet: true,
            json: false,
            'mcp-profile': 'core'
        }));
        expect(payload.ok).toBe(true);
        expect(payload.steps.some((step: any) => step.id === 'repo_zero_touch' && step.status === 'pass')).toBe(true);
    });
});
