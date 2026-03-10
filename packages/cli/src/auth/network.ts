import http from 'http';
import https from 'https';
import os from 'os';
import { execSync } from 'child_process';
import {
    bffErrorCode,
    bffErrorMessage,
    DEFAULT_SCOPE,
    getAuthServer,
    type BffDeviceCodeResponse,
    type BffTokenResponse,
    type DeviceCodeResponse,
    type TokenResponse,
    type TokenStore
} from './shared.js';
import { writeTokenFile } from './store.js';

const MAX_REDIRECTS = 5;

export function openBrowser(url: string): void {
    try {
        const platform = os.platform();
        if (platform === 'win32') execSync(`start "" "${url}"`, { stdio: 'ignore' });
        else if (platform === 'darwin') execSync(`open "${url}"`, { stdio: 'ignore' });
        else execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
    } catch {
        // The URL is still printed to the terminal.
    }
}

function httpPost(
    url: string,
    body: string,
    contentType: string,
    timeoutMs = 10_000,
    redirectsRemaining = MAX_REDIRECTS
): Promise<string> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const transport = parsed.protocol === 'https:' ? https : http;
        const request = transport.request(
            {
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: parsed.pathname + parsed.search,
                method: 'POST',
                headers: {
                    'Content-Type': contentType,
                    'Content-Length': Buffer.byteLength(body),
                    'User-Agent': '0ctx-cli/1.0'
                },
                timeout: timeoutMs
            },
            response => {
                let data = '';
                response.on('data', chunk => {
                    data += chunk;
                });
                response.on('end', () => {
                    const status = response.statusCode ?? 0;
                    const location = response.headers.location;
                    if (location && [301, 302, 303, 307, 308].includes(status)) {
                        if (redirectsRemaining <= 0) {
                            reject(new Error(`Too many redirects while requesting ${url}`));
                            return;
                        }
                        const nextUrl = new URL(location, url).toString();
                        resolve(httpPost(nextUrl, body, contentType, timeoutMs, redirectsRemaining - 1));
                        return;
                    }
                    resolve(data);
                });
            }
        );
        request.on('error', reject);
        request.on('timeout', () => {
            request.destroy();
            reject(new Error('Request timed out'));
        });
        request.write(body);
        request.end();
    });
}

function httpJsonPost(url: string, body: Record<string, unknown>, timeoutMs = 10_000): Promise<string> {
    return httpPost(url, JSON.stringify(body), 'application/json', timeoutMs);
}

export function parseJsonResponse<T>(raw: string, operation: string): T {
    try {
        return JSON.parse(raw) as T;
    } catch {
        const preview = raw.replace(/\s+/g, ' ').trim().slice(0, 160) || '(empty response)';
        throw new Error(`${operation} returned a non-JSON response. This usually means the auth server redirected or served HTML/text instead of JSON. Response preview: ${preview}`);
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function requestDeviceCode(authServer: string): Promise<DeviceCodeResponse> {
    let raw: string;
    try {
        raw = await httpJsonPost(`${authServer}/api/v1/auth/device`, { scope: DEFAULT_SCOPE });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Cannot connect to auth server (${authServer}): ${message}`);
    }

    const parsed = parseJsonResponse<BffDeviceCodeResponse>(raw, 'Device code request');
    if (parsed.error || !parsed.deviceCode || !parsed.userCode) {
        throw new Error(`Device code error: ${bffErrorMessage(parsed.error)} — ${raw}`);
    }

    return {
        device_code: parsed.deviceCode,
        user_code: parsed.userCode,
        verification_uri: parsed.verificationUri,
        verification_uri_complete: parsed.verificationUriComplete,
        expires_in: parsed.expiresIn,
        interval: parsed.interval
    };
}

export async function pollForToken(
    authServer: string,
    deviceCode: string,
    intervalSec: number,
    expiresSec: number
): Promise<TokenResponse> {
    const deadline = Date.now() + expiresSec * 1000;
    const intervalMs = Math.max(intervalSec, 5) * 1000;

    while (Date.now() < deadline) {
        await sleep(intervalMs);
        let raw: string;
        try {
            raw = await httpJsonPost(`${authServer}/api/v1/auth/device/token`, { deviceCode });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Token poll failed: ${message}`);
        }

        const parsed = parseJsonResponse<BffTokenResponse>(raw, 'Token poll');
        if (parsed.accessToken) {
            const tokenType = parsed.tokenType ?? 'Bearer';
            if (tokenType.toLowerCase() !== 'bearer') {
                throw new Error(`Unexpected token_type: ${tokenType}`);
            }
            return {
                access_token: parsed.accessToken,
                refresh_token: parsed.refreshToken ?? '',
                expires_in: parsed.expiresIn ?? 3600,
                token_type: tokenType,
                email: parsed.email ?? undefined,
                tenant_id: parsed.tenantId ?? undefined
            };
        }

        const errorCode = bffErrorCode(parsed.error);
        if (errorCode === 'authorization_pending') continue;
        if (errorCode === 'slow_down') {
            await sleep(5_000);
            continue;
        }
        if (errorCode === 'expired_token') throw new Error('Device code expired. Run `0ctx auth login` again.');
        if (errorCode === 'access_denied') throw new Error('Authorization denied by user.');
        throw new Error(`Token error: ${bffErrorMessage(parsed.error)} — ${parsed.errorDescription ?? ''}`);
    }

    throw new Error('Device code expired (timed out). Run `0ctx auth login` again.');
}

export async function refreshAccessToken(store: TokenStore): Promise<TokenStore> {
    const authServer = getAuthServer();
    let raw: string;
    try {
        raw = await httpJsonPost(`${authServer}/api/v1/auth/device/refresh`, {
            refreshToken: store.refreshToken
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Token refresh failed: ${message}`);
    }

    const parsed = parseJsonResponse<BffTokenResponse>(raw, 'Token refresh');
    if (!parsed.accessToken) {
        throw new Error(`Refresh error: ${bffErrorMessage(parsed.error)} — ${parsed.errorDescription ?? ''}`);
    }

    const tokenType = parsed.tokenType ?? 'Bearer';
    if (tokenType.toLowerCase() !== 'bearer') {
        throw new Error(`Unexpected token_type from refresh: ${tokenType}`);
    }
    if (!parsed.refreshToken) {
        console.warn('Warning: auth server did not rotate refresh token (RFC 9700 §4.14 recommends rotation)');
    }

    const updated: TokenStore = {
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken || store.refreshToken,
        expiresAt: Date.now() + (parsed.expiresIn ?? 3600) * 1000,
        email: parsed.email ?? store.email,
        tenantId: parsed.tenantId ?? store.tenantId
    };
    writeTokenFile(updated);
    return updated;
}

export async function revokeRefreshToken(authServer: string, token: string): Promise<void> {
    await httpJsonPost(
        `${authServer}/api/v1/auth/device/revoke`,
        { token, tokenTypeHint: 'refresh_token' },
        5_000
    );
}
