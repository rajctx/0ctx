import fs from 'fs';
import path from 'path';
import { extractTranscriptTextParts, isRecord, pickString, pickTimestamp } from './shared';
import { type TranscriptCaptureData, type TranscriptCaptureMessage } from './types';

export function summarizeTranscriptMessages(messages: TranscriptCaptureMessage[], sessionTitle: string | null): string | null {
    let lastUserText: string | null = null;
    let lastAssistantText: string | null = null;

    for (const message of messages) {
        if (message.role === 'user') {
            lastUserText = message.text;
            continue;
        }
        if (message.role === 'assistant') {
            lastAssistantText = message.text;
        }
    }

    if (lastUserText && lastAssistantText) {
        return `${lastUserText} -> ${lastAssistantText}`;
    }
    return lastAssistantText ?? lastUserText ?? sessionTitle;
}

export function readTranscriptCapture(filePath: string | null): TranscriptCaptureData {
    const empty = {
        summary: null,
        cwd: null,
        sessionTitle: null,
        startedAt: null,
        messages: []
    };
    if (!filePath) {
        return empty;
    }

    try {
        const resolvedPath = path.resolve(filePath);
        if (!fs.existsSync(resolvedPath)) {
            return empty;
        }

        const content = fs.readFileSync(resolvedPath, 'utf8');
        let cwd: string | null = null;
        let sessionTitle: string | null = null;
        const messages: TranscriptCaptureMessage[] = [];
        const usedIds = new Map<string, number>();

        for (const [index, line] of content.split(/\r?\n/).entries()) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            let parsed: unknown;
            try {
                parsed = JSON.parse(trimmed);
            } catch {
                continue;
            }
            if (!isRecord(parsed)) continue;

            const lineType = typeof parsed.type === 'string' ? parsed.type : null;
            if (lineType === 'session_start') {
                cwd = pickString(parsed, ['cwd']) ?? cwd;
                sessionTitle = pickString(parsed, ['title', 'sessionTitle']) ?? sessionTitle;
                continue;
            }
            if (lineType !== 'message') continue;

            const message = isRecord(parsed.message) ? parsed.message : null;
            if (!message) continue;

            const role = typeof message.role === 'string' ? message.role.trim().toLowerCase() : null;
            const visibleText = extractTranscriptTextParts(message.content).join(' ').trim();
            if (!visibleText) continue;

            const baseMessageId = pickString(parsed, ['id', 'message.id']) ?? `line-${index + 1}`;
            const seenCount = usedIds.get(baseMessageId) ?? 0;
            usedIds.set(baseMessageId, seenCount + 1);
            const messageId = seenCount === 0 ? baseMessageId : `${baseMessageId}-${seenCount + 1}`;

            messages.push({
                messageId,
                role: role ?? 'unknown',
                text: visibleText,
                occurredAt: pickTimestamp(parsed, ['timestamp', 'createdAt', 'created_at'], Date.now()),
                parentId: pickString(parsed, ['parentId']),
                lineNumber: index + 1,
                raw: parsed
            });
        }

        return {
            summary: summarizeTranscriptMessages(messages, sessionTitle),
            cwd,
            sessionTitle,
            startedAt: messages[0]?.occurredAt ?? null,
            messages
        };
    } catch {
        return empty;
    }
}

export function readTranscriptSummary(filePath: string | null): {
    summary: string | null;
    cwd: string | null;
    sessionTitle: string | null;
} {
    const capture = readTranscriptCapture(filePath);
    return {
        summary: capture.summary,
        cwd: capture.cwd,
        sessionTitle: capture.sessionTitle
    };
}

export function resolveHookTranscriptPath(payload: Record<string, unknown>): string | null {
    return pickString(payload, [
        'transcript_path',
        'transcriptPath',
        'agent_transcript_path',
        'agentTranscriptPath'
    ]);
}
