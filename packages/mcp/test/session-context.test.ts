import { describe, expect, it, vi } from 'vitest';
import { resolveRequestSessionContextId, selectContextIdForToolArgs, selectContextIdForWorkingDirectory } from '../src/session-context';

describe('MCP session context selection', () => {
    it('matches the enabled workspace from a nested repo working directory', () => {
        const contextId = selectContextIdForWorkingDirectory([
            { id: 'ctx-a', paths: ['C:\\repo-a'] },
            { id: 'ctx-b', paths: ['C:\\repo-b'] }
        ], 'C:\\repo-b\\packages\\cli');

        expect(contextId).toBe('ctx-b');
    });

    it('returns null when the working directory is outside enabled workspaces', () => {
        const contextId = selectContextIdForWorkingDirectory([
            { id: 'ctx-a', paths: ['C:\\repo-a'] }
        ], 'C:\\outside');

        expect(contextId).toBeNull();
    });

    it('prefers explicit context bindings from tool arguments', () => {
        expect(selectContextIdForToolArgs(null, { contextId: 'ctx-explicit' })).toBe('ctx-explicit');
        expect(selectContextIdForToolArgs(null, { sourceContextId: 'ctx-source' })).toBe('ctx-source');
    });

    it('resolves a workspace from worktree and repo path arguments', () => {
        const contexts = [
            { id: 'ctx-a', paths: ['C:\\repo-a'] },
            { id: 'ctx-b', paths: ['C:\\repo-b'] }
        ];

        expect(selectContextIdForToolArgs(contexts, { worktreePath: 'C:\\repo-b\\worktrees\\feature' })).toBe('ctx-b');
        expect(selectContextIdForToolArgs(contexts, { repoRoot: 'C:\\repo-a' })).toBe('ctx-a');
        expect(selectContextIdForToolArgs(contexts, { sourceWorktreePath: 'C:\\repo-b\\src' })).toBe('ctx-b');
    });

    it('avoids listing contexts when a request has no context hints', async () => {
        const listContexts = vi.fn(async () => [{ id: 'ctx-a', paths: ['C:\\repo-a'] }]);

        const contextId = await resolveRequestSessionContextId({ branch: 'feature/test' }, listContexts);

        expect(contextId).toBeNull();
        expect(listContexts).not.toHaveBeenCalled();
    });
});
