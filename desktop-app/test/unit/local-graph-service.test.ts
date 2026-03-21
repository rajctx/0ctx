import { describe, expect, it } from 'vitest';
import { LocalGraphService } from '../../src/main/daemon/local-graph-service';

class MissingCoreLocalGraphService extends LocalGraphService {
  protected override loadCoreModule() {
    return null;
  }
}

describe('LocalGraphService', () => {
  it('does not throw when the optional core module is unavailable', () => {
    const service = new MissingCoreLocalGraphService();

    expect(service.resolvePreferredRead('listChatSessions', { contextId: 'ctx-1' })).toBeUndefined();
    expect(service.resolveReadFallback('listContexts', {})).toBeUndefined();
  });
});
