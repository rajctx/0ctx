/**
 * SYNC-01: HTTPS transport layer for sync push/pull.
 *
 * Uses Node built-in https/http (same pattern as auth.ts — zero deps).
 * Endpoint configurable via config or CTX_SYNC_ENDPOINT env var.
 */

import https from 'https';
import http from 'http';
import type { SyncEnvelope } from '@0ctx/core';
import { getConfigValue } from '@0ctx/core';

const TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

function getSyncEndpoint(): string {
    return normalize0ctxHostedUrl(getConfigValue('sync.endpoint')).replace(/\/$/, '');
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

function request(
    method: 'POST' | 'GET',
    url: string,
    token: string,
    body?: string,
    redirectsRemaining = MAX_REDIRECTS
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const transport = parsed.protocol === 'https:' ? https : http;

        const req = transport.request(
            {
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: parsed.pathname + parsed.search,
                method,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {})
                },
                timeout: TIMEOUT_MS
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    const status = res.statusCode ?? 0;
                    const responseBody = Buffer.concat(chunks).toString('utf8');
                    const location = res.headers.location;
                    if (location && [301, 302, 303, 307, 308].includes(status)) {
                        if (redirectsRemaining <= 0) {
                            reject(new Error(`Too many redirects while requesting ${url}`));
                            return;
                        }
                        const nextUrl = new URL(location, url).toString();
                        const nextMethod = status === 303 ? 'GET' : method;
                        const nextBody = nextMethod === 'GET' ? undefined : body;
                        resolve(request(nextMethod, nextUrl, token, nextBody, redirectsRemaining - 1));
                        return;
                    }
                    resolve({
                        status,
                        body: responseBody
                    });
                });
            }
        );

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy(new Error('Request timed out'));
        });

        if (body) req.write(body);
        req.end();
    });
}

function normalize0ctxHostedUrl(value: string): string {
    try {
        const parsed = new URL(value);
        if (parsed.hostname === '0ctx.com') {
            parsed.hostname = 'www.0ctx.com';
        }
        return parsed.toString();
    } catch {
        return value.replace(/^https:\/\/0ctx\.com(?=\/|$)/, 'https://www.0ctx.com');
    }
}

// ─── Push ────────────────────────────────────────────────────────────────────

export interface PushResult {
    ok: boolean;
    error?: string;
    statusCode?: number;
}

export async function pushEnvelope(token: string, envelope: SyncEnvelope): Promise<PushResult> {
    const endpoint = `${getSyncEndpoint()}/push`;

    try {
        const body = JSON.stringify(envelope);
        const res = await request('POST', endpoint, token, body);

        if (res.status >= 200 && res.status < 300) {
            return { ok: true, statusCode: res.status };
        }

        let error: string;
        try {
            // BFF returns { "error": { "code": "...", "message": "..." } } — handle
            // both flat string and nested object envelopes, same as cloud.ts.
            const parsed = JSON.parse(res.body) as {
                error?: string | { code?: string; message?: string };
                message?: string;
            };
            if (typeof parsed.error === 'string') {
                error = parsed.error;
            } else if (parsed.error && typeof parsed.error === 'object') {
                error = parsed.error.message ?? parsed.error.code ?? `HTTP ${res.status}`;
            } else if (typeof parsed.message === 'string') {
                error = parsed.message;
            } else {
                error = `HTTP ${res.status}`;
            }
        } catch {
            error = `HTTP ${res.status}: ${res.body.slice(0, 200)}`;
        }

        return { ok: false, error, statusCode: res.status };
    } catch (e: unknown) {
        return {
            ok: false,
            error: e instanceof Error ? e.message : String(e)
        };
    }
}

// ─── Pull ────────────────────────────────────────────────────────────────────

export interface PullResult {
    ok: boolean;
    envelopes: SyncEnvelope[];
    error?: string;
}

export async function pullEnvelopes(token: string, since: number): Promise<PullResult> {
    const endpoint = `${getSyncEndpoint()}/pull?since=${since}`;

    try {
        const res = await request('GET', endpoint, token, undefined);

        if (res.status >= 200 && res.status < 300) {
            const data = JSON.parse(res.body) as { envelopes?: SyncEnvelope[] };
            return { ok: true, envelopes: data.envelopes ?? [] };
        }

        return {
            ok: false,
            envelopes: [],
            error: `HTTP ${res.status}`
        };
    } catch (e: unknown) {
        return {
            ok: false,
            envelopes: [],
            error: e instanceof Error ? e.message : String(e)
        };
    }
}
