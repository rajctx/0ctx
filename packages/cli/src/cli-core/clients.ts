import type { HookSupportedAgent } from '../hooks';
import type { HookInstallClient, SupportedClient } from './types';

export const GA_SUPPORTED_CLIENTS: SupportedClient[] = ['claude', 'antigravity'];
export const PREVIEW_SUPPORTED_CLIENTS: SupportedClient[] = ['codex', 'cursor', 'windsurf'];
export const ALL_SUPPORTED_CLIENTS: SupportedClient[] = [...GA_SUPPORTED_CLIENTS, ...PREVIEW_SUPPORTED_CLIENTS];
export const DEFAULT_MCP_CLIENTS: SupportedClient[] = ['claude', 'antigravity'];
export const DEFAULT_HOOK_INSTALL_CLIENTS: HookInstallClient[] = ['claude', 'factory', 'antigravity'];
export const SESSION_START_AGENTS: Array<Extract<HookSupportedAgent, 'claude' | 'factory' | 'antigravity'>> = ['claude', 'factory', 'antigravity'];

export function isGaHookAgent(agent: HookSupportedAgent): agent is Extract<HookSupportedAgent, 'claude' | 'factory' | 'antigravity'> {
    return agent === 'claude' || agent === 'factory' || agent === 'antigravity';
}

export function parseClients(
    raw: string | boolean | undefined,
    supportedClients: SupportedClient[] = ALL_SUPPORTED_CLIENTS,
    defaultClients: SupportedClient[] = DEFAULT_MCP_CLIENTS
): SupportedClient[] {
    if (!raw || typeof raw !== 'string') return defaultClients;
    const normalized = raw.trim().toLowerCase();
    if (!normalized || normalized === 'ga') return defaultClients;

    const parsed = normalized
        .split(/[,\s]+/)
        .map(item => item.trim())
        .filter((item): item is SupportedClient => supportedClients.includes(item as SupportedClient));

    return parsed.length > 0 ? parsed : defaultClients;
}

export function parseHookClients(
    raw: string | boolean | undefined,
    supportedClients: SupportedClient[] = ALL_SUPPORTED_CLIENTS,
    defaultClients: HookInstallClient[] = DEFAULT_HOOK_INSTALL_CLIENTS
): HookInstallClient[] {
    if (!raw || typeof raw !== 'string') return defaultClients;
    const normalized = raw.trim().toLowerCase();
    if (!normalized || normalized === 'ga') return defaultClients;

    const parsed = normalized
        .split(/[,\s]+/)
        .map(item => item.trim())
        .filter((item): item is HookInstallClient => item === 'factory' || supportedClients.includes(item as SupportedClient));

    return parsed.length > 0 ? parsed : defaultClients;
}

export function parseEnableMcpClients(
    raw: string | boolean | undefined,
    defaultClients: SupportedClient[] = DEFAULT_MCP_CLIENTS,
    parseMcpClients: (rawValue: string | boolean | undefined) => SupportedClient[] = value => parseClients(value)
): SupportedClient[] {
    if (!raw || typeof raw !== 'string') return defaultClients;
    const normalized = raw.trim().toLowerCase();
    if (!normalized) return defaultClients;
    if (normalized === 'none') return [];
    if (normalized === 'ga') return defaultClients;
    return parseMcpClients(raw);
}

export function validateExplicitPreviewSelection(
    raw: string | boolean | undefined,
    previewExample: string,
    gaExample = 'ga'
): string | null {
    if (!raw || typeof raw !== 'string') return null;
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'preview' || normalized === 'all') {
        return `Preview integrations stay outside the normal product path. Use --clients=${gaExample} for the supported path or name preview integrations explicitly with --clients=${previewExample}.`;
    }
    return null;
}
