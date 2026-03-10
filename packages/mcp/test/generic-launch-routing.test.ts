import { describe, expect, it, vi } from 'vitest';
import { resolveRequestSessionContextId, selectContextIdForWorkingDirectory } from '../src/session-context';

describe('MCP generic launch routing matrix', () => {
    const contexts = [
        { id: 'ctx-claude', paths: ['C:\\repos\\claude-repo'] },
        { id: 'ctx-factory', paths: ['C:\\repos\\factory-repo'] },
        { id: 'ctx-antigravity', paths: ['C:\\repos\\antigravity-repo'] }
    ];

    it('keeps Claude on the explicit context binding even when the launch directory is unrelated', async () => {
        const listContexts = vi.fn(async () => contexts);

        expect(selectContextIdForWorkingDirectory(contexts, 'C:\\Users\\Rajesh')).toBeNull();
        await expect(resolveRequestSessionContextId({ contextId: 'ctx-claude' }, listContexts)).resolves.toBe('ctx-claude');
        expect(listContexts).not.toHaveBeenCalled();
    });

    it('resolves Antigravity repositoryRoot hints back to the enabled workspace from a generic launch', async () => {
        const listContexts = vi.fn(async () => contexts);

        expect(selectContextIdForWorkingDirectory(contexts, 'C:\\Users\\Rajesh')).toBeNull();
        await expect(resolveRequestSessionContextId({
            repositoryRoot: 'C:\\repos\\antigravity-repo'
        }, listContexts)).resolves.toBe('ctx-antigravity');
        expect(listContexts).toHaveBeenCalledTimes(1);
    });

    it('resolves Factory worktree hints back to the repo-bound workspace from a generic launch', async () => {
        const listContexts = vi.fn(async () => contexts);

        expect(selectContextIdForWorkingDirectory(contexts, 'C:\\Users\\Rajesh')).toBeNull();
        await expect(resolveRequestSessionContextId({
            worktreePath: 'C:\\repos\\factory-repo\\worktrees\\feature-routing'
        }, listContexts)).resolves.toBe('ctx-factory');
        expect(listContexts).toHaveBeenCalledTimes(1);
    });

    it('resolves compare-style source and target worktree hints without relying on process cwd', async () => {
        const listContexts = vi.fn(async () => contexts);

        expect(selectContextIdForWorkingDirectory(contexts, 'C:\\Users\\Rajesh')).toBeNull();
        await expect(resolveRequestSessionContextId({
            sourceWorktreePath: 'C:\\repos\\factory-repo\\worktrees\\feature-source',
            targetWorktreePath: 'C:\\repos\\antigravity-repo\\worktrees\\feature-target'
        }, listContexts)).resolves.toBe('ctx-factory');
        expect(listContexts).toHaveBeenCalledTimes(1);
    });
});
