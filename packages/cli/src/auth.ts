import { saveConfig } from '@0ctx/core';
import {
    getAuthServer,
    normalize0ctxHostedUrl,
    type DeviceCodeResponse,
    type TokenResponse,
    type TokenStore
} from './auth/shared.js';
import {
    clearTokenStoreSecure,
    getEnvToken,
    getTokenFilePath,
    isTokenExpired,
    readTokenStore,
    readTokenStoreSecure,
    resolveToken,
    writeTokenStoreSecure
} from './auth/store.js';
import { openBrowser, parseJsonResponse, pollForToken, refreshAccessToken, requestDeviceCode, revokeRefreshToken } from './auth/network.js';
import { appendCliOpsLogEntry } from './ops-log.js';

export type { TokenStore } from './auth/shared.js';
export {
    clearTokenStoreSecure,
    getEnvToken,
    isTokenExpired,
    readTokenStore,
    readTokenStoreSecure,
    resolveToken,
    writeTokenStoreSecure
} from './auth/store.js';
export { refreshAccessToken } from './auth/network.js';

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

export const __test = {
    requestDeviceCode,
    normalize0ctxHostedUrl,
    parseJsonResponse
};

export async function commandAuthLogin(flags: Record<string, string | boolean>): Promise<number> {
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
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        recordAuthOpsEvent('auth.login', 'error', { stage: 'request_device_code', message });
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
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        recordAuthOpsEvent('auth.login', 'error', { stage: 'poll_token', message });
        return 1;
    }

    const store: TokenStore = {
        accessToken: tokenResp.access_token,
        refreshToken: tokenResp.refresh_token,
        expiresAt: Date.now() + tokenResp.expires_in * 1000,
        email: tokenResp.email ?? '',
        tenantId: tokenResp.tenant_id ?? ''
    };

    const insecure = Boolean(flags['insecure-storage']);
    const storageDest = await writeTokenStoreSecure(store, insecure);

    console.log('');
    console.log(`Logged in as: ${store.email}`);
    if (store.tenantId) console.log(`Tenant:       ${store.tenantId}`);
    console.log(`Stored in:    ${storageDest === 'keyring' ? 'OS credential store' : getTokenFilePath()}`);
    if (storageDest === 'file' && !insecure) {
        console.log('  (OS keyring unavailable — using plaintext file fallback)');
    }

    try {
        saveConfig({
            'auth.server': authServer,
            'sync.enabled': true,
            'sync.endpoint': `${authServer}/api/v1/sync`
        });
        console.log(`Sync:         enabled (${authServer}/api/v1/sync)`);
    } catch {
        // Config write failure should not block login.
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
    await clearTokenStoreSecure();
    if (existing) console.log(`Logged out (was: ${existing.email})`);
    else console.log('Not logged in — nothing to clear.');
    recordAuthOpsEvent('auth.logout', 'success', { hadExistingSession: Boolean(existing) });
    return 0;
}

export async function commandAuthRotate(flags: Record<string, string | boolean>): Promise<number> {
    const envToken = getEnvToken();
    if (envToken) {
        console.error('Cannot rotate token: authenticated via CTX_AUTH_TOKEN environment variable.');
        recordAuthOpsEvent('auth.rotate', 'error', { reason: 'env_token' });
        return 1;
    }

    const { store } = await readTokenStoreSecure();
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
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Rotation failed: ${message}`);
        recordAuthOpsEvent('auth.rotate', 'error', { reason: 'refresh_failed', message });
        return 1;
    }

    if (oldRefreshToken !== updated.refreshToken) {
        try {
            await revokeRefreshToken(authServer, oldRefreshToken);
            console.log('Old refresh token revoked.');
        } catch {
            console.warn('Warning: could not revoke old refresh token (server may not support revocation).');
        }
    }

    const insecure = Boolean(flags['insecure-storage']);
    const storageDest = await writeTokenStoreSecure(updated, insecure);
    const expiresIn = updated.expiresAt - Date.now();
    const expiresInHuman = expiresIn > 86400_000 ? `${Math.round(expiresIn / 86400_000)}d` : `${Math.round(expiresIn / 3600_000)}h`;

    console.log('Token rotated successfully.');
    console.log(`  Email:     ${updated.email}`);
    console.log(`  Expires:   ${new Date(updated.expiresAt).toISOString()} (${expiresInHuman})`);
    console.log(`  Stored in: ${storageDest === 'keyring' ? 'OS credential store' : getTokenFilePath()}`);
    recordAuthOpsEvent('auth.rotate', 'success', {
        source: storageDest === 'keyring' ? 'keyring' : 'file',
        rotated: true
    });
    return 0;
}

export function checkTokenExpiryWarning(): { expiresInMs: number | null; shouldWarn: boolean } {
    if (getEnvToken()) return { expiresInMs: null, shouldWarn: false };

    const store = readTokenStore();
    if (!store || store.expiresAt >= Number.MAX_SAFE_INTEGER) {
        return { expiresInMs: null, shouldWarn: false };
    }

    const remaining = store.expiresAt - Date.now();
    const warnDays = Number(process.env.CTX_AUTH_TOKEN_ROTATION_WARN_DAYS ?? '7');
    const warnMs = warnDays * 86400_000;
    return {
        expiresInMs: remaining > 0 ? remaining : 0,
        shouldWarn: remaining > 0 && remaining < warnMs
    };
}

export function commandAuthStatus(flags: Record<string, string | boolean>): number {
    const asJson = Boolean(flags.json);
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
        console.log(
            JSON.stringify({
                status: expired ? 'expired' : 'logged_in',
                source: isEnv ? 'environment' : 'token_file',
                email: store.email,
                tenantId: store.tenantId,
                expiresAt: expiresDate
            })
        );
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
