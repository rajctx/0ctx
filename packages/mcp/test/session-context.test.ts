import { describe, expect, it } from 'vitest';
import { selectContextIdForWorkingDirectory } from '../src/session-context';

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
});
