import { describe, expect, it, vi } from 'vitest';
import { handleWorkstreamToolCall } from '../src/dispatch-workstream';

describe('MCP workstream tool dispatch', () => {
    it('lets compare-workspaces rely on the daemon session context when sourceContextId is omitted', async () => {
        const callDaemon = vi.fn(async () => ({ ok: true }));

        await handleWorkstreamToolCall('ctx_compare_workspaces', { targetContextId: 'ctx-target' }, {
            callDaemon,
            pickContextId: () => undefined,
            switchSessionContext: async () => undefined
        });

        expect(callDaemon).toHaveBeenCalledWith('compareWorkspaces', {
            sourceContextId: undefined,
            targetContextId: 'ctx-target'
        });
    });
});
