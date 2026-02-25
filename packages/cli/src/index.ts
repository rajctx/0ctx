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

    const hasSubcommand = command === 'daemon' || command === 'auth' || command === 'sync';
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

    try {
        const authState = await sendToDaemon('authStatus', {});
        console.log(`auth: ${authState?.authenticated ? 'authenticated' : 'not authenticated'}`);
        if (authState?.userId) console.log(`user_id: ${authState.userId}`);
        if (authState?.tenantId) console.log(`tenant_id: ${authState.tenantId}`);
    } catch (error) {
        console.log(`auth_error: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
        const syncState = await sendToDaemon('syncStatus', {});
        console.log(`sync: ${syncState?.enabled ? 'enabled' : 'disabled'}`);
        console.log(`sync_pending: ${syncState?.pendingItems ?? 0}`);
        console.log(`sync_failed: ${syncState?.failedItems ?? 0}`);
        if (syncState?.lastSyncAt) console.log(`last_sync: ${new Date(syncState.lastSyncAt).toISOString()}`);
    } catch (error) {
        console.log(`sync_error: ${error instanceof Error ? error.message : String(error)}`);
    }

    return 0;
}

// ── Auth commands ───────────────────────────────────────────────

async function commandAuthLogin(flags: Record<string, string | boolean>): Promise<number> {
    const daemon = await isDaemonReachable();
    if (!daemon.ok) {
        console.error('Daemon is not running. Start it first with `0ctx daemon start`.');
        return 1;
    }

    const tenantUrl = typeof flags['tenant-url'] === 'string' ? flags['tenant-url'] : (typeof flags.tenant === 'string' ? flags.tenant : null);
    if (!tenantUrl) {
        console.error('Missing required --tenant-url flag.');
        return 1;
    }

    try {
        const loginInit = await sendToDaemon('authLogin', { tenantUrl });
        console.log('\nDevice code authentication initiated.');
        console.log(`Open: ${loginInit.verificationUri}`);
        console.log(`Enter code: ${loginInit.userCode}`);
        console.log('\nPolling for completion...');

        // Poll for login completion
        const maxPolls = Math.ceil(loginInit.expiresIn / loginInit.interval);
        for (let i = 0; i < maxPolls; i += 1) {
            await new Promise(resolve => setTimeout(resolve, loginInit.interval * 1000));
            const pollResult = await sendToDaemon('authPollLogin', { deviceCode: loginInit.deviceCode });

            if (pollResult.status === 'complete') {
                console.log(`\nAuthenticated successfully!`);
                console.log(`user_id: ${pollResult.userId}`);
                console.log(`tenant_id: ${pollResult.tenantId}`);
                return 0;
            }

            if (pollResult.status === 'expired') {
                console.error('Login expired. Try again.');
                return 1;
            }

            // Still pending, continue polling
        }

        console.error('Login timed out.');
        return 1;
    } catch (error) {
        console.error(`Auth login failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

async function commandAuthLogout(): Promise<number> {
    const daemon = await isDaemonReachable();
    if (!daemon.ok) {
        console.error('Daemon is not running.');
        return 1;
    }

    try {
        await sendToDaemon('authLogout', {});
        console.log('Logged out successfully.');
        return 0;
    } catch (error) {
        console.error(`Auth logout failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

async function commandAuthStatus(): Promise<number> {
    const daemon = await isDaemonReachable();
    if (!daemon.ok) {
        console.error('Daemon is not running.');
        return 1;
    }

    try {
        const authState = await sendToDaemon('authStatus', {});
        console.log(`authenticated: ${authState.authenticated}`);
        console.log(`user_id: ${authState.userId ?? 'none'}`);
        console.log(`tenant_id: ${authState.tenantId ?? 'none'}`);
        console.log(`tenant_url: ${authState.tenantUrl ?? 'none'}`);
        console.log(`device_id: ${authState.deviceId ?? 'none'}`);
        if (authState.tokenExpiresAt) {
            console.log(`token_expires: ${new Date(authState.tokenExpiresAt).toISOString()}`);
        }
        return 0;
    } catch (error) {
        console.error(`Auth status failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

// ── Sync commands ───────────────────────────────────────────────

async function commandSyncStatus(): Promise<number> {
    const daemon = await isDaemonReachable();
    if (!daemon.ok) {
        console.error('Daemon is not running.');
        return 1;
    }

    try {
        const syncState = await sendToDaemon('syncStatus', {});
        console.log(`enabled: ${syncState.enabled}`);
        console.log(`authenticated: ${syncState.authenticated}`);
        console.log(`pending_items: ${syncState.pendingItems}`);
        console.log(`failed_items: ${syncState.failedItems}`);
        console.log(`last_sync: ${syncState.lastSyncAt ? new Date(syncState.lastSyncAt).toISOString() : 'never'}`);
        console.log(`last_error: ${syncState.lastError ?? 'none'}`);
        return 0;
    } catch (error) {
        console.error(`Sync status failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

async function commandSyncTrigger(): Promise<number> {
    const daemon = await isDaemonReachable();
    if (!daemon.ok) {
        console.error('Daemon is not running.');
        return 1;
    }

    try {
        console.log('Triggering full sync...');
        const result = await sendToDaemon('syncTrigger', {});
        if (result.ok) {
            console.log(`Full sync complete. Contexts synced: ${result.contextsSynced}`);
            return 0;
        }
        console.error(`Sync failed: ${result.error ?? 'unknown error'}`);
        return 1;
    } catch (error) {
        console.error(`Sync trigger failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
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

    // Auth check
    if (daemon.ok) {
        try {
            const authState = await sendToDaemon('authStatus', {});
            checks.push({
                id: 'auth_state',
                status: authState?.authenticated ? 'pass' : 'warn',
                message: authState?.authenticated
                    ? `Authenticated as ${authState.userId}.`
                    : 'Not authenticated. Run `0ctx auth login --tenant-url=<url>` to connect.',
                details: { authenticated: authState?.authenticated, userId: authState?.userId, tenantId: authState?.tenantId }
            });
        } catch (error) {
            checks.push({
                id: 'auth_state',
                status: 'warn',
                message: `Could not check auth state: ${error instanceof Error ? error.message : String(error)}`
            });
        }

        // Sync check
        try {
            const syncState = await sendToDaemon('syncStatus', {});
            const syncOk = syncState?.enabled && syncState?.failedItems === 0;
            checks.push({
                id: 'sync_state',
                status: syncOk ? 'pass' : (syncState?.failedItems > 0 ? 'fail' : 'warn'),
                message: syncOk
                    ? `Sync enabled. ${syncState.pendingItems} pending items.`
                    : syncState?.failedItems > 0
                        ? `Sync has ${syncState.failedItems} failed items.`
                        : 'Sync not fully active.',
                details: { ...syncState }
            });
        } catch (error) {
            checks.push({
                id: 'sync_state',
                status: 'warn',
                message: `Could not check sync state: ${error instanceof Error ? error.message : String(error)}`
            });
        }
    }

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

  0ctx auth login --tenant-url=<url>
  0ctx auth logout
  0ctx auth status

  0ctx sync status
  0ctx sync trigger
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
        case 'auth':
            switch (parsed.subcommand) {
                case 'login':
                    return commandAuthLogin(parsed.flags);
                case 'logout':
                    return commandAuthLogout();
                case 'status':
                    return commandAuthStatus();
                default:
                    printHelp();
                    return 1;
            }
        case 'sync':
            switch (parsed.subcommand) {
                case 'status':
                    return commandSyncStatus();
                case 'trigger':
                    return commandSyncTrigger();
                default:
                    printHelp();
                    return 1;
            }
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
