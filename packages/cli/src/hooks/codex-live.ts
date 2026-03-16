import { compactTranscriptText, extractGenericTextParts, getByPath, isRecord, normalizeCodexRole, pickString, pickTimestamp } from './shared';
import { summarizeTranscriptMessages } from './transcript';
import { type TranscriptCaptureData, type TranscriptCaptureMessage } from './types';

function selectCodexUserMessage(raw: Record<string, unknown>): {
    role: string;
    text: string;
    occurredAt: number | null;
    raw: Record<string, unknown> | string;
} | null {
    const inputs = getByPath(raw, 'input-messages') ?? getByPath(raw, 'input_messages');
    if (!Array.isArray(inputs) || inputs.length === 0) return null;

    for (let index = inputs.length - 1; index >= 0; index -= 1) {
        const item = inputs[index];
        if (typeof item === 'string') {
            const text = compactTranscriptText(item);
            if (!text) continue;
            return { role: 'user', text, occurredAt: null, raw: item };
        }
        if (!isRecord(item)) continue;
        const role = normalizeCodexRole(item.role ?? item.actor ?? item.speaker);
        const text = extractGenericTextParts(item.content ?? item.text ?? item.message).join(' ').trim();
        if (!text) continue;
        return {
            role,
            text,
            occurredAt: pickTimestamp(item, ['timestamp', 'createdAt', 'created_at'], Date.now()),
            raw: item
        };
    }

    return null;
}

export function readCodexCapture(
    payload: Record<string, unknown>,
    options: {
        sessionId: string;
        turnId: string;
        occurredAt: number;
    }
): TranscriptCaptureData {
    const sessionTitle = pickString(payload, ['thread-title', 'thread_title', 'title', 'sessionTitle', 'threadName']);
    const cwd = pickString(payload, ['cwd', 'workspace.cwd', 'workspace.path', 'project.path']);
    const messages: TranscriptCaptureMessage[] = [];
    const userMessage = selectCodexUserMessage(payload);
    const assistantText = pickString(payload, [
        'last-assistant-message',
        'last_assistant_message',
        'lastAssistantMessage',
        'assistant_response',
        'assistantResponse',
        'response',
        'content',
        'text'
    ]);

    if (userMessage && userMessage.role !== 'system' && userMessage.role !== 'tool') {
        messages.push({
            messageId: `${options.turnId}:user`,
            role: userMessage.role,
            text: userMessage.text,
            occurredAt: userMessage.occurredAt ?? options.occurredAt,
            parentId: null,
            lineNumber: 1,
            raw: typeof userMessage.raw === 'string' ? { text: userMessage.raw } : userMessage.raw
        });
    }
    if (assistantText) {
        messages.push({
            messageId: `${options.turnId}:assistant`,
            role: 'assistant',
            text: assistantText,
            occurredAt: options.occurredAt,
            parentId: messages.length > 0 ? messages[messages.length - 1].messageId : null,
            lineNumber: messages.length + 1,
            raw: payload
        });
    }

    return {
        summary: summarizeTranscriptMessages(messages, sessionTitle),
        cwd,
        sessionTitle,
        startedAt: messages[0]?.occurredAt ?? options.occurredAt,
        messages
    };
}
