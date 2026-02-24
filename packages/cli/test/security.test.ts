import http from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyConnectorTrust } from '../src/cloud';
import { checkTokenExpiryWarning } from '../src/auth';

function startServer(
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ server: http.Server; baseUrl: string }> {
    return new Promise((resolve) => {
        const server = http.createServer(handler);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            const port = typeof addr === 'object' && addr ? addr.port : 0;
            resolve({ server, baseUrl: `http://127.0.0.1:${port}/v1` });
        });
    });
}

async function closeServer(server: http.Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
    });
}

afterEach(() => {
    delete process.env.CTX_CONTROL_PLANE_URL;
    delete process.env.CTX_AUTH_TOKEN;
    delete process.env.CTX_AUTH_TOKEN_ROTATION_WARN_DAYS;
});

describe('Connector trust verification (SEC-001)', () => {
    it('sends trust challenge and gets accepted', async () => {
        const { server, baseUrl } = await startServer((req, res) => {
            if (req.url?.includes('/trust/verify') && req.method === 'POST') {
                let body = '';
                req.on('data', (chunk) => (body += chunk));
                req.on('end', () => {
                    const parsed = JSON.parse(body);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        accepted: true,
                        trustLevel: parsed.challengeResponse ? 'verified' : 'unverified'
                    }));
                });
                return;
            }
            res.writeHead(404);
            res.end('{}');
        });

        process.env.CTX_CONTROL_PLANE_URL = baseUrl;
        const result = await verifyConnectorTrust('token-1', {
            machineId: 'm-1',
            challengeResponse: 'signed-nonce-abc'
        });

        expect(result.ok).toBe(true);
        expect(result.data?.accepted).toBe(true);
        expect(result.data?.trustLevel).toBe('verified');

        await closeServer(server);
    });

    it('handles trust rejection', async () => {
        const { server, baseUrl } = await startServer((req, res) => {
            if (req.url?.includes('/trust/verify') && req.method === 'POST') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ accepted: false, trustLevel: 'rejected' }));
                return;
            }
            res.writeHead(404);
            res.end('{}');
        });

        process.env.CTX_CONTROL_PLANE_URL = baseUrl;
        const result = await verifyConnectorTrust('token-1', {
            machineId: 'm-1',
            challengeResponse: 'bad-response'
        });

        expect(result.ok).toBe(true);
        expect(result.data?.accepted).toBe(false);
        await closeServer(server);
    });
});

describe('Token expiry awareness (SEC-001)', () => {
    it('returns no warning for env-based token', () => {
        process.env.CTX_AUTH_TOKEN = 'env-token-value';
        const result = checkTokenExpiryWarning();
        expect(result.expiresInMs).toBeNull();
        expect(result.shouldWarn).toBe(false);
    });

    it('returns no warning when not logged in', () => {
        // No CTX_AUTH_TOKEN and no token file → null
        const result = checkTokenExpiryWarning();
        expect(result.expiresInMs).toBeNull();
        expect(result.shouldWarn).toBe(false);
    });
});
