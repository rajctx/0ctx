import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RawSyncAuth } from './types';

const TOKEN_FILE = path.join(os.homedir(), '.0ctx', 'auth.json');

interface RawTokenStore {
    accessToken?: string;
    tenantId?: string;
    email?: string;
}

export function getRawToken(): RawSyncAuth | null {
    const envToken = process.env.CTX_AUTH_TOKEN;
    if (envToken) {
        return {
            token: envToken,
            tenantId: process.env.CTX_TENANT_ID ?? '',
            userId: process.env.CTX_USER_ID ?? 'env:CTX_AUTH_TOKEN'
        };
    }

    try {
        if (!fs.existsSync(TOKEN_FILE)) return null;
        const raw = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')) as RawTokenStore;
        if (!raw.accessToken) return null;
        return { token: raw.accessToken, tenantId: raw.tenantId ?? '', userId: raw.email ?? '' };
    } catch {
        return null;
    }
}
