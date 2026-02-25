import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import type { ConnectorEventPayload } from './cloud';

const QUEUE_FILE_VERSION = 1;
const DEFAULT_QUEUE_LIMIT = 20_000;
const DEFAULT_BATCH_LIMIT = 200;
const DEFAULT_QUEUE_MAX_AGE_HOURS = 24 * 7;

export interface QueuedConnectorEvent {
    queueId: string;
    eventId: string;
    subscriptionId: string;
    sequence: number;
    contextId: string | null;
    type: string;
    timestamp: number;
    source: string;
    payload: Record<string, unknown>;
    enqueuedAt: number;
    attempts: number;
    nextAttemptAt: number;
    lastError: string | null;
}

interface ConnectorQueueFile {
    version: number;
    updatedAt: number;
    items: QueuedConnectorEvent[];
}

export interface ConnectorQueueStats {
    pending: number;
    ready: number;
    backoff: number;
    maxAttempts: number;
    oldestEnqueuedAt: number | null;
}

export interface ConnectorQueuePurgeOptions {
    all?: boolean;
    olderThanHours?: number;
    minAttempts?: number;
}

export interface ConnectorQueuePurgeResult {
    removed: number;
    remaining: number;
}

function computeBackoffMs(attempts: number): number {
    // 2s, 4s, 8s ... capped to 5 min
    const value = 2_000 * (2 ** Math.max(0, attempts - 1));
    return Math.min(value, 5 * 60_000);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

function getQueueLimit(): number {
    return parsePositiveInt(process.env.CTX_CONNECTOR_QUEUE_MAX_ITEMS, DEFAULT_QUEUE_LIMIT);
}

function getQueueMaxAgeMs(): number {
    const hours = parsePositiveInt(process.env.CTX_CONNECTOR_QUEUE_MAX_AGE_HOURS, DEFAULT_QUEUE_MAX_AGE_HOURS);
    return hours * 60 * 60 * 1000;
}

export function getConnectorQueuePath(): string {
    return process.env.CTX_CONNECTOR_QUEUE_PATH || path.join(os.homedir(), '.0ctx', 'connector-event-queue.json');
}

function ensureDir(filePath: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readQueueFile(): ConnectorQueueFile {
    const filePath = getConnectorQueuePath();
    if (!fs.existsSync(filePath)) {
        return { version: QUEUE_FILE_VERSION, updatedAt: Date.now(), items: [] };
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<ConnectorQueueFile>;
        const items = Array.isArray(parsed.items)
            ? parsed.items.filter((item): item is QueuedConnectorEvent => {
                return Boolean(
                    item
                    && typeof item.queueId === 'string'
                    && typeof item.eventId === 'string'
                    && typeof item.subscriptionId === 'string'
                    && typeof item.sequence === 'number'
                );
            })
            : [];

        return {
            version: QUEUE_FILE_VERSION,
            updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
            items
        };
    } catch {
        return { version: QUEUE_FILE_VERSION, updatedAt: Date.now(), items: [] };
    }
}

function writeQueueFile(data: ConnectorQueueFile): void {
    const filePath = getConnectorQueuePath();
    ensureDir(filePath);
    fs.writeFileSync(
        filePath,
        JSON.stringify({
            version: QUEUE_FILE_VERSION,
            updatedAt: Date.now(),
            items: data.items
        }, null, 2),
        { encoding: 'utf8', mode: 0o600 }
    );
}

export function enqueueConnectorEvents(
    subscriptionId: string,
    events: ConnectorEventPayload[],
    now = Date.now(),
    maxItems = getQueueLimit()
): { enqueued: number; lastSequence: number | null } {
    if (!Array.isArray(events) || events.length === 0) {
        return { enqueued: 0, lastSequence: null };
    }

    const data = readQueueFile();
    const existingEventIds = new Set(data.items.map(item => item.eventId));
    let enqueued = 0;
    let lastSequence: number | null = null;

    for (const event of events) {
        if (!event?.eventId || typeof event.sequence !== 'number') continue;
        if (existingEventIds.has(event.eventId)) {
            lastSequence = lastSequence === null ? event.sequence : Math.max(lastSequence, event.sequence);
            continue;
        }

        data.items.push({
            queueId: randomUUID(),
            eventId: event.eventId,
            subscriptionId,
            sequence: event.sequence,
            contextId: event.contextId ?? null,
            type: event.type,
            timestamp: event.timestamp,
            source: event.source,
            payload: event.payload ?? {},
            enqueuedAt: now,
            attempts: 0,
            nextAttemptAt: now,
            lastError: null
        });
        existingEventIds.add(event.eventId);
        enqueued += 1;
        lastSequence = lastSequence === null ? event.sequence : Math.max(lastSequence, event.sequence);
    }

    const pruneResult = pruneConnectorQueue({
        now,
        maxItems,
        maxAgeMs: getQueueMaxAgeMs(),
        _data: data
    });

    if (enqueued > 0 || pruneResult.removed > 0) {
        writeQueueFile(data);
    }

    return { enqueued, lastSequence };
}

export function getReadyConnectorEvents(limit = DEFAULT_BATCH_LIMIT, now = Date.now()): QueuedConnectorEvent[] {
    const data = readQueueFile();
    const safeLimit = Math.max(1, Math.min(DEFAULT_BATCH_LIMIT, Math.floor(limit)));
    return data.items
        .filter(item => item.nextAttemptAt <= now)
        .sort((a, b) => a.sequence - b.sequence || a.enqueuedAt - b.enqueuedAt)
        .slice(0, safeLimit);
}

export function listQueuedConnectorEvents(): QueuedConnectorEvent[] {
    const data = readQueueFile();
    return [...data.items].sort((a, b) => a.sequence - b.sequence || a.enqueuedAt - b.enqueuedAt);
}

export function markConnectorEventsDelivered(queueIds: string[]): void {
    if (!Array.isArray(queueIds) || queueIds.length === 0) return;

    const idSet = new Set(queueIds);
    const data = readQueueFile();
    const before = data.items.length;
    data.items = data.items.filter(item => !idSet.has(item.queueId));
    if (data.items.length !== before) {
        writeQueueFile(data);
    }
}

export function markConnectorEventsFailed(queueIds: string[], error: string, now = Date.now()): void {
    if (!Array.isArray(queueIds) || queueIds.length === 0) return;

    const idSet = new Set(queueIds);
    const data = readQueueFile();
    let changed = false;

    for (const item of data.items) {
        if (!idSet.has(item.queueId)) continue;
        item.attempts += 1;
        item.lastError = error;
        item.nextAttemptAt = now + computeBackoffMs(item.attempts);
        changed = true;
    }

    if (changed) writeQueueFile(data);
}

export function getConnectorQueueStats(now = Date.now()): ConnectorQueueStats {
    const data = readQueueFile();
    const pending = data.items.length;
    let ready = 0;
    let maxAttempts = 0;
    let oldestEnqueuedAt: number | null = null;

    for (const item of data.items) {
        if (item.nextAttemptAt <= now) ready += 1;
        if (item.attempts > maxAttempts) maxAttempts = item.attempts;
        if (oldestEnqueuedAt === null || item.enqueuedAt < oldestEnqueuedAt) {
            oldestEnqueuedAt = item.enqueuedAt;
        }
    }

    return {
        pending,
        ready,
        backoff: Math.max(0, pending - ready),
        maxAttempts,
        oldestEnqueuedAt
    };
}

export function purgeConnectorQueue(options: ConnectorQueuePurgeOptions = {}): ConnectorQueuePurgeResult {
    const data = readQueueFile();
    const before = data.items.length;
    const now = Date.now();

    if (options.all) {
        data.items = [];
        writeQueueFile(data);
        return { removed: before, remaining: 0 };
    }

    const olderThanMs = typeof options.olderThanHours === 'number' && options.olderThanHours > 0
        ? options.olderThanHours * 60 * 60 * 1000
        : null;
    const minAttempts = typeof options.minAttempts === 'number' && options.minAttempts > 0
        ? Math.floor(options.minAttempts)
        : null;

    if (olderThanMs === null && minAttempts === null) {
        return { removed: 0, remaining: before };
    }

    data.items = data.items.filter(item => {
        const olderMatch = olderThanMs !== null ? (now - item.enqueuedAt) >= olderThanMs : false;
        const attemptsMatch = minAttempts !== null ? item.attempts >= minAttempts : false;
        return !(olderMatch || attemptsMatch);
    });

    if (data.items.length !== before) {
        writeQueueFile(data);
    }
    return { removed: before - data.items.length, remaining: data.items.length };
}

export function pruneConnectorQueue(input?: {
    now?: number;
    maxItems?: number;
    maxAgeMs?: number;
    _data?: ConnectorQueueFile;
}): ConnectorQueuePurgeResult {
    const now = input?.now ?? Date.now();
    const maxItems = input?.maxItems ?? getQueueLimit();
    const maxAgeMs = input?.maxAgeMs ?? getQueueMaxAgeMs();
    const data = input?._data ?? readQueueFile();
    const before = data.items.length;

    if (maxAgeMs > 0) {
        data.items = data.items.filter(item => (now - item.enqueuedAt) <= maxAgeMs);
    }

    if (data.items.length > maxItems) {
        data.items.sort((a, b) => a.sequence - b.sequence || a.enqueuedAt - b.enqueuedAt);
        data.items.splice(0, data.items.length - maxItems);
    }

    if (!input?._data && data.items.length !== before) {
        writeQueueFile(data);
    }

    return { removed: before - data.items.length, remaining: data.items.length };
}
