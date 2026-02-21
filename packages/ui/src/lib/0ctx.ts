import net from 'net';
import path from 'path';
import os from 'os';

const IS_WIN = os.platform() === 'win32';
const SOCKET_PATH = IS_WIN ? '\\\\.\\pipe\\0ctx.sock' : path.join(os.homedir(), '.0ctx', '0ctx.sock');
const REQUEST_TIMEOUT_MS = 9000;

export function sendToDaemon<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(SOCKET_PATH);
        const timeout = setTimeout(() => {
            socket.destroy();
            reject(new Error(`0ctx daemon request timed out after ${REQUEST_TIMEOUT_MS}ms`));
        }, REQUEST_TIMEOUT_MS);

        const cleanup = () => clearTimeout(timeout);

        socket.on('connect', () => {
            socket.write(JSON.stringify({ method, params }) + '\n');
        });

        let responseData = '';
        socket.on('data', data => {
            responseData += data.toString();
            let newlineIndex;
            while ((newlineIndex = responseData.indexOf('\n')) !== -1) {
                const message = responseData.slice(0, newlineIndex);
                responseData = responseData.slice(newlineIndex + 1);
                try {
                    const res = JSON.parse(message);
                    cleanup();
                    socket.destroy();
                    if (res.ok) resolve(res.result as T);
                    else reject(new Error(res.error));
                } catch (e) {
                    cleanup();
                    socket.destroy();
                    reject(new Error("Failed to parse ui daemon response: " + e));
                }
            }
        });

        socket.on('error', error => {
            cleanup();
            reject(error);
        });
    });
}
