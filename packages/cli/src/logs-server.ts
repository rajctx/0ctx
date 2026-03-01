import http from 'node:http';
import { readConnectorState } from './connector.js';
import { listQueuedConnectorEvents, getConnectorQueueStats } from './connector-queue.js';
import { readCliOpsLog } from './ops-log.js';
import { sendToDaemon } from '@0ctx/mcp/dist/client';
import { getLogsHtml } from './logs-ui.js';

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

async function findAvailablePort(preferred = 3210): Promise<number> {
    return new Promise((resolve) => {
        const tryPort = (p: number) => {
            const probe = http.createServer();
            probe.listen(p, '127.0.0.1', () => {
                const addr = probe.address() as { port: number };
                probe.close(() => resolve(addr.port));
            });
            probe.on('error', () => {
                // Preferred port in use — fall back to OS-assigned
                const fallback = http.createServer();
                fallback.listen(0, '127.0.0.1', () => {
                    const addr = fallback.address() as { port: number };
                    fallback.close(() => resolve(addr.port));
                });
                fallback.on('error', () => resolve(3211));
            });
        };
        tryPort(preferred);
    });
}

function jsonOk(res: http.ServerResponse, data: unknown): void {
    const body = JSON.stringify(data);
    res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'http://127.0.0.1',
        'Cache-Control': 'no-cache'
    });
    res.end(body);
}

async function getDaemonData(): Promise<Record<string, unknown>> {
    try {
        const [health, sync, caps] = await Promise.allSettled([
            sendToDaemon('health', {}),
            sendToDaemon('syncStatus', {}),
            sendToDaemon('getCapabilities', {}),
        ]);

        const val = <T>(r: PromiseSettledResult<T>): T | null =>
            r.status === 'fulfilled' ? r.value : null;

        const healthVal = val(health) as Record<string, unknown> | null;
        if (!healthVal) return { reachable: false };

        return {
            reachable: true,
            health: healthVal,
            sync: val(sync),
            capabilities: val(caps),
        };
    } catch {
        return { reachable: false };
    }
}

export interface LogsServerHandle {
    port: number;
    close(): Promise<void>;
}

export async function startLogsServer(): Promise<LogsServerHandle> {
    const port = await findAvailablePort(3210);
    let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
    let srv: http.Server;

    function resetTimer(): void {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => srv.close(), INACTIVITY_TIMEOUT_MS);
    }

    srv = http.createServer(async (req, res) => {
        resetTimer();

        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
        const p = url.pathname;

        if (req.method === 'OPTIONS') {
            res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' });
            res.end();
            return;
        }

        // HTML shell
        if (p === '/' || p === '') {
            const html = getLogsHtml(port);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end(html);
            return;
        }

        // Connector identity
        if (p === '/api/identity') {
            const state = readConnectorState();
            jsonOk(res, state ?? { _missing: true });
            return;
        }

        // Event queue
        if (p === '/api/queue') {
            const stats = getConnectorQueueStats();
            const items = listQueuedConnectorEvents();
            jsonOk(res, { stats, items });
            return;
        }

        // Ops log
        if (p === '/api/ops') {
            const entries = readCliOpsLog(200).reverse(); // newest first
            jsonOk(res, { entries });
            return;
        }

        // Daemon data
        if (p === '/api/daemon') {
            const data = await getDaemonData();
            jsonOk(res, data);
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
    });

    await new Promise<void>((resolve, reject) => {
        srv.listen(port, '127.0.0.1', resolve);
        srv.on('error', reject);
    });

    resetTimer();

    return {
        port,
        close(): Promise<void> {
            if (inactivityTimer) clearTimeout(inactivityTimer);
            return new Promise(resolve => srv.close(() => resolve()));
        }
    };
}
