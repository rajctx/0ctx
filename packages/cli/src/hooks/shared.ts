import fs from 'fs';
import path from 'path';
import {
    type HookAgent,
    type HookAgentState,
    PREVIEW_HOOK_AGENTS,
    SUPPORTED_HOOK_AGENTS
} from './types';

export function normalizeClient(client: string): HookAgent | null {
    const value = client.trim().toLowerCase();
    if (value === 'claude' || value === 'windsurf' || value === 'codex' || value === 'cursor' || value === 'factory' || value === 'antigravity') {
        return value;
    }
    return null;
}

export function toStableJson(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`;
}

export function writeIfChanged(filePath: string, content: string): boolean {
    const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
    if (current === content) return false;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
}

export function defaultHookAgents(now: number): HookAgentState[] {
    return SUPPORTED_HOOK_AGENTS.map((agent): HookAgentState => ({
        agent,
        status: 'Skipped',
        installed: false,
        command: null,
        updatedAt: now,
        notes: agent === 'codex'
            ? 'preview-notify-archive'
            : PREVIEW_HOOK_AGENTS.has(agent)
                ? 'preview-hook'
                : 'supported'
    }));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function getByPath(record: Record<string, unknown>, dottedPath: string): unknown {
    const parts = dottedPath.split('.');
    let current: unknown = record;
    for (const part of parts) {
        if (Array.isArray(current)) {
            const index = Number(part);
            if (!Number.isInteger(index) || index < 0 || index >= current.length) {
                return undefined;
            }
            current = current[index];
            continue;
        }
        if (!current || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

export function pickString(record: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
        const value = getByPath(record, key);
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }
    return null;
}

export function compactTranscriptText(value: string): string | null {
    const withoutReminders = value
        .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return withoutReminders.length > 0 ? withoutReminders : null;
}

export function extractTranscriptTextParts(value: unknown): string[] {
    if (typeof value === 'string') {
        const compact = compactTranscriptText(value);
        return compact ? [compact] : [];
    }
    if (!Array.isArray(value)) return [];

    const parts: string[] = [];
    for (const item of value) {
        if (!isRecord(item) || item.type !== 'text') continue;
        const compact = typeof item.text === 'string' ? compactTranscriptText(item.text) : null;
        if (compact) {
            parts.push(compact);
        }
    }
    return parts;
}

export function extractGenericTextParts(value: unknown): string[] {
    if (typeof value === 'string') {
        const compact = compactTranscriptText(value);
        return compact ? [compact] : [];
    }
    if (Array.isArray(value)) {
        return value.flatMap((item) => extractGenericTextParts(item));
    }
    if (!isRecord(value)) return [];

    if (typeof value.type === 'string' && value.type !== 'text' && value.type !== 'message' && value.type !== 'input') {
        if (value.type === 'thinking' || value.type === 'tool_result') {
            return [];
        }
    }

    const parts: string[] = [];
    if (typeof value.text === 'string') {
        const compact = compactTranscriptText(value.text);
        if (compact) parts.push(compact);
    }
    if ('content' in value) {
        parts.push(...extractGenericTextParts(value.content));
    }
    if ('message' in value) {
        parts.push(...extractGenericTextParts(value.message));
    }
    return parts;
}

export function pickVisibleText(record: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
        const value = getByPath(record, key);
        const text = extractGenericTextParts(value).join(' ').trim();
        if (text.length > 0) {
            return text;
        }
    }
    return null;
}

export function pickTimestamp(record: Record<string, unknown>, keys: string[], fallback: number): number {
    for (const key of keys) {
        const value = getByPath(record, key);
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value > 10_000_000_000 ? value : value * 1000;
        }
        if (typeof value === 'string' && value.trim().length > 0) {
            const parsed = Date.parse(value.trim());
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
    }
    return fallback;
}

export function normalizeCodexRole(value: unknown): string {
    if (typeof value !== 'string') return 'user';
    const role = value.trim().toLowerCase();
    if (role === 'assistant' || role === 'user' || role === 'system' || role === 'tool') {
        return role;
    }
    return 'user';
}
