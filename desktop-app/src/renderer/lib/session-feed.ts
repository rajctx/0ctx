import type { ChatSessionSummary } from '../../shared/types/domain';
import { deriveSessionPreview, deriveSessionTitle } from './session-display';

export interface SessionFeedResolution {
  sessions: ChatSessionSummary[];
  scope: 'workstream' | 'workspace';
  fallbackApplied: boolean;
}

export function resolveSessionFeed(options: {
  hasActiveWorkstream: boolean;
  workstreamSessions?: ChatSessionSummary[] | null;
  workspaceSessions?: ChatSessionSummary[] | null;
}): SessionFeedResolution {
  const workstreamSessions = options.workstreamSessions ?? [];
  const workspaceSessions = options.workspaceSessions ?? [];

  if (!options.hasActiveWorkstream) {
    return {
      sessions: workspaceSessions,
      scope: 'workspace',
      fallbackApplied: false
    };
  }

  if (workstreamSessions.length > 0) {
    return {
      sessions: workstreamSessions,
      scope: 'workstream',
      fallbackApplied: false
    };
  }

  return {
    sessions: workspaceSessions,
    scope: 'workspace',
    fallbackApplied: workspaceSessions.length > 0
  };
}

export function filterSessionsByQuery(
  sessions: ChatSessionSummary[],
  query: string
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return sessions;
  }

  return sessions.filter((session) => (
    [
      deriveSessionTitle(session),
      deriveSessionPreview(session),
      session.branch,
      session.agent,
      session.worktreePath,
      session.sessionId
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery)
  ));
}
