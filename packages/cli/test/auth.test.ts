import http from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/keyring.js', () => ({
    storeToKeyring: vi.fn(async () => false),
    readFromKeyring: vi.fn(async () => null),
    deleteFromKeyring: vi.fn(async () => undefined)
}));

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

describe('auth device-code redirect handling', () => {
    let originalAuthServer: string | undefined;
    let server: http.Server | null = null;
    let baseUrl = '';
    const requests: Array<{ method: string; url: string }> = [];

    beforeEach(async () => {
        vi.resetModules();
        requests.length = 0;
        originalAuthServer = process.env.CTX_AUTH_SERVER;

        server = http.createServer((req, res) => {
            requests.push({ method: req.method ?? 'GET', url: req.url ?? '/' });

            if (req.url === '/api/v1/auth/device' && req.method === 'POST') {
                res.statusCode = 307;
                res.setHeader('Location', `${baseUrl}/redirect/device`);
                res.setHeader('Content-Type', 'text/plain');
                res.end('Redirecting...');
                return;
            }

            if (req.url === '/redirect/device' && req.method === 'POST') {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                    deviceCode: 'device-code',
                    userCode: 'ABCD-EFGH',
                    verificationUri: `${baseUrl}/auth/device`,
                    verificationUriComplete: `${baseUrl}/auth/device?user_code=ABCD-EFGH`,
                    expiresIn: 900,
                    interval: 5
                }));
                return;
            }

            res.statusCode = 404;
            res.end('not found');
        });

        const port = await listen(server);
        baseUrl = `http://127.0.0.1:${port}`;
        process.env.CTX_AUTH_SERVER = baseUrl;
    });

    afterEach(async () => {
        vi.resetModules();
        if (server) {
            await close(server);
            server = null;
        }
        if (originalAuthServer === undefined) delete process.env.CTX_AUTH_SERVER;
        else process.env.CTX_AUTH_SERVER = originalAuthServer;
    });

    it('follows redirects and parses the redirected device-code response', async () => {
        const { __test } = await import('../src/auth.ts');
        const response = await __test.requestDeviceCode(process.env.CTX_AUTH_SERVER!);

        expect(response).toMatchObject({
            device_code: 'device-code',
            user_code: 'ABCD-EFGH',
            verification_uri: `${baseUrl}/auth/device`,
            verification_uri_complete: `${baseUrl}/auth/device?user_code=ABCD-EFGH`,
            expires_in: 900,
            interval: 5
        });
        expect(requests).toEqual([
            { method: 'POST', url: '/api/v1/auth/device' },
            { method: 'POST', url: '/redirect/device' }
        ]);
    });
});
