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

function resolveConfigPath(): string {
    const override = String(process.env.CTX_CONFIG_PATH || '').trim();
    if (override) {
        return override;
    }
    return path.join(os.homedir(), '.0ctx', 'config.json');
}

// ─── Schema ──────────────────────────────────────────────────────────────────

export interface AppConfig {
    'auth.server': string;
    'sync.enabled': boolean;
    'sync.endpoint': string;
    'ui.url': string;
    'capture.retentionDays': number;
    'capture.debugRetentionDays': number;
    'capture.debugArtifacts': boolean;
    'integration.chatgpt.enabled': boolean;
    'integration.chatgpt.requireApproval': boolean;
    'integration.autoBootstrap': boolean;
    /** Per-machine HMAC secret for audit log chain integrity. Auto-generated on first use. */
    'audit.hmacSecret': string;
    /** Whether telemetry events are collected (true) or disabled (false) */
    'telemetry.enabled': boolean;
}

const DEFAULTS: AppConfig = {
    'auth.server': 'https://www.0ctx.com',
    'sync.enabled': true,
    'sync.endpoint': 'https://www.0ctx.com/api/v1/sync',
    'ui.url': 'https://www.0ctx.com/install',
    'capture.retentionDays': 14,
    'capture.debugRetentionDays': 7,
    'capture.debugArtifacts': false,
    'integration.chatgpt.enabled': false,
    'integration.chatgpt.requireApproval': true,
    'integration.autoBootstrap': true,
    'audit.hmacSecret': '',
    'telemetry.enabled': false
};

/** Map of config keys to env var overrides */
const ENV_OVERRIDES: Partial<Record<keyof AppConfig, string>> = {
    'auth.server': 'CTX_AUTH_SERVER',
    'sync.enabled': 'CTX_SYNC_ENABLED',
    'sync.endpoint': 'CTX_SYNC_ENDPOINT',
    'capture.retentionDays': 'CTX_HOOK_DUMP_RETENTION_DAYS',
    'capture.debugRetentionDays': 'CTX_HOOK_DEBUG_RETENTION_DAYS',
    'capture.debugArtifacts': 'CTX_HOOK_DEBUG_ARTIFACTS',
    'integration.chatgpt.enabled': 'CTX_INTEGRATION_CHATGPT_ENABLED',
    'integration.chatgpt.requireApproval': 'CTX_INTEGRATION_CHATGPT_REQUIRE_APPROVAL',
    'integration.autoBootstrap': 'CTX_INTEGRATION_AUTO_BOOTSTRAP',
    'audit.hmacSecret': 'CTX_AUDIT_HMAC_SECRET',
    'telemetry.enabled': 'CTX_TELEMETRY_ENABLED'
};

const BOOLEAN_KEYS = new Set<keyof AppConfig>([
    'sync.enabled',
    'capture.debugArtifacts',
    'integration.chatgpt.enabled',
    'integration.chatgpt.requireApproval',
    'integration.autoBootstrap',
    'telemetry.enabled'
]);

const NUMBER_KEYS = new Set<keyof AppConfig>([
    'capture.retentionDays',
    'capture.debugRetentionDays'
]);

function parseNumberValue(value: string, fallback: number): number {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanValue(value: string): boolean {
    return value === '1' || value.toLowerCase() === 'true';
}

// ─── Load / Save ─────────────────────────────────────────────────────────────

/**
 * Load raw config from disk. Returns empty object if file missing/corrupt.
 */
function loadRawConfig(): Partial<AppConfig> {
    const configPath = resolveConfigPath();
    try {
        if (!fs.existsSync(configPath)) return {};
        return JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<AppConfig>;
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
    const configPath = resolveConfigPath();
    const existing = loadRawConfig();
    const merged = { ...existing, ...partial };

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf8');
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
            if (BOOLEAN_KEYS.has(key)) {
                return parseBooleanValue(envVal) as AppConfig[K];
            }
            if (NUMBER_KEYS.has(key)) {
                return parseNumberValue(envVal, DEFAULTS[key] as number) as AppConfig[K];
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
            if (BOOLEAN_KEYS.has(key)) {
                value = parseBooleanValue(envVal);
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
    return resolveConfigPath();
}
