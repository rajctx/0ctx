import { describe, expect, it } from 'vitest';
import { resolveSessionFeed } from '../../src/renderer/lib/session-feed';

describe('session feed resolution', () => {
  it('prefers workstream sessions when they exist', () => {
    const result = resolveSessionFeed({
      hasActiveWorkstream: true,
      workstreamSessions: [{ sessionId: 's-1' }],
      workspaceSessions: [{ sessionId: 's-2' }]
    });

    expect(result.sessions.map((session) => session.sessionId)).toEqual(['s-1']);
    expect(result.scope).toBe('workstream');
    expect(result.fallbackApplied).toBe(false);
  });

  it('falls back to workspace sessions when the selected workstream has none', () => {
    const result = resolveSessionFeed({
      hasActiveWorkstream: true,
      workstreamSessions: [],
      workspaceSessions: [{ sessionId: 's-2' }, { sessionId: 's-3' }]
    });

    expect(result.sessions.map((session) => session.sessionId)).toEqual(['s-2', 's-3']);
    expect(result.scope).toBe('workspace');
    expect(result.fallbackApplied).toBe(true);
  });
});
