import fs from 'fs';
import path from 'path';

export type BootstrapSupportedClient = 'claude' | 'cursor' | 'windsurf' | 'codex' | 'antigravity';

export interface BootstrapRegistration {
    command: string;
    args: string[];
}

export type BootstrapRegistrationStatus = 'updated' | 'created' | 'unchanged';

export function getCandidatePaths(
    client: BootstrapSupportedClient,
    platform: NodeJS.Platform,
    homeDir: string,
    appDataDir: string
): string[] {
    switch (client) {
        case 'claude':
            if (platform === 'win32') return [path.join(appDataDir, 'Claude', 'claude_desktop_config.json')];
            if (platform === 'darwin') return [path.join(homeDir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')];
            return [path.join(homeDir, '.config', 'Claude', 'claude_desktop_config.json')];

        case 'cursor':
            if (platform === 'win32') return [
                path.join(homeDir, '.cursor', 'mcp.json'),
                path.join(appDataDir, 'Cursor', 'User', 'mcp.json')
            ];
            if (platform === 'darwin') return [
                path.join(homeDir, '.cursor', 'mcp.json'),
                path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'mcp.json')
            ];
            return [
                path.join(homeDir, '.cursor', 'mcp.json'),
                path.join(homeDir, '.config', 'Cursor', 'User', 'mcp.json')
            ];

        case 'windsurf':
            if (platform === 'win32') return [
                path.join(homeDir, '.codeium', 'windsurf', 'mcp_config.json'),
                path.join(homeDir, '.codeium', 'mcp_config.json'),
                path.join(appDataDir, 'Windsurf', 'User', 'mcp.json'),
                path.join(homeDir, '.windsurf', 'mcp.json')
            ];
            if (platform === 'darwin') return [
                path.join(homeDir, '.codeium', 'windsurf', 'mcp_config.json'),
                path.join(homeDir, '.codeium', 'mcp_config.json'),
                path.join(homeDir, 'Library', 'Application Support', 'Windsurf', 'User', 'mcp.json'),
                path.join(homeDir, '.windsurf', 'mcp.json')
            ];
            return [
                path.join(homeDir, '.codeium', 'windsurf', 'mcp_config.json'),
                path.join(homeDir, '.codeium', 'mcp_config.json'),
                path.join(homeDir, '.config', 'Windsurf', 'User', 'mcp.json'),
                path.join(homeDir, '.windsurf', 'mcp.json')
            ];

        case 'antigravity': {
            const homeCandidates = [
                path.join(homeDir, '.gemini', 'mcp.json'),
                path.join(homeDir, '.antigravity', 'mcp.json')
            ];
            if (platform === 'win32') {
                return [path.join(appDataDir, 'Antigravity', 'User', 'mcp.json'), ...homeCandidates];
            }
            if (platform === 'darwin') {
                return [
                    path.join(homeDir, 'Library', 'Application Support', 'Antigravity', 'User', 'mcp.json'),
                    ...homeCandidates
                ];
            }
            return [
                path.join(homeDir, '.config', 'Antigravity', 'User', 'mcp.json'),
                ...homeCandidates
            ];
        }

        case 'codex':
            return [path.join(homeDir, '.codex', 'config.toml')];
    }
}

export function pickWritablePath(candidates: string[]): string | null {
    const existing = candidates.find(candidate => fs.existsSync(candidate));
    if (existing) return existing;

    const parentExists = candidates.find(candidate => fs.existsSync(path.dirname(candidate)));
    return parentExists || null;
}

export function applyBootstrapRegistration(options: {
    targetPath: string;
    client: BootstrapSupportedClient;
    serverName: string;
    registration: BootstrapRegistration;
    dryRun?: boolean;
}): BootstrapRegistrationStatus {
    const existedBefore = fs.existsSync(options.targetPath);
    if (options.client === 'codex') {
        const changedResult = upsertCodexServerConfig(readText(options.targetPath), options.serverName, options.registration);
        if (!changedResult.changed) return 'unchanged';
        if (!options.dryRun) {
            writeText(options.targetPath, changedResult.nextConfig);
        }
        return existedBefore ? 'updated' : 'created';
    }

    const changedResult = upsertServerConfig(readJson(options.targetPath), options.serverName, options.registration);
    if (!changedResult.changed) return 'unchanged';
    if (!options.dryRun) {
        writeJson(options.targetPath, changedResult.nextConfig);
    }
    return existedBefore ? 'updated' : 'created';
}

function readJson(pathName: string): Record<string, unknown> {
    if (!fs.existsSync(pathName)) return {};

    const raw = fs.readFileSync(pathName, 'utf8').trim();
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
    }

    return parsed as Record<string, unknown>;
}

function writeJson(pathName: string, value: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(pathName), { recursive: true });
    fs.writeFileSync(pathName, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function readText(pathName: string): string {
    if (!fs.existsSync(pathName)) return '';
    return fs.readFileSync(pathName, 'utf8');
}

function writeText(pathName: string, value: string): void {
    fs.mkdirSync(path.dirname(pathName), { recursive: true });
    fs.writeFileSync(pathName, value, 'utf8');
}

function upsertServerConfig(
    config: Record<string, unknown>,
    serverName: string,
    registration: BootstrapRegistration
): { changed: boolean; nextConfig: Record<string, unknown> } {
    const nextConfig: Record<string, unknown> = { ...config };

    const rawServers = nextConfig.mcpServers;
    const servers: Record<string, unknown> = rawServers && typeof rawServers === 'object' && !Array.isArray(rawServers)
        ? { ...(rawServers as Record<string, unknown>) }
        : {};

    const previous = servers[serverName];
    const next = { command: registration.command, args: registration.args };
    const changed = JSON.stringify(previous) !== JSON.stringify(next);

    servers[serverName] = next;
    nextConfig.mcpServers = servers;

    return { changed, nextConfig };
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function quoteTomlString(value: string): string {
    return JSON.stringify(value);
}

function formatTomlKeySegment(value: string): string {
    return /^[A-Za-z0-9_-]+$/.test(value) ? value : quoteTomlString(value);
}

function buildCodexServerBlock(serverName: string, registration: BootstrapRegistration, newline: string): string {
    return [
        `[mcp_servers.${formatTomlKeySegment(serverName)}]`,
        `command = ${quoteTomlString(registration.command)}`,
        `args = [${registration.args.map(arg => quoteTomlString(arg)).join(', ')}]`
    ].join(newline);
}

function upsertCodexServerConfig(
    rawConfig: string,
    serverName: string,
    registration: BootstrapRegistration
): { changed: boolean; nextConfig: string } {
    const newline = rawConfig.includes('\r\n') ? '\r\n' : '\n';
    const lines = rawConfig.length > 0 ? rawConfig.split(/\r?\n/) : [];
    const escapedServerName = escapeRegExp(serverName);
    const serverSectionPattern = new RegExp(
        `^\\s*\\[\\s*mcp_servers\\.(?:${escapedServerName}|\"${escapedServerName}\")\\s*\\]\\s*$`
    );
    const tablePattern = /^\s*\[[^\]]+\]\s*$/;
    const blockLines = buildCodexServerBlock(serverName, registration, newline).split(newline);
    let start = -1;

    for (let idx = 0; idx < lines.length; idx += 1) {
        if (serverSectionPattern.test(lines[idx])) {
            start = idx;
            break;
        }
    }

    let nextLines: string[];
    if (start === -1) {
        nextLines = [...lines];
        while (nextLines.length > 0 && nextLines[nextLines.length - 1].trim() === '') {
            nextLines.pop();
        }
        if (nextLines.length > 0) {
            nextLines.push('');
        }
        nextLines.push(...blockLines);
    } else {
        let end = lines.length;
        for (let idx = start + 1; idx < lines.length; idx += 1) {
            if (tablePattern.test(lines[idx])) {
                end = idx;
                break;
            }
        }
        nextLines = [...lines.slice(0, start), ...blockLines, ...lines.slice(end)];
    }

    const nextConfig = nextLines.join(newline).replace(new RegExp(`${newline}*$`), '') + newline;
    return { changed: nextConfig !== rawConfig, nextConfig };
}
