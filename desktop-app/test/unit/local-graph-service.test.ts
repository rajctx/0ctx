import { describe, expect, it, vi } from 'vitest';
import { LocalGraphService } from '../../src/main/daemon/local-graph-service';

describe('local graph service', () => {
  it('prefers direct local session detail reads for hot session data', () => {
    const service = new LocalGraphService();
    const detail = {
      session: { sessionId: 'sess-1', turnCount: 5 },
      messages: [{ nodeId: 'msg-1', role: 'user', content: 'hello' }],
      checkpointCount: 0,
      latestCheckpoint: null
    };
    const getSessionDetail = vi.fn(() => detail);

    (service as unknown as { getGraph: () => unknown }).getGraph = () => ({
      getSessionDetail
    });

    expect(service.resolvePreferredRead('getSessionDetail', { contextId: 'ctx-1', sessionId: 'sess-1' })).toEqual(detail);
    expect(getSessionDetail).toHaveBeenCalledWith('ctx-1', 'sess-1');
  });

  it('falls back to the local graph when daemon session detail is internally inconsistent', () => {
    const service = new LocalGraphService();
    const localDetail = {
      session: { sessionId: 'sess-2', turnCount: 5 },
      messages: [{ nodeId: 'msg-2', role: 'assistant', content: 'from local graph' }],
      checkpointCount: 0,
      latestCheckpoint: null
    };
    const getSessionDetail = vi.fn(() => localDetail);

    (service as unknown as { getGraph: () => unknown }).getGraph = () => ({
      getSessionDetail
    });

    const daemonResult = {
      session: { sessionId: 'sess-2', turnCount: 5 },
      messages: [],
      checkpointCount: 0,
      latestCheckpoint: null
    };

    expect(service.resolveReadFallback('getSessionDetail', { contextId: 'ctx-1', sessionId: 'sess-2' }, daemonResult)).toEqual(localDetail);
    expect(getSessionDetail).toHaveBeenCalledWith('ctx-1', 'sess-2');
  });
});
