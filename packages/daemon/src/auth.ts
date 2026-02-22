/**
 * AUTH-02: Daemon-side auth state reader.
 *
 * The CLI (`packages/cli/src/auth.ts`) owns writing ~/.0ctx/auth.json.
 * This module reads it on demand — no caching, no network, no writes.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const TOKEN_FILE = path.join(os.homedir(), '.0ctx', 'auth.json');

export interface AuthState {
    authenticated: boolean;
    email: string | null;
    tenantId: string | null;
    expiresAt: number | null;   // Unix ms
    tokenExpired: boolean;
}

interface RawTokenStore {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    email?: string;
    tenantId?: string;
}

export function readAuthState(): AuthState {
    const absent: AuthState = {
        authenticated: false,
        email: null,
        tenantId: null,
        expiresAt: null,
        tokenExpired: false
    };

    try {
        if (!fs.existsSync(TOKEN_FILE)) return absent;
        const raw = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')) as RawTokenStore;

        if (!raw.accessToken) return absent;

        const expiresAt = typeof raw.expiresAt === 'number' ? raw.expiresAt : null;
        const tokenExpired = expiresAt !== null && Date.now() >= expiresAt;

        return {
            authenticated: !tokenExpired,
            email: raw.email ?? null,
            tenantId: raw.tenantId ?? null,
            expiresAt,
            tokenExpired
        };
    } catch {
        return absent;
    }
}
