import { describe, expect, it, vi } from 'vitest';
import { handleOpsToolCall } from '../src/dispatch-ops';

describe('MCP ops tool dispatch', () => {
    it('switches the session to a restored backup context', async () => {
        const callDaemon = vi.fn(async (method: string) => {
            if (method === 'restoreBackup') {
                return { id: 'ctx-restored', name: 'Restored workspace' };
            }
            return null;
        });
        const switchSessionContext = vi.fn(async () => undefined);

        const result = await handleOpsToolCall('ctx_backup_restore', { fileName: 'backup.enc' }, {
            callDaemon,
            pickContextId: () => undefined,
            switchSessionContext
        });

        expect(callDaemon).toHaveBeenCalledWith('restoreBackup', { fileName: 'backup.enc', name: undefined });
        expect(switchSessionContext).toHaveBeenCalledWith('ctx-restored');
        expect(result?.toolResult.content[0]?.text).toContain('Restored to context: ctx-restored');
    });
});
