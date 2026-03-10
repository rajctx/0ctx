import fs from 'fs';
import net from 'net';
import { randomUUID } from 'crypto';
import type { DaemonRequest, DaemonResponse } from '../protocol';

type StartupProbeResult = 'daemon' | 'stale_endpoint' | 'occupied';

export async function bindDaemonServer(
    server: net.Server,
    socketPath: string,
    probeTimeoutMs: number
): Promise<'started' | 'already_running'> {
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
            unlinkStaleSocket(socketPath);
            await listenOnSocket(server, socketPath);
            return 'started';
        }

        throw new Error(`Address ${socketPath} is already in use by a non-daemon process.`);
    }
}

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
    return new Promise((resolve) => {
        const socket = net.createConnection(socketPath);
        let settled = false;
        let buffer = '';
        const timer = setTimeout(() => finish('occupied'), timeoutMs);

        const finish = (result: StartupProbeResult) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.removeAllListeners();
            socket.destroy();
            resolve(result);
        };

        socket.once('connect', () => {
            const healthRequest: DaemonRequest = {
                method: 'health',
                params: {},
                requestId: randomUUID(),
                apiVersion: '2'
            };
            socket.write(JSON.stringify(healthRequest) + '\n');
        });

        socket.on('data', (data) => {
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
                // Invalid JSON means something else is bound here.
            }

            finish('occupied');
        });

        socket.once('error', (error) => {
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

function unlinkStaleSocket(socketPath: string): void {
    try {
        fs.unlinkSync(socketPath);
    } catch (error) {
        if (!(typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
            throw error;
        }
    }
}
