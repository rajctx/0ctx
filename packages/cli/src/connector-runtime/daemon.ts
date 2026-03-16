import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { sendToDaemon } from '@0ctx/mcp/dist/client';
import { getConfigValue } from '@0ctx/core';
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

export function getHostedUiUrl(): string {
    const configured = getConfigValue('ui.url');
    if (typeof configured === 'string' && configured.trim().length > 0) {
        return configured.trim();
    }
    return 'https://www.0ctx.com/install';
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
