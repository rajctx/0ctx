import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveMcpToolProfile } from './tools';
import {
    applyBootstrapRegistration,
    getCandidatePaths,
    pickWritablePath,
    type BootstrapRegistration,
    type BootstrapSupportedClient
} from './bootstrap-config';

type SupportedClient = BootstrapSupportedClient;
const SUPPORTED_CLIENTS: SupportedClient[] = ['claude', 'cursor', 'windsurf', 'codex', 'antigravity'];
const DEFAULT_CLIENTS: SupportedClient[] = ['claude', 'antigravity'];

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

export function parseBootstrapClients(raw: string | undefined): SupportedClient[] {
    const source = (raw || 'ga').trim().toLowerCase();
    if (!source || source === 'ga') return DEFAULT_CLIENTS;

    const parsed = source
        .split(/[,\s]+/)
        .map(item => item.trim())
        .filter((item): item is SupportedClient => SUPPORTED_CLIENTS.includes(item as SupportedClient));

    return parsed.length === 0 ? DEFAULT_CLIENTS : parsed;
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

export function bootstrapMcpRegistration(options: BootstrapOptions): BootstrapResult[] {
    const platform = getPlatform(options);
    const homeDir = getHomeDir(options);
    const appDataDir = getAppDataDir(homeDir, options);
    const serverName = options.serverName || '0ctx';
    const entrypoint = resolveEntrypoint(options.entrypoint);
    const profile = resolveMcpToolProfile(options.profile ?? 'core');

    const registration: BootstrapRegistration = {
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
            const status = applyBootstrapRegistration({
                targetPath,
                client,
                serverName,
                registration,
                dryRun: options.dryRun
            });
            results.push({
                client,
                configPath: targetPath,
                status
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
    const clients = parseBootstrapClients(parseArgValue('--clients') || parseArgValue('--client'));
    const serverName = parseArgValue('--server-name') || '0ctx';
    const entrypoint = parseArgValue('--entrypoint');
    const profile = parseArgValue('--profile') || parseArgValue('--mcp-profile') || 'core';

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
