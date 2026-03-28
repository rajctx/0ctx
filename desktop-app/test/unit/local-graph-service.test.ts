import { describe, expect, it } from 'vitest';
import { LocalGraphService } from '../../src/main/daemon/local-graph-service';

class MissingCoreLocalGraphService extends LocalGraphService {
  protected override loadCoreModule() {
    return null;
  }
}

class FailingOpenLocalGraphService extends LocalGraphService {
  protected override loadCoreModule() {
    return {
      Graph: class {},
      openDb() {
        throw new Error('native module mismatch');
      }
    } as never;
  }
}

describe('LocalGraphService', () => {
  it('does not throw when the optional core module is unavailable', () => {
    const service = new MissingCoreLocalGraphService();

    expect(service.resolvePreferredRead('listChatSessions', { contextId: 'ctx-1' })).toBeUndefined();
    expect(service.resolveReadFallback('listContexts', {})).toBeUndefined();
  });

  it('falls back cleanly when the local graph cannot initialize', () => {
    const service = new FailingOpenLocalGraphService();

    expect(service.resolvePreferredRead('listChatSessions', { contextId: 'ctx-1' })).toBeUndefined();
    expect(service.resolveReadFallback('listContexts', {}, ['ctx-1'])).toEqual(['ctx-1']);
    expect(service.resolvePreferredRead('listChatSessions', { contextId: 'ctx-1' })).toBeUndefined();
  });
});
