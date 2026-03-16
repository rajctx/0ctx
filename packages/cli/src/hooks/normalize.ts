import { readTranscriptSummary, resolveHookTranscriptPath } from './transcript';
import { pickString, pickTimestamp } from './shared';
import { type HookAgent, type NormalizedHookPayload } from './types';

function normalizeSummary(value: string): string {
    const compact = value.replace(/\s+/g, ' ').trim();
    if (!compact) return 'Chat turn captured';
    return compact.length > 280 ? `${compact.slice(0, 277)}...` : compact;
}

export function normalizeHookPayload(agent: HookAgent, payload: unknown, now = Date.now()): NormalizedHookPayload {
    const raw: Record<string, unknown> = (payload && typeof payload === 'object' && !Array.isArray(payload))
        ? { ...(payload as Record<string, unknown>) }
        : { payload };

    const baseSessionKeys = ['sessionId', 'session_id', 'session.id', 'conversationId', 'conversation_id', 'thread', 'threadId', 'thread_id'];
    const baseTurnKeys = [
        'turnId',
        'turn_id',
        'turn.id',
        'messageId',
        'message_id',
        'message.id',
        'generation_id',
        'generationId',
        'execution_id',
        'executionId',
        'id'
    ];
    const baseRoleKeys = ['role', 'message.role', 'actor', 'speaker'];
    const baseSummaryKeys = [
        'summary',
        'message.content',
        'content',
        'text',
        'prompt',
        'completion',
        'response',
        'stop_reason',
        'assistant_response',
        'assistantResponse',
        'tool_info.response'
    ];
    const windsurfSummaryKeys = ['tool_info.response', 'response', 'tool_info.user_prompt', ...baseSummaryKeys];
    const cursorSummaryKeys = ['response', 'text', 'content', ...baseSummaryKeys];
    const factorySummaryKeys = ['hook_event_name', 'stop_reason', ...baseSummaryKeys];
    const codexSummaryKeys = ['last-assistant-message', 'last_assistant_message', 'lastAssistantMessage', ...baseSummaryKeys];
    const claudeSummaryKeys = ['last_assistant_message', 'lastAssistantMessage', 'last-assistant-message', ...baseSummaryKeys];
    const transcriptSummary = (agent === 'factory' || agent === 'antigravity' || agent === 'claude')
        ? readTranscriptSummary(resolveHookTranscriptPath(raw))
        : { summary: null, cwd: null, sessionTitle: null };
    if (transcriptSummary.cwd && !pickString(raw, ['cwd'])) {
        raw.cwd = transcriptSummary.cwd;
    }
    if (transcriptSummary.sessionTitle && !pickString(raw, ['sessionTitle', 'title'])) {
        raw.sessionTitle = transcriptSummary.sessionTitle;
    }

    const agentSessionKeys = agent === 'windsurf'
        ? ['trajectory_id', 'conversation.id', ...baseSessionKeys]
        : agent === 'cursor'
            ? ['conversation.id', 'conversation_id', 'thread.id', ...baseSessionKeys]
            : agent === 'codex'
                ? ['thread-id', 'thread_id', 'thread.id', 'session.id', ...baseSessionKeys]
                : (agent === 'factory' || agent === 'antigravity')
                    ? ['session_id', 'sessionId', ...baseSessionKeys]
                    : ['conversation.id', ...baseSessionKeys];
    const agentTurnKeys = agent === 'windsurf'
        ? ['execution_id', 'executionId', 'turn.id', ...baseTurnKeys]
        : agent === 'cursor'
            ? ['generation_id', 'generationId', 'turn.id', ...baseTurnKeys]
            : agent === 'codex'
                ? ['turn-id', 'turn_id', 'turn.id', ...baseTurnKeys]
                : [...baseTurnKeys];
    const agentSummaryKeys = agent === 'windsurf'
        ? windsurfSummaryKeys
        : agent === 'cursor'
            ? cursorSummaryKeys
            : agent === 'codex'
                ? codexSummaryKeys
                : agent === 'claude'
                    ? claudeSummaryKeys
                    : (agent === 'factory' || agent === 'antigravity')
                        ? factorySummaryKeys
                        : baseSummaryKeys;
    const summaryFallback = agent === 'codex'
        ? pickString(raw, ['input-messages.0', 'input_messages.0'])
        : agent === 'cursor'
            ? pickString(raw, ['prompt', 'text'])
            : (agent === 'factory' || agent === 'antigravity' || agent === 'claude')
                ? transcriptSummary.summary ?? pickString(raw, ['sessionTitle', 'title'])
                : null;

    const sessionId = pickString(raw, agentSessionKeys) ?? 'default-session';
    const occurredAt = pickTimestamp(raw, ['timestamp', 'createdAt', 'created_at', 'time', 'eventAt', 'event_at', 'tool_info.timestamp'], now);
    const turnId = pickString(raw, agentTurnKeys) ?? `turn-${occurredAt}`;
    const windsurfAction = pickString(raw, ['agent_action_name', 'event']);
    const defaultRole = (agent === 'claude' || agent === 'codex' || agent === 'cursor' || agent === 'factory' || agent === 'antigravity')
        ? 'assistant'
        : (agent === 'windsurf' && windsurfAction?.startsWith('post_cascade_response'))
            ? 'assistant'
            : 'unknown';
    const role = pickString(raw, baseRoleKeys) ?? defaultRole;
    const summarySource = (agent === 'factory' || agent === 'antigravity' || agent === 'claude')
        ? summaryFallback ?? pickString(raw, agentSummaryKeys)
        : pickString(raw, agentSummaryKeys) ?? summaryFallback;

    return {
        agent,
        sessionId,
        turnId,
        role,
        summary: normalizeSummary(summarySource ?? JSON.stringify(raw)),
        occurredAt,
        raw
    };
}
