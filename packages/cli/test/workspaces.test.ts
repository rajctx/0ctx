import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseOptionalStringFlag } from '../src/cli-core/args';
import { printJsonOrValue } from '../src/cli-core/output';
import { createWorkspaceCommands } from '../src/commands/product/workspaces';

describe('commandWorkspaces', () => {
    const originalLog = console.log;
    const originalError = console.error;

    afterEach(() => {
        console.log = originalLog;
        console.error = originalError;
        vi.restoreAllMocks();
    });

    it('requires --confirm for non-interactive workspace deletion', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const sendToDaemon = vi.fn(async (method: string) => {
            if (method === 'listContexts') {
                return [{ id: 'ctx-1', name: 'repo', paths: ['C:\\repo'] }];
            }
            return null;
        });

        const { commandWorkspaces } = createWorkspaceCommands({
            parseOptionalStringFlag,
            sendToDaemon,
            findGitRepoRoot: vi.fn(() => 'C:\\repo'),
            resolveRepoRoot: (input: string | null) => String(input ?? ''),
            selectHookContextId: vi.fn(() => 'ctx-1'),
            printJsonOrValue,
            formatSyncPolicyLabel: (policy: string | null | undefined) => policy ?? 'none'
        } as never);

        const exitCode = await commandWorkspaces(['delete'], { json: true });

        expect(exitCode).toBe(1);
        expect(sendToDaemon).toHaveBeenCalledWith('listContexts', {});
        expect(sendToDaemon).not.toHaveBeenCalledWith('deleteContext', expect.anything());
        expect(String(consoleError.mock.calls[0]?.[0] ?? '')).toContain('workspaces_delete_requires_confirm');
    });

    it('deletes a workspace resolved from repo-root', async () => {
        const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
        const sendToDaemon = vi.fn(async (method: string, params?: Record<string, unknown>) => {
            switch (method) {
                case 'listContexts':
                    return [{ id: 'ctx-1', name: 'repo', paths: ['C:\\repo'] }];
                case 'deleteContext':
                    return { success: true, params };
                default:
                    return null;
            }
        });

        const { commandWorkspaces } = createWorkspaceCommands({
            parseOptionalStringFlag,
            sendToDaemon,
            findGitRepoRoot: vi.fn(() => null),
            resolveRepoRoot: (input: string | null) => String(input ?? ''),
            selectHookContextId: vi.fn(() => 'ctx-1'),
            printJsonOrValue,
            formatSyncPolicyLabel: (policy: string | null | undefined) => policy ?? 'none'
        } as never);

        const exitCode = await commandWorkspaces(['delete'], {
            json: true,
            confirm: true,
            'repo-root': 'C:\\repo'
        });

        expect(exitCode).toBe(0);
        expect(sendToDaemon).toHaveBeenCalledWith('deleteContext', { id: 'ctx-1' });
        expect(JSON.parse(String(consoleLog.mock.calls[0]?.[0] ?? '{}'))).toMatchObject({
            success: true,
            contextId: 'ctx-1',
            workspaceName: 'repo',
            repoRoot: 'C:\\repo'
        });
    });

    it('uses the current repo as the default source workspace for compare', async () => {
        const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
        const sendToDaemon = vi.fn(async (method: string, params?: Record<string, unknown>) => {
            switch (method) {
                case 'listContexts':
                    return [
                        { id: 'ctx-source', name: 'source', paths: ['C:\\repo'], syncPolicy: 'local_only' },
                        { id: 'ctx-target', name: 'target', paths: ['C:\\other'], syncPolicy: 'local_only' }
                    ];
                case 'compareWorkspaces':
                    return {
                        source: { contextId: 'ctx-source' },
                        target: { contextId: 'ctx-target' },
                        comparisonKind: 'same_repository',
                        comparisonSummary: 'Both workspaces are bound to the same repository path.',
                        comparisonText: 'same repo'
                    };
                default:
                    return null;
            }
        });

        const { commandWorkspaces } = createWorkspaceCommands({
            parseOptionalStringFlag,
            sendToDaemon,
            findGitRepoRoot: vi.fn(() => 'C:\\repo'),
            resolveRepoRoot: (input: string | null) => String(input ?? ''),
            selectHookContextId: vi.fn((contexts: Array<{ id?: string; paths?: string[] }>, repoRoot: string) => (
                contexts.find((context) => context.paths?.includes(repoRoot))?.id ?? null
            )),
            printJsonOrValue,
            formatSyncPolicyLabel: (policy: string | null | undefined) => policy ?? 'none'
        } as never);

        const exitCode = await commandWorkspaces(['compare'], {
            json: true,
            'target-context-id': 'ctx-target'
        });

        expect(exitCode).toBe(0);
        expect(sendToDaemon).toHaveBeenCalledWith('compareWorkspaces', {
            sourceContextId: 'ctx-source',
            targetContextId: 'ctx-target'
        });
        expect(JSON.parse(String(consoleLog.mock.calls[0]?.[0] ?? '{}'))).toMatchObject({
            comparisonKind: 'same_repository',
            comparisonSummary: 'Both workspaces are bound to the same repository path.'
        });
    });
});
