/**
 * AUTH-01: CLI-side device code auth (RFC 8628)
 *
 * Token store (SEC-02 priority order):
 *   1. CTX_AUTH_TOKEN env var (SEC-01)
 *   2. OS keyring (macOS Keychain / Windows Credential Manager / Linux Secret Service)
 *   3. ~/.0ctx/auth.json fallback (0o600) — or forced via --insecure-storage
 *
 * Auth server: CTX_AUTH_SERVER env var (default: https://0ctx.com)
 *
 * The CLI talks to the 0ctx.com BFF proxy routes (not Auth0 directly):
 *   POST {authServer}/api/v1/auth/device         → initiate device code
 *   POST {authServer}/api/v1/auth/device/token   → poll for tokens
 *   POST {authServer}/api/v1/auth/device/refresh → refresh access token
 *   POST {authServer}/api/v1/auth/device/revoke  → revoke refresh token
 *
 * All requests/responses are JSON (not form-encoded).
 * All proxy responses use camelCase; mapped to snake_case types locally.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import http from 'http';
import { execSync } from 'child_process';
import { storeToKeyring, readFromKeyring, deleteFromKeyring } from './keyring.js';
import { getConfigValue, saveConfig } from '@0ctx/core';
import { appendCliOpsLogEntry } from './ops-log.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_AUTH_SERVER = 'https://0ctx.com';
const DEFAULT_SCOPE = 'openid profile email offline_access';

/**
 * Returns the token file path.
 * Override with CTX_AUTH_FILE env var for testing or non-standard installs.
 * Re-evaluated on each call so tests can override process.env at runtime.
 */
function getTokenFilePath(): string {
    return process.env.CTX_AUTH_FILE ?? path.join(os.homedir(), '.0ctx', 'auth.json');
}

function getAuthServer(): string {
    return getConfigValue('auth.server').replace(/\/$/, '');
}

function recordAuthOpsEvent(
    operation: 'auth.login' | 'auth.logout' | 'auth.rotate',
    status: 'success' | 'error',
    details: Record<string, unknown> = {}
): void {
    appendCliOpsLogEntry({
        operation,
        status,
        details
    });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TokenStore {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;     // Unix ms
    email: string;
    tenantId: string;
}

// Internal snake_case types (RFC 8628 names kept for readability inside this module)
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

// Proxy BFF response shapes (camelCase — what 0ctx.com returns)
interface BffError {
    code: string;
    message: string;
    retryable?: boolean;
    correlationId?: string;
}

/** Extract a readable message from either BFF error shape. */
function bffErrorMessage(error: BffError | string | undefined): string {
    if (!error) return 'unknown error';
    if (typeof error === 'string') return error;
    return error.message ?? error.code ?? 'unknown error';
}

/** Extract the error code for polling state comparisons. */
function bffErrorCode(error: BffError | string | undefined): string | undefined {
    if (!error) return undefined;
    if (typeof error === 'string') return error;
    return error.code;
}

interface BffDeviceCodeResponse {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete?: string;
    expiresIn: number;
    interval: number;
    // BFF always uses object errors for this endpoint
    error?: BffError;
}

interface BffTokenResponse {
    accessToken?: string;
    refreshToken?: string | null;
    idToken?: string | null;
    tokenType?: string;
    expiresIn?: number;
    email?: string | null;
    tenantId?: string | null;
    // Polling passthrough errors ("authorization_pending" etc.) are plain strings.
    // BFF hard errors (device_auth_upstream_error etc.) are BffError objects.
    error?: BffError | string;
    errorDescription?: string;
}

// ─── Token store I/O (SEC-02: keyring-first, file-fallback) ───────────────────

/** Read from file only (sync fallback). */
function readTokenFile(): TokenStore | null {
    try {
        const f = getTokenFilePath();
        if (!fs.existsSync(f)) return null;
        const raw = fs.readFileSync(f, 'utf8');
        return JSON.parse(raw) as TokenStore;
    } catch {
        return null;
    }
}

function writeTokenFile(store: TokenStore): void {
    const f = getTokenFilePath();
    const dir = path.dirname(f);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function clearTokenFile(): void {
    try { fs.unlinkSync(getTokenFilePath()); } catch { /* already gone */ }
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

/** Generic HTTP POST with configurable Content-Type. */
function httpPost(
    url: string,
    body: string,
    contentType: string,
    timeoutMs = 10_000
): Promise<string> {
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
                    'Content-Type': contentType,
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

/** POST JSON to our BFF proxy routes. All 0ctx.com auth API routes expect JSON. */
function httpJsonPost(url: string, body: Record<string, unknown>, timeoutMs = 10_000): Promise<string> {
    return httpPost(url, JSON.stringify(body), 'application/json', timeoutMs);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Device code flow (RFC 8628) ─────────────────────────────────────────────

async function requestDeviceCode(authServer: string): Promise<DeviceCodeResponse> {
    let raw: string;
    try {
        raw = await httpJsonPost(`${authServer}/api/v1/auth/device`, { scope: DEFAULT_SCOPE });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Cannot connect to auth server (${authServer}): ${msg}`);
    }

    const parsed = JSON.parse(raw) as BffDeviceCodeResponse;
    if (parsed.error || !parsed.deviceCode || !parsed.userCode) {
        throw new Error(`Device code error: ${bffErrorMessage(parsed.error)} — ${raw}`);
    }

    // Map camelCase BFF response → internal snake_case shape
    return {
        device_code: parsed.deviceCode,
        user_code: parsed.userCode,
        verification_uri: parsed.verificationUri,
        verification_uri_complete: parsed.verificationUriComplete,
        expires_in: parsed.expiresIn,
        interval: parsed.interval,
    };
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

        let raw: string;
        try {
            raw = await httpJsonPost(`${authServer}/api/v1/auth/device/token`, { deviceCode });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`Token poll failed: ${msg}`);
        }

        const parsed = JSON.parse(raw) as BffTokenResponse;

        if (parsed.accessToken) {
            // SEC-04: Validate token_type per RFC 6749 §5.1
            const tokenType = parsed.tokenType ?? 'Bearer';
            if (tokenType.toLowerCase() !== 'bearer') {
                throw new Error(`Unexpected token_type: ${tokenType}`);
            }
            // Map camelCase BFF response → internal snake_case shape
            return {
                access_token: parsed.accessToken,
                refresh_token: parsed.refreshToken ?? '',
                expires_in: parsed.expiresIn ?? 3600,
                token_type: tokenType,
                email: parsed.email ?? undefined,
                tenant_id: parsed.tenantId ?? undefined,
            };
        }

        const errCode = bffErrorCode(parsed.error);
        if (errCode === 'authorization_pending') continue;
        if (errCode === 'slow_down') {
            await sleep(5_000);
            continue;
        }
        if (errCode === 'expired_token') {
            throw new Error('Device code expired. Run `0ctx auth login` again.');
        }
        if (errCode === 'access_denied') {
            throw new Error('Authorization denied by user.');
        }
        throw new Error(`Token error: ${bffErrorMessage(parsed.error)} — ${parsed.errorDescription ?? ''}`);
    }

    throw new Error('Device code expired (timed out). Run `0ctx auth login` again.');
}

// ─── Token refresh ────────────────────────────────────────────────────────────

export async function refreshAccessToken(store: TokenStore): Promise<TokenStore> {
    const authServer = getAuthServer();

    let raw: string;
    try {
        raw = await httpJsonPost(`${authServer}/api/v1/auth/device/refresh`, {
            refreshToken: store.refreshToken
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Token refresh failed: ${msg}`);
    }

    const parsed = JSON.parse(raw) as BffTokenResponse;
    if (!parsed.accessToken) {
        throw new Error(`Refresh error: ${bffErrorMessage(parsed.error)} — ${parsed.errorDescription ?? ''}`);
    }

    // SEC-04: Validate token_type
    const tokenType = parsed.tokenType ?? 'Bearer';
    if (tokenType.toLowerCase() !== 'bearer') {
        throw new Error(`Unexpected token_type from refresh: ${tokenType}`);
    }
    // SEC-04: Warn when server does not rotate refresh token
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

// ─── CLI commands ─────────────────────────────────────────────────────────────

export async function commandAuthLogin(flags: Record<string, string | boolean>): Promise<number> {
    // SEC-01: Check for env var token first
    const envToken = getEnvToken();
    if (envToken) {
        console.log('Already authenticated via CTX_AUTH_TOKEN environment variable.');
        console.log(`Email: ${envToken.email}`);
        recordAuthOpsEvent('auth.login', 'success', { source: 'env_token' });
        return 0;
    }

    const authServer = getAuthServer();
    const noBrowser = Boolean(flags['no-browser']);
    console.log(`Connecting to auth server: ${authServer}`);

    let deviceCodeResp: DeviceCodeResponse;
    try {
        deviceCodeResp = await requestDeviceCode(authServer);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(msg);
        recordAuthOpsEvent('auth.login', 'error', { stage: 'request_device_code', message: msg });
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
        const msg = e instanceof Error ? e.message : String(e);
        console.error(msg);
        recordAuthOpsEvent('auth.login', 'error', { stage: 'poll_token', message: msg });
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
    console.log(`Stored in:    ${storageDest === 'keyring' ? 'OS credential store' : getTokenFilePath()}`);
    if (storageDest === 'file' && !insecure) {
        console.log('  (OS keyring unavailable — using plaintext file fallback)');
    }

    // SYNC-02: Auto-configure sync after successful login
    try {
        const serverUrl = new URL(authServer);
        saveConfig({
            'auth.server': authServer,
            'sync.enabled': true,
            'sync.endpoint': `${authServer}/api/v1/sync`
        });
        console.log(`Sync:         enabled (${authServer}/api/v1/sync)`);
    } catch {
        // Config write failure shouldn't block login
    }

    recordAuthOpsEvent('auth.login', 'success', {
        source: storageDest === 'keyring' ? 'keyring' : 'file',
        tenantPresent: Boolean(store.tenantId),
        syncConfigured: true
    });
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
    recordAuthOpsEvent('auth.logout', 'success', { hadExistingSession: Boolean(existing) });
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
        recordAuthOpsEvent('auth.rotate', 'error', { reason: 'env_token' });
        return 1;
    }

    const { store, source } = await readTokenStoreSecure();
    if (!store) {
        console.error('Not logged in. Run: 0ctx auth login');
        recordAuthOpsEvent('auth.rotate', 'error', { reason: 'not_logged_in' });
        return 1;
    }

    if (!store.refreshToken) {
        console.error('No refresh token available — cannot rotate. Run: 0ctx auth login');
        recordAuthOpsEvent('auth.rotate', 'error', { reason: 'missing_refresh_token' });
        return 1;
    }

    const authServer = getAuthServer();
    const oldRefreshToken = store.refreshToken;

    console.log(`Rotating token for ${store.email}...`);

    let updated: TokenStore;
    try {
        updated = await refreshAccessToken(store);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`Rotation failed: ${msg}`);
        recordAuthOpsEvent('auth.rotate', 'error', { reason: 'refresh_failed', message: msg });
        return 1;
    }

    // Attempt to revoke the old refresh token (best-effort)
    if (oldRefreshToken !== updated.refreshToken) {
        try {
            await httpJsonPost(`${authServer}/api/v1/auth/device/revoke`, {
                token: oldRefreshToken,
                tokenTypeHint: 'refresh_token'
            }, 5_000);
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
    console.log(`  Stored in: ${storageDest === 'keyring' ? 'OS credential store' : getTokenFilePath()}`);
    recordAuthOpsEvent('auth.rotate', 'success', {
        source: storageDest === 'keyring' ? 'keyring' : 'file',
        rotated: true
    });
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
        if (!isEnv) console.log(`File:      ${getTokenFilePath()}`);
        if (expired && !isEnv) {
            console.log('');
            console.log('Token expired. Run: 0ctx auth login');
        }
    }

    return 0;
}
