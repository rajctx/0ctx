#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { bootstrapMcpRegistration } from '@0ctx/mcp/dist/bootstrap';
import { sendToDaemon } from '@0ctx/mcp/dist/client';

type SupportedClient = 'claude' | 'cursor' | 'windsurf';
type CheckStatus = 'pass' | 'warn' | 'fail';

interface DoctorCheck {
    id: string;
    status: CheckStatus;
    message: string;
    details?: Record<string, unknown>;
}

interface ParsedArgs {
    command: string;
    subcommand?: string;
    flags: Record<string, string | boolean>;
}

const DB_PATH = process.env.CTX_DB_PATH || path.join(os.homedir(), '.0ctx', '0ctx.db');
const KEY_PATH = path.join(os.homedir(), '.0ctx', 'master.key');
const SOCKET_PATH = os.platform() === 'win32'
    ? '\\\\.\\pipe\\0ctx.sock'
    : path.join(os.homedir(), '.0ctx', '0ctx.sock');

const SUPPORTED_CLIENTS: SupportedClient[] = ['claude', 'cursor', 'windsurf'];

function parseArgs(argv: string[]): ParsedArgs {
    const [command = 'help', maybeSubcommand, ...rest] = argv;
    const flags: Record<string, string | boolean> = {};

    for (let i = 0; i < rest.length; i += 1) {
        const token = rest[i];
        if (!token.startsWith('--')) continue;

        const [rawKey, rawValue] = token.split('=');
        const key = rawKey.slice(2);

        if (rawValue !== undefined) {
            flags[key] = rawValue;
            continue;
        }

        const next = rest[i + 1];
        if (next && !next.startsWith('--')) {
            flags[key] = next;
            i += 1;
            continue;
        }

        flags[key] = true;
    }

    const hasSubcommand = command === 'daemon';
    return {
        command,
        subcommand: hasSubcommand ? maybeSubcommand : undefined,
        flags
    };
}

function parseClients(raw: string | boolean | undefined): SupportedClient[] {
    if (!raw || typeof raw !== 'string') return SUPPORTED_CLIENTS;
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'all') return SUPPORTED_CLIENTS;

    const parsed = normalized
        .split(',')
        .map(item => item.trim())
        .filter((item): item is SupportedClient => SUPPORTED_CLIENTS.includes(item as SupportedClient));

    return parsed.length > 0 ? parsed : SUPPORTED_CLIENTS;
}

async function isDaemonReachable(): Promise<{ ok: boolean; error?: string; health?: any }> {
    try {
        const health = await sendToDaemon('health', {});
        return { ok: true, health };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

function resolveDaemonEntrypoint(): string {
    const candidates = [
        path.resolve(process.cwd(), 'packages', 'daemon', 'dist', 'index.js'),
        path.resolve(__dirname, '..', '..', 'daemon', 'dist', 'index.js'),
        (() => {
            try {
                return require.resolve('@0ctx/daemon/dist/index.js');
            } catch {
                return '';
            }
        })()
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }

    throw new Error('Could not resolve daemon entrypoint. Run `npm run build` first.');
}

function startDaemonDetached(): void {
    const entry = resolveDaemonEntrypoint();
    const child = spawn(process.execPath, [entry], {
        detached: true,
        stdio: 'ignore'
    });
    child.unref();
}

async function waitForDaemon(timeoutMs = 10000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const status = await isDaemonReachable();
        if (status.ok) return true;
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    return false;
}

function runBootstrap(clients: SupportedClient[], dryRun: boolean): ReturnType<typeof bootstrapMcpRegistration> {
    return bootstrapMcpRegistration({
        clients,
        dryRun,
        serverName: '0ctx'
    });
}

function printBootstrapResults(results: ReturnType<typeof bootstrapMcpRegistration>, dryRun: boolean): void {
    const mode = dryRun ? 'DRY RUN' : 'APPLIED';
    console.log(`\nMCP bootstrap (${mode})`);
    for (const result of results) {
        const suffix = result.message ? ` - ${result.message}` : '';
        console.log(`- ${result.client}: ${result.status} (${result.configPath})${suffix}`);
    }
}

async function commandStatus(): Promise<number> {
    const daemon = await isDaemonReachable();
    console.log(`daemon: ${daemon.ok ? 'running' : 'not running'}`);
    console.log(`socket: ${SOCKET_PATH}`);
    console.log(`db: ${DB_PATH}`);
    console.log(`master_key: ${fs.existsSync(KEY_PATH) || Boolean(process.env.CTX_MASTER_KEY) ? 'present' : 'missing'}`);

    if (!daemon.ok) {
        if (daemon.error) console.log(`daemon_error: ${daemon.error}`);
        return 1;
    }

    try {
        const capabilities = await sendToDaemon('getCapabilities', {});
        const methods = Array.isArray(capabilities?.methods) ? capabilities.methods.length : 0;
        console.log(`api_version: ${capabilities?.apiVersion ?? 'unknown'}`);
        console.log(`methods: ${methods}`);
    } catch (error) {
        console.log(`capabilities_error: ${error instanceof Error ? error.message : String(error)}`);
    }

    return 0;
}

async function commandBootstrap(flags: Record<string, string | boolean>): Promise<number> {
    const clients = parseClients(flags.clients);
    const dryRun = Boolean(flags['dry-run']);
    const results = runBootstrap(clients, dryRun);
    printBootstrapResults(results, dryRun);
    return results.some(result => result.status === 'failed') ? 1 : 0;
}

async function commandInstall(flags: Record<string, string | boolean>): Promise<number> {
    console.log('Running install workflow...');
    const daemonStatus = await isDaemonReachable();

    if (!daemonStatus.ok) {
        console.log('daemon: starting background service...');
        try {
            startDaemonDetached();
        } catch (error) {
            console.error(`failed_to_start_daemon: ${error instanceof Error ? error.message : String(error)}`);
            return 1;
        }
    }

    const ready = await waitForDaemon();
    if (!ready) {
        console.error('daemon_start_timeout: unable to reach daemon health endpoint');
        return 1;
    }

    const bootstrapCode = await commandBootstrap(flags);
    if (bootstrapCode !== 0) return bootstrapCode;

    return commandStatus();
}

async function commandDoctor(flags: Record<string, string | boolean>): Promise<number> {
    const checks: DoctorCheck[] = [];
    const daemon = await isDaemonReachable();

    checks.push({
        id: 'daemon_reachable',
        status: daemon.ok ? 'pass' : 'fail',
        message: daemon.ok ? 'Daemon health check succeeded.' : 'Daemon is not reachable.',
        details: daemon.ok ? daemon.health : { error: daemon.error }
    });

    checks.push({
        id: 'db_path',
        status: fs.existsSync(DB_PATH) ? 'pass' : 'warn',
        message: fs.existsSync(DB_PATH) ? 'Database file exists.' : 'Database file not found yet (may be created on first run).',
        details: { path: DB_PATH }
    });

    const hasKey = Boolean(process.env.CTX_MASTER_KEY) || fs.existsSync(KEY_PATH);
    checks.push({
        id: 'encryption_key',
        status: hasKey ? 'pass' : 'warn',
        message: hasKey ? 'Encryption key available.' : 'Encryption key file/env not found yet.',
        details: { env: Boolean(process.env.CTX_MASTER_KEY), file: KEY_PATH }
    });

    const dryRunResults = runBootstrap(parseClients(flags.clients), true);
    const failedBootstrap = dryRunResults.some(result => result.status === 'failed');
    checks.push({
        id: 'bootstrap_dry_run',
        status: failedBootstrap ? 'fail' : 'pass',
        message: failedBootstrap ? 'Bootstrap dry run found failures.' : 'Bootstrap dry run succeeded (or skipped unsupported clients).',
        details: { results: dryRunResults }
    });

    const asJson = Boolean(flags.json);
    if (asJson) {
        console.log(JSON.stringify({ checks }, null, 2));
    } else {
        console.log('\n0ctx doctor');
        for (const check of checks) {
            console.log(`- ${check.id}: ${check.status} - ${check.message}`);
        }
    }

    return checks.some(check => check.status === 'fail') ? 1 : 0;
}

async function commandRepair(flags: Record<string, string | boolean>): Promise<number> {
    console.log('Running repair workflow...');

    const daemon = await isDaemonReachable();
    if (!daemon.ok) {
        try {
            startDaemonDetached();
        } catch (error) {
            console.error(`repair_failed_to_start_daemon: ${error instanceof Error ? error.message : String(error)}`);
            return 1;
        }
    }

    const ready = await waitForDaemon();
    if (!ready) {
        console.error('repair_daemon_start_timeout');
        return 1;
    }

    const bootstrapCode = await commandBootstrap(flags);
    if (bootstrapCode !== 0) return bootstrapCode;

    return commandDoctor({ ...flags, json: false });
}

function printHelp(): void {
    console.log(`0ctx CLI

Usage:
  0ctx install [--clients=all|claude,cursor,windsurf]
  0ctx bootstrap [--dry-run] [--clients=...]
  0ctx doctor [--json] [--clients=...]
  0ctx status
  0ctx repair [--clients=...]
  0ctx daemon start
`);
}

async function main(): Promise<number> {
    const parsed = parseArgs(process.argv.slice(2));

    switch (parsed.command) {
        case 'install':
            return commandInstall(parsed.flags);
        case 'bootstrap':
            return commandBootstrap(parsed.flags);
        case 'doctor':
            return commandDoctor(parsed.flags);
        case 'status':
            return commandStatus();
        case 'repair':
            return commandRepair(parsed.flags);
        case 'daemon':
            if (parsed.subcommand === 'start') {
                try {
                    startDaemonDetached();
                } catch (error) {
                    console.error(error instanceof Error ? error.message : String(error));
                    return 1;
                }
                const ok = await waitForDaemon();
                console.log(ok ? 'daemon started' : 'daemon start timeout');
                return ok ? 0 : 1;
            }
            printHelp();
            return 1;
        case 'help':
        default:
            printHelp();
            return 0;
    }
}

main()
    .then(code => {
        process.exitCode = code;
    })
    .catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
