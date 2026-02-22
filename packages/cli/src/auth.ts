/**
 * AUTH-01: CLI-side device code auth (RFC 8628)
 *
 * Token store: ~/.0ctx/auth.json (owner-read-only, 0o600)
 * Auth server: CTX_AUTH_SERVER env var (default: https://auth.0ctx.com)
 *
 * This module is intentionally backend-agnostic. The actual auth server
 * will be wired in SYNC-01; until then, `auth login` fails gracefully
 * with a connection error when no server is reachable.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import http from 'http';
import { execSync } from 'child_process';

// ─── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_AUTH_SERVER = 'https://auth.0ctx.com';
const CLIENT_ID = '0ctx-cli';
const DEFAULT_SCOPE = 'profile sync';
const TOKEN_FILE = path.join(os.homedir(), '.0ctx', 'auth.json');

function getAuthServer(): string {
    return (process.env.CTX_AUTH_SERVER ?? DEFAULT_AUTH_SERVER).replace(/\/$/, '');
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TokenStore {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;     // Unix ms
    email: string;
    tenantId: string;
}

interface DeviceCodeResponse {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;    // seconds
    interval: number;      // seconds
}

interface TokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;    // seconds
    token_type: string;
    email?: string;
    tenant_id?: string;
}

interface TokenErrorResponse {
    error: string;
    error_description?: string;
}

// ─── Token store I/O ─────────────────────────────────────────────────────────

export function readTokenStore(): TokenStore | null {
    try {
        if (!fs.existsSync(TOKEN_FILE)) return null;
        const raw = fs.readFileSync(TOKEN_FILE, 'utf8');
        return JSON.parse(raw) as TokenStore;
    } catch {
        return null;
    }
}

export function writeTokenStore(store: TokenStore): void {
    const dir = path.dirname(TOKEN_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
}

export function clearTokenStore(): void {
    try { fs.unlinkSync(TOKEN_FILE); } catch { /* already gone */ }
}

export function isTokenExpired(store: TokenStore): boolean {
    return Date.now() >= store.expiresAt;
}

// ─── Env var token bypass (SEC-01) ────────────────────────────────────────────

/**
 * Check CTX_AUTH_TOKEN or CTX_AUTH_TOKEN_FILE env vars for CI/CD headless use.
 * Returns a synthetic TokenStore if found, null otherwise.
 */
export function getEnvToken(): TokenStore | null {
    const direct = process.env.CTX_AUTH_TOKEN;
    if (direct) {
        return {
            accessToken: direct,
            refreshToken: '',
            expiresAt: Number.MAX_SAFE_INTEGER,
            email: 'env:CTX_AUTH_TOKEN',
            tenantId: process.env.CTX_TENANT_ID ?? ''
        };
    }

    const filePath = process.env.CTX_AUTH_TOKEN_FILE;
    if (filePath) {
        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            const parsed = JSON.parse(raw) as TokenStore;
            if (parsed.accessToken) return parsed;
        } catch {
            // fall through
        }
    }

    return null;
}

/**
 * Resolve the effective token: env var > disk token store.
 */
export function resolveToken(): TokenStore | null {
    return getEnvToken() ?? readTokenStore();
}

// ─── Browser opener (SEC-03) ──────────────────────────────────────────────────

function openBrowser(url: string): void {
    try {
        const platform = os.platform();
        if (platform === 'win32') {
            execSync(`start "" "${url}"`, { stdio: 'ignore' });
        } else if (platform === 'darwin') {
            execSync(`open "${url}"`, { stdio: 'ignore' });
        } else {
            execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
        }
    } catch {
        // Silently fail — user still has the URL printed to console
    }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function httpPost(url: string, body: string, timeoutMs = 10_000): Promise<string> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const lib = parsed.protocol === 'https:' ? https : http;
        const req = lib.request(
            {
                hostname: parsed.hostname,
                port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
                path: parsed.pathname + parsed.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(body),
                    'User-Agent': '0ctx-cli/1.0'
                },
                timeout: timeoutMs
            },
            res => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => resolve(data));
            }
        );
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timed out'));
        });
        req.write(body);
        req.end();
    });
}

function urlEncode(params: Record<string, string>): string {
    return Object.entries(params)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Device code flow (RFC 8628) ─────────────────────────────────────────────

async function requestDeviceCode(authServer: string): Promise<DeviceCodeResponse> {
    const body = urlEncode({ client_id: CLIENT_ID, scope: DEFAULT_SCOPE });
    let raw: string;
    try {
        raw = await httpPost(`${authServer}/device/code`, body);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Cannot connect to auth server (${authServer}): ${msg}`);
    }

    const parsed = JSON.parse(raw) as DeviceCodeResponse;
    if (!parsed.device_code || !parsed.user_code) {
        throw new Error(`Unexpected device code response: ${raw}`);
    }
    return parsed;
}

async function pollForToken(
    authServer: string,
    deviceCode: string,
    intervalSec: number,
    expiresSec: number
): Promise<TokenResponse> {
    const deadline = Date.now() + expiresSec * 1000;
    const intervalMs = Math.max(intervalSec, 5) * 1000;

    while (Date.now() < deadline) {
        await sleep(intervalMs);

        const body = urlEncode({
            client_id: CLIENT_ID,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            device_code: deviceCode
        });

        let raw: string;
        try {
            raw = await httpPost(`${authServer}/token`, body);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`Token poll failed: ${msg}`);
        }

        const parsed = JSON.parse(raw) as TokenResponse | TokenErrorResponse;
        if ('access_token' in parsed) {
            const tokenResp = parsed as TokenResponse;
            // SEC-04: Validate token_type per RFC 6749 §5.1
            if (tokenResp.token_type && tokenResp.token_type.toLowerCase() !== 'bearer') {
                throw new Error(`Unexpected token_type: ${tokenResp.token_type}`);
            }
            return tokenResp;
        }

        const errParsed = parsed as TokenErrorResponse;
        if (errParsed.error === 'authorization_pending') continue;
        if (errParsed.error === 'slow_down') {
            await sleep(5_000); // extra delay when server requests it
            continue;
        }
        if (errParsed.error === 'expired_token') {
            throw new Error('Device code expired. Run `0ctx auth login` again.');
        }
        if (errParsed.error === 'access_denied') {
            throw new Error('Authorization denied by user.');
        }
        throw new Error(`Token error: ${errParsed.error} — ${errParsed.error_description ?? ''}`);
    }

    throw new Error('Device code expired (timed out). Run `0ctx auth login` again.');
}

// ─── Token refresh ────────────────────────────────────────────────────────────

export async function refreshAccessToken(store: TokenStore): Promise<TokenStore> {
    const authServer = getAuthServer();
    const body = urlEncode({
        client_id: CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: store.refreshToken
    });

    let raw: string;
    try {
        raw = await httpPost(`${authServer}/token`, body);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Token refresh failed: ${msg}`);
    }

    const parsed = JSON.parse(raw) as TokenResponse | TokenErrorResponse;
    if (!('access_token' in parsed)) {
        const err = parsed as TokenErrorResponse;
        throw new Error(`Refresh error: ${err.error} — ${err.error_description ?? ''}`);
    }

    const resp = parsed as TokenResponse;
    // SEC-04: Validate token_type
    if (resp.token_type && resp.token_type.toLowerCase() !== 'bearer') {
        throw new Error(`Unexpected token_type from refresh: ${resp.token_type}`);
    }
    // SEC-04: Warn when server does not rotate refresh token
    if (!resp.refresh_token) {
        console.warn('Warning: auth server did not rotate refresh token (RFC 9700 §4.14 recommends rotation)');
    }
    const updated: TokenStore = {
        accessToken: resp.access_token,
        refreshToken: resp.refresh_token || store.refreshToken,
        expiresAt: Date.now() + resp.expires_in * 1000,
        email: resp.email ?? store.email,
        tenantId: resp.tenant_id ?? store.tenantId
    };
    writeTokenStore(updated);
    return updated;
}

// ─── CLI commands ─────────────────────────────────────────────────────────────

export async function commandAuthLogin(flags: Record<string, string | boolean>): Promise<number> {
    // SEC-01: Check for env var token first
    const envToken = getEnvToken();
    if (envToken) {
        console.log('Already authenticated via CTX_AUTH_TOKEN environment variable.');
        console.log(`Email: ${envToken.email}`);
        return 0;
    }

    const authServer = getAuthServer();
    const noBrowser = Boolean(flags['no-browser']);
    console.log(`Connecting to auth server: ${authServer}`);

    let deviceCodeResp: DeviceCodeResponse;
    try {
        deviceCodeResp = await requestDeviceCode(authServer);
    } catch (e: unknown) {
        console.error(e instanceof Error ? e.message : String(e));
        return 1;
    }

    console.log('');
    console.log('Open this URL in your browser to authenticate:');
    console.log('');
    console.log(`  ${deviceCodeResp.verification_uri_complete ?? deviceCodeResp.verification_uri}`);
    console.log('');
    if (!deviceCodeResp.verification_uri_complete) {
        console.log(`Enter this code when prompted:  ${deviceCodeResp.user_code}`);
        console.log('');
    }

    // SEC-03: Auto-open browser unless --no-browser
    if (!noBrowser) {
        const uri = deviceCodeResp.verification_uri_complete ?? deviceCodeResp.verification_uri;
        openBrowser(uri);
    }

    console.log(`Waiting for authorization... (expires in ${deviceCodeResp.expires_in}s)`);

    let tokenResp: TokenResponse;
    try {
        tokenResp = await pollForToken(
            authServer,
            deviceCodeResp.device_code,
            deviceCodeResp.interval,
            deviceCodeResp.expires_in
        );
    } catch (e: unknown) {
        console.error(e instanceof Error ? e.message : String(e));
        return 1;
    }

    const store: TokenStore = {
        accessToken: tokenResp.access_token,
        refreshToken: tokenResp.refresh_token,
        expiresAt: Date.now() + tokenResp.expires_in * 1000,
        email: tokenResp.email ?? '',
        tenantId: tokenResp.tenant_id ?? ''
    };
    writeTokenStore(store);

    console.log('');
    console.log(`Logged in as: ${store.email}`);
    if (store.tenantId) console.log(`Tenant:       ${store.tenantId}`);
    console.log(`Token file:   ${TOKEN_FILE}`);
    return 0;
}

export function commandAuthLogout(): number {
    const existing = readTokenStore();
    clearTokenStore();
    if (existing) {
        console.log(`Logged out (was: ${existing.email})`);
    } else {
        console.log('Not logged in — nothing to clear.');
    }
    return 0;
}

export function commandAuthStatus(flags: Record<string, string | boolean>): number {
    const asJson = Boolean(flags.json);
    // SEC-01: Check env token first, then disk
    const store = resolveToken();
    const isEnv = Boolean(getEnvToken());

    if (!store) {
        if (asJson) {
            console.log(JSON.stringify({ status: 'logged_out', email: null, tenantId: null, expiresAt: null }));
        } else {
            console.log('Status:  logged out');
            console.log('Run:     0ctx auth login');
        }
        return 0;
    }

    const expired = isTokenExpired(store);
    const neverExpires = store.expiresAt >= Number.MAX_SAFE_INTEGER;
    const expiresDate = neverExpires ? 'never' : new Date(store.expiresAt).toISOString();

    if (asJson) {
        console.log(JSON.stringify({
            status: expired ? 'expired' : 'logged_in',
            source: isEnv ? 'environment' : 'token_file',
            email: store.email,
            tenantId: store.tenantId,
            expiresAt: expiresDate
        }));
    } else {
        console.log(`Status:    ${expired ? 'token expired' : 'logged in'}`);
        if (isEnv) console.log('Source:    CTX_AUTH_TOKEN environment variable');
        console.log(`Email:     ${store.email}`);
        if (store.tenantId) console.log(`Tenant:    ${store.tenantId}`);
        console.log(`Expires:   ${expiresDate}`);
        if (!isEnv) console.log(`File:      ${TOKEN_FILE}`);
        if (expired && !isEnv) {
            console.log('');
            console.log('Token expired. Run: 0ctx auth login');
        }
    }

    return 0;
}
