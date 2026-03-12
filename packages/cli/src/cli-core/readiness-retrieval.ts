import type { HookSupportedAgent } from '../hooks';
import type { SupportedClient } from './types';

type GaAutoContextAgent = Extract<HookSupportedAgent, 'claude' | 'factory' | 'antigravity'>;
type GaMcpRegistrationClient = Extract<SupportedClient, 'claude' | 'antigravity'>;

function requiresGaMcpRegistration(agent: HookSupportedAgent): agent is GaMcpRegistrationClient {
    return agent === 'claude' || agent === 'antigravity';
}

function asRegisteredGaMcpClient(value: string): GaMcpRegistrationClient | null {
    return value === 'claude' || value === 'antigravity' ? value : null;
}

function dedupeAgents<T extends string>(values: T[]): T[] {
    return [...new Set(values)];
}

export function resolveGaAutoContextReadiness(options: {
    captureReadyAgents: GaAutoContextAgent[];
    sessionStartReadyAgents: GaAutoContextAgent[];
    registeredMcpClients: SupportedClient[];
}): {
    autoContextAgents: GaAutoContextAgent[];
    autoContextMissingAgents: GaAutoContextAgent[];
    sessionStartMissingAgents: GaAutoContextAgent[];
    mcpRegistrationMissingAgents: GaMcpRegistrationClient[];
} {
    const registeredMcpClients = new Set(
        options.registeredMcpClients
            .map(client => asRegisteredGaMcpClient(String(client || '').trim().toLowerCase()))
            .filter((client): client is GaMcpRegistrationClient => Boolean(client))
    );
    const captureReadyAgents = dedupeAgents(options.captureReadyAgents);
    const sessionStartReadyAgents = dedupeAgents(options.sessionStartReadyAgents);
    const sessionStartMissingAgents = captureReadyAgents.filter(agent => !sessionStartReadyAgents.includes(agent));
    const mcpRegistrationMissingAgents = sessionStartReadyAgents
        .filter(requiresGaMcpRegistration)
        .filter(agent => !registeredMcpClients.has(agent));
    const autoContextAgents = sessionStartReadyAgents.filter(
        agent => !requiresGaMcpRegistration(agent) || registeredMcpClients.has(agent)
    );
    const autoContextMissingAgents = captureReadyAgents.filter(agent => !autoContextAgents.includes(agent));

    return {
        autoContextAgents,
        autoContextMissingAgents,
        sessionStartMissingAgents,
        mcpRegistrationMissingAgents
    };
}

export function buildGaAutoContextActionHint(options: {
    sessionStartMissingAgents: GaAutoContextAgent[];
    mcpRegistrationMissingAgents: GaMcpRegistrationClient[];
}): string | null {
    const parts: string[] = [];
    if (options.sessionStartMissingAgents.length > 0) {
        parts.push(`Install automatic context injection for ${options.sessionStartMissingAgents.join(', ')}.`);
    }
    if (options.mcpRegistrationMissingAgents.length > 0) {
        parts.push(`Register MCP retrieval for ${options.mcpRegistrationMissingAgents.join(', ')}.`);
    }
    return parts.length > 0 ? parts.join(' ') : null;
}
