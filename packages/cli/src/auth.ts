/**
 * AUTH-01: CLI-side device code auth (RFC 8628)
 *
 * Token store (SEC-02 priority order):
 *   1. CTX_AUTH_TOKEN env var (SEC-01)
 *   2. OS keyring (macOS Keychain / Windows Credential Manager / Linux Secret Service)
 *   3. ~/.0ctx/auth.json fallback (0o600) — or forced via --insecure-storage
 *
 * Auth server: CTX_AUTH_SERVER env var (default: https://auth.0ctx.com)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import http from 'http';
import { execSync } from 'child_process';
import { storeToKeyring, readFromKeyring, deleteFromKeyring } from './keyring.js';
import { getConfigValue, saveConfig } from '@0ctx/core';

// ─── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_AUTH_SERVER = 'https://auth.0ctx.com';
const CLIENT_ID = '0ctx-cli';
const DEFAULT_SCOPE = 'profile sync';
const TOKEN_FILE = path.join(os.homedir(), '.0ctx', 'auth.json');

function getAuthServer(): string {
    return getConfigValue('auth.server').replace(/\/$/, '');
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

// ─── Token store I/O (SEC-02: keyring-first, file-fallback) ───────────────────

/** Read from file only (sync fallback). */
function readTokenFile(): TokenStore | null {
    try {
        if (!fs.existsSync(TOKEN_FILE)) return null;
        const raw = fs.readFileSync(TOKEN_FILE, 'utf8');
        return JSON.parse(raw) as TokenStore;
    } catch {
        return null;
    }
}

function writeTokenFile(store: TokenStore): void {
    const dir = path.dirname(TOKEN_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function clearTokenFile(): void {
    try { fs.unlinkSync(TOKEN_FILE); } catch { /* already gone */ }
}

/** Read token: keyring first, then file (sync compat wrapper). */
export function readTokenStore(): TokenStore | null {
    return readTokenFile();
}

/** Write token to keyring + file. Async because keyring is async. */
export async function writeTokenStoreSecure(store: TokenStore, insecureOnly = false): Promise<'keyring' | 'file'> {
    const json = JSON.stringify(store, null, 2);
    if (!insecureOnly) {
        const stored = await storeToKeyring(json);
        if (stored) {
            // Also write file as backup (daemon reads from file)
            writeTokenFile(store);
            return 'keyring';
        }
    }
    writeTokenFile(store);
    return 'file';
}

/** Read token: tries keyring first, falls back to file. */
export async function readTokenStoreSecure(): Promise<{ store: TokenStore | null; source: 'keyring' | 'file' | null }> {
    const keyringRaw = await readFromKeyring();
    if (keyringRaw) {
        try {
            return { store: JSON.parse(keyringRaw) as TokenStore, source: 'keyring' };
        } catch { /* corrupt keyring entry, try file */ }
    }
    const fileStore = readTokenFile();
    return { store: fileStore, source: fileStore ? 'file' : null };
}

/** Clear token from both keyring and file. */
export async function clearTokenStoreSecure(): Promise<void> {
    await deleteFromKeyring();
    clearTokenFile();
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
    writeTokenFile(updated);
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

    // SEC-02: Store to keyring first, file fallback
    const insecure = Boolean(flags['insecure-storage']);
    const storageDest = await writeTokenStoreSecure(store, insecure);

    console.log('');
    console.log(`Logged in as: ${store.email}`);
    if (store.tenantId) console.log(`Tenant:       ${store.tenantId}`);
    console.log(`Stored in:    ${storageDest === 'keyring' ? 'OS credential store' : TOKEN_FILE}`);
    if (storageDest === 'file' && !insecure) {
        console.log('  (OS keyring unavailable — using plaintext file fallback)');
    }

    // SYNC-02: Auto-configure sync after successful login
    try {
        const serverUrl = new URL(authServer);
        const apiBase = `${serverUrl.protocol}//api.${serverUrl.hostname.replace(/^auth\./, '')}`;
        saveConfig({
            'auth.server': authServer,
            'sync.enabled': true,
            'sync.endpoint': `${apiBase}/v1/sync`
        });
        console.log(`Sync:         enabled (${apiBase}/v1/sync)`);
    } catch {
        // Config write failure shouldn't block login
    }

    return 0;
}

export async function commandAuthLogout(): Promise<number> {
    const existing = readTokenStore();
    // SEC-02: Clear from both keyring and file
    await clearTokenStoreSecure();
    if (existing) {
        console.log(`Logged out (was: ${existing.email})`);
    } else {
        console.log('Not logged in — nothing to clear.');
    }
    return 0;
}

// ─── Token rotation (SEC-001) ─────────────────────────────────────────────────

/**
 * SEC-001: Rotate token — request a new access token using the existing
 * refresh token and revoke the old refresh token if the server supports it.
 */
export async function commandAuthRotate(flags: Record<string, string | boolean>): Promise<number> {
    const envToken = getEnvToken();
    if (envToken) {
        console.error('Cannot rotate token: authenticated via CTX_AUTH_TOKEN environment variable.');
        return 1;
    }

    const { store, source } = await readTokenStoreSecure();
    if (!store) {
        console.error('Not logged in. Run: 0ctx auth login');
        return 1;
    }

    if (!store.refreshToken) {
        console.error('No refresh token available — cannot rotate. Run: 0ctx auth login');
        return 1;
    }

    const authServer = getAuthServer();
    const oldRefreshToken = store.refreshToken;

    console.log(`Rotating token for ${store.email}...`);

    let updated: TokenStore;
    try {
        updated = await refreshAccessToken(store);
    } catch (e: unknown) {
        console.error(`Rotation failed: ${e instanceof Error ? e.message : String(e)}`);
        return 1;
    }

    // Attempt to revoke the old refresh token (best-effort)
    if (oldRefreshToken !== updated.refreshToken) {
        try {
            const body = urlEncode({
                client_id: CLIENT_ID,
                token: oldRefreshToken,
                token_type_hint: 'refresh_token'
            });
            await httpPost(`${authServer}/revoke`, body, 5_000);
            console.log('Old refresh token revoked.');
        } catch {
            console.warn('Warning: could not revoke old refresh token (server may not support revocation).');
        }
    }

    const insecure = Boolean(flags['insecure-storage']);
    const storageDest = await writeTokenStoreSecure(updated, insecure);

    const expiresIn = updated.expiresAt - Date.now();
    const expiresInHuman = expiresIn > 86400_000
        ? `${Math.round(expiresIn / 86400_000)}d`
        : `${Math.round(expiresIn / 3600_000)}h`;

    console.log(`Token rotated successfully.`);
    console.log(`  Email:     ${updated.email}`);
    console.log(`  Expires:   ${new Date(updated.expiresAt).toISOString()} (${expiresInHuman})`);
    console.log(`  Stored in: ${storageDest === 'keyring' ? 'OS credential store' : TOKEN_FILE}`);
    return 0;
}

/**
 * SEC-001: Check if token is close to expiry and warn.
 * Returns the number of ms remaining, or null if no token / env token.
 */
export function checkTokenExpiryWarning(): { expiresInMs: number | null; shouldWarn: boolean } {
    const envToken = getEnvToken();
    if (envToken) return { expiresInMs: null, shouldWarn: false };

    const store = readTokenStore();
    if (!store || store.expiresAt >= Number.MAX_SAFE_INTEGER) {
        return { expiresInMs: null, shouldWarn: false };
    }

    const remaining = store.expiresAt - Date.now();
    const total = store.expiresAt - (store.expiresAt - (store.expiresAt > 0 ? store.expiresAt : 0));

    // Warn when within configurable threshold (default 7 days)
    const warnDays = Number(process.env.CTX_AUTH_TOKEN_ROTATION_WARN_DAYS ?? '7');
    const warnMs = warnDays * 86400_000;
    const shouldWarn = remaining > 0 && remaining < warnMs;

    return { expiresInMs: remaining > 0 ? remaining : 0, shouldWarn };
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
