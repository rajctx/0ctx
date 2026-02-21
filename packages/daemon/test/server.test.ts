import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DaemonRequest, DaemonResponse } from '../src/protocol';
import { startDaemon, type StartDaemonResult } from '../src/server';

const tempDirs: string[] = [];
const runningDaemons: Array<Extract<StartDaemonResult, { status: 'started' }>> = [];
const blockingServers: Array<{ server: net.Server; sockets: Set<net.Socket> }> = [];

function createTempDir(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), '0ctx-daemon-server-test-'));
    tempDirs.push(dir);
    return dir;
}

function createSocketPath(tempDir: string): string {
    if (process.platform === 'win32') {
        return `\\\\.\\pipe\\0ctx-daemon-test-${randomUUID()}`;
    }
    return path.join(tempDir, '0ctx.sock');
}

function closeServer(server: net.Server): Promise<void> {
    return new Promise(resolve => {
        if (!server.listening) {
            resolve();
            return;
        }

        server.close(() => {
            resolve();
        });
    });
}

function closeBlockingServer(blocker: { server: net.Server; sockets: Set<net.Socket> }): Promise<void> {
    for (const socket of blocker.sockets) {
        socket.destroy();
    }
    blocker.sockets.clear();
    return closeServer(blocker.server);
}

function listenServer(server: net.Server, socketPath: string): Promise<void> {
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
        server.listen(socketPath);
    });
}

function sendDaemonRequest(socketPath: string, request: DaemonRequest): Promise<DaemonResponse> {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(socketPath);
        let buffer = '';
        let settled = false;

        const finish = (error: Error | null, response?: DaemonResponse) => {
            if (settled) return;
            settled = true;
            socket.removeAllListeners();
            socket.destroy();
            if (error) {
                reject(error);
                return;
            }
            resolve(response!);
        };

        socket.once('connect', () => {
            socket.write(JSON.stringify(request) + '\n');
        });

        socket.on('data', chunk => {
            buffer += chunk.toString();
            const newlineIndex = buffer.indexOf('\n');
            if (newlineIndex === -1) return;

            const message = buffer.slice(0, newlineIndex);
            try {
                finish(null, JSON.parse(message) as DaemonResponse);
            } catch (error) {
                finish(error as Error);
            }
        });

        socket.once('error', error => {
            finish(error);
        });
    });
}

afterEach(async () => {
    while (runningDaemons.length > 0) {
        const daemon = runningDaemons.pop();
        if (daemon) {
            await daemon.close();
        }
    }

    while (blockingServers.length > 0) {
        const blocker = blockingServers.pop();
        if (blocker) {
            await closeBlockingServer(blocker);
        }
    }

    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('daemon startup', () => {
    it('starts and serves health requests', async () => {
        const tempDir = createTempDir();
        const socketPath = createSocketPath(tempDir);
        const dbPath = path.join(tempDir, '0ctx.db');

        const daemon = await startDaemon({
            socketPath,
            dbPath,
            registerSignalHandlers: false,
            probeTimeoutMs: 300
        });

        expect(daemon.status).toBe('started');
        if (daemon.status !== 'started') return;
        runningDaemons.push(daemon);

        const response = await sendDaemonRequest(socketPath, {
            method: 'health',
            requestId: randomUUID(),
            apiVersion: '2'
        });

        expect(response.ok).toBe(true);
        const result = response.result as { status?: string };
        expect(result.status).toBe('ok');
    });

    it('returns already_running when daemon is already bound to endpoint', async () => {
        const tempDir = createTempDir();
        const socketPath = createSocketPath(tempDir);
        const firstDbPath = path.join(tempDir, 'first.db');
        const secondDbPath = path.join(tempDir, 'second.db');

        const first = await startDaemon({
            socketPath,
            dbPath: firstDbPath,
            registerSignalHandlers: false,
            probeTimeoutMs: 300
        });

        expect(first.status).toBe('started');
        if (first.status !== 'started') return;
        runningDaemons.push(first);

        const second = await startDaemon({
            socketPath,
            dbPath: secondDbPath,
            registerSignalHandlers: false,
            probeTimeoutMs: 300
        });

        expect(second.status).toBe('already_running');
    });

    const unixOnlyIt = process.platform === 'win32' ? it.skip : it;

    unixOnlyIt('recovers from stale unix socket path', async () => {
        const tempDir = createTempDir();
        const socketPath = createSocketPath(tempDir);
        const dbPath = path.join(tempDir, 'stale.db');

        writeFileSync(socketPath, 'stale');

        const daemon = await startDaemon({
            socketPath,
            dbPath,
            registerSignalHandlers: false,
            probeTimeoutMs: 300
        });

        expect(daemon.status).toBe('started');
        if (daemon.status !== 'started') return;
        runningDaemons.push(daemon);

        const response = await sendDaemonRequest(socketPath, {
            method: 'health',
            requestId: randomUUID(),
            apiVersion: '2'
        });

        expect(response.ok).toBe(true);
    });

    it('throws when endpoint is occupied by a non-daemon process', async () => {
        const tempDir = createTempDir();
        const socketPath = createSocketPath(tempDir);
        const dbPath = path.join(tempDir, 'collision.db');

        const sockets = new Set<net.Socket>();
        const blocker = net.createServer(socket => {
            sockets.add(socket);
            socket.once('close', () => {
                sockets.delete(socket);
            });
            socket.write('not-daemon\n');
            socket.end();
        });
        await listenServer(blocker, socketPath);
        blockingServers.push({ server: blocker, sockets });

        await expect(startDaemon({
            socketPath,
            dbPath,
            registerSignalHandlers: false,
            probeTimeoutMs: 300
        })).rejects.toThrow(/already in use by a non-daemon process/i);
    });
});
