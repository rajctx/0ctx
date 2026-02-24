import http from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import {
    fetchConnectorCapabilities,
    getControlPlaneBaseUrl,
    registerConnectorInCloud,
    sendConnectorEvents,
    sendConnectorHeartbeat
} from '../src/cloud';

function startServer(
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ server: http.Server; baseUrl: string }> {
    return new Promise((resolve) => {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            const port = typeof addr === 'object' && addr ? addr.port : 0;
            resolve({
                server,
                baseUrl: `http://127.0.0.1:${port}/v1`
            });
        });
    });
}

async function closeServer(server: http.Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.close((err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

afterEach(() => {
    delete process.env.CTX_CONTROL_PLANE_URL;
    delete process.env.CTX_SYNC_ENDPOINT;
    delete process.env.CTX_CONTROL_PLANE_TIMEOUT_MS;
});

describe('cloud connector client', () => {
    it('derives control plane url from sync endpoint', () => {
        process.env.CTX_SYNC_ENDPOINT = 'https://api.example.com/v2/sync';
        expect(getControlPlaneBaseUrl()).toBe('https://api.example.com/v2');
    });

    it('uses explicit control plane override when provided', () => {
        process.env.CTX_CONTROL_PLANE_URL = 'https://cp.example.com/v9/';
        expect(getControlPlaneBaseUrl()).toBe('https://cp.example.com/v9');
    });

    it('registers, heartbeats, and fetches capabilities', async () => {
        const { server, baseUrl } = await startServer((req, res) => {
            if (req.url === '/v1/connectors/register' && req.method === 'POST') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ registrationId: 'reg-1', streamUrl: 'wss://stream', capabilities: ['sync'] }));
                return;
            }
            if (req.url === '/v1/connectors/heartbeat' && req.method === 'POST') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ accepted: true }));
                return;
            }
            if (req.url?.startsWith('/v1/connectors/capabilities') && req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ capabilities: ['sync', 'blackboard'] }));
                return;
            }
            if (req.url === '/v1/connectors/events' && req.method === 'POST') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ accepted: true, processed: 1 }));
                return;
            }

            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'not_found' }));
        });

        process.env.CTX_CONTROL_PLANE_URL = baseUrl;
        const token = 'token-1';

        const register = await registerConnectorInCloud(token, {
            machineId: 'm-1',
            tenantId: 't-1',
            uiUrl: 'https://app.0ctx.com',
            platform: 'win32'
        });
        expect(register.ok).toBe(true);
        expect(register.data?.registrationId).toBe('reg-1');

        const heartbeat = await sendConnectorHeartbeat(token, {
            machineId: 'm-1',
            tenantId: 't-1',
            posture: 'connected',
            daemonRunning: true,
            syncEnabled: true,
            syncRunning: true,
            queue: { pending: 0, inFlight: 0, failed: 0, done: 5 }
        });
        expect(heartbeat.ok).toBe(true);
        expect(heartbeat.data?.accepted).toBe(true);

        const capabilities = await fetchConnectorCapabilities(token, 'm-1');
        expect(capabilities.ok).toBe(true);
        expect(capabilities.data?.capabilities).toEqual(['sync', 'blackboard']);

        const events = await sendConnectorEvents(token, {
            machineId: 'm-1',
            tenantId: 't-1',
            subscriptionId: 'sub-1',
            cursor: 7,
            events: [
                {
                    eventId: 'evt-1',
                    sequence: 7,
                    contextId: 'ctx-1',
                    type: 'NodeAdded',
                    timestamp: Date.now(),
                    source: 'session:s-1',
                    payload: { method: 'addNode' }
                }
            ]
        });
        expect(events.ok).toBe(true);
        expect(events.data?.accepted).toBe(true);

        await closeServer(server);
    });

    it('falls back to alternate endpoint paths on 404', async () => {
        const { server, baseUrl } = await startServer((req, res) => {
            if (req.url === '/v1/connector/register' && req.method === 'POST') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ registrationId: 'reg-legacy' }));
                return;
            }
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'not_found' }));
        });

        process.env.CTX_CONTROL_PLANE_URL = baseUrl;
        const result = await registerConnectorInCloud('token', {
            machineId: 'm-2',
            tenantId: null,
            uiUrl: 'https://app.0ctx.com',
            platform: 'linux'
        });

        expect(result.ok).toBe(true);
        expect(result.data?.registrationId).toBe('reg-legacy');

        await closeServer(server);
    });
});
