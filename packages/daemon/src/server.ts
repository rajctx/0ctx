import net from 'net';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { openDb, Graph } from '@0ctx/core';
import { handleRequest } from './handlers';
import { SyncEngine } from './sync-engine';
import { clearConnectionContext } from './resolver';
import type { DaemonRequest, DaemonResponse } from './protocol';
import { RequestMetrics } from './metrics';
import { log } from './logger';
import { EventRuntime } from './events';
import { bindDaemonServer } from './server/endpoint';
import { createDaemonCloser, registerShutdownHandlers } from './server/lifecycle';

const IS_WIN = os.platform() === 'win32';
const DEFAULT_SOCKET_PATH = process.env.CTX_SOCKET_PATH
    || (IS_WIN ? '\\\\.\\pipe\\0ctx.sock' : path.join(os.homedir(), '.0ctx', '0ctx.sock'));
const DEFAULT_PROBE_TIMEOUT_MS = 750;

export interface StartDaemonOptions {
    socketPath?: string;
    dbPath?: string;
    probeTimeoutMs?: number;
    registerSignalHandlers?: boolean;
}

export type StartDaemonResult =
    | {
        status: 'started';
        socketPath: string;
        close: () => Promise<void>;
    }
    | {
        status: 'already_running';
        socketPath: string;
    };

export async function startDaemon(options: StartDaemonOptions = {}): Promise<StartDaemonResult> {
    const socketPath = options.socketPath ?? DEFAULT_SOCKET_PATH;
    const probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    const db = openDb(options.dbPath ? { dbPath: options.dbPath } : undefined);
    const graph = new Graph(db);
    const startedAt = Date.now();
    const metrics = new RequestMetrics();
    const syncEngine = new SyncEngine(graph, db);
    const eventRuntime = new EventRuntime();
    let closeDaemonRef: (() => Promise<void>) | null = null;

    const requestShutdown = () => {
        if (!closeDaemonRef) return;
        setTimeout(() => {
            void closeDaemonRef?.().catch(error => {
                log('error', 'daemon_shutdown_error', {
                    socketPath,
                    error: error instanceof Error ? error.message : String(error)
                });
            });
        }, 0);
    };

    const server = net.createServer(socket => {
        // Unique ID for this client connection to track active context
        const connectionId = randomUUID();

        let buffer = '';
        socket.on('data', data => {
            buffer += data.toString();
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const message = buffer.slice(0, newlineIndex);
                buffer = buffer.slice(newlineIndex + 1);
                if (!message.trim()) continue;

                try {
                    const req = JSON.parse(message) as DaemonRequest;
                    if (!req || typeof req.method !== 'string') {
                        throw new Error('Invalid request payload. Missing method.');
                    }

                    const requestStart = Date.now();
                    const result = handleRequest(graph, connectionId, req, {
                        startedAt,
                        getMetricsSnapshot: () => metrics.snapshot(),
                        syncEngine,
                        eventRuntime,
                        requestShutdown
                    });
                    const durationMs = Date.now() - requestStart;
                    metrics.record(req.method, true, durationMs);
                    log('info', 'request_success', {
                        requestId: req.requestId ?? null,
                        sessionToken: req.sessionToken ?? null,
                        method: req.method,
                        connectionId,
                        durationMs
                    });

                    const response: DaemonResponse = { ok: true, result, requestId: req.requestId };
                    socket.write(JSON.stringify(response) + '\n');
                } catch (err: any) {
                    const request = (() => {
                        try {
                            return JSON.parse(message) as Partial<DaemonRequest>;
                        } catch {
                            return null;
                        }
                    })();

                    if (request?.method && typeof request.method === 'string') {
                        metrics.record(request.method, false, 0);
                    }

                    log('error', 'request_failed', {
                        requestId: request?.requestId ?? null,
                        sessionToken: request?.sessionToken ?? null,
                        method: request?.method ?? null,
                        connectionId,
                        error: err.message
                    });

                    const response: DaemonResponse = { ok: false, error: err.message };
                    socket.write(JSON.stringify(response) + '\n');
                }
            }
        });

        socket.on('close', () => {
            clearConnectionContext(connectionId);
            log('debug', 'connection_closed', { connectionId });
        });
    });

    const closeDaemon = createDaemonCloser(server, db, socketPath, syncEngine);
    closeDaemonRef = closeDaemon;

    try {
        const status = await bindDaemonServer(server, socketPath, probeTimeoutMs);
        if (status === 'already_running') {
            await closeDaemon();
            log('info', 'daemon_already_running', { socketPath });
            return { status: 'already_running', socketPath };
        }

        log('info', 'daemon_started', { socketPath });

        // Start sync engine after successful bind
        syncEngine.start();

        server.on('error', error => {
            log('error', 'daemon_server_error', {
                socketPath,
                error: error.message
            });
        });

        if (options.registerSignalHandlers !== false) {
            registerShutdownHandlers(closeDaemon);
        }

        return {
            status: 'started',
            socketPath,
            close: closeDaemon
        };
    } catch (error) {
        await closeDaemon();
        throw error;
    }
}
