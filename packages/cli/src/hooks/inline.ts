import { pickString, pickTimestamp, pickVisibleText, normalizeCodexRole } from './shared';
import { summarizeTranscriptMessages } from './transcript';
import { type HookAgent, type TranscriptCaptureData, type TranscriptCaptureMessage } from './types';

function deriveInlineEventMode(agent: HookAgent, payload: Record<string, unknown>): 'user' | 'assistant' | 'mixed' | 'unknown' {
    const eventName = pickString(payload, [
        'hook_event_name',
        'hookEventName',
        'event',
        'agent_action_name',
        'type',
        'name'
    ])?.toLowerCase() ?? '';
    const rawRole = pickString(payload, ['role', 'message.role', 'actor', 'speaker']);
    const role = rawRole ? normalizeCodexRole(rawRole) : null;

    if (agent === 'windsurf') {
        if (eventName.includes('pre_user_prompt')) return 'user';
        if (eventName.includes('post_cascade_response')) return 'assistant';
    }
    if (agent === 'cursor') {
        if (eventName.includes('before') || eventName.includes('submitprompt')) return 'user';
        if (eventName.includes('afteragentresponse')) return 'assistant';
    }
    if (role === 'user') return 'user';
    if (role === 'assistant') return 'assistant';
    if (role === 'system' || role === 'tool') return 'unknown';
    return 'mixed';
}

export function readInlineHookCapture(
    agent: HookAgent,
    payload: Record<string, unknown>,
    options: {
        sessionId: string;
        turnId: string;
        occurredAt: number;
    }
): TranscriptCaptureData {
    const sessionTitle = pickString(payload, [
        'sessionTitle',
        'thread-title',
        'thread_title',
        'threadName',
        'conversation.title',
        'title'
    ]);
    const cwd = pickString(payload, ['cwd', 'workspace.cwd', 'workspace.path', 'project.path', 'repositoryRoot']);
    const userText = pickVisibleText(payload, [
        'tool_info.user_prompt',
        'user_prompt',
        'userPrompt',
        'prompt',
        'request.prompt',
        'input',
        'input_message',
        'input.message'
    ]);
    const assistantText = pickVisibleText(payload, [
        'last_assistant_message',
        'lastAssistantMessage',
        'last-assistant-message',
        'tool_info.response',
        'assistant_response',
        'assistantResponse',
        'completion',
        'response',
        'message.content',
        'content',
        'text'
    ]);
    const mode = deriveInlineEventMode(agent, payload);
    const startedAt = pickTimestamp(payload, ['timestamp', 'createdAt', 'created_at', 'eventAt', 'time'], options.occurredAt);
    const messages: TranscriptCaptureMessage[] = [];

    if ((mode === 'user' || mode === 'mixed') && userText) {
        messages.push({
            messageId: `${options.turnId}:user`,
            role: 'user',
            text: userText,
            occurredAt: startedAt,
            parentId: null,
            lineNumber: 1,
            raw: payload
        });
    }
    if ((mode === 'assistant' || mode === 'mixed') && assistantText) {
        messages.push({
            messageId: `${options.turnId}:assistant`,
            role: 'assistant',
            text: assistantText,
            occurredAt: options.occurredAt,
            parentId: messages[0]?.messageId ?? null,
            lineNumber: messages.length + 1,
            raw: payload
        });
    }

    return {
        summary: summarizeTranscriptMessages(messages, sessionTitle),
        cwd,
        sessionTitle,
        startedAt: messages[0]?.occurredAt ?? startedAt,
        messages
    };
}
