import http from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function listen(server: http.Server): Promise<number> {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                reject(new Error('No server address'));
                return;
            }
            resolve(address.port);
        });
    });
}

async function close(server: http.Server): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

describe('sync transport redirect handling', () => {
    let originalSyncEndpoint: string | undefined;
    let server: http.Server | null = null;
    let baseUrl = '';
    const hits: Array<{ method: string; url: string; auth: string | undefined }> = [];

    beforeEach(async () => {
        vi.resetModules();
        hits.length = 0;
        originalSyncEndpoint = process.env.CTX_SYNC_ENDPOINT;

        server = http.createServer((req, res) => {
            hits.push({
                method: req.method ?? 'GET',
                url: req.url ?? '/',
                auth: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined
            });

            if (req.url === '/api/v1/sync/push' && req.method === 'POST') {
                res.statusCode = 307;
                res.setHeader('Location', `${baseUrl}/redirect/push`);
                res.setHeader('Content-Type', 'text/plain');
                res.end('Redirecting...');
                return;
            }

            if (req.url === '/redirect/push' && req.method === 'POST') {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: true }));
                return;
            }

            if (req.url === '/api/v1/sync/pull?since=42' && req.method === 'GET') {
                res.statusCode = 307;
                res.setHeader('Location', `${baseUrl}/redirect/pull?since=42`);
                res.setHeader('Content-Type', 'text/plain');
                res.end('Redirecting...');
                return;
            }

            if (req.url === '/redirect/pull?since=42' && req.method === 'GET') {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                    envelopes: [
                        {
                            version: 1,
                            contextId: 'ctx-1',
                            tenantId: 'tenant-1',
                            userId: 'user@example.com',
                            timestamp: 42,
                            encrypted: false,
                            syncPolicy: 'metadata_only',
                            payload: { mode: 'metadata_only', graph: { nodeCount: 0, edgeCount: 0 } }
                        }
                    ]
                }));
                return;
            }

            res.statusCode = 404;
            res.end('not found');
        });

        const port = await listen(server);
        baseUrl = `http://127.0.0.1:${port}`;
        process.env.CTX_SYNC_ENDPOINT = `${baseUrl}/api/v1/sync`;
    });

    afterEach(async () => {
        vi.resetModules();
        if (server) {
            await close(server);
            server = null;
        }
        if (originalSyncEndpoint === undefined) delete process.env.CTX_SYNC_ENDPOINT;
        else process.env.CTX_SYNC_ENDPOINT = originalSyncEndpoint;
    });

    it('follows redirects for push and pull requests', async () => {
        const { pullEnvelopes, pushEnvelope } = await import('../src/sync-transport.ts');

        const pushed = await pushEnvelope('test-token', {
            version: 1,
            contextId: 'ctx-1',
            tenantId: 'tenant-1',
            userId: 'user@example.com',
            timestamp: 42,
            encrypted: false,
            syncPolicy: 'metadata_only',
            payload: { mode: 'metadata_only', graph: { nodeCount: 0, edgeCount: 0 } }
        });
        const pulled = await pullEnvelopes('test-token', 42);

        expect(pushed).toMatchObject({ ok: true, statusCode: 200 });
        expect(pulled.ok).toBe(true);
        expect(pulled.envelopes).toHaveLength(1);
        expect(hits).toEqual(expect.arrayContaining([
            { method: 'POST', url: '/api/v1/sync/push', auth: 'Bearer test-token' },
            { method: 'POST', url: '/redirect/push', auth: 'Bearer test-token' },
            { method: 'GET', url: '/api/v1/sync/pull?since=42', auth: 'Bearer test-token' },
            { method: 'GET', url: '/redirect/pull?since=42', auth: 'Bearer test-token' }
        ]));
    });
});
