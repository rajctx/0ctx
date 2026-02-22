/**
 * SEC-02: OS keyring credential storage wrapper.
 *
 * Uses `cross-keychain` for platform-native secure credential storage:
 *   - macOS: Keychain (Security.framework or `security` CLI)
 *   - Windows: Credential Manager (native or PowerShell)
 *   - Linux: Secret Service (libsecret or `secret-tool` CLI)
 *
 * All operations are async and fail gracefully — the caller falls back
 * to the plaintext token file if keyring operations fail.
 */

const SERVICE = '0ctx-cli';
const ACCOUNT = 'auth-token';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _mod: any = null;

async function getModule(): Promise<{ setPassword: (service: string, account: string, password: string) => Promise<void>; getPassword: (service: string, account: string) => Promise<string | null>; deletePassword: (service: string, account: string) => Promise<void> }> {
    if (!_mod) {
        _mod = await import('cross-keychain');
    }
    return _mod;
}

/**
 * Store a JSON string in the OS keyring.
 * Returns true on success, false if the keyring is unavailable.
 */
export async function storeToKeyring(json: string): Promise<boolean> {
    try {
        const mod = await getModule();
        await mod.setPassword(SERVICE, ACCOUNT, json);
        return true;
    } catch {
        return false;
    }
}

/**
 * Read the stored JSON string from the OS keyring.
 * Returns null if not found or keyring unavailable.
 */
export async function readFromKeyring(): Promise<string | null> {
    try {
        const mod = await getModule();
        const password = await mod.getPassword(SERVICE, ACCOUNT);
        return password ?? null;
    } catch {
        return null;
    }
}

/**
 * Delete the stored credential from the OS keyring.
 * Silently succeeds if nothing was stored.
 */
export async function deleteFromKeyring(): Promise<void> {
    try {
        const mod = await getModule();
        await mod.deletePassword(SERVICE, ACCOUNT);
    } catch {
        // Not found or unavailable — that's fine
    }
}
