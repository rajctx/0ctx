import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { sendToDaemon } from '@0ctx/mcp/dist/client';
import { getConfigValue } from '@0ctx/core';
import type { ConnectorEventPayload } from '../cloud.js';
import type { ConnectorRuntimeSyncStatus } from './types.js';
import { sleep } from './helpers.js';

function resolveDaemonEntrypoint(): string {
    const candidates = [
        path.resolve(__dirname, 'daemon.js'),
        path.resolve(process.cwd(), 'packages', 'daemon', 'dist', 'index.js'),
        path.resolve(__dirname, '..', '..', 'daemon', 'dist', 'index.js'),
        (() => {
            try {
                return require.resolve('@0ctx/daemon/dist/index.js');
            } catch {
                return '';
            }
        })()
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }

    throw new Error('Could not resolve daemon entrypoint. Run `npm run build` (repo) or reinstall/repair the CLI package.');
}

export function getHostedDashboardUrl(): string {
    const configured = getConfigValue('ui.url');
    if (typeof configured === 'string' && configured.trim().length > 0) {
        return configured.trim();
    }
    return 'https://app.0ctx.com';
}

export function startDaemonDetached(): void {
    const entry = resolveDaemonEntrypoint();
    const child = spawn(process.execPath, [entry], {
        detached: true,
        stdio: 'ignore'
    });
    child.unref();
}

export async function isDaemonReachable(): Promise<{ ok: boolean; error?: string }> {
    try {
        await sendToDaemon('health', {});
        return { ok: true };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

export async function waitForDaemon(timeoutMs = 10_000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const status = await isDaemonReachable();
        if (status.ok) return true;
        await sleep(300);
    }
    return false;
}

export async function getSyncStatus(): Promise<ConnectorRuntimeSyncStatus | null> {
    try {
        return (await sendToDaemon('syncStatus', {})) as ConnectorRuntimeSyncStatus;
    } catch {
        return null;
    }
}

export async function createDaemonSession(): Promise<{ sessionToken: string }> {
    const session = (await sendToDaemon('createSession', {})) as { sessionToken?: string };
    if (!session?.sessionToken) {
        throw new Error('createSession returned no sessionToken');
    }
    return { sessionToken: session.sessionToken };
}

export async function subscribeEvents(
    sessionToken: string,
    afterSequence = 0
): Promise<{ subscriptionId: string; lastAckedSequence?: number }> {
    const subscription = (await sendToDaemon('subscribeEvents', { afterSequence }, { sessionToken })) as {
        subscriptionId?: string;
        lastAckedSequence?: number;
    };
    if (!subscription?.subscriptionId) {
        throw new Error('subscribeEvents returned no subscriptionId');
    }
    return {
        subscriptionId: subscription.subscriptionId,
        lastAckedSequence: subscription.lastAckedSequence
    };
}

export async function pollEvents(
    sessionToken: string,
    subscriptionId: string,
    afterSequence: number,
    limit = 200
): Promise<{ cursor: number; events: ConnectorEventPayload[]; hasMore?: boolean }> {
    const result = (await sendToDaemon('pollEvents', { subscriptionId, afterSequence, limit }, { sessionToken })) as {
        cursor?: number;
        events?: ConnectorEventPayload[];
        hasMore?: boolean;
    };
    return {
        cursor: typeof result?.cursor === 'number' ? result.cursor : afterSequence,
        events: Array.isArray(result?.events) ? result.events : [],
        hasMore: result?.hasMore
    };
}

export async function ackEvents(
    sessionToken: string,
    subscriptionId: string,
    sequence: number
): Promise<{ lastAckedSequence?: number }> {
    return ((await sendToDaemon('ackEvent', { subscriptionId, sequence }, { sessionToken })) as {
        lastAckedSequence?: number;
    }) ?? {};
}

export async function applyDaemonCommand(
    sessionToken: string,
    method: string,
    params: Record<string, unknown>
): Promise<unknown> {
    return sendToDaemon(method, params, { sessionToken });
}

export async function getContextSyncPolicy(
    sessionToken: string,
    contextId: string
): Promise<'local_only' | 'metadata_only' | 'full_sync' | null> {
    try {
        const result = (await sendToDaemon('getSyncPolicy', { contextId }, { sessionToken })) as { syncPolicy?: string };
        if (result.syncPolicy === 'local_only' || result.syncPolicy === 'metadata_only' || result.syncPolicy === 'full_sync') {
            return result.syncPolicy;
        }
        return null;
    } catch {
        return null;
    }
}
