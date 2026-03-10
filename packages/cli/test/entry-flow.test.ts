import { describe, expect, it, vi } from 'vitest';
import type { ParsedArgs } from '../src/cli-core/types';
import { resolveDataPolicySubcommand, runParsedCommand } from '../src/entry/dispatch';
import { runWithoutArgs } from '../src/entry/no-args';

function createParsed(command: string, overrides: Partial<ParsedArgs> = {}): ParsedArgs {
    return {
        command,
        positionalArgs: [],
        flags: {},
        ...overrides
    };
}

function createRegistry(overrides: Record<string, unknown> = {}) {
    return {
        runCommandWithOpsSummary: vi.fn(async (_operation, action) => Promise.resolve(action())),
        printHelp: vi.fn(),
        resolveToken: vi.fn(() => null),
        readConnectorState: vi.fn(() => null),
        findGitRepoRoot: vi.fn(() => 'C:/repo'),
        commandEnable: vi.fn(async () => 0),
        commandBranches: vi.fn(async () => 0),
        commandAuthLogin: vi.fn(async () => 0),
        isTokenExpired: vi.fn(() => false),
        refreshAccessToken: vi.fn(async () => undefined),
        getEnvToken: vi.fn(() => null),
        isDaemonReachable: vi.fn(async () => ({ ok: true })),
        commandSetup: vi.fn(async () => 0),
        commandInstall: vi.fn(async () => 0),
        commandBootstrap: vi.fn(async () => 0),
        commandMcp: vi.fn(async () => 0),
        commandDoctor: vi.fn(async () => 0),
        commandStatus: vi.fn(async () => 0),
        commandRepair: vi.fn(async () => 0),
        commandReset: vi.fn(async () => 0),
        commandVersion: vi.fn(async () => 0),
        commandWorkspaces: vi.fn(async () => 0),
        commandAgentContext: vi.fn(async () => 0),
        commandSessions: vi.fn(async () => 0),
        commandCheckpoints: vi.fn(async () => 0),
        commandInsights: vi.fn(async () => 0),
        commandExtract: vi.fn(async () => 0),
        commandResume: vi.fn(async () => 0),
        commandRewind: vi.fn(async () => 0),
        commandExplain: vi.fn(async () => 0),
        commandRecall: vi.fn(async () => 0),
        commandAuthLogout: vi.fn(() => 0),
        commandAuthStatus: vi.fn(() => 0),
        commandAuthRotate: vi.fn(async () => 0),
        startDaemonDetached: vi.fn(),
        waitForDaemon: vi.fn(async () => true),
        commandDaemonService: vi.fn(async () => 0),
        commandConfigList: vi.fn(async () => 0),
        commandConfigGet: vi.fn(async () => 0),
        commandConfigSet: vi.fn(async () => 0),
        commandDataPolicy: vi.fn(async () => 0),
        commandSyncStatus: vi.fn(async () => 0),
        commandSyncPolicyGet: vi.fn(async () => 0),
        commandSyncPolicySet: vi.fn(async () => 0),
        commandConnector: vi.fn(async () => 0),
        commandConnectorQueue: vi.fn(async () => 0),
        commandConnectorHook: vi.fn(async () => 0),
        commandLogs: vi.fn(async () => 0),
        commandDashboard: vi.fn(async () => 0),
        commandShell: vi.fn(async () => 0),
        commandReleasePublish: vi.fn(async () => 0),
        ...overrides
    };
}

describe('CLI entry flow', () => {
    it('accepts only supported data-policy subcommands', () => {
        expect(resolveDataPolicySubcommand('shared')).toBe('shared');
        expect(resolveDataPolicySubcommand('bogus')).toBeNull();
    });

    it('routes connector hook alias through the extracted dispatcher', async () => {
        const registry = createRegistry();
        await runParsedCommand(createParsed('hook', { positionalArgs: ['status'] }), registry as never);
        expect(registry.commandConnectorHook).toHaveBeenCalledWith('status', {});
    });

    it('routes daemon start through the extracted dispatcher', async () => {
        const registry = createRegistry();
        const exitCode = await runParsedCommand(createParsed('daemon', { subcommand: 'start' }), registry as never);
        expect(exitCode).toBe(0);
        expect(registry.startDaemonDetached).toHaveBeenCalledTimes(1);
        expect(registry.waitForDaemon).toHaveBeenCalledTimes(1);
    });

    it('auto-enables the detected repo on first run with no token', async () => {
        const registry = createRegistry();
        const exitCode = await runWithoutArgs({
            ...registry,
            captureEvent: vi.fn(),
            stdinIsTTY: true,
            stdoutIsTTY: true,
            shellMode: false
        } as never);
        expect(exitCode).toBe(0);
        expect(registry.commandEnable).toHaveBeenCalledWith({ 'repo-root': 'C:/repo' });
        expect(registry.runCommandWithOpsSummary).toHaveBeenCalledWith(
            'cli.enable',
            expect.any(Function),
            expect.objectContaining({ reason: 'first_run_repo' })
        );
    });

    it('falls back to help when launched without tty', async () => {
        const registry = createRegistry();
        const exitCode = await runWithoutArgs({
            ...registry,
            captureEvent: vi.fn(),
            stdinIsTTY: false,
            stdoutIsTTY: false,
            shellMode: false
        } as never);
        expect(exitCode).toBe(0);
        expect(registry.printHelp).toHaveBeenCalledWith(false);
    });
});
