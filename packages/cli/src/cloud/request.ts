import http from 'http';
import https from 'https';
import { getConfigValue } from '@0ctx/core';

const DEFAULT_CONTROL_PLANE_BASE_URL = 'https://www.0ctx.com/api/v1';
const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface CloudRequestOptions {
    method: 'GET' | 'POST';
    path: string;
    token: string;
    body?: unknown;
    query?: Record<string, string | number | null | undefined>;
}

export interface CloudApiResult<T> {
    ok: boolean;
    statusCode: number;
    data?: T;
    error?: string;
}

function parseTimeoutMs(): number {
    const raw = process.env.CTX_API_TIMEOUT_MS ?? process.env.CTX_CONTROL_PLANE_TIMEOUT_MS;
    if (!raw) return DEFAULT_TIMEOUT_MS;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

export function getControlPlaneBaseUrl(): string {
    const explicit = (process.env.CTX_API_URL ?? process.env.CTX_CONTROL_PLANE_URL)?.trim();
    if (explicit) return explicit.replace(/\/$/, '');

    try {
        const syncEndpoint = getConfigValue('sync.endpoint');
        const parsed = new URL(syncEndpoint);
        const normalizedPath = parsed.pathname.replace(/\/+$/, '');
        parsed.pathname = normalizedPath.endsWith('/sync') ? normalizedPath.slice(0, -('/sync'.length)) || '/v1' : normalizedPath || '/v1';
        parsed.search = '';
        parsed.hash = '';
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/, '');
    } catch {
        return DEFAULT_CONTROL_PLANE_BASE_URL;
    }
}

function buildUrl(path: string, query?: Record<string, string | number | null | undefined>): URL {
    const url = new URL(path.replace(/^\/+/, ''), `${getControlPlaneBaseUrl().replace(/\/$/, '')}/`);
    if (query) {
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
        }
    }
    return url;
}

export async function requestJson<T>(options: CloudRequestOptions): Promise<CloudApiResult<T>> {
    const initialUrl = buildUrl(options.path, options.query);
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);

    function doRequest(targetUrl: URL, redirectsLeft: number): Promise<CloudApiResult<T>> {
        return new Promise(resolve => {
            const transport = targetUrl.protocol === 'https:' ? https : http;
            const request = transport.request(
                {
                    hostname: targetUrl.hostname,
                    port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
                    path: targetUrl.pathname + targetUrl.search,
                    method: options.method,
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${options.token}`,
                        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
                    },
                    timeout: parseTimeoutMs()
                },
                response => {
                    const statusCode = response.statusCode ?? 0;
                    if (statusCode >= 300 && statusCode < 400 && response.headers.location && redirectsLeft > 0) {
                        response.resume();
                        resolve(doRequest(new URL(response.headers.location, targetUrl), redirectsLeft - 1));
                        return;
                    }

                    const chunks: Buffer[] = [];
                    response.on('data', (chunk: Buffer) => chunks.push(chunk));
                    response.on('end', () => {
                        const text = Buffer.concat(chunks).toString('utf8');
                        if (statusCode >= 200 && statusCode < 300) {
                            if (!text.trim()) {
                                resolve({ ok: true, statusCode, data: {} as T });
                                return;
                            }
                            try {
                                resolve({ ok: true, statusCode, data: JSON.parse(text) as T });
                            } catch {
                                resolve({ ok: true, statusCode, data: {} as T });
                            }
                            return;
                        }

                        let error = `HTTP ${statusCode}`;
                        if (text.trim()) {
                            try {
                                const parsed = JSON.parse(text) as {
                                    error?: string | { code?: string; message?: string };
                                    message?: string;
                                };
                                if (typeof parsed.error === 'string') error = parsed.error;
                                else if (parsed.error && typeof parsed.error === 'object') error = parsed.error.message ?? parsed.error.code ?? error;
                                else if (typeof parsed.message === 'string') error = parsed.message;
                            } catch {
                                error = `${error}: ${text.slice(0, 200)}`;
                            }
                        }

                        resolve({ ok: false, statusCode, error });
                    });
                }
            );

            request.on('error', error => {
                resolve({
                    ok: false,
                    statusCode: 0,
                    error: error instanceof Error ? error.message : String(error)
                });
            });
            request.on('timeout', () => request.destroy(new Error('Request timed out')));
            if (payload) request.write(payload);
            request.end();
        });
    }

    return doRequest(initialUrl, MAX_REDIRECTS);
}

export async function requestWithFallback<T>(
    options: Omit<CloudRequestOptions, 'path'>,
    paths: string[]
): Promise<CloudApiResult<T>> {
    let last: CloudApiResult<T> | null = null;
    for (const path of paths) {
        const result = await requestJson<T>({ ...options, path });
        if (result.ok) return result;
        last = result;
        if (result.statusCode !== 404 && result.statusCode !== 405) break;
    }

    return last ?? { ok: false, statusCode: 0, error: 'Cloud request failed' };
}
