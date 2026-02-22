/**
 * SYNC-02: Global configuration system.
 *
 * Config file: ~/.0ctx/config.json
 * Resolution order: env var → config.json → built-in default
 *
 * Used by CLI, daemon, and MCP packages for consistent config access.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const CONFIG_PATH = path.join(os.homedir(), '.0ctx', 'config.json');

// ─── Schema ──────────────────────────────────────────────────────────────────

export interface AppConfig {
    'auth.server': string;
    'sync.enabled': boolean;
    'sync.endpoint': string;
    'ui.url': string;
}

const DEFAULTS: AppConfig = {
    'auth.server': 'https://auth.0ctx.com',
    'sync.enabled': true,
    'sync.endpoint': 'https://api.0ctx.com/v1/sync',
    'ui.url': 'https://app.0ctx.com'
};

/** Map of config keys to env var overrides */
const ENV_OVERRIDES: Partial<Record<keyof AppConfig, string>> = {
    'auth.server': 'CTX_AUTH_SERVER',
    'sync.enabled': 'CTX_SYNC_ENABLED',
    'sync.endpoint': 'CTX_SYNC_ENDPOINT'
};

// ─── Load / Save ─────────────────────────────────────────────────────────────

/**
 * Load raw config from disk. Returns empty object if file missing/corrupt.
 */
function loadRawConfig(): Partial<AppConfig> {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return {};
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Partial<AppConfig>;
    } catch {
        return {};
    }
}

/**
 * Load full config with defaults applied.
 */
export function loadConfig(): AppConfig {
    const raw = loadRawConfig();
    return { ...DEFAULTS, ...raw };
}

/**
 * Save partial config (merges with existing).
 */
export function saveConfig(partial: Partial<AppConfig>): void {
    const existing = loadRawConfig();
    const merged = { ...existing, ...partial };

    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
}

// ─── Get / Set ───────────────────────────────────────────────────────────────

const VALID_KEYS = new Set<string>(Object.keys(DEFAULTS));

/**
 * Get a resolved config value. Priority: env var → config.json → default.
 */
export function getConfigValue<K extends keyof AppConfig>(key: K): AppConfig[K] {
    // 1. Check env var override
    const envKey = ENV_OVERRIDES[key];
    if (envKey) {
        const envVal = process.env[envKey];
        if (envVal !== undefined && envVal !== '') {
            // Parse boolean for sync.enabled
            if (key === 'sync.enabled') {
                return (envVal === '1' || envVal.toLowerCase() === 'true') as AppConfig[K];
            }
            return envVal as AppConfig[K];
        }
    }

    // 2. Check config file
    const raw = loadRawConfig();
    if (key in raw) {
        return raw[key] as AppConfig[K];
    }

    // 3. Default
    return DEFAULTS[key];
}

/**
 * Set a config value and persist to disk.
 */
export function setConfigValue<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    if (!VALID_KEYS.has(key)) {
        throw new Error(`Unknown config key: ${key}. Valid keys: ${[...VALID_KEYS].join(', ')}`);
    }
    saveConfig({ [key]: value } as Partial<AppConfig>);
}

/**
 * List all config values (resolved, with source indication).
 */
export function listConfig(): Array<{
    key: keyof AppConfig;
    value: unknown;
    source: 'env' | 'config' | 'default';
}> {
    const raw = loadRawConfig();

    return (Object.keys(DEFAULTS) as Array<keyof AppConfig>).map(key => {
        const envKey = ENV_OVERRIDES[key];
        const envVal = envKey ? process.env[envKey] : undefined;

        if (envVal !== undefined && envVal !== '') {
            let value: unknown = envVal;
            if (key === 'sync.enabled') {
                value = envVal === '1' || envVal.toLowerCase() === 'true';
            }
            return { key, value, source: 'env' as const };
        }

        if (key in raw) {
            return { key, value: raw[key], source: 'config' as const };
        }

        return { key, value: DEFAULTS[key], source: 'default' as const };
    });
}

/**
 * Check if a string is a valid config key.
 */
export function isValidConfigKey(key: string): key is keyof AppConfig {
    return VALID_KEYS.has(key);
}

/**
 * Get the config file path (for display/debug).
 */
export function getConfigPath(): string {
    return CONFIG_PATH;
}
