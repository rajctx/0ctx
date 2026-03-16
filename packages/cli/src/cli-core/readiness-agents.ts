import type { HookSupportedAgent } from '../hooks';
import type { HookInstallClient } from './types';

type GaHookClient = Extract<HookInstallClient, 'claude' | 'factory' | 'antigravity'>;

function asGaHookClient(value: string): GaHookClient | null {
    return value === 'claude' || value === 'factory' || value === 'antigravity'
        ? value
        : null;
}

function dedupeGaHookClients(values: Array<string | HookSupportedAgent | HookInstallClient>): GaHookClient[] {
    const seen = new Set<GaHookClient>();
    for (const value of values) {
        const agent = asGaHookClient(String(value || '').trim().toLowerCase());
        if (agent) seen.add(agent);
    }
    return [...seen];
}

export function resolveExpectedGaCaptureAgents(options: {
    defaultHookInstallClients: HookInstallClient[];
    detectedHookClients: HookInstallClient[];
    captureReadyAgents: HookSupportedAgent[];
}): GaHookClient[] {
    const detected = dedupeGaHookClients(options.detectedHookClients);
    if (detected.length > 0) return detected;

    const configured = dedupeGaHookClients(options.captureReadyAgents);
    if (configured.length > 0) return configured;

    return dedupeGaHookClients(options.defaultHookInstallClients);
}
