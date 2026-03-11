import fs from 'fs';
import os from 'os';
import path from 'path';

type GaHookAgent = 'claude' | 'factory' | 'antigravity';
type GaMcpClient = 'claude' | 'antigravity';

const DEFAULT_GA_HOOK_AGENTS: GaHookAgent[] = ['claude', 'factory', 'antigravity'];

function exists(candidate: string): boolean {
    try {
        return fs.existsSync(candidate);
    } catch {
        return false;
    }
}

function resolveAppData(homeDir: string): string {
    return process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
}

function claudeSignals(platform: NodeJS.Platform, homeDir: string, appDataDir: string): string[] {
    if (platform === 'win32') return [path.join(homeDir, '.claude'), path.join(appDataDir, 'Claude')];
    if (platform === 'darwin') return [path.join(homeDir, '.claude'), path.join(homeDir, 'Library', 'Application Support', 'Claude')];
    return [path.join(homeDir, '.claude'), path.join(homeDir, '.config', 'Claude')];
}

function factorySignals(homeDir: string): string[] {
    return [path.join(homeDir, '.factory')];
}

function antigravitySignals(platform: NodeJS.Platform, homeDir: string, appDataDir: string): string[] {
    if (platform === 'win32') {
        return [path.join(homeDir, '.gemini'), path.join(homeDir, '.antigravity'), path.join(appDataDir, 'Antigravity')];
    }
    if (platform === 'darwin') {
        return [
            path.join(homeDir, '.gemini'),
            path.join(homeDir, '.antigravity'),
            path.join(homeDir, 'Library', 'Application Support', 'Antigravity')
        ];
    }
    return [
        path.join(homeDir, '.gemini'),
        path.join(homeDir, '.antigravity'),
        path.join(homeDir, '.config', 'Antigravity')
    ];
}

function claudeMcpConfigPaths(platform: NodeJS.Platform, homeDir: string, appDataDir: string): string[] {
    if (platform === 'win32') return [path.join(appDataDir, 'Claude', 'claude_desktop_config.json')];
    if (platform === 'darwin') return [path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')];
    return [path.join(homeDir, '.config', 'Claude', 'claude_desktop_config.json')];
}

function antigravityMcpConfigPaths(platform: NodeJS.Platform, homeDir: string, appDataDir: string): string[] {
    const homeCandidates = [
        path.join(homeDir, '.gemini', 'mcp.json'),
        path.join(homeDir, '.antigravity', 'mcp.json')
    ];
    if (platform === 'win32') {
        return [path.join(appDataDir, 'Antigravity', 'User', 'mcp.json'), ...homeCandidates];
    }
    if (platform === 'darwin') {
        return [path.join(homeDir, 'Library', 'Application Support', 'Antigravity', 'User', 'mcp.json'), ...homeCandidates];
    }
    return [path.join(homeDir, '.config', 'Antigravity', 'User', 'mcp.json'), ...homeCandidates];
}

function hasMcpRegistration(candidatePaths: string[], serverName: string): boolean {
    return candidatePaths.some((candidate) => {
        if (!exists(candidate)) return false;
        try {
            const raw = fs.readFileSync(candidate, 'utf8').trim();
            if (!raw) return false;
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
            const servers = parsed.mcpServers;
            if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return false;
            const registration = (servers as Record<string, unknown>)[serverName];
            return Boolean(registration && typeof registration === 'object' && !Array.isArray(registration));
        } catch {
            return false;
        }
    });
}

export function detectInstalledGaHookAgents(): GaHookAgent[] {
    const platform = process.platform;
    const homeDir = os.homedir();
    const appDataDir = resolveAppData(homeDir);
    const agents: GaHookAgent[] = [];

    if (claudeSignals(platform, homeDir, appDataDir).some(exists)) agents.push('claude');
    if (factorySignals(homeDir).some(exists)) agents.push('factory');
    if (antigravitySignals(platform, homeDir, appDataDir).some(exists)) agents.push('antigravity');

    return agents;
}

export function detectRegisteredGaMcpClients(serverName = '0ctx'): GaMcpClient[] {
    const platform = process.platform;
    const homeDir = os.homedir();
    const appDataDir = resolveAppData(homeDir);
    const clients: GaMcpClient[] = [];

    if (hasMcpRegistration(claudeMcpConfigPaths(platform, homeDir, appDataDir), serverName)) clients.push('claude');
    if (hasMcpRegistration(antigravityMcpConfigPaths(platform, homeDir, appDataDir), serverName)) clients.push('antigravity');

    return clients;
}

export function resolveExpectedGaCaptureAgents(captureReadyAgents: string[]): GaHookAgent[] {
    const detected = detectInstalledGaHookAgents();
    if (detected.length > 0) return [...new Set(detected)];

    const configured = captureReadyAgents
        .map((value) => String(value || '').trim().toLowerCase())
        .filter((value): value is GaHookAgent => value === 'claude' || value === 'factory' || value === 'antigravity');
    if (configured.length > 0) return [...new Set(configured)];

    return [...DEFAULT_GA_HOOK_AGENTS];
}
