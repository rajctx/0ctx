import net from 'net';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';

const IS_WIN = os.platform() === 'win32';
const SOCKET_PATH = IS_WIN ? '\\\\.\\pipe\\0ctx.sock' : path.join(os.homedir(), '.0ctx', '0ctx.sock');

export interface SendToDaemonOptions {
    requestId?: string;
    sessionToken?: string;
    apiVersion?: string;
}

export function sendToDaemon(method: string, params: Record<string, unknown> = {}, options: SendToDaemonOptions = {}): Promise<any> {
    return new Promise((resolve, reject) => {
        const requestId = options.requestId || randomUUID();

        const socket = net.createConnection(SOCKET_PATH);
        socket.write(JSON.stringify({
            method,
            params,
            requestId,
            sessionToken: options.sessionToken,
            apiVersion: options.apiVersion ?? '2'
        }) + '\n');

        let responseData = '';
        socket.on('data', data => {
            responseData += data.toString();
            let newlineIndex;
            while ((newlineIndex = responseData.indexOf('\n')) !== -1) {
                const message = responseData.slice(0, newlineIndex);
                responseData = responseData.slice(newlineIndex + 1);
                try {
                    const res = JSON.parse(message);
                    socket.destroy();
                    if (res.ok) resolve(res.result);
                    else reject(new Error(res.error));
                } catch (e) {
                    socket.destroy();
                    reject(new Error("Failed to parse response: " + e));
                }
            }
        });

        socket.on('error', reject);
    });
}
