import { describe, expect, it } from 'vitest';
import { buildOfflineDaemonFallback } from '../../src/main/daemon/offline-fallbacks';
import { isDaemonUnavailableError } from '../../src/main/daemon/ipc-client';

describe('daemon offline fallbacks', () => {
  it('detects missing pipe and empty-response errors as daemon unavailable', () => {
    expect(isDaemonUnavailableError(new Error('connect ENOENT \\\\.\\pipe\\0ctx.sock'))).toBe(true);
    expect(isDaemonUnavailableError(new Error('daemon_empty_response:createSession'))).toBe(true);
    expect(isDaemonUnavailableError(new Error('random parser issue'))).toBe(false);
  });

  it('returns stable read fallbacks when the daemon is offline', () => {
    expect(buildOfflineDaemonFallback('listBranchLanes')).toEqual([]);
    expect(buildOfflineDaemonFallback('getSessionDetail')).toEqual({
      session: null,
      messages: [],
      checkpointCount: 0,
      latestCheckpoint: null
    });
    expect(buildOfflineDaemonFallback('getHookHealth')).toMatchObject({
      readyCount: 0,
      agents: expect.arrayContaining([
        expect.objectContaining({ agent: 'claude', installed: false }),
        expect.objectContaining({ agent: 'factory', installed: false }),
        expect.objectContaining({ agent: 'antigravity', installed: false })
      ])
    });
  });

  it('derives comparison placeholders from method params', () => {
    expect(
      buildOfflineDaemonFallback('compareWorkspaces', {
        sourceContextId: 'ctx-a',
        targetContextId: 'ctx-b'
      })
    ).toMatchObject({
      source: expect.objectContaining({ contextId: 'ctx-a' }),
      target: expect.objectContaining({ contextId: 'ctx-b' }),
      comparisonKind: 'isolated'
    });

    expect(
      buildOfflineDaemonFallback('compareWorkstreams', {
        contextId: 'ctx-a',
        sourceBranch: 'main',
        targetBranch: 'develop'
      })
    ).toMatchObject({
      contextId: 'ctx-a',
      source: expect.objectContaining({ branch: 'main' }),
      target: expect.objectContaining({ branch: 'develop' }),
      comparisonKind: 'not_comparable'
    });
  });
});
