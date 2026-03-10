import fs from 'fs';
import os from 'os';
import path from 'path';
import { deleteFromKeyring, readFromKeyring, storeToKeyring } from '../keyring.js';
import type { TokenStore } from './shared.js';

export function getTokenFilePath(): string {
    return process.env.CTX_AUTH_FILE ?? path.join(os.homedir(), '.0ctx', 'auth.json');
}

function readTokenFile(): TokenStore | null {
    try {
        const filePath = getTokenFilePath();
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, 'utf8')) as TokenStore;
    } catch {
        return null;
    }
}

export function writeTokenFile(store: TokenStore): void {
    const filePath = getTokenFilePath();
    const directory = path.dirname(filePath);
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function clearTokenFile(): void {
    try {
        fs.unlinkSync(getTokenFilePath());
    } catch {
        // Already gone.
    }
}

export function readTokenStore(): TokenStore | null {
    return readTokenFile();
}

export async function writeTokenStoreSecure(store: TokenStore, insecureOnly = false): Promise<'keyring' | 'file'> {
    const json = JSON.stringify(store, null, 2);
    if (!insecureOnly) {
        const stored = await storeToKeyring(json);
        if (stored) {
            writeTokenFile(store);
            return 'keyring';
        }
    }
    writeTokenFile(store);
    return 'file';
}

export async function readTokenStoreSecure(): Promise<{ store: TokenStore | null; source: 'keyring' | 'file' | null }> {
    const keyringRaw = await readFromKeyring();
    if (keyringRaw) {
        try {
            return { store: JSON.parse(keyringRaw) as TokenStore, source: 'keyring' };
        } catch {
            // Corrupt keyring entry, fall back to file.
        }
    }
    const store = readTokenFile();
    return { store, source: store ? 'file' : null };
}

export async function clearTokenStoreSecure(): Promise<void> {
    await deleteFromKeyring();
    clearTokenFile();
}

export function isTokenExpired(store: TokenStore): boolean {
    return Date.now() >= store.expiresAt;
}

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
    if (!filePath) return null;
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as TokenStore;
        return parsed.accessToken ? parsed : null;
    } catch {
        return null;
    }
}

export function resolveToken(): TokenStore | null {
    return getEnvToken() ?? readTokenStore();
}
