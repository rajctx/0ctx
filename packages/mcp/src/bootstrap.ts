import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveMcpToolProfile } from './tools';

type SupportedClient = 'claude' | 'cursor' | 'windsurf' | 'codex' | 'antigravity';
const SUPPORTED_CLIENTS: SupportedClient[] = ['claude', 'cursor', 'windsurf', 'codex', 'antigravity'];

interface Registration {
    command: string;
    args: string[];
}

interface BootstrapOptions {
    clients: SupportedClient[];
    dryRun?: boolean;
    entrypoint?: string;
    serverName?: string;
    profile?: string;
    platform?: NodeJS.Platform;
    homeDir?: string;
    appDataDir?: string;
}

interface BootstrapResult {
    client: SupportedClient;
    configPath: string;
    status: 'updated' | 'created' | 'unchanged' | 'skipped' | 'failed';
    message?: string;
}

function parseClients(raw: string | undefined): SupportedClient[] {
    const source = (raw || SUPPORTED_CLIENTS.join(',')).trim().toLowerCase();
    if (source === 'all') return SUPPORTED_CLIENTS;

    const parsed = source
        .split(/[,\s]+/)
        .map(item => item.trim())
        .filter((item): item is SupportedClient => SUPPORTED_CLIENTS.includes(item as SupportedClient));

    return parsed.length === 0 ? SUPPORTED_CLIENTS : parsed;
}

function getPlatform(options?: Pick<BootstrapOptions, 'platform'>): NodeJS.Platform {
    return options?.platform || process.platform;
}

function getHomeDir(options?: Pick<BootstrapOptions, 'homeDir'>): string {
    return options?.homeDir || os.homedir();
}

function getAppDataDir(homeDir: string, options?: Pick<BootstrapOptions, 'appDataDir'>): string {
    return options?.appDataDir || process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
}

function isMcpRuntimeDir(dirPath: string): boolean {
    const normalized = dirPath.replace(/\\/g, '/').toLowerCase();
    return normalized.includes('/packages/mcp/dist')
        || normalized.includes('/@0ctx/mcp/dist')
        || normalized.endsWith('/mcp/dist');
}

function resolveEntrypoint(customEntrypoint?: string): string {
    if (customEntrypoint) {
        const resolved = path.resolve(customEntrypoint);
        if (fs.existsSync(resolved)) return resolved;
        throw new Error(`Configured MCP entrypoint does not exist: ${resolved}`);
    }

    const candidates = [
        path.resolve(process.cwd(), 'packages', 'mcp', 'dist', 'index.js'),
        path.resolve(process.cwd(), 'dist', 'index.js'),
        ...(isMcpRuntimeDir(__dirname) ? [path.resolve(__dirname, 'index.js')] : [])
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    throw new Error('Could not resolve MCP entrypoint. Run `npm run build` or pass --entrypoint=/absolute/path/to/index.js.');
}

function getCandidatePaths(
    client: SupportedClient,
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
                path.join(appDataDir, 'Cursor', 'User', 'mcp.json'),
                path.join(homeDir, '.cursor', 'mcp.json')
            ];
            if (platform === 'darwin') return [
                path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'mcp.json'),
                path.join(homeDir, '.cursor', 'mcp.json')
            ];
            return [
                path.join(homeDir, '.config', 'Cursor', 'User', 'mcp.json'),
                path.join(homeDir, '.cursor', 'mcp.json')
            ];

        case 'windsurf':
            if (platform === 'win32') return [
                path.join(appDataDir, 'Windsurf', 'User', 'mcp.json'),
                path.join(homeDir, '.windsurf', 'mcp.json')
            ];
            if (platform === 'darwin') return [
                path.join(homeDir, 'Library', 'Application Support', 'Windsurf', 'User', 'mcp.json'),
                path.join(homeDir, '.windsurf', 'mcp.json')
            ];
            return [
                path.join(homeDir, '.config', 'Windsurf', 'User', 'mcp.json'),
                path.join(homeDir, '.windsurf', 'mcp.json')
            ];

        case 'antigravity':
            if (platform === 'win32') return [
                path.join(appDataDir, 'Antigravity', 'User', 'mcp.json'),
                path.join(homeDir, '.antigravity', 'mcp.json')
            ];
            if (platform === 'darwin') return [
                path.join(homeDir, 'Library', 'Application Support', 'Antigravity', 'User', 'mcp.json'),
                path.join(homeDir, '.antigravity', 'mcp.json')
            ];
            return [
                path.join(homeDir, '.config', 'Antigravity', 'User', 'mcp.json'),
                path.join(homeDir, '.antigravity', 'mcp.json')
            ];

        case 'codex':
            return [path.join(homeDir, '.codex', 'config.toml')];
    }
}

function pickWritablePath(candidates: string[]): string | null {
    const existing = candidates.find(candidate => fs.existsSync(candidate));
    if (existing) return existing;

    const parentExists = candidates.find(candidate => fs.existsSync(path.dirname(candidate)));
    return parentExists || null;
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
    registration: Registration
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

function buildCodexServerBlock(serverName: string, registration: Registration, newline: string): string {
    return [
        `[mcp_servers.${formatTomlKeySegment(serverName)}]`,
        `command = ${quoteTomlString(registration.command)}`,
        `args = [${registration.args.map(arg => quoteTomlString(arg)).join(', ')}]`
    ].join(newline);
}

function upsertCodexServerConfig(
    rawConfig: string,
    serverName: string,
    registration: Registration
): { changed: boolean; nextConfig: string } {
    const newline = rawConfig.includes('\r\n') ? '\r\n' : '\n';
    const lines = rawConfig.length > 0 ? rawConfig.split(/\r?\n/) : [];
    const escapedServerName = escapeRegExp(serverName);
    const serverSectionPattern = new RegExp(
        `^\\s*\\[\\s*mcp_servers\\.(?:${escapedServerName}|"${escapedServerName}")\\s*\\]\\s*$`
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

export function bootstrapMcpRegistration(options: BootstrapOptions): BootstrapResult[] {
    const platform = getPlatform(options);
    const homeDir = getHomeDir(options);
    const appDataDir = getAppDataDir(homeDir, options);
    const serverName = options.serverName || '0ctx';
    const entrypoint = resolveEntrypoint(options.entrypoint);
    const profile = resolveMcpToolProfile(options.profile);

    const registration: Registration = {
        command: process.execPath,
        args: profile.all ? [entrypoint] : [entrypoint, '--profile', profile.normalized]
    };

    const results: BootstrapResult[] = [];

    for (const client of options.clients) {
        const candidates = getCandidatePaths(client, platform, homeDir, appDataDir);
        const targetPath = pickWritablePath(candidates);

        if (!targetPath) {
            results.push({
                client,
                configPath: candidates[0],
                status: 'skipped',
                message: 'No known client config directory detected.'
            });
            continue;
        }

        try {
            const existedBefore = fs.existsSync(targetPath);
            const isCodexClient = client === 'codex';
            if (isCodexClient) {
                const changedResult = upsertCodexServerConfig(readText(targetPath), serverName, registration);

                if (!changedResult.changed) {
                    results.push({ client, configPath: targetPath, status: 'unchanged' });
                    continue;
                }

                if (!options.dryRun) {
                    writeText(targetPath, changedResult.nextConfig);
                }
            } else {
                const changedResult = upsertServerConfig(readJson(targetPath), serverName, registration);

                if (!changedResult.changed) {
                    results.push({ client, configPath: targetPath, status: 'unchanged' });
                    continue;
                }

                if (!options.dryRun) {
                    writeJson(targetPath, changedResult.nextConfig);
                }
            }

            results.push({
                client,
                configPath: targetPath,
                status: existedBefore ? 'updated' : 'created'
            });
        } catch (error) {
            results.push({
                client,
                configPath: targetPath,
                status: 'failed',
                message: error instanceof Error ? error.message : String(error)
            });
        }
    }

    return results;
}

function parseArgValue(flag: string): string | undefined {
    const direct = process.argv.find(arg => arg.startsWith(`${flag}=`));
    if (direct) return direct.slice(flag.length + 1);

    const index = process.argv.findIndex(arg => arg === flag);
    if (index !== -1 && process.argv[index + 1]) {
        return process.argv[index + 1];
    }

    return undefined;
}

function hasFlag(flag: string): boolean {
    return process.argv.includes(flag) || process.argv.some(arg => arg.startsWith(`${flag}=`));
}

function printSummary(results: BootstrapResult[], dryRun: boolean): void {
    const mode = dryRun ? 'DRY RUN' : 'APPLIED';
    console.log(`\n0ctx MCP bootstrap (${mode})`);
    for (const result of results) {
        const suffix = result.message ? ` - ${result.message}` : '';
        console.log(`- ${result.client}: ${result.status} (${result.configPath})${suffix}`);
    }
}

export function runBootstrapFromCli(): number {
    const dryRun = hasFlag('--dry-run');
    const clients = parseClients(parseArgValue('--clients') || parseArgValue('--client'));
    const serverName = parseArgValue('--server-name') || '0ctx';
    const entrypoint = parseArgValue('--entrypoint');
    const profile = parseArgValue('--profile') || parseArgValue('--mcp-profile') || undefined;

    const results = bootstrapMcpRegistration({
        clients,
        dryRun,
        serverName,
        entrypoint,
        profile
    });

    printSummary(results, dryRun);

    const failed = results.some(result => result.status === 'failed');
    return failed ? 1 : 0;
}

// NOTE: Do NOT add a `require.main === module` auto-run block here.
// When esbuild bundles this ESM file into the CLI's CJS bundle, the bundled
// module's `module` object IS `require.main`, so the guard evaluates to true
// on every CLI invocation — causing the bootstrap to run before every command.
// Call runBootstrapFromCli() explicitly from the CLI entry point if needed.
