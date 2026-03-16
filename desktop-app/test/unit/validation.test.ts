import { describe, expect, it } from 'vitest';
import { ensureDaemonStatus, ensurePreferences } from '../../src/shared/ipc/validation';

describe('desktop contract validation', () => {
  it('normalizes daemon status payloads', () => {
    const status = ensureDaemonStatus({
      health: { status: 'ok' },
      contexts: [{ id: 'ctx-1', name: 'alpha', paths: ['C:/repo'] }],
      capabilities: { methods: ['health', 'listContexts'] },
      storage: { dataDir: 'C:/Users/test/.0ctx' }
    });

    expect(status.health).toEqual({ status: 'ok' });
    expect(status.contexts[0]?.id).toBe('ctx-1');
    expect(status.capabilities.methods).toContain('health');
  });

  it('falls back to default preferences safely', () => {
    const preferences = ensurePreferences({});
    expect(preferences.theme).toBe('midnight');
    expect(preferences.lastRoute).toBe('overview');
  });
});
