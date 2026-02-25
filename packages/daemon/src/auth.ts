import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { encryptJson, decryptJson } from '@0ctx/core';
import type { EncryptedPayload, AuthState } from '@0ctx/core';
import { log } from './logger';

// ── In-memory auth cache ────────────────────────────────────────

let authCache: {
    userId: string | null;
    tenantId: string | null;
    tenantUrl: string | null;
    deviceId: string | null;
    accessToken: string | null;
    refreshToken: string | null;
    tokenExpiresAt: number | null;
} = {
    userId: null,
    tenantId: null,
    tenantUrl: null,
    deviceId: null,
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null
};

let authDb: Database.Database | null = null;

// ── Key-value helpers for auth_state table ──────────────────────

function readAuthKey(db: Database.Database, key: string): string | null {
    const row = db.prepare('SELECT value FROM auth_state WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
}

function writeAuthKey(db: Database.Database, key: string, value: string): void {
    db.prepare(`
    INSERT INTO auth_state (key, value, updatedAt)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt
  `).run(key, value, Date.now());
}

function deleteAuthKey(db: Database.Database, key: string): void {
    db.prepare('DELETE FROM auth_state WHERE key = ?').run(key);
}

// ── Encrypted token helpers ─────────────────────────────────────

function encryptToken(token: string): string {
    return JSON.stringify(encryptJson(token));
}

function decryptToken(encrypted: string): string {
    const payload = JSON.parse(encrypted) as EncryptedPayload;
    return decryptJson<string>(payload);
}

// ── Public API ──────────────────────────────────────────────────

export function initAuth(db: Database.Database): void {
    authDb = db;

    // Load persisted state into memory cache
    authCache.userId = readAuthKey(db, 'userId');
    authCache.tenantId = readAuthKey(db, 'tenantId');
    authCache.tenantUrl = readAuthKey(db, 'tenantUrl');
    authCache.deviceId = readAuthKey(db, 'deviceId') ?? randomUUID();

    const expiresRaw = readAuthKey(db, 'tokenExpiresAt');
    authCache.tokenExpiresAt = expiresRaw ? Number(expiresRaw) : null;

    // Decrypt tokens if present
    const encryptedAccess = readAuthKey(db, 'accessToken');
    const encryptedRefresh = readAuthKey(db, 'refreshToken');

    try {
        authCache.accessToken = encryptedAccess ? decryptToken(encryptedAccess) : null;
    } catch {
        log('warn', 'auth_access_token_decrypt_failed', {});
        authCache.accessToken = null;
    }

    try {
        authCache.refreshToken = encryptedRefresh ? decryptToken(encryptedRefresh) : null;
    } catch {
        log('warn', 'auth_refresh_token_decrypt_failed', {});
        authCache.refreshToken = null;
    }

    // Ensure deviceId is persisted
    if (!readAuthKey(db, 'deviceId')) {
        writeAuthKey(db, 'deviceId', authCache.deviceId!);
    }

    log('info', 'auth_initialized', {
        authenticated: isAuthenticated(),
        userId: authCache.userId,
        tenantId: authCache.tenantId
    });
}

export function getAuthState(): AuthState {
    return {
        userId: authCache.userId,
        tenantId: authCache.tenantId,
        tenantUrl: authCache.tenantUrl,
        deviceId: authCache.deviceId,
        tokenExpiresAt: authCache.tokenExpiresAt,
        authenticated: isAuthenticated()
    };
}

export function isAuthenticated(): boolean {
    if (!authCache.userId || !authCache.accessToken) return false;
    if (authCache.tokenExpiresAt && authCache.tokenExpiresAt < Date.now()) return false;
    return true;
}

export function getAccessToken(): string | null {
    if (!isAuthenticated()) return null;
    return authCache.accessToken;
}

export function getUserId(): string | null {
    return authCache.userId;
}

export function getTenantId(): string | null {
    return authCache.tenantId;
}

export function getDeviceId(): string {
    return authCache.deviceId ?? randomUUID();
}

export function getTenantUrl(): string | null {
    return authCache.tenantUrl;
}

export interface AuthLoginInitResult {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    expiresIn: number;
    interval: number;
}

/**
 * Initiates a device code authentication flow.
 * Returns the device code details for the user to complete in a browser.
 */
export function initiateDeviceCodeLogin(tenantUrl: string): AuthLoginInitResult {
    if (!authDb) throw new Error('Auth module not initialized.');

    // Persist tenant URL early so polling can reference it
    authCache.tenantUrl = tenantUrl;
    writeAuthKey(authDb, 'tenantUrl', tenantUrl);

    // Generate a local device code (real implementation would call the auth provider)
    const deviceCode = randomUUID();
    const userCode = randomUUID().slice(0, 8).toUpperCase();

    return {
        deviceCode,
        userCode,
        verificationUri: `${tenantUrl}/device`,
        expiresIn: 900,
        interval: 5
    };
}

/**
 * Polls the auth provider for token exchange completion.
 * In a real implementation this would call the auth provider's token endpoint.
 * For now, simulates a successful login to prove the pipeline works end-to-end.
 */
export function pollDeviceCodeLogin(deviceCode: string): {
    status: 'pending' | 'complete' | 'expired';
    userId?: string;
    tenantId?: string;
} {
    if (!authDb) throw new Error('Auth module not initialized.');

    // Simulation: treat any device code poll as a completed login.
    // Real implementation would call: POST {tenantUrl}/oauth/token with device_code grant
    const userId = `user-${randomUUID().slice(0, 8)}`;
    const tenantId = `tenant-${randomUUID().slice(0, 8)}`;
    const accessToken = `at-${randomUUID()}`;
    const refreshToken = `rt-${randomUUID()}`;
    const tokenExpiresAt = Date.now() + 3600_000; // 1 hour

    setAuthTokens({
        userId,
        tenantId,
        accessToken,
        refreshToken,
        tokenExpiresAt
    });

    return { status: 'complete', userId, tenantId };
}

export interface SetAuthTokensParams {
    userId: string;
    tenantId: string;
    accessToken: string;
    refreshToken: string;
    tokenExpiresAt: number;
}

export function setAuthTokens(params: SetAuthTokensParams): void {
    if (!authDb) throw new Error('Auth module not initialized.');

    authCache.userId = params.userId;
    authCache.tenantId = params.tenantId;
    authCache.accessToken = params.accessToken;
    authCache.refreshToken = params.refreshToken;
    authCache.tokenExpiresAt = params.tokenExpiresAt;

    writeAuthKey(authDb, 'userId', params.userId);
    writeAuthKey(authDb, 'tenantId', params.tenantId);
    writeAuthKey(authDb, 'accessToken', encryptToken(params.accessToken));
    writeAuthKey(authDb, 'refreshToken', encryptToken(params.refreshToken));
    writeAuthKey(authDb, 'tokenExpiresAt', String(params.tokenExpiresAt));

    log('info', 'auth_tokens_set', {
        userId: params.userId,
        tenantId: params.tenantId,
        tokenExpiresAt: params.tokenExpiresAt
    });
}

export function clearAuth(): void {
    if (!authDb) throw new Error('Auth module not initialized.');

    authCache.userId = null;
    authCache.tenantId = null;
    authCache.accessToken = null;
    authCache.refreshToken = null;
    authCache.tokenExpiresAt = null;
    // Keep deviceId and tenantUrl for re-login convenience

    for (const key of ['userId', 'tenantId', 'accessToken', 'refreshToken', 'tokenExpiresAt']) {
        deleteAuthKey(authDb, key);
    }

    log('info', 'auth_cleared', {});
}

export function resetAuthStateForTests(): void {
    authCache = {
        userId: null,
        tenantId: null,
        tenantUrl: null,
        deviceId: null,
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null
    };
    authDb = null;
}
