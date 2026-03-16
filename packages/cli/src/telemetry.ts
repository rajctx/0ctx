import { PostHog } from 'posthog-node';
import os from 'os';
import { getConfigValue } from '@0ctx/core';

// ── Sensitive-key deny list ──────────────────────────────────────────────────
// Any property whose key (case-insensitive) matches one of these will be
// stripped before the event is sent to PostHog.
const SENSITIVE_KEYS = new Set([
    'accesstoken',
    'refreshtoken',
    'token',
    'password',
    'secret',
    'apikey',
    'api_key',
    'masterkey',
    'master_key',
    'authorization',
    'cookie',
    'otp',
    'credentials',
    'private_key',
    'privatekey',
]);

const HOME_DIR = os.homedir();
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

let posthog: PostHog | null = null;
let isTelemetryEnabled = false;
let distinctId = 'cli-anonymous';

function getPostHogApiKey(): string {
    return String(process.env.CTX_POSTHOG_API_KEY || '').trim();
}

function getPostHogHost(): string {
    return String(process.env.CTX_POSTHOG_HOST || '').trim() || DEFAULT_POSTHOG_HOST;
}

// ── CLI version (read once) ──────────────────────────────────────────────────
let cliVersion = 'unknown';
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cliVersion = require('../package.json').version;
} catch {
    // Bundled build may not have package.json — that's fine.
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Recursively strips sensitive keys and redacts home-directory paths from
 * property values before they are sent to PostHog.
 */
function sanitizeProperties(props: Record<string, any>): Record<string, any> {
    const clean: Record<string, any> = {};

    for (const [key, value] of Object.entries(props)) {
        // Drop keys that match the sensitive deny list
        if (SENSITIVE_KEYS.has(key.toLowerCase())) {
            continue;
        }

        if (value === null || value === undefined) {
            clean[key] = value;
        } else if (typeof value === 'string') {
            // Redact home-directory prefix from paths
            clean[key] = value.includes(HOME_DIR)
                ? value.replaceAll(HOME_DIR, '~')
                : value;
        } else if (typeof value === 'object' && !Array.isArray(value)) {
            clean[key] = sanitizeProperties(value);
        } else {
            clean[key] = value;
        }
    }

    return clean;
}

function checkTelemetryEnabled(): boolean {
    if (process.env.CTX_DISABLE_TELEMETRY === '1' || process.env.CTX_DISABLE_TELEMETRY === 'true') {
        return false;
    }
    if (!getPostHogApiKey()) {
        return false;
    }
    const enabled = getConfigValue('telemetry.enabled');
    if (enabled === false) {
        return false;
    }
    return true;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function initTelemetry(deviceId?: string) {
    distinctId = deviceId || 'cli-anonymous';

    isTelemetryEnabled = checkTelemetryEnabled();
    if (!isTelemetryEnabled) {
        posthog = null;
        return;
    }

    try {
        posthog = new PostHog(getPostHogApiKey(), {
            host: getPostHogHost(),
            flushAt: 1,
            flushInterval: 0,
        });
    } catch {
        // Silently fail if initialization fails
    }
}

export function captureEvent(event: string, properties?: Record<string, any>) {
    if (!posthog || !isTelemetryEnabled) {
        return;
    }

    try {
        const safeProps = properties ? sanitizeProperties(properties) : {};

        posthog.capture({
            distinctId,
            event,
            properties: {
                ...safeProps,
                $lib: 'cli',
                cli_version: cliVersion,
                os_platform: os.platform(),
                os_arch: os.arch(),
                node_version: process.version,
            },
        });
    } catch {
        // Silently fail telemetry errors
    }
}

export async function shutdownTelemetry() {
    if (posthog) {
        try {
            await posthog.shutdown();
        } catch {
            // Ignore shutdown errors
        }
    }
    posthog = null;
    isTelemetryEnabled = false;
}
