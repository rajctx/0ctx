import { describe, expect, it, vi } from 'vitest';
import { handleCoreToolCall } from '../src/dispatch-core';

describe('MCP core tool dispatch', () => {
    it('uses the session context helper for explicit context switches', async () => {
        const callDaemon = vi.fn(async (method: string) => {
            if (method === 'getActiveContext') {
                return { id: 'ctx-next', name: 'Next workspace' };
            }
            return null;
        });
        const switchSessionContext = vi.fn(async () => undefined);

        const result = await handleCoreToolCall('ctx_switch_context', { contextId: 'ctx-next' }, {
            callDaemon,
            pickContextId: () => undefined,
            switchSessionContext
        });

        expect(switchSessionContext).toHaveBeenCalledWith('ctx-next');
        expect(callDaemon).toHaveBeenCalledWith('getActiveContext', {});
        expect(result?.toolResult.content[0]?.text).toContain('Switched to active context: Next workspace');
    });
});
