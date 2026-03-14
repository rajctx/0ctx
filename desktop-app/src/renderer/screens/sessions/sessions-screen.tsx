import type { ChatSessionSummary } from '../../../shared/types/domain';
import { useSessionMessages, useSessions, useWorkstreams } from '../../features/runtime/queries';
import { formatClockTime, pickText, workstreamKey } from '../../lib/format';
import { useShellStore } from '../../lib/store';

function SessionBlock({
  session,
  index,
  activeContextId
}: {
  session: ChatSessionSummary;
  index: number;
  activeContextId: string | null;
}) {
  const messages = useSessionMessages(activeContextId, session.sessionId);
  const label = pickText(session.title, session.summary, session.sessionId);

  return (
    <div className="session-block">
      <div className="session-heading">
        <span className="chevron">&gt;&gt;</span>
        {`Session ${index + 1}: ${label}`}
      </div>

      {(messages.data ?? []).slice(0, 4).map((message) => {
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

      {(messages.data ?? []).length === 0 ? (
        <div className="message">
          <div className="msg-meta">
            <span className="msg-time">--:--:--</span>
            <span className="msg-sender">SYS</span>
          </div>
          <div className="msg-body sys">[LOG] No captured messages are available for this session yet.</div>
        </div>
      ) : null}
    </div>
  );
}

export function SessionsScreen() {
  const { activeContextId, activeWorkstreamKey } = useShellStore();
  const workstreams = useWorkstreams(activeContextId);
  const activeWorkstream = (workstreams.data ?? []).find((stream) => workstreamKey(stream.branch, stream.worktreePath) === activeWorkstreamKey)
    ?? workstreams.data?.[0]
    ?? null;
  const sessions = useSessions(
    activeContextId,
    activeWorkstream?.branch ?? null,
    activeWorkstream?.worktreePath ?? null,
    activeWorkstream ? workstreamKey(activeWorkstream.branch, activeWorkstream.worktreePath) : null
  );

  if ((sessions.data ?? []).length === 0) {
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
          <div className="msg-body sys">[LOG] No sessions are available for the selected workstream.</div>
        </div>
      </div>
    );
  }

  return (
    <>
      {(sessions.data ?? []).slice(0, 3).map((session, index) => (
        <SessionBlock key={session.sessionId} session={session} index={index} activeContextId={activeContextId} />
      ))}
    </>
  );
}
