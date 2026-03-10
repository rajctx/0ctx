import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractGenericTextParts, getByPath, isRecord, normalizeCodexRole, pickString, pickTimestamp } from './shared';
import { summarizeTranscriptMessages } from './transcript';
import { type TranscriptCaptureData, type TranscriptCaptureMessage } from './types';

function readCodexIndexTimestamps(sessionId: string): number[] {
    const indexPath = path.join(os.homedir(), '.codex', 'session_index.jsonl');
    if (!fs.existsSync(indexPath)) {
        return [];
    }
    try {
        const lines = fs.readFileSync(indexPath, 'utf8').split(/\r?\n/);
        const matches: number[] = [];
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let parsed: unknown;
            try {
                parsed = JSON.parse(trimmed);
            } catch {
                continue;
            }
            if (!isRecord(parsed) || pickString(parsed, ['id']) !== sessionId) {
                continue;
            }
            const updatedAt = pickTimestamp(parsed, ['updated_at', 'updatedAt', 'timestamp'], NaN);
            if (Number.isFinite(updatedAt)) {
                matches.push(updatedAt);
            }
        }
        return matches;
    } catch {
        return [];
    }
}

function codexSessionIdFromArchive(filePath: string): string | null {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        for (const line of content.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let parsed: unknown;
            try {
                parsed = JSON.parse(trimmed);
            } catch {
                continue;
            }
            if (!isRecord(parsed) || parsed.type !== 'session_meta') {
                continue;
            }
            const payload = isRecord(parsed.payload) ? parsed.payload : parsed;
            return pickString(payload, ['id', 'session_id', 'sessionId']);
        }
    } catch {
        return null;
    }
    return null;
}

function collectCodexSearchRoots(sessionsRoot: string, sessionId: string): string[] {
    const roots = new Set<string>([sessionsRoot]);
    for (const timestamp of readCodexIndexTimestamps(sessionId)) {
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) continue;
        roots.add(path.join(
            sessionsRoot,
            String(date.getUTCFullYear()).padStart(4, '0'),
            String(date.getUTCMonth() + 1).padStart(2, '0'),
            String(date.getUTCDate()).padStart(2, '0')
        ));
    }
    return Array.from(roots).filter((value) => fs.existsSync(value));
}

export function resolveCodexSessionArchivePath(payload: Record<string, unknown>, sessionId: string): string | null {
    const explicitPath = pickString(payload, [
        'session_path',
        'sessionPath',
        'archive_path',
        'archivePath',
        'transcript_path',
        'transcriptPath'
    ]);
    if (explicitPath) {
        const resolved = path.resolve(explicitPath);
        if (fs.existsSync(resolved)) {
            return resolved;
        }
    }

    const sessionsRoot = path.join(os.homedir(), '.codex', 'sessions');
    if (!fs.existsSync(sessionsRoot)) {
        return null;
    }

    const searchRoots = collectCodexSearchRoots(sessionsRoot, sessionId);
    let bestMatch: { path: string; mtimeMs: number } | null = null;
    const inspectedFiles: string[] = [];
    const pending = [...searchRoots];
    while (pending.length > 0) {
        const current = pending.pop();
        if (!current) continue;
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                pending.push(fullPath);
                continue;
            }
            if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.jsonl')) {
                continue;
            }
            inspectedFiles.push(fullPath);
            if (!entry.name.includes(sessionId)) {
                continue;
            }
            const mtimeMs = fs.existsSync(fullPath) ? (fs.statSync(fullPath).mtimeMs ?? 0) : 0;
            if (!bestMatch || mtimeMs >= bestMatch.mtimeMs) {
                bestMatch = { path: fullPath, mtimeMs };
            }
        }
    }

    if (bestMatch) {
        return bestMatch.path;
    }
    for (const filePath of inspectedFiles) {
        if (codexSessionIdFromArchive(filePath) !== sessionId) {
            continue;
        }
        const mtimeMs = fs.existsSync(filePath) ? (fs.statSync(filePath).mtimeMs ?? 0) : 0;
        if (!bestMatch || mtimeMs >= bestMatch.mtimeMs) {
            bestMatch = { path: filePath, mtimeMs };
        }
    }
    return bestMatch?.path ?? null;
}

export function readCodexArchiveCapture(
    filePath: string | null,
    options: {
        sessionId: string;
        occurredAt: number;
        sessionTitle?: string | null;
        cwd?: string | null;
    }
): TranscriptCaptureData {
    const empty = {
        summary: null,
        cwd: options.cwd ?? null,
        sessionTitle: options.sessionTitle ?? null,
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
        let cwd: string | null = options.cwd ?? null;
        let sessionTitle: string | null = options.sessionTitle ?? null;
        const messages: TranscriptCaptureMessage[] = [];
        const usedIds = new Map<string, number>();
        let previousVisibleMessageId: string | null = null;

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
            if (lineType === 'session_meta') {
                const meta = isRecord(parsed.payload) ? parsed.payload : parsed;
                cwd = pickString(meta, ['cwd', 'workspace.cwd', 'project.path', 'projectPath']) ?? cwd;
                sessionTitle = pickString(meta, ['thread_name', 'threadName', 'title', 'session_title', 'sessionTitle']) ?? sessionTitle;
                continue;
            }

            let messageEnvelope: Record<string, unknown> | null = null;
            if (lineType === 'response_item' && isRecord(parsed.payload)) {
                messageEnvelope = parsed.payload;
            } else if (lineType === 'message' && isRecord(parsed.message)) {
                messageEnvelope = parsed.message;
            }
            if (!messageEnvelope) continue;

            const payloadType = typeof messageEnvelope.type === 'string' ? messageEnvelope.type : null;
            if (lineType === 'response_item' && payloadType !== 'message') {
                continue;
            }

            const rawRoleValue = messageEnvelope.role ?? parsed.role ?? getByPath(messageEnvelope, 'message.role');
            const rawRole = typeof rawRoleValue === 'string' ? rawRoleValue.trim().toLowerCase() : '';
            if (rawRole !== 'user' && rawRole !== 'assistant') {
                continue;
            }
            const role = normalizeCodexRole(rawRole);
            const visibleText = extractGenericTextParts(
                messageEnvelope.content ?? messageEnvelope.text ?? messageEnvelope.message
            ).join(' ').trim();
            if (!visibleText) continue;

            const baseMessageId = pickString(messageEnvelope, ['id'])
                ?? pickString(parsed, ['id'])
                ?? `${options.sessionId}:line-${index + 1}`;
            const seenCount = usedIds.get(baseMessageId) ?? 0;
            usedIds.set(baseMessageId, seenCount + 1);
            const messageId = seenCount === 0 ? baseMessageId : `${baseMessageId}-${seenCount + 1}`;
            const parentId = pickString(messageEnvelope, [
                'parent_id',
                'parentId',
                'previous_item_id',
                'previousItemId',
                'in_reply_to',
                'inReplyTo'
            ]) ?? previousVisibleMessageId;

            messages.push({
                messageId,
                role,
                text: visibleText,
                occurredAt: pickTimestamp(parsed, ['timestamp', 'payload.timestamp', 'payload.created_at', 'payload.createdAt'], options.occurredAt),
                parentId,
                lineNumber: index + 1,
                raw: parsed
            });
            previousVisibleMessageId = messageId;
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
