import net from 'net';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { openDb, Graph } from '@0ctx/core';
import { handleRequest } from './handlers';
import { SyncEngine } from './sync-engine';
import { clearConnectionContext } from './resolver';
import type { DaemonRequest, DaemonResponse } from './protocol';
import { RequestMetrics } from './metrics';
import { log } from './logger';
import { EventRuntime } from './events';

const IS_WIN = os.platform() === 'win32';
const DEFAULT_SOCKET_PATH = IS_WIN ? '\\\\.\\pipe\\0ctx.sock' : path.join(os.homedir(), '.0ctx', '0ctx.sock');
const DEFAULT_PROBE_TIMEOUT_MS = 750;

type StartupProbeResult = 'daemon' | 'stale_endpoint' | 'occupied';

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

function isNamedPipePath(socketPath: string): boolean {
    return socketPath.startsWith('\\\\.\\pipe\\');
}

function isAddressInUse(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
}

function isStaleEndpointError(error: unknown): boolean {
    if (!(typeof error === 'object' && error !== null && 'code' in error)) return false;
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ECONNREFUSED' || code === 'ENOTSOCK';
}

function listenOnSocket(server: net.Server, socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const onListening = () => {
            cleanup();
            resolve();
        };

        const onError = (error: Error) => {
            cleanup();
            reject(error);
        };

        const cleanup = () => {
            server.off('listening', onListening);
            server.off('error', onError);
        };

        server.once('listening', onListening);
        server.once('error', onError);

        try {
            server.listen(socketPath);
        } catch (error) {
            cleanup();
            reject(error);
        }
    });
}

function probeExistingEndpoint(socketPath: string, timeoutMs: number): Promise<StartupProbeResult> {
    return new Promise(resolve => {
        const socket = net.createConnection(socketPath);
        let settled = false;
        let buffer = '';

        const finish = (result: StartupProbeResult) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.removeAllListeners();
            socket.destroy();
            resolve(result);
        };

        const timer = setTimeout(() => {
            finish('occupied');
        }, timeoutMs);

        socket.once('connect', () => {
            const healthRequest: DaemonRequest = {
                method: 'health',
                params: {},
                requestId: randomUUID(),
                apiVersion: '2'
            };
            socket.write(JSON.stringify(healthRequest) + '\n');
        });

        socket.on('data', data => {
            buffer += data.toString();
            const newlineIndex = buffer.indexOf('\n');
            if (newlineIndex === -1) return;

            const message = buffer.slice(0, newlineIndex);
            try {
                const response = JSON.parse(message) as DaemonResponse;
                const result = response.result as { status?: string } | undefined;
                if (response.ok && result?.status === 'ok') {
                    finish('daemon');
                    return;
                }
            } catch {
                // Any invalid response means an endpoint is bound, but it is not a 0ctx daemon.
            }

            finish('occupied');
        });

        socket.once('error', error => {
            if (isStaleEndpointError(error)) {
                finish('stale_endpoint');
                return;
            }
            finish('occupied');
        });

        socket.once('end', () => {
            finish('occupied');
        });
    });
}

function createDaemonCloser(
    server: net.Server,
    db: ReturnType<typeof openDb>,
    socketPath: string,
    syncEngine?: SyncEngine
): () => Promise<void> {
    let closed = false;

    return async () => {
        if (closed) return;
        closed = true;

        // Stop sync engine before closing server
        syncEngine?.stop();

        await new Promise<void>(resolve => {
            if (!server.listening) {
                resolve();
                return;
            }

            server.close(closeError => {
                if (closeError) {
                    log('warn', 'daemon_close_error', {
                        socketPath,
                        error: closeError.message
                    });
                }
                resolve();
            });
        });

        try {
            db.close();
        } catch (closeError) {
            log('warn', 'daemon_db_close_error', {
                error: closeError instanceof Error ? closeError.message : String(closeError)
            });
        }
    };
}

function registerShutdownHandlers(closeDaemon: () => Promise<void>): void {
    const shutdown = (signal: 'SIGINT' | 'SIGTERM') => {
        log('info', 'daemon_shutdown', { signal });
        void closeDaemon().finally(() => {
            process.exit();
        });
    };

    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
}

async function bindDaemonServer(server: net.Server, socketPath: string, probeTimeoutMs: number): Promise<'started' | 'already_running'> {
    try {
        await listenOnSocket(server, socketPath);
        return 'started';
    } catch (error) {
        if (!isAddressInUse(error)) throw error;

        const probeResult = await probeExistingEndpoint(socketPath, probeTimeoutMs);

        if (probeResult === 'daemon') {
            return 'already_running';
        }

        if (!isNamedPipePath(socketPath) && probeResult === 'stale_endpoint') {
            try {
                fs.unlinkSync(socketPath);
            } catch (unlinkError) {
                if (!(typeof unlinkError === 'object' && unlinkError !== null && 'code' in unlinkError && (unlinkError as NodeJS.ErrnoException).code === 'ENOENT')) {
                    throw unlinkError;
                }
            }
            await listenOnSocket(server, socketPath);
            return 'started';
        }

        throw new Error(`Address ${socketPath} is already in use by a non-daemon process.`);
    }
}

export async function startDaemon(options: StartDaemonOptions = {}): Promise<StartDaemonResult> {
    const socketPath = options.socketPath ?? DEFAULT_SOCKET_PATH;
    const probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    const db = openDb(options.dbPath ? { dbPath: options.dbPath } : undefined);
    const graph = new Graph(db);
    const startedAt = Date.now();
    const metrics = new RequestMetrics();
    const syncEngine = new SyncEngine(graph, db);
    const eventRuntime = new EventRuntime();

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
                        eventRuntime
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
