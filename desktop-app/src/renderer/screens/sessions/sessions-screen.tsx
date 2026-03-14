import { useMemo } from 'react';
import type { ChatSessionSummary, ChatMessage } from '../../../shared/types/domain';
import { useSessionDetail, useSessions, useWorkstreams } from '../../features/runtime/queries';
import { formatClockTime, formatRelativeLabel, pickText, workstreamKey } from '../../lib/format';
import { filterSessionsByQuery, resolveSessionFeed } from '../../lib/session-feed';
import { useShellStore } from '../../lib/store';

function sessionHeading(session: ChatSessionSummary, index: number) {
  return `Session ${index + 1}: ${pickText(session.title, session.summary, session.sessionId)}`;
}

function messageMatchesQuery(message: ChatMessage, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [
    message.role,
    message.agent,
    message.content,
    message.prompt,
    message.reply,
    message.sessionTitle
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(normalizedQuery);
}

function SessionTranscript({
  session,
  index,
  messages,
  fallbackApplied,
  search
}: {
  session: ChatSessionSummary;
  index: number;
  messages: ChatMessage[];
  fallbackApplied: boolean;
  search: string;
}) {
  const visibleMessages = useMemo(
    () => messages.filter((message) => messageMatchesQuery(message, search)),
    [messages, search]
  );

  return (
    <div className="session-block">
      <div className="session-heading">
        <span className="chevron">&gt;&gt;</span>
        {sessionHeading(session, index)}
      </div>
      <div className="session-subhead">
        {[
          pickText(session.branch, 'No branch'),
          pickText(session.agent, 'Unknown agent'),
          `${typeof session.turnCount === 'number' ? session.turnCount : visibleMessages.length} turns`,
          formatRelativeLabel(session.lastTurnAt)
        ].join(' · ')}
      </div>

      {fallbackApplied ? (
        <div className="message">
          <div className="msg-meta">
            <span className="msg-time">--:--:--</span>
            <span className="msg-sender">SYS</span>
          </div>
          <div className="msg-body sys">[LOG] Showing a workspace session because the selected workstream had no direct session match.</div>
        </div>
      ) : null}

      {visibleMessages.map((message) => {
        const sender = pickText(message.role, message.agent, 'SYS').toUpperCase();
        const body = pickText(message.content, message.prompt, message.reply, 'No message content recorded.');
        const isSystem = sender === 'SYS' || sender === 'SYSTEM';

        return (
          <div key={message.nodeId} className="message">
            <div className="msg-meta">
              <span className="msg-time">{formatClockTime(message.createdAt)}</span>
              <span className="msg-sender">{sender}</span>
            </div>
            <div className={isSystem ? 'msg-body sys' : 'msg-body'}>{body}</div>
          </div>
        );
      })}

      {messages.length === 0 ? (
        <div className="message">
          <div className="msg-meta">
            <span className="msg-time">--:--:--</span>
            <span className="msg-sender">SYS</span>
          </div>
          <div className="msg-body sys">[LOG] No captured messages are available for this session yet.</div>
        </div>
      ) : null}

      {messages.length > 0 && visibleMessages.length === 0 ? (
        <div className="message">
          <div className="msg-meta">
            <span className="msg-time">--:--:--</span>
            <span className="msg-sender">SYS</span>
          </div>
          <div className="msg-body sys">[LOG] No messages in this session match the active filter.</div>
        </div>
      ) : null}
    </div>
  );
}

export function SessionsScreen() {
  const { activeContextId, activeWorkstreamKey, activeSessionId, search } = useShellStore();
  const workstreams = useWorkstreams(activeContextId);
  const activeWorkstream = (workstreams.data ?? []).find((stream) => workstreamKey(stream.branch, stream.worktreePath) === activeWorkstreamKey)
    ?? workstreams.data?.[0]
    ?? null;
  const workstreamSessions = useSessions(
    activeContextId,
    activeWorkstream?.branch ?? null,
    activeWorkstream?.worktreePath ?? null,
    activeWorkstream ? workstreamKey(activeWorkstream.branch, activeWorkstream.worktreePath) : null
  );
  const workspaceSessions = useSessions(activeContextId, null, null, `workspace-sessions:${activeContextId ?? 'none'}`);
  const sessionFeed = resolveSessionFeed({
    hasActiveWorkstream: Boolean(activeWorkstream),
    workstreamSessions: workstreamSessions.data,
    workspaceSessions: workspaceSessions.data
  });
  const filteredSessions = filterSessionsByQuery(sessionFeed.sessions, search);
  const selectedSession = filteredSessions.find((session) => session.sessionId === activeSessionId)
    ?? filteredSessions[0]
    ?? null;
  const selectedIndex = selectedSession
    ? filteredSessions.findIndex((session) => session.sessionId === selectedSession.sessionId)
    : -1;
  const detail = useSessionDetail(activeContextId, selectedSession?.sessionId ?? null);
  const messages = detail.data?.messages ?? [];

  if (filteredSessions.length === 0) {
    return (
      <div className="session-block">
        <div className="session-heading">
          <span className="chevron">&gt;&gt;</span>
          Session stream
        </div>
        <div className="message">
          <div className="msg-meta">
            <span className="msg-time">--:--:--</span>
            <span className="msg-sender">SYS</span>
          </div>
          <div className="msg-body sys">
            {search.trim()
              ? '[LOG] No sessions match the current filter.'
              : '[LOG] No sessions are available for the selected workstream or workspace.'}
          </div>
        </div>
      </div>
    );
  }

  if (!selectedSession) {
    return null;
  }

  return (
    <SessionTranscript
      session={selectedSession}
      index={selectedIndex === -1 ? 0 : selectedIndex}
      messages={messages}
      fallbackApplied={sessionFeed.fallbackApplied}
      search={search}
    />
  );
}
