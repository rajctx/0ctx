import { encryptJson } from '@0ctx/core';
import type { ContextDump, SyncEnvelope, SyncQueueEntry } from '@0ctx/core';
import { getAccessToken, getDeviceId, getTenantUrl, getUserId, getTenantId } from './auth';
import { log } from './logger';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface CloudPushResult {
    ok: boolean;
    syncedIds: string[];
    error?: string;
}

export interface CloudPullResult {
    ok: boolean;
    items: Array<{
        entityType: string;
        entityId: string;
        action: string;
        payload: Record<string, unknown>;
        syncedAt: number;
    }>;
    cursor: string | null;
    error?: string;
}

function resolveCloudUrl(): string {
    const tenantUrl = getTenantUrl();
    const envUrl = process.env.CTX_CLOUD_URL;
    const baseUrl = envUrl || tenantUrl;
    if (!baseUrl) throw new Error('No cloud URL configured. Set CTX_CLOUD_URL or authenticate with a tenant.');
    return baseUrl.replace(/\/+$/, '');
}

function buildHeaders(): Record<string, string> {
    const token = getAccessToken();
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-0ctx-Device-Id': getDeviceId(),
        'X-0ctx-Api-Version': '1'
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

async function cloudFetch(path: string, body: unknown): Promise<Response> {
    const baseUrl = resolveCloudUrl();
    const url = `${baseUrl}${path}`;
    const headers = buildHeaders();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: controller.signal
        });
        return response;
    } finally {
        clearTimeout(timeout);
    }
}

function buildSyncEnvelope(payload: unknown, encrypted: boolean): SyncEnvelope {
    const userId = getUserId();
    const tenantId = getTenantId();
    if (!userId || !tenantId) {
        throw new Error('Cannot build sync envelope: not authenticated.');
    }

    return {
        version: 1,
        userId,
        tenantId,
        deviceId: getDeviceId(),
        syncedAt: Date.now(),
        encrypted,
        payload: encrypted ? encryptJson(payload) : payload
    };
}

/**
 * Push a batch of sync queue entries to the cloud.
 */
export async function pushSyncBatch(items: SyncQueueEntry[]): Promise<CloudPushResult> {
    if (items.length === 0) return { ok: true, syncedIds: [] };

    try {
        const envelopes = items.map(item => ({
            id: item.id,
            entityType: item.entityType,
            entityId: item.entityId,
            action: item.action,
            envelope: buildSyncEnvelope(item.payload, true)
        }));

        const response = await cloudFetch('/api/v1/sync/push', { items: envelopes });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            log('warn', 'cloud_push_failed', { status: response.status, error: errorText });
            return { ok: false, syncedIds: [], error: `HTTP ${response.status}: ${errorText}` };
        }

        const result = await response.json() as { syncedIds?: string[] };
        return { ok: true, syncedIds: result.syncedIds ?? items.map(i => i.id) };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log('warn', 'cloud_push_error', { error: message });
        return { ok: false, syncedIds: [], error: message };
    }
}

/**
 * Pull remote changes since the given cursor.
 */
export async function pullSyncState(cursor: string | null): Promise<CloudPullResult> {
    try {
        const response = await cloudFetch('/api/v1/sync/pull', { cursor });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            log('warn', 'cloud_pull_failed', { status: response.status, error: errorText });
            return { ok: false, items: [], cursor: null, error: `HTTP ${response.status}: ${errorText}` };
        }

        const result = await response.json() as CloudPullResult;
        return { ok: true, items: result.items ?? [], cursor: result.cursor ?? null };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log('warn', 'cloud_pull_error', { error: message });
        return { ok: false, items: [], cursor: null, error: message };
    }
}

/**
 * Push a full context dump to the cloud for initial or recovery sync.
 */
export async function pushFullContextSync(dump: ContextDump): Promise<{ ok: boolean; error?: string }> {
    try {
        const envelope = buildSyncEnvelope(dump, true);

        const response = await cloudFetch('/api/v1/sync/full', {
            contextId: dump.context.id,
            contextName: dump.context.name,
            envelope
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            log('warn', 'cloud_full_sync_failed', { status: response.status, error: errorText });
            return { ok: false, error: `HTTP ${response.status}: ${errorText}` };
        }

        return { ok: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log('warn', 'cloud_full_sync_error', { error: message });
        return { ok: false, error: message };
    }
}
