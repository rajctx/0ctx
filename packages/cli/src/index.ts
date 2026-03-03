#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, execSync } from 'child_process';
import color from 'picocolors';
import { bootstrapMcpRegistration } from '@0ctx/mcp/dist/bootstrap';
import { sendToDaemon } from '@0ctx/mcp/dist/client';
import { listConfig, getConfigValue, setConfigValue, isValidConfigKey, getConfigPath } from '@0ctx/core';
import type { AppConfig } from '@0ctx/core';
import {
    installService as installServiceWindows,
    enableService as enableServiceWindows,
    disableService as disableServiceWindows,
    uninstallService as uninstallServiceWindows,
    statusService as statusServiceWindows,
    startService as startServiceWindows,
    stopService as stopServiceWindows,
    restartService as restartServiceWindows,
} from './service-windows';
import {
    installService as installServiceMac,
    enableService as enableServiceMac,
    disableService as disableServiceMac,
    uninstallService as uninstallServiceMac,
    statusService as statusServiceMac,
    startService as startServiceMac,
    stopService as stopServiceMac,
    restartService as restartServiceMac,
} from './service-macos';
import {
    installService as installServiceLinux,
    enableService as enableServiceLinux,
    disableService as disableServiceLinux,
    uninstallService as uninstallServiceLinux,
    statusService as statusServiceLinux,
    startService as startServiceLinux,
    stopService as stopServiceLinux,
    restartService as restartServiceLinux,
} from './service-linux';
import { commandAuthLogin, commandAuthLogout, commandAuthStatus, commandAuthRotate, resolveToken, isTokenExpired, refreshAccessToken, getEnvToken } from './auth';
import { getConnectorStatePath, readConnectorState, registerConnector, writeConnectorState } from './connector';
import { fetchConnectorCapabilities, registerConnectorInCloud, sendConnectorEvents, sendConnectorHeartbeat } from './cloud';
import { runConnectorRuntime } from './connector-runtime';
import {
    getConnectorQueuePath,
    getConnectorQueueStats,
    getReadyConnectorEvents,
    listQueuedConnectorEvents,
    markConnectorEventsDelivered,
    markConnectorEventsFailed,
    purgeConnectorQueue
} from './connector-queue';
import { appendCliOpsLogEntry, clearCliOpsLog, getCliOpsLogPath, readCliOpsLog } from './ops-log';
import { drainConnectorQueue } from './connector-queue-drain';
import { runInteractiveShell } from './shell';
import { runReleasePublish } from './release';
import { startLogsServer } from './logs-server';
import { initTelemetry, captureEvent, shutdownTelemetry } from './telemetry';

type SupportedClient = 'claude' | 'cursor' | 'windsurf';
type CheckStatus = 'pass' | 'warn' | 'fail';
type BootstrapResult = { client: string; status: string; configPath: string; message?: string };

interface DoctorCheck {
    id: string;
    status: CheckStatus;
    message: string;
    details?: Record<string, unknown>;
}

interface ParsedArgs {
    command: string;
    subcommand?: string;
    serviceAction?: string;
    positionalArgs: string[];
    flags: Record<string, string | boolean>;
}

const DB_PATH = process.env.CTX_DB_PATH || path.join(os.homedir(), '.0ctx', '0ctx.db');
const KEY_PATH = path.join(os.homedir(), '.0ctx', 'master.key');
const SOCKET_PATH = os.platform() === 'win32'
    ? '\\\\.\\pipe\\0ctx.sock'
    : path.join(os.homedir(), '.0ctx', '0ctx.sock');

const SUPPORTED_CLIENTS: SupportedClient[] = ['claude', 'cursor', 'windsurf'];
const CLI_VERSION = (() => {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pkg = require('../package.json') as { version?: string };
        return typeof pkg.version === 'string' ? pkg.version : 'unknown';
    } catch {
        return 'unknown';
    }
})();

function normalizeCommandAlias(command: string): string {
    const normalized = command.trim().toLowerCase();
    if (normalized === 'deamon') return 'daemon';
    return normalized;
}

function parseArgs(argv: string[]): ParsedArgs {
    const [rawCommand = 'help', maybeSubcommand, ...rest] = argv;
    const command = normalizeCommandAlias(rawCommand);
    const hasSubcommand = command === 'daemon'
        || command === 'auth'
        || command === 'config'
        || command === 'sync'
        || command === 'connector'
        || command === 'release';
    const tokens = hasSubcommand
        ? rest
        : [maybeSubcommand, ...rest].filter((token): token is string => Boolean(token));
    const flags: Record<string, string | boolean> = {};

    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (!token.startsWith('--')) continue;

        const [rawKey, rawValue] = token.split('=');
        const key = rawKey.slice(2);

        if (rawValue !== undefined) {
            flags[key] = rawValue;
            continue;
        }

        const next = tokens[i + 1];
        if (next && !next.startsWith('--')) {
            flags[key] = next;
            i += 1;
            continue;
        }

        flags[key] = true;
    }

    const sub = hasSubcommand ? maybeSubcommand : undefined;
    // 3-level: daemon|connector service <action>
    const serviceAction = (sub === 'service' && tokens[0] && !tokens[0].startsWith('--'))
        ? tokens[0]
        : undefined;
    // Collect non-flag positional args (for config get/set key value)
    const positionalArgs = tokens.filter(arg => !arg.startsWith('--'));
    return {
        command,
        subcommand: sub,
        serviceAction,
        positionalArgs,
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

function resolveMcpEntrypointForBootstrap(explicitEntrypoint?: string): string {
    if (explicitEntrypoint && explicitEntrypoint.trim().length > 0) {
        const resolved = path.resolve(explicitEntrypoint.trim());
        if (fs.existsSync(resolved)) return resolved;
        throw new Error(`Configured MCP entrypoint does not exist: ${resolved}`);
    }

    const candidates = [
        path.resolve(__dirname, 'mcp-server.js'),
        (() => {
            try {
                return require.resolve('@0ctx/mcp/dist/index.js');
            } catch {
                return '';
            }
        })(),
        path.resolve(process.cwd(), 'packages', 'mcp', 'dist', 'index.js'),
        path.resolve(process.cwd(), 'dist', 'mcp-server.js')
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }

    throw new Error('Could not resolve MCP server entrypoint. Run `npm run build` (repo) or `0ctx repair --clients=all` (installed CLI).');
}

function resolveCliEntrypoint(): string {
    if (process.argv[1]) {
        return path.resolve(process.argv[1]);
    }
    return __filename;
}

function getHostedDashboardUrl(): string {
    const configured = getConfigValue('ui.url');
    if (typeof configured === 'string' && configured.trim().length > 0) {
        return configured.trim();
    }
    return 'https://app.0ctx.com';
}

function openUrl(url: string): void {
    try {
        const platform = os.platform();
        if (platform === 'win32') {
            execSync(`start "" "${url}"`, { stdio: 'ignore' });
        } else if (platform === 'darwin') {
            execSync(`open "${url}"`, { stdio: 'ignore' });
        } else {
            execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
        }
    } catch {
        // Best-effort open only. User can copy URL.
    }
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

function runBootstrap(
    clients: SupportedClient[],
    dryRun: boolean,
    explicitEntrypoint?: string
): ReturnType<typeof bootstrapMcpRegistration> {
    return bootstrapMcpRegistration({
        clients,
        dryRun,
        serverName: '0ctx',
        entrypoint: resolveMcpEntrypointForBootstrap(explicitEntrypoint)
    });
}

async function printBootstrapResults(results: BootstrapResult[], dryRun: boolean): Promise<void> {
    const p = await import('@clack/prompts');
    const mode = dryRun ? color.yellow('DRY RUN') : color.green('APPLIED');
    p.log.message(`MCP bootstrap (${mode})`);

    for (const result of results) {
        const clientName = color.cyan(result.client);
        const suffix = result.message ? color.dim(` - ${result.message}`) : '';

        if (result.status === 'failed') {
            p.log.error(`${clientName}: failed (${result.configPath || 'no config'})${suffix}`);
        } else if (result.status === 'skipped') {
            p.log.info(`${clientName}: skipped (${result.configPath || 'no config'})${suffix}`);
        } else {
            p.log.success(`${clientName}: ${result.status} (${result.configPath})${suffix}`);
        }
    }
}

async function commandStatus(): Promise<number> {
    const p = await import('@clack/prompts');
    p.intro(color.bgCyan(color.black(' 0ctx status ')));
    const s = p.spinner();
    s.start('Checking daemon health');

    let daemon = await isDaemonReachable();

    // Auto-start daemon if not running (best-effort, no error if it fails)
    if (!daemon.ok) {
        s.message('Daemon not running — starting...');
        try {
            startDaemonDetached();
            const started = await waitForDaemon(8000);
            if (started) {
                daemon = await isDaemonReachable();
            }
        } catch {
            // Best-effort only — status will report offline if it didn't start
        }
    }

    s.stop(`Daemon is ${daemon.ok ? color.green('running') : color.red('not running')}`);

    const info: Record<string, string> = {
        'Socket': SOCKET_PATH,
        'Database': DB_PATH,
        'Master Key': fs.existsSync(KEY_PATH) || Boolean(process.env.CTX_MASTER_KEY) ? color.green('present') : color.yellow('missing')
    };

    if (!daemon.ok) {
        if (daemon.error) {
            info['Error'] = color.red(daemon.error);
        }
    } else {
        try {
            const capabilities = await sendToDaemon('getCapabilities', {});
            const methods = Array.isArray(capabilities?.methods) ? capabilities.methods.length : 0;
            info['API Version'] = capabilities?.apiVersion ?? 'unknown';
            info['RPC Methods'] = String(methods);
        } catch (error) {
            info['API Error'] = color.red(error instanceof Error ? error.message : String(error));
        }
    }

    p.note(
        Object.entries(info).map(([k, v]) => `${color.dim(k.padEnd(12))} : ${v}`).join('\n'),
        'System Details'
    );
    p.outro(daemon.ok ? 'All systems operational' : color.yellow('Daemon degraded or offline'));

    return daemon.ok ? 0 : 1;
}

async function commandBootstrap(flags: Record<string, string | boolean>): Promise<number> {
    const p = await import('@clack/prompts');
    const clients = parseClients(flags.clients);
    const dryRun = Boolean(flags['dry-run']);
    const entrypoint = parseOptionalStringFlag(flags.entrypoint) ?? undefined;

    if (!Boolean(flags.quiet) && !Boolean(flags.json)) {
        p.intro(color.bgBlue(color.black(' 0ctx bootstrap ')));
    }

    const s = p.spinner();
    if (!Boolean(flags.quiet) && !Boolean(flags.json)) s.start('Applying MCP configurations');

    const results = runBootstrap(clients, dryRun, entrypoint);

    if (!Boolean(flags.quiet) && !Boolean(flags.json)) {
        s.stop('Bootstrap complete');
        await printBootstrapResults(results, dryRun);
        p.log.info('Restart your AI client app so it reloads MCP config changes.');
        p.outro(results.some(r => r.status === 'failed') ? color.yellow('Bootstrap finished with errors') : color.green('Bootstrap successful'));
    }

    if (Boolean(flags.json)) {
        console.log(JSON.stringify({ dryRun, clients, results }, null, 2));
    }
    return results.some((result: BootstrapResult) => result.status === 'failed') ? 1 : 0;
}

async function commandInstall(flags: Record<string, string | boolean>): Promise<number> {
    const p = await import('@clack/prompts');
    const quiet = Boolean(flags.quiet);
    const asJson = Boolean(flags.json);
    const skipBootstrap = Boolean(flags['skip-bootstrap']);

    if (!quiet && !asJson) {
        p.intro(color.bgBlue(color.black(' 0ctx install ')));
    }

    const s = p.spinner();
    if (!quiet && !asJson) s.start('Checking daemon status');

    const daemonStatus = await isDaemonReachable();

    if (!daemonStatus.ok) {
        if (!quiet && !asJson) s.message('Starting background service...');
        try {
            startDaemonDetached();
        } catch (error) {
            if (!quiet && !asJson) s.stop(color.red('Failed to start daemon'));
            console.error(error instanceof Error ? error.message : String(error));
            if (!quiet && !asJson) p.outro(color.red('Install failed'));
            return 1;
        }
    }

    if (!quiet && !asJson) s.message('Waiting for daemon to become ready...');
    const ready = await waitForDaemon();

    if (!ready) {
        if (!quiet && !asJson) s.stop(color.red('Daemon start timeout'));
        console.error('Unable to reach daemon health endpoint.');
        if (!quiet && !asJson) p.outro(color.red('Install failed'));
        return 1;
    }

    if (!quiet && !asJson) s.stop(color.green('Daemon is ready'));

    let bootstrapCode = 0;
    if (!skipBootstrap) {
        bootstrapCode = await commandBootstrap({ ...flags, quiet: (quiet || asJson), json: false });
        if (bootstrapCode !== 0) {
            if (!quiet && !asJson) p.outro(color.yellow('Install partial (bootstrap failed)'));
            return bootstrapCode;
        }
    }

    if (quiet || asJson) {
        if (asJson) {
            console.log(JSON.stringify({
                ok: true,
                daemonRunning: true,
                bootstrap: skipBootstrap ? 'skipped' : 'ok'
            }, null, 2));
        }
        return 0;
    }

    const checks = await isDaemonReachable();
    p.outro(color.green(`Installation complete! Daemon is ${checks.ok ? 'running' : 'degraded'}.`));
    return checks.ok ? 0 : 1;
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

    const opsLogPath = getCliOpsLogPath();
    let opsLogWritable = true;
    let opsLogError: string | null = null;
    try {
        const dir = path.dirname(opsLogPath);
        fs.mkdirSync(dir, { recursive: true });
        fs.accessSync(dir, fs.constants.W_OK);
        if (fs.existsSync(opsLogPath)) {
            fs.accessSync(opsLogPath, fs.constants.W_OK);
        }
    } catch (error) {
        opsLogWritable = false;
        opsLogError = error instanceof Error ? error.message : String(error);
    }
    checks.push({
        id: 'ops_log_writable',
        status: opsLogWritable ? 'pass' : 'warn',
        message: opsLogWritable ? 'CLI operations log path is writable.' : 'CLI operations log path is not writable.',
        details: { path: opsLogPath, error: opsLogError }
    });

    const dryRunResults = runBootstrap(parseClients(flags.clients), true);
    const failedBootstrap = dryRunResults.some((result: BootstrapResult) => result.status === 'failed');
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
        const p = await import('@clack/prompts');
        p.intro(color.bgCyan(color.black(' 0ctx doctor ')));

        for (const check of checks) {
            if (check.status === 'pass') {
                p.log.success(`${color.bold(check.id)}: ${color.dim(check.message)}`);
            } else if (check.status === 'warn') {
                p.log.warn(`${color.bold(check.id)}: ${color.yellow(check.message)}`);
            } else {
                p.log.error(`${color.bold(check.id)}: ${color.red(check.message)}`);
            }
        }

        const hasFailures = checks.some(c => c.status === 'fail');
        p.outro(hasFailures ? color.red('Doctor found issues requiring attention.') : color.green('All systems go!'));
    }

    return checks.some(check => check.status === 'fail') ? 1 : 0;
}

async function commandRepair(flags: Record<string, string | boolean>): Promise<number> {
    const p = await import('@clack/prompts');
    p.intro(color.bgCyan(color.black(' 0ctx repair ')));

    const s = p.spinner();
    s.start('Checking daemon status');

    const daemon = await isDaemonReachable();
    if (!daemon.ok) {
        s.message('Starting daemon for repair...');
        try {
            startDaemonDetached();
        } catch (error) {
            s.stop(color.red('Failed to start daemon'));
            p.log.error(error instanceof Error ? error.message : String(error));
            p.outro(color.red('Repair failed'));
            return 1;
        }
    }

    const ready = await waitForDaemon();
    if (!ready) {
        s.stop(color.red('Daemon start timeout'));
        p.outro(color.red('Repair failed'));
        return 1;
    }

    s.stop(color.green('Daemon is running'));

    p.log.step('Running bootstrap to fix MCP configs');
    const bootstrapCode = await commandBootstrap({ ...flags, quiet: true, json: false });
    if (bootstrapCode !== 0) {
        p.outro(color.yellow('Repair partial (bootstrap failed)'));
        return bootstrapCode;
    }

    p.log.step('Running doctor checks');
    return commandDoctor({ ...flags, json: false });
}

async function commandDashboard(flags: Record<string, string | boolean>): Promise<number> {
    const url = applyDashboardQuery(getHostedDashboardUrl(), flags['dashboard-query']);
    console.log(`dashboard_url: ${url}`);

    if (Boolean(flags['no-open'])) {
        console.log('Open the URL above in your browser.');
        return 0;
    }

    openUrl(url);
    console.log('Opened dashboard URL in your default browser (best effort).');
    return 0;
}

async function commandLogs(flags: Record<string, string | boolean>): Promise<number> {
    const { port, close } = await startLogsServer();
    const url = `http://127.0.0.1:${port}`;
    console.log(`logs_url: ${url}`);

    if (!Boolean(flags['no-open'])) {
        openUrl(url);
        console.log('Opened local logs in your default browser (best effort).');
    }

    console.log('Local logs server running. Press Ctrl+C to stop (auto-closes after 30 min of inactivity).');

    await new Promise<void>(resolve => {
        process.once('SIGINT', resolve);
        process.once('SIGTERM', resolve);
    });

    await close();
    return 0;
}

async function commandShell(): Promise<number> {
    return runInteractiveShell({
        cliEntrypoint: resolveCliEntrypoint(),
        nodeExecArgv: process.execArgv
    });
}

async function commandReleasePublish(flags: Record<string, string | boolean>): Promise<number> {
    const versionRaw = parseOptionalStringFlag(flags.version);
    if (!versionRaw) {
        console.error('Missing required --version argument.');
        console.error('Usage: 0ctx release publish --version vX.Y.Z [--tag latest] [--otp 123456] [--dry-run] [--allow-dirty] [--json]');
        return 1;
    }

    const result = await runReleasePublish({
        version: versionRaw,
        tag: parseOptionalStringFlag(flags.tag) ?? 'latest',
        dryRun: Boolean(flags['dry-run']),
        allowDirty: Boolean(flags['allow-dirty']),
        otp: parseOptionalStringFlag(flags.otp) ?? undefined,
        skipValidate: Boolean(flags['skip-validate']),
        skipChangelog: Boolean(flags['skip-changelog']),
        outputMode: Boolean(flags.json) ? 'capture' : 'inherit'
    });

    if (Boolean(flags.json)) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        console.log(`release_publish: ${result.ok ? 'success' : 'failed'}`);
        console.log(`version: ${result.version}`);
        console.log(`tag: ${result.tag}`);
        console.log(`dry_run: ${result.dryRun}`);
        if (!result.ok) {
            const failedStep = result.steps.find(step => !step.ok);
            if (failedStep) {
                console.error(`failed_step: ${failedStep.id} (exit=${failedStep.exitCode ?? 'unknown'})`);
            }
        }
    }

    return result.ok ? 0 : 1;
}

function commandVersion(): number {
    console.log(CLI_VERSION);
    return 0;
}

function parsePositiveNumberFlag(value: string | boolean | undefined, fallback: number): number {
    if (typeof value !== 'string') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function parsePositiveIntegerFlag(value: string | boolean | undefined, fallback: number): number {
    return Math.max(1, Math.floor(parsePositiveNumberFlag(value, fallback)));
}

function parseOptionalStringFlag(value: string | boolean | undefined): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function sleepMs(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function applyDashboardQuery(url: string, queryRaw: string | boolean | undefined): string {
    if (typeof queryRaw !== 'string' || queryRaw.trim().length === 0) return url;
    const normalized = queryRaw.trim().replace(/^\?+/, '');
    if (normalized.length === 0) return url;

    try {
        const parsedUrl = new URL(url);
        const query = new URLSearchParams(normalized);
        for (const [key, value] of query.entries()) {
            parsedUrl.searchParams.set(key, value);
        }
        return parsedUrl.toString();
    } catch {
        const sep = url.includes('?') ? '&' : '?';
        return `${url}${sep}${normalized}`;
    }
}

async function commandConnectorQueue(action: string | undefined, flags: Record<string, string | boolean>): Promise<number> {
    const validActions = ['status', 'drain', 'purge', 'logs'];
    const safeAction = action || 'status';

    if (!validActions.includes(safeAction)) {
        console.error(`Unknown connector queue action: '${action ?? ''}'`);
        console.error(`Valid actions: ${validActions.join(', ')}`);
        return 1;
    }

    if (safeAction === 'status') {
        const stats = getConnectorQueueStats(Date.now());
        const sample = listQueuedConnectorEvents().slice(0, 5).map(item => ({
            queueId: item.queueId,
            eventId: item.eventId,
            sequence: item.sequence,
            attempts: item.attempts,
            nextAttemptAt: new Date(item.nextAttemptAt).toISOString(),
            lastError: item.lastError
        }));

        const payload = {
            path: getConnectorQueuePath(),
            stats: {
                ...stats,
                oldestEnqueuedAt: stats.oldestEnqueuedAt ? new Date(stats.oldestEnqueuedAt).toISOString() : null
            },
            sample
        };

        if (Boolean(flags.json)) {
            console.log(JSON.stringify(payload, null, 2));
            return 0;
        }

        console.log('\nConnector Queue\n');
        console.log(`  path:         ${payload.path}`);
        console.log(`  pending:      ${payload.stats.pending}`);
        console.log(`  ready:        ${payload.stats.ready}`);
        console.log(`  backoff:      ${payload.stats.backoff}`);
        console.log(`  max_attempts: ${payload.stats.maxAttempts}`);
        if (payload.stats.oldestEnqueuedAt) {
            console.log(`  oldest:       ${payload.stats.oldestEnqueuedAt}`);
        }
        if (payload.sample.length > 0) {
            console.log('\n  sample:');
            for (const row of payload.sample) {
                console.log(
                    `    seq=${row.sequence} attempts=${row.attempts} next=${row.nextAttemptAt}` +
                    `${row.lastError ? ` error=${row.lastError}` : ''}`
                );
            }
        }
        console.log('');
        return 0;
    }

    if (safeAction === 'logs') {
        const limit = parsePositiveIntegerFlag(flags.limit, 50);
        const clear = Boolean(flags.clear);
        const dryRun = Boolean(flags['dry-run']);
        const confirm = Boolean(flags.confirm);
        const currentEntries = readCliOpsLog(limit).map((entry) => ({
            ...entry,
            isoTime: new Date(entry.timestamp).toISOString()
        }));
        const filePath = getCliOpsLogPath();

        if (clear) {
            if (!dryRun && !confirm) {
                console.error('connector_queue_logs_clear_requires_confirm: pass --confirm (or use --dry-run).');
                return 1;
            }

            if (dryRun) {
                const payload = { dryRun: true, path: filePath, removableEntries: currentEntries.length };
                if (Boolean(flags.json)) {
                    console.log(JSON.stringify(payload, null, 2));
                } else {
                    console.log(`connector_queue_logs_clear_dry_run: path=${filePath} removable_entries=${currentEntries.length}`);
                }
            } else {
                const result = clearCliOpsLog();
                const payload = { dryRun: false, ...result };
                if (Boolean(flags.json)) {
                    console.log(JSON.stringify(payload, null, 2));
                } else {
                    console.log(`connector_queue_logs_clear: cleared=${result.cleared} path=${result.path}`);
                }
            }
            return 0;
        }

        const payload = {
            path: filePath,
            count: currentEntries.length,
            entries: currentEntries
        };

        if (Boolean(flags.json)) {
            console.log(JSON.stringify(payload, null, 2));
            return 0;
        }

        console.log('\nConnector Queue Ops Log\n');
        console.log(`  path:  ${payload.path}`);
        console.log(`  count: ${payload.count}`);
        if (currentEntries.length > 0) {
            console.log('');
            for (const entry of currentEntries) {
                const details = entry.details ? ` details=${JSON.stringify(entry.details)}` : '';
                console.log(`  ${entry.isoTime} ${entry.status} ${entry.operation}${details}`);
            }
        }
        console.log('');
        return 0;
    }

    if (safeAction === 'purge') {
        const dryRun = Boolean(flags['dry-run']);
        const confirm = Boolean(flags.confirm);
        const all = Boolean(flags.all);
        const olderThanHours = parsePositiveNumberFlag(flags['older-than-hours'], 0);
        const minAttempts = parsePositiveNumberFlag(flags['min-attempts'], 0);
        const queuePath = getConnectorQueuePath();

        if (!dryRun && !confirm) {
            console.error('connector_queue_purge_requires_confirm: pass --confirm (or use --dry-run).');
            appendCliOpsLogEntry({
                operation: 'connector.queue.purge',
                status: 'error',
                details: { reason: 'missing_confirm', dryRun, all, olderThanHours, minAttempts, queuePath }
            });
            return 1;
        }

        if (!all && olderThanHours <= 0 && minAttempts <= 0) {
            console.error('connector_queue_purge_requires_filter: use --all or --older-than-hours or --min-attempts.');
            appendCliOpsLogEntry({
                operation: 'connector.queue.purge',
                status: 'error',
                details: { reason: 'missing_filter', dryRun, all, olderThanHours, minAttempts, queuePath }
            });
            return 1;
        }

        if (dryRun) {
            const now = Date.now();
            const candidates = listQueuedConnectorEvents();
            const removable = candidates.filter(item => {
                if (all) return true;
                const olderMatch = olderThanHours > 0 ? (now - item.enqueuedAt) >= olderThanHours * 60 * 60 * 1000 : false;
                const attemptsMatch = minAttempts > 0 ? item.attempts >= minAttempts : false;
                return olderMatch || attemptsMatch;
            }).length;

            const payload = { dryRun: true, removable, total: candidates.length };
            appendCliOpsLogEntry({
                operation: 'connector.queue.purge',
                status: 'dry_run',
                details: {
                    all,
                    olderThanHours,
                    minAttempts,
                    removable,
                    total: candidates.length,
                    queuePath
                }
            });
            if (Boolean(flags.json)) {
                console.log(JSON.stringify(payload, null, 2));
            } else {
                console.log(`connector_queue_purge_dry_run: removable=${removable} total=${candidates.length}`);
            }
            return 0;
        }
        const result = purgeConnectorQueue({
            all,
            olderThanHours: olderThanHours > 0 ? olderThanHours : undefined,
            minAttempts: minAttempts > 0 ? minAttempts : undefined
        });

        const payload = { removed: result.removed, remaining: result.remaining };
        appendCliOpsLogEntry({
            operation: 'connector.queue.purge',
            status: 'success',
            details: {
                all,
                olderThanHours: olderThanHours > 0 ? olderThanHours : null,
                minAttempts: minAttempts > 0 ? minAttempts : null,
                removed: result.removed,
                remaining: result.remaining,
                queuePath
            }
        });
        if (Boolean(flags.json)) {
            console.log(JSON.stringify(payload, null, 2));
        } else {
            console.log(`connector_queue_purge: removed=${result.removed} remaining=${result.remaining}`);
        }
        return 0;
    }

    // drain
    const token = resolveToken();
    if (!token) {
        console.error('connector_queue_drain_requires_auth: run `0ctx auth login` first.');
        appendCliOpsLogEntry({
            operation: 'connector.queue.drain',
            status: 'error',
            details: { reason: 'missing_auth', queuePath: getConnectorQueuePath() }
        });
        return 1;
    }

    const registration = readConnectorState();
    if (!registration) {
        console.error('connector_queue_drain_requires_registration: run `0ctx connector register` first.');
        appendCliOpsLogEntry({
            operation: 'connector.queue.drain',
            status: 'error',
            details: { reason: 'missing_registration', queuePath: getConnectorQueuePath() }
        });
        return 1;
    }

    const maxBatches = parsePositiveIntegerFlag(flags['max-batches'], 10);
    const batchSize = Math.min(500, parsePositiveIntegerFlag(flags['batch-size'], 200));
    const wait = Boolean(flags.wait);
    const strict = Boolean(flags.strict) || Boolean(flags['fail-on-retry']);
    const timeoutMs = parsePositiveIntegerFlag(flags['timeout-ms'], 120_000);
    const pollMs = Math.max(200, parsePositiveIntegerFlag(flags['poll-ms'], 1_000));
    const queuePath = getConnectorQueuePath();
    const drained = await drainConnectorQueue({
        machineId: registration.machineId,
        tenantId: registration.tenantId,
        accessToken: token.accessToken,
        maxBatches,
        batchSize,
        wait,
        timeoutMs,
        pollMs
    }, {
        now: () => Date.now(),
        sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
        getReadyEvents: getReadyConnectorEvents,
        sendEvents: sendConnectorEvents,
        markEventsDelivered: markConnectorEventsDelivered,
        markEventsFailed: markConnectorEventsFailed,
        getQueueStats: getConnectorQueueStats,
        onBridgeUnsupported: () => {
            registration.runtime.eventBridgeSupported = false;
            registration.runtime.eventBridgeError = null;
            registration.updatedAt = Date.now();
            writeConnectorState(registration);
        }
    });

    registration.runtime.eventQueuePending = drained.queue.pending;
    registration.runtime.eventQueueReady = drained.queue.ready;
    registration.runtime.eventQueueBackoff = drained.queue.backoff;
    registration.runtime.eventBridgeError = drained.lastError;
    registration.updatedAt = Date.now();
    writeConnectorState(registration);

    const response = {
        sent: drained.sent,
        failed: drained.failed,
        batches: drained.batches,
        queue: drained.queue,
        wait: {
            enabled: wait,
            strict,
            timeoutMs: drained.wait.timeoutMs,
            pollMs: drained.wait.pollMs,
            elapsedMs: drained.wait.elapsedMs,
            timedOut: drained.wait.timedOut,
            hitMaxBatches: drained.wait.hitMaxBatches,
            reason: drained.wait.reason
        },
        lastError: drained.lastError
    };

    const status = wait
        ? (drained.queue.pending === 0 && (!strict || drained.failed === 0) ? 'success' : 'partial')
        : (drained.failed > 0 ? 'partial' : 'success');
    appendCliOpsLogEntry({
        operation: 'connector.queue.drain',
        status,
        details: {
            queuePath,
            maxBatches,
            batchSize,
            wait,
            strict,
            timeoutMs: wait ? timeoutMs : null,
            pollMs: wait ? pollMs : null,
            sent: drained.sent,
            failed: drained.failed,
            batches: drained.batches,
            pending: drained.queue.pending,
            ready: drained.queue.ready,
            backoff: drained.queue.backoff,
            reason: drained.wait.reason,
            lastError: drained.lastError
        }
    });

    if (Boolean(flags.json)) {
        console.log(JSON.stringify(response, null, 2));
    } else {
        console.log('\nConnector Queue Drain\n');
        console.log(`  sent:         ${drained.sent}`);
        console.log(`  failed:       ${drained.failed}`);
        console.log(`  batches:      ${drained.batches}`);
        console.log(`  pending:      ${drained.queue.pending}`);
        console.log(`  ready:        ${drained.queue.ready}`);
        console.log(`  backoff:      ${drained.queue.backoff}`);
        if (wait) {
            console.log(`  wait:         true`);
            console.log(`  strict:       ${strict}`);
            console.log(`  timeout_ms:   ${drained.wait.timeoutMs}`);
            console.log(`  elapsed_ms:   ${drained.wait.elapsedMs}`);
            console.log(`  reason:       ${drained.wait.reason}`);
        }
        if (drained.lastError) {
            console.log(`  error:        ${drained.lastError}`);
        }
        console.log('');
    }

    if (wait) {
        if (drained.queue.pending > 0) return 1;
        return strict && drained.failed > 0 ? 1 : 0;
    }
    if (strict && drained.failed > 0) return 1;
    return drained.failed > 0 ? 1 : 0;
}

async function commandConnector(action: string | undefined, flags: Record<string, string | boolean>): Promise<number> {
    const validActions = ['install', 'enable', 'disable', 'uninstall', 'status', 'start', 'stop', 'restart', 'verify', 'register', 'run', 'logs'];
    if (!action || !validActions.includes(action)) {
        console.error(`Unknown connector action: '${action ?? ''}'`);
        console.error(`Valid actions: ${validActions.join(', ')}`);
        return 1;
    }

    if (action === 'run') {
        const intervalRaw = flags['interval-ms'];
        const intervalMs = typeof intervalRaw === 'string' ? Number(intervalRaw) : undefined;
        return runConnectorRuntime({
            once: Boolean(flags.once),
            quiet: Boolean(flags.quiet),
            autoStartDaemon: !Boolean(flags['no-daemon-autostart']),
            intervalMs: Number.isFinite(intervalMs) ? intervalMs : undefined
        });
    }

    if (action === 'verify') {
        const daemon = await isDaemonReachable();
        const registration = readConnectorState();
        const token = resolveToken();
        const requireCloud = Boolean(flags.cloud) || Boolean(flags['require-cloud']);
        const asJson = Boolean(flags.json);
        let cloudOk = !requireCloud;
        let cloudError: string | null = null;

        if (requireCloud && token && registration) {
            const cloudCapabilities = await fetchConnectorCapabilities(token.accessToken, registration.machineId);
            cloudOk = cloudCapabilities.ok;
            cloudError = cloudCapabilities.ok ? null : (cloudCapabilities.error ?? 'cloud_capabilities_check_failed');
        } else if (requireCloud && (!token || !registration)) {
            cloudOk = false;
            cloudError = 'cloud_verification_requires_auth_and_registration';
        }

        const checks = {
            daemon: daemon.ok,
            registration: Boolean(registration),
            auth: Boolean(token),
            cloud: cloudOk
        };

        const ok = checks.daemon && checks.registration && checks.auth && checks.cloud;

        const payload = {
            ok,
            requireCloud,
            checks,
            machineId: registration?.machineId ?? null,
            daemonError: daemon.ok ? null : (daemon.error ?? 'unknown'),
            cloudError
        };

        if (asJson) {
            console.log(JSON.stringify(payload, null, 2));
        } else if (!Boolean(flags.quiet)) {
            console.log('\nConnector Verify\n');
            console.log(`  daemon:       ${checks.daemon ? 'ok' : 'missing'}`);
            console.log(`  registration: ${checks.registration ? 'ok' : 'missing'}`);
            console.log(`  auth:         ${checks.auth ? 'ok' : 'missing'}`);
            if (requireCloud) {
                console.log(`  cloud:        ${checks.cloud ? 'ok' : 'missing'}`);
            }
            if (registration) {
                console.log(`  machine_id:   ${registration.machineId}`);
            }
            if (!daemon.ok && daemon.error) {
                console.log(`  daemon_error: ${daemon.error}`);
            }
            if (requireCloud && cloudError) {
                console.log(`  cloud_error:  ${cloudError}`);
            }
            console.log('');
        }

        return ok ? 0 : 1;
    }

    if (action === 'register') {
        const asJson = Boolean(flags.json);
        const token = resolveToken();
        if (!token) {
            console.error('connector_register_requires_auth: run `0ctx auth login` first.');
            if (asJson) {
                console.log(JSON.stringify({
                    ok: false,
                    error: 'connector_register_requires_auth',
                    message: 'run `0ctx auth login` first.'
                }, null, 2));
            }
            return 1;
        }

        const force = Boolean(flags.force);
        const localOnly = Boolean(flags['local-only']);
        const requireCloud = Boolean(flags['require-cloud']);
        const dashboardUrl = getHostedDashboardUrl();
        const { state: localState, created } = registerConnector({
            tenantId: token.tenantId || null,
            uiUrl: dashboardUrl,
            force
        });
        let state = localState;
        let cloudError: string | null = null;
        let cloudRegistrationStatus: 'skipped' | 'connected' | 'local_fallback' = 'skipped';

        if (!localOnly) {
            const cloudResult = await registerConnectorInCloud(token.accessToken, {
                machineId: localState.machineId,
                tenantId: token.tenantId || null,
                uiUrl: dashboardUrl,
                platform: os.platform()
            });

            if (cloudResult.ok) {
                cloudRegistrationStatus = 'connected';
                state = {
                    ...localState,
                    tenantId: cloudResult.data?.tenantId ?? localState.tenantId,
                    updatedAt: Date.now(),
                    registrationMode: 'cloud',
                    cloud: {
                        registrationId: cloudResult.data?.registrationId ?? localState.cloud.registrationId,
                        streamUrl: cloudResult.data?.streamUrl ?? localState.cloud.streamUrl,
                        capabilities: cloudResult.data?.capabilities ?? localState.cloud.capabilities,
                        lastHeartbeatAt: localState.cloud.lastHeartbeatAt,
                        lastError: null
                    }
                };
            } else {
                cloudRegistrationStatus = 'local_fallback';
                cloudError = cloudResult.error ?? 'cloud_registration_failed';
                state = {
                    ...localState,
                    updatedAt: Date.now(),
                    registrationMode: 'local',
                    cloud: {
                        ...localState.cloud,
                        lastError: cloudError
                    }
                };
            }

            writeConnectorState(state);
        }

        const payload = {
            ok: true,
            created,
            machineId: state.machineId,
            tenantId: state.tenantId ?? null,
            dashboardUrl: state.uiUrl,
            registrationMode: state.registrationMode,
            cloudRegistration: cloudRegistrationStatus,
            cloudRegistrationId: state.cloud.registrationId ?? null,
            cloudStreamUrl: state.cloud.streamUrl ?? null,
            cloudError,
            statePath: getConnectorStatePath()
        };

        if (asJson) {
            console.log(JSON.stringify(payload, null, 2));
        } else if (!Boolean(flags.quiet)) {
            console.log(`connector_registration: ${created ? 'created' : 'existing'}`);
            console.log(`machine_id: ${state.machineId}`);
            console.log(`tenant_id: ${state.tenantId ?? 'n/a'}`);
            console.log(`dashboard_url: ${state.uiUrl}`);
            console.log(`registration_mode: ${state.registrationMode}`);
            console.log(`cloud_registration: ${cloudRegistrationStatus}`);
            if (state.cloud.registrationId) {
                console.log(`cloud_registration_id: ${state.cloud.registrationId}`);
            }
            if (state.cloud.streamUrl) {
                console.log(`cloud_stream_url: ${state.cloud.streamUrl}`);
            }
            if (cloudError) {
                console.log(`cloud_error: ${cloudError}`);
            }
            console.log(`state_path: ${getConnectorStatePath()}`);
        }

        if (requireCloud && state.registrationMode !== 'cloud') {
            console.error('connector_register_cloud_required: unable to register with cloud control plane');
            if (asJson) {
                console.log(JSON.stringify({
                    ...payload,
                    ok: false,
                    error: 'connector_register_cloud_required'
                }, null, 2));
            }
            return 1;
        }

        return 0;
    }

    if (action === 'status') {
        const daemon = await isDaemonReachable();
        const registration = readConnectorState();
        const token = resolveToken();
        const requireBridge = Boolean(flags['require-bridge']);
        const cloudRequired = registration?.registrationMode === 'cloud';
        const cloudProbeRequested = Boolean(flags.cloud) || cloudRequired;
        let sync: {
            enabled: boolean;
            running: boolean;
            lastError: string | null;
            queue?: { pending: number; inFlight: number; failed: number; done: number };
        } | null = null;

        if (daemon.ok) {
            try {
                sync = await sendToDaemon('syncStatus', {});
            } catch {
                sync = null;
            }
        }

        let cloud = {
            connected: false,
            required: cloudRequired,
            registrationId: registration?.cloud.registrationId ?? null,
            streamUrl: registration?.cloud.streamUrl ?? null,
            capabilities: registration?.cloud.capabilities ?? [],
            lastError: registration?.cloud.lastError ?? null,
            lastHeartbeatAt: registration?.cloud.lastHeartbeatAt ?? null
        };

        if (cloudProbeRequested && token && registration) {
            const capabilitiesResult = await fetchConnectorCapabilities(token.accessToken, registration.machineId);
            if (capabilitiesResult.ok) {
                cloud.capabilities = capabilitiesResult.data?.capabilities
                    ?? capabilitiesResult.data?.features
                    ?? cloud.capabilities;
                cloud.connected = true;
                cloud.lastError = null;
            } else {
                cloud.connected = false;
                cloud.lastError = capabilitiesResult.error ?? 'cloud_capabilities_failed';
            }

            const heartbeatPayload = {
                machineId: registration.machineId,
                tenantId: registration.tenantId,
                posture: daemon.ok ? 'connected' : 'offline',
                daemonRunning: daemon.ok,
                syncEnabled: Boolean(sync?.enabled),
                syncRunning: Boolean(sync?.running),
                queue: sync?.queue
            } as const;
            const heartbeatResult = await sendConnectorHeartbeat(token.accessToken, heartbeatPayload);
            if (heartbeatResult.ok) {
                cloud.lastHeartbeatAt = Date.now();
                if (!capabilitiesResult.ok) {
                    cloud.connected = true;
                    cloud.lastError = null;
                }
            } else {
                cloud.lastError = heartbeatResult.error ?? cloud.lastError ?? 'cloud_heartbeat_failed';
                if (cloudRequired) {
                    cloud.connected = false;
                }
            }

            const updatedState = {
                ...registration,
                updatedAt: Date.now(),
                cloud: {
                    ...registration.cloud,
                    capabilities: cloud.capabilities,
                    lastHeartbeatAt: cloud.lastHeartbeatAt,
                    lastError: cloud.lastError
                }
            };
            writeConnectorState(updatedState);
        }

        const posture = !daemon.ok
            ? 'offline'
            : (!token || !registration)
                ? 'degraded'
                : (cloudRequired && !cloud.connected)
                    ? 'degraded'
                    : (Boolean(registration.runtime.eventBridgeError) || Boolean(registration.runtime.commandBridgeError))
                        ? 'degraded'
                        : (sync?.enabled && sync?.running ? 'connected' : 'degraded');

        const payload = {
            posture,
            daemon: {
                running: daemon.ok,
                error: daemon.ok ? null : (daemon.error ?? 'unknown')
            },
            registration: registration ? {
                registered: true,
                machineId: registration.machineId,
                tenantId: registration.tenantId,
                statePath: getConnectorStatePath(),
                updatedAt: new Date(registration.updatedAt).toISOString(),
                runtime: {
                    eventBridgeSupported: registration.runtime.eventBridgeSupported,
                    eventBridgeError: registration.runtime.eventBridgeError,
                    lastEventSequence: registration.runtime.lastEventSequence,
                    lastEventSyncAt: registration.runtime.lastEventSyncAt
                        ? new Date(registration.runtime.lastEventSyncAt).toISOString()
                        : null,
                    commandBridgeSupported: registration.runtime.commandBridgeSupported,
                    commandBridgeError: registration.runtime.commandBridgeError,
                    lastCommandCursor: registration.runtime.lastCommandCursor,
                    lastCommandSyncAt: registration.runtime.lastCommandSyncAt
                        ? new Date(registration.runtime.lastCommandSyncAt).toISOString()
                        : null,
                    queue: {
                        pending: registration.runtime.eventQueuePending,
                        ready: registration.runtime.eventQueueReady,
                        backoff: registration.runtime.eventQueueBackoff
                    }
                }
            } : {
                registered: false,
                machineId: null,
                tenantId: null,
                statePath: getConnectorStatePath(),
                updatedAt: null,
                runtime: null
            },
            auth: {
                authenticated: Boolean(token),
                tenantId: token?.tenantId ?? null
            },
            cloud,
            sync: sync ?? {
                enabled: false,
                running: false,
                lastError: daemon.ok ? 'sync_status_unavailable' : 'daemon_unreachable',
                queue: { pending: 0, inFlight: 0, failed: 0, done: 0 }
            },
            dashboardUrl: getHostedDashboardUrl()
        };

        const bridgeReasons: string[] = [];
        if (!payload.registration.registered || !payload.registration.runtime) {
            bridgeReasons.push('not_registered');
        } else {
            if (!payload.registration.runtime.eventBridgeSupported) {
                bridgeReasons.push('bridge_not_supported');
            }
            if (payload.registration.runtime.eventBridgeError) {
                bridgeReasons.push('bridge_error');
            }
            if (!payload.registration.runtime.commandBridgeSupported) {
                bridgeReasons.push('command_bridge_not_supported');
            }
            if (payload.registration.runtime.commandBridgeError) {
                bridgeReasons.push('command_bridge_error');
            }
            if (payload.registration.runtime.queue.backoff > 0) {
                bridgeReasons.push('queue_backoff');
            }
        }
        const bridge = {
            required: requireBridge,
            healthy: bridgeReasons.length === 0,
            reasons: bridgeReasons
        };
        const exitCode = (requireBridge && !bridge.healthy)
            ? 1
            : (posture === 'connected' ? 0 : 1);

        if (Boolean(flags.json)) {
            console.log(JSON.stringify({ ...payload, bridge }, null, 2));
            return exitCode;
        }

        console.log('\nConnector Status\n');
        console.log(`  posture:      ${payload.posture}`);
        console.log(`  daemon:       ${payload.daemon.running ? 'running' : 'not running'}`);
        console.log(`  registration: ${payload.registration.registered ? 'registered' : 'not registered'}`);
        console.log(`  auth:         ${payload.auth.authenticated ? 'authenticated' : 'not authenticated'}`);
        console.log(`  cloud:        ${payload.cloud.connected ? 'connected' : (payload.cloud.required ? 'not connected' : 'optional')}`);
        console.log(`  dashboard:    ${payload.dashboardUrl}`);
        if (payload.registration.registered) {
            console.log(`  machine_id:   ${payload.registration.machineId}`);
            if (payload.registration.runtime) {
                console.log(
                    `  event_bridge: supported=${payload.registration.runtime.eventBridgeSupported}` +
                    ` sequence=${payload.registration.runtime.lastEventSequence}`
                );
                console.log(
                    `  command_bridge: supported=${payload.registration.runtime.commandBridgeSupported}` +
                    ` cursor=${payload.registration.runtime.lastCommandCursor}`
                );
                console.log(
                    `  event_queue:  pending=${payload.registration.runtime.queue.pending}` +
                    ` ready=${payload.registration.runtime.queue.ready}` +
                    ` backoff=${payload.registration.runtime.queue.backoff}`
                );
                if (payload.registration.runtime.lastEventSyncAt) {
                    console.log(`  event_sync:   ${payload.registration.runtime.lastEventSyncAt}`);
                }
                if (payload.registration.runtime.eventBridgeError) {
                    console.log(`  event_error:  ${payload.registration.runtime.eventBridgeError}`);
                }
                if (payload.registration.runtime.lastCommandSyncAt) {
                    console.log(`  command_sync: ${payload.registration.runtime.lastCommandSyncAt}`);
                }
                if (payload.registration.runtime.commandBridgeError) {
                    console.log(`  command_error: ${payload.registration.runtime.commandBridgeError}`);
                }
            }
        }
        if (payload.cloud.registrationId) {
            console.log(`  cloud_reg_id: ${payload.cloud.registrationId}`);
        }
        if (payload.cloud.lastError) {
            console.log(`  cloud_error:  ${payload.cloud.lastError}`);
        }
        if (payload.sync) {
            console.log(`  sync:         enabled=${payload.sync.enabled} running=${payload.sync.running}`);
            if (payload.sync.lastError) {
                console.log(`  sync_error:   ${payload.sync.lastError}`);
            }
        }
        if (!payload.daemon.running && payload.daemon.error) {
            console.log(`  daemon_error: ${payload.daemon.error}`);
        }
        if (requireBridge || !bridge.healthy) {
            console.log(`  bridge:       ${bridge.healthy ? 'healthy' : 'unhealthy'}`);
            if (!bridge.healthy) {
                console.log(`  bridge_issue: ${bridge.reasons.join(',')}`);
            }
        }
        console.log('');
        return exitCode;
    }

    if (action === 'logs') {
        const platform = os.platform();
        if (platform === 'win32') {
            console.log('Use Windows Event Viewer (Application logs) for service diagnostics.');
        } else if (platform === 'darwin') {
            console.log('Use: log stream --process 0ctx-daemon');
        } else if (platform === 'linux') {
            console.log('Use: systemctl --user status 0ctx-daemon && journalctl --user -u 0ctx-daemon -f');
        } else {
            console.log('No log helper available for this platform.');
        }
        return 0;
    }

    console.log(`connector ${action}: delegating to managed service lifecycle commands.`);
    return commandDaemonService(action);
}

async function commandSetup(flags: Record<string, string | boolean>): Promise<number> {
    const asJson = Boolean(flags.json);
    const quiet = Boolean(flags.quiet) || asJson;
    const skipService = Boolean(flags['skip-service']);
    const skipBootstrap = Boolean(flags['skip-bootstrap']);
    const requireCloud = Boolean(flags['require-cloud']);
    const waitCloudReady = Boolean(flags['wait-cloud-ready']);
    const cloudWaitTimeoutMs = parsePositiveIntegerFlag(flags['cloud-wait-timeout-ms'], 60_000);
    const cloudWaitIntervalMs = parsePositiveIntegerFlag(flags['cloud-wait-interval-ms'], 2_000);
    const createContextName = parseOptionalStringFlag(flags['create-context']);
    const dashboardQueryInput = flags['dashboard-query'];
    const steps: Array<{
        id: string;
        status: 'pass' | 'warn' | 'fail';
        code: number;
        message: string;
    }> = [];

    if (!quiet) {
        console.log('Running setup workflow...');
    }

    if (!resolveToken()) {
        if (!quiet) {
            console.log('auth: no active session found. Starting login...');
        }
        const authCode = await commandAuthLogin(flags);
        steps.push({
            id: 'auth_login',
            status: authCode === 0 ? 'pass' : 'fail',
            code: authCode,
            message: authCode === 0 ? 'Authentication completed.' : 'Authentication failed.'
        });
        if (authCode !== 0) {
            if (asJson) {
                console.log(JSON.stringify({ ok: false, steps, dashboardUrl: getHostedDashboardUrl() }, null, 2));
            }
            return authCode;
        }
    } else {
        if (!quiet) {
            console.log('auth: already logged in');
        }
        steps.push({
            id: 'auth_login',
            status: 'pass',
            code: 0,
            message: 'Already authenticated.'
        });
    }

    if (skipService) {
        steps.push({
            id: 'connector_service',
            status: 'warn',
            code: 0,
            message: 'Service installation/start was skipped by --skip-service.'
        });
    } else {
        // Best effort: install/enable/start managed service.
        for (const action of ['install', 'enable', 'start'] as const) {
            const code = await commandConnector(action, { ...flags, quiet });
            steps.push({
                id: `connector_service_${action}`,
                status: code === 0 ? 'pass' : 'warn',
                code,
                message: code === 0
                    ? `Connector service ${action} succeeded.`
                    : `Connector service ${action} failed; continuing with local runtime flow.`
            });
            if (code !== 0 && !quiet) {
                console.log(`connector ${action}: warning (continuing with local runtime flow)`);
            }
        }
    }

    const installCode = await commandInstall({ ...flags, quiet, json: false, 'skip-bootstrap': skipBootstrap });
    steps.push({
        id: 'install',
        status: installCode === 0 ? 'pass' : 'fail',
        code: installCode,
        message: installCode === 0
            ? `Install workflow completed${skipBootstrap ? ' (bootstrap skipped).' : '.'}`
            : 'Install workflow failed.'
    });
    if (installCode !== 0) {
        if (asJson) {
            console.log(JSON.stringify({ ok: false, steps, dashboardUrl: getHostedDashboardUrl() }, null, 2));
        }
        return installCode;
    }

    const registerCode = await commandConnector('register', { ...flags, quiet: true, json: false, 'require-cloud': requireCloud });
    steps.push({
        id: 'connector_register',
        status: registerCode === 0 ? 'pass' : 'fail',
        code: registerCode,
        message: registerCode === 0 ? 'Connector registration completed.' : 'Connector registration failed.'
    });
    if (registerCode !== 0) {
        console.error('setup_register_failed: unable to register connector metadata');
        if (asJson) {
            console.log(JSON.stringify({ ok: false, steps, dashboardUrl: getHostedDashboardUrl() }, null, 2));
        }
        return registerCode;
    }

    const verifyCode = await commandConnector('verify', {
        ...flags,
        quiet: true,
        json: false,
        'require-cloud': requireCloud,
        cloud: requireCloud
    });
    steps.push({
        id: 'connector_verify',
        status: verifyCode === 0 ? 'pass' : 'fail',
        code: verifyCode,
        message: verifyCode === 0 ? 'Connector verification passed.' : 'Connector verification failed.'
    });
    if (verifyCode !== 0) {
        console.error('setup_verify_failed: connector/runtime verification failed');
        if (asJson) {
            console.log(JSON.stringify({ ok: false, steps, dashboardUrl: getHostedDashboardUrl() }, null, 2));
        }
        return verifyCode;
    }

    if (waitCloudReady || requireCloud) {
        if (!quiet) {
            console.log('cloud: waiting for connector cloud-ready posture...');
        }

        const waitStartedAt = Date.now();
        let attempts = 0;
        let ready = false;
        while (Date.now() - waitStartedAt < cloudWaitTimeoutMs) {
            attempts += 1;
            const cloudVerifyCode = await commandConnector('verify', {
                ...flags,
                quiet: true,
                json: false,
                'require-cloud': true,
                cloud: true
            });
            if (cloudVerifyCode === 0) {
                ready = true;
                break;
            }
            await sleepMs(cloudWaitIntervalMs);
        }

        const elapsedMs = Date.now() - waitStartedAt;
        steps.push({
            id: 'cloud_ready',
            status: ready ? 'pass' : 'fail',
            code: ready ? 0 : 1,
            message: ready
                ? `Cloud-ready posture confirmed after ${attempts} attempt(s) in ${elapsedMs}ms.`
                : `Cloud-ready posture not confirmed within ${elapsedMs}ms (${attempts} attempt(s)).`
        });

        if (!ready) {
            if (asJson) {
                console.log(JSON.stringify({ ok: false, steps, dashboardUrl: getHostedDashboardUrl() }, null, 2));
            } else {
                console.error('setup_cloud_ready_timeout: connector did not reach cloud-ready posture within timeout');
            }
            return 1;
        }
    }

    let createdContextId: string | null = null;
    if (createContextName) {
        try {
            const created = await sendToDaemon('createContext', { name: createContextName }) as { id?: string; contextId?: string };
            createdContextId = created?.id ?? created?.contextId ?? null;
            steps.push({
                id: 'create_context',
                status: 'pass',
                code: 0,
                message: `Context created: ${createContextName}`
            });
        } catch (error) {
            const errorText = error instanceof Error ? error.message : String(error);
            steps.push({
                id: 'create_context',
                status: 'fail',
                code: 1,
                message: `Failed to create context '${createContextName}': ${errorText}`
            });
            if (asJson) {
                console.log(JSON.stringify({ ok: false, steps, dashboardUrl: getHostedDashboardUrl() }, null, 2));
            } else {
                console.error(`setup_create_context_failed: ${errorText}`);
            }
            return 1;
        }
    }

    let dashboardQuery = parseOptionalStringFlag(dashboardQueryInput);
    if (dashboardQueryInput !== undefined) {
        const parts = new URLSearchParams(dashboardQuery ?? '');
        const state = readConnectorState();
        if (state) {
            parts.set('machineId', state.machineId);
            if (state.tenantId) parts.set('tenantId', state.tenantId);
            parts.set('registrationMode', state.registrationMode);
        }
        if (createContextName) parts.set('contextName', createContextName);
        if (createdContextId) parts.set('contextId', createdContextId);
        if (requireCloud) parts.set('requireCloud', '1');
        dashboardQuery = parts.toString();
    }

    const resolvedDashboardUrl = applyDashboardQuery(getHostedDashboardUrl(), dashboardQuery ?? undefined);
    const dashboardFlags = dashboardQuery ? { ...flags, 'dashboard-query': dashboardQuery } : flags;
    const dashboardCode = asJson ? 0 : await commandDashboard(dashboardFlags);
    steps.push({
        id: 'dashboard_handoff',
        status: dashboardCode === 0 ? 'pass' : 'fail',
        code: dashboardCode,
        message: dashboardCode === 0 ? 'Dashboard handoff completed.' : 'Dashboard handoff failed.'
    });

    if (asJson) {
        console.log(JSON.stringify({
            ok: dashboardCode === 0,
            steps,
            dashboardUrl: resolvedDashboardUrl
        }, null, 2));
    }

    return dashboardCode;
}

function printHelp(): void {
    console.log(`0ctx CLI

Usage:
  0ctx                    First run: auto setup + auth. Afterwards: interactive shell.
  0ctx shell
  0ctx version
  0ctx --version | -v
  0ctx setup [--clients=all|claude,cursor,windsurf] [--no-open] [--json]
             [--require-cloud] [--wait-cloud-ready]
             [--cloud-wait-timeout-ms=60000] [--cloud-wait-interval-ms=2000]
             [--create-context=<name>] [--dashboard-query[=k=v&...]]
             [--skip-service] [--skip-bootstrap]
  0ctx install [--clients=all|claude,cursor,windsurf] [--json] [--skip-bootstrap]
  0ctx bootstrap [--dry-run] [--clients=...] [--entrypoint=/path/to/mcp-server.js] [--json]
  0ctx doctor [--json] [--clients=...]
  0ctx status
  0ctx repair [--clients=...]
  0ctx logs [--no-open]
  0ctx dashboard [--no-open] [--dashboard-query=k=v&...]
  0ctx release publish --version vX.Y.Z [--tag latest|next] [--otp 123456] [--dry-run] [--json]
  0ctx daemon start

Authentication:
  0ctx auth login    Start device-code login flow
  0ctx auth logout   Clear stored credentials
  0ctx auth status   Show current auth state
  0ctx auth status --json

Configuration:
  0ctx config list              Show all settings
  0ctx config get <key>         Get a specific setting
  0ctx config set <key> <value> Set a specific setting

  Config keys: auth.server, sync.enabled, sync.endpoint, ui.url,
               integration.chatgpt.enabled, integration.chatgpt.requireApproval, integration.autoBootstrap

Sync:
  0ctx sync status   Show sync engine health and queue
  0ctx sync policy get --context-id=<contextId>
  0ctx sync policy set <local_only|metadata_only|full_sync> --context-id=<contextId>

Connector:
  0ctx connector service install|enable|disable|uninstall|status|start|stop|restart
  0ctx connector install|enable|disable|uninstall|status|start|stop|restart
  0ctx connector status [--json] [--cloud] [--require-bridge]
  0ctx connector verify [--require-cloud] [--json]
  0ctx connector register [--force] [--local-only] [--require-cloud] [--json]
  0ctx connector run [--once] [--interval-ms=30000] [--no-daemon-autostart]
  0ctx connector queue status [--json]
  0ctx connector queue drain [--max-batches=10] [--batch-size=200] [--wait] [--strict|--fail-on-retry] [--timeout-ms=120000] [--poll-ms=1000] [--json]
  0ctx connector queue purge [--all|--older-than-hours=N|--min-attempts=N] [--dry-run|--confirm] [--json]
  0ctx connector queue logs [--limit=50] [--json] [--clear --confirm|--dry-run]
  0ctx connector logs

Service management compatibility (requires Admin on Windows):
  Both command paths manage the same underlying OS service.
  Preferred: 0ctx connector service <action>
  Legacy:    0ctx daemon service <action>

Legacy daemon service commands:
  0ctx daemon service install    Register daemon as a service
  0ctx daemon service enable     Set service start type to Automatic
  0ctx daemon service disable    Set service start type to Manual
  0ctx daemon service start      Start the service
  0ctx daemon service stop       Stop the service
  0ctx daemon service restart    Stop then start the service
  0ctx daemon service status     Show current service state
  0ctx daemon service uninstall  Remove service registration
`);
}

// ─── Config command ──────────────────────────────────────────────────────────

function commandConfigList(): number {
    const entries = listConfig();
    console.log(`\nConfig (${getConfigPath()})\n`);
    for (const entry of entries) {
        const srcTag = entry.source === 'default' ? ' (default)' : entry.source === 'env' ? ' (env)' : '';
        console.log(`  ${entry.key} = ${JSON.stringify(entry.value)}${srcTag}`);
    }
    console.log('');
    return 0;
}

function commandConfigGet(key: string | undefined): number {
    if (!key) {
        console.error('Usage: 0ctx config get <key>');
        return 1;
    }
    if (!isValidConfigKey(key)) {
        console.error(`Unknown config key: ${key}`);
        console.error(`Valid keys: ${listConfig().map(e => e.key).join(', ')}`);
        return 1;
    }
    console.log(getConfigValue(key));
    return 0;
}

function commandConfigSet(key: string | undefined, value: string | undefined): number {
    if (!key || value === undefined) {
        console.error('Usage: 0ctx config set <key> <value>');
        return 1;
    }
    if (!isValidConfigKey(key)) {
        console.error(`Unknown config key: ${key}`);
        console.error(`Valid keys: ${listConfig().map(e => e.key).join(', ')}`);
        return 1;
    }

    const booleanKeys = new Set<keyof AppConfig>([
        'sync.enabled',
        'integration.chatgpt.enabled',
        'integration.chatgpt.requireApproval',
        'integration.autoBootstrap'
    ]);

    // Parse booleans for boolean-backed config keys.
    let parsed: unknown = value;
    if (booleanKeys.has(key)) {
        parsed = value === 'true' || value === '1';
    }

    setConfigValue(key, parsed as AppConfig[typeof key]);
    console.log(`Set ${key} = ${JSON.stringify(parsed)}`);
    return 0;
}

// ─── Sync command ────────────────────────────────────────────────────────────

async function commandSyncStatus(): Promise<number> {
    try {
        const status = await sendToDaemon('syncStatus', {}) as {
            enabled: boolean;
            running: boolean;
            lastPushAt: number | null;
            lastPullAt: number | null;
            lastError: string | null;
            queue: { pending: number; inFlight: number; failed: number; done: number };
        };

        console.log('\nSync Status\n');
        console.log(`  Enabled:     ${status.enabled}`);
        console.log(`  Running:     ${status.running}`);
        console.log(`  Endpoint:    ${getConfigValue('sync.endpoint')}`);
        console.log(`  Last push:   ${status.lastPushAt ? new Date(status.lastPushAt).toISOString() : 'never'}`);
        console.log(`  Last pull:   ${status.lastPullAt ? new Date(status.lastPullAt).toISOString() : 'never'}`);
        if (status.lastError) {
            console.log(`  Last error:  ${status.lastError}`);
        }
        console.log('');
        console.log('  Queue:');
        console.log(`    Pending:   ${status.queue.pending}`);
        console.log(`    In-flight: ${status.queue.inFlight}`);
        console.log(`    Failed:    ${status.queue.failed}`);
        console.log(`    Done:      ${status.queue.done}`);
        console.log('');
        return 0;
    } catch (error) {
        console.error('Failed to get sync status:', error instanceof Error ? error.message : String(error));
        console.error('Is the daemon running? Try: 0ctx daemon start');
        return 1;
    }
}

function getContextIdFlag(flags: Record<string, string | boolean>): string | null {
    const contextId = flags['context-id'] ?? flags.contextId;
    if (typeof contextId === 'string' && contextId.trim().length > 0) {
        return contextId.trim();
    }
    return null;
}

async function commandSyncPolicyGet(flags: Record<string, string | boolean>): Promise<number> {
    const contextId = getContextIdFlag(flags);
    if (!contextId) {
        console.error("Missing required '--context-id' for `0ctx sync policy get`.");
        return 1;
    }

    try {
        const result = await sendToDaemon('getSyncPolicy', { contextId }) as { contextId: string; syncPolicy: string };
        console.log('\nSync Policy\n');
        console.log(`  Context: ${result.contextId}`);
        console.log(`  Policy:  ${result.syncPolicy}`);
        console.log('');
        return 0;
    } catch (error) {
        console.error('Failed to get sync policy:', error instanceof Error ? error.message : String(error));
        console.error('Is the daemon running? Try: 0ctx daemon start');
        return 1;
    }
}

async function commandSyncPolicySet(
    policy: string | undefined,
    flags: Record<string, string | boolean>
): Promise<number> {
    const contextId = getContextIdFlag(flags);
    if (!contextId) {
        console.error("Missing required '--context-id' for `0ctx sync policy set`.");
        return 1;
    }

    if (policy !== 'local_only' && policy !== 'metadata_only' && policy !== 'full_sync') {
        console.error("Invalid policy. Expected one of: local_only, metadata_only, full_sync.");
        return 1;
    }

    try {
        const result = await sendToDaemon('setSyncPolicy', { contextId, syncPolicy: policy }) as { contextId: string; syncPolicy: string };
        console.log(`Sync policy updated: ${result.contextId} -> ${result.syncPolicy}`);
        return 0;
    } catch (error) {
        console.error('Failed to set sync policy:', error instanceof Error ? error.message : String(error));
        console.error('Is the daemon running? Try: 0ctx daemon start');
        return 1;
    }
}

async function commandDaemonService(action: string | undefined): Promise<number> {
    const platform = os.platform();

    type ServiceOps = {
        install: () => void;
        enable: () => void;
        disable: () => void;
        uninstall: () => void;
        status: () => void;
        start: () => void;
        stop: () => void;
        restart: () => void;
    };

    let ops: ServiceOps | undefined;
    if (platform === 'win32') {
        ops = {
            install: installServiceWindows,
            enable: enableServiceWindows,
            disable: disableServiceWindows,
            uninstall: uninstallServiceWindows,
            status: statusServiceWindows,
            start: startServiceWindows,
            stop: stopServiceWindows,
            restart: restartServiceWindows,
        };
    } else if (platform === 'darwin') {
        ops = {
            install: installServiceMac,
            enable: enableServiceMac,
            disable: disableServiceMac,
            uninstall: uninstallServiceMac,
            status: statusServiceMac,
            start: startServiceMac,
            stop: stopServiceMac,
            restart: restartServiceMac,
        };
    } else if (platform === 'linux') {
        ops = {
            install: installServiceLinux,
            enable: enableServiceLinux,
            disable: disableServiceLinux,
            uninstall: uninstallServiceLinux,
            status: statusServiceLinux,
            start: startServiceLinux,
            stop: stopServiceLinux,
            restart: restartServiceLinux,
        };
    } else {
        console.error(`daemon service commands are not supported on platform: ${platform}`);
        return 1;
    }

    const validActions = ['install', 'enable', 'disable', 'uninstall', 'status', 'start', 'stop', 'restart'];
    if (!action || !validActions.includes(action)) {
        console.error(`Unknown service action: '${action ?? ''}'`);
        console.error(`Valid actions: ${validActions.join(', ')}`);
        return 1;
    }

    try {
        ops[action as keyof ServiceOps]();
        return 0;
    } catch (error) {
        console.error(`service ${action} failed:`, error instanceof Error ? error.message : String(error));
        return 1;
    }
}

function normalizeVersionCommandArgs(argv: string[]): string[] {
    if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-v')) {
        return ['version'];
    }
    return argv;
}

function resolveCommandOperation(parsed: ParsedArgs): string {
    if (parsed.command === 'auth') {
        return parsed.subcommand ? `cli.auth.${parsed.subcommand}` : 'cli.auth';
    }
    if (parsed.command === 'config') {
        return parsed.subcommand ? `cli.config.${parsed.subcommand}` : 'cli.config.list';
    }
    if (parsed.command === 'sync') {
        if (parsed.subcommand === 'policy') {
            const action = parsed.positionalArgs[0] || 'unknown';
            return `cli.sync.policy.${action}`;
        }
        return parsed.subcommand ? `cli.sync.${parsed.subcommand}` : 'cli.sync.status';
    }
    if (parsed.command === 'connector') {
        if (parsed.subcommand === 'service') {
            const action = parsed.serviceAction || 'unknown';
            return `cli.connector.service.${action}`;
        }
        if (parsed.subcommand === 'queue') {
            const action = parsed.positionalArgs[0] || 'status';
            return `cli.connector.queue.${action}`;
        }
        return parsed.subcommand ? `cli.connector.${parsed.subcommand}` : 'cli.connector';
    }
    if (parsed.command === 'daemon') {
        if (parsed.subcommand === 'service') {
            const action = parsed.serviceAction || 'unknown';
            return `cli.daemon.service.${action}`;
        }
        return parsed.subcommand ? `cli.daemon.${parsed.subcommand}` : 'cli.daemon';
    }
    if (parsed.command === 'release') {
        return parsed.subcommand ? `cli.release.${parsed.subcommand}` : 'cli.release';
    }
    return `cli.${parsed.command}`;
}

async function runCommandWithOpsSummary(
    operation: string,
    action: () => Promise<number> | number,
    details: Record<string, unknown> = {}
): Promise<number> {
    const startedAt = Date.now();
    try {
        const exitCode = await Promise.resolve(action());
        appendCliOpsLogEntry({
            operation,
            status: exitCode === 0 ? 'success' : 'error',
            details: {
                ...details,
                exitCode,
                durationMs: Date.now() - startedAt
            }
        });
        return exitCode;
    } catch (error) {
        appendCliOpsLogEntry({
            operation,
            status: 'error',
            details: {
                ...details,
                exitCode: 1,
                durationMs: Date.now() - startedAt,
                error: error instanceof Error ? error.message : String(error)
            }
        });
        throw error;
    }
}

async function main(): Promise<number> {
    const argv = normalizeVersionCommandArgs(process.argv.slice(2));

    let deviceId: string | undefined;
    try {
        const state = readConnectorState();
        if (state) deviceId = state.machineId;
    } catch (e) { }
    initTelemetry(deviceId);

    if (argv.length === 0) {
        if (process.env.CTX_SHELL_MODE === '1') {
            captureEvent('cli_command_executed', { command: 'help' });
            return runCommandWithOpsSummary('cli.help', () => {
                printHelp();
                return 0;
            }, { command: 'help', interactive: true });
        }
        if (process.stdin.isTTY && process.stdout.isTTY) {
            // Auto-run setup if this machine hasn't been fully configured yet.
            // Checks: (1) no auth token, (2) expired token (try silent refresh first),
            // (3) no connector state on disk.
            const tokenStore = resolveToken();
            const connectorState = readConnectorState();

            if (!tokenStore) {
                console.log(color.bold('\nWelcome to 0ctx!'));
                console.log(color.dim("Looks like this is your first time. Let's get you set up.\n"));
                return runCommandWithOpsSummary('cli.setup', () => commandSetup({}), { command: 'setup', interactive: true });
            }

            // If the stored token is expired, attempt a silent refresh.
            // Fall back to interactive login only if the refresh fails.
            if (!getEnvToken() && isTokenExpired(tokenStore)) {
                let refreshed = false;
                if (tokenStore.refreshToken) {
                    try {
                        await refreshAccessToken(tokenStore);
                        refreshed = true;
                    } catch {
                        // Refresh failed — will prompt below
                    }
                }
                if (!refreshed) {
                    console.log(color.bold('\nYour session has expired.'));
                    console.log(color.dim('Logging you back in...\n'));
                    const loginCode = await runCommandWithOpsSummary(
                        'cli.auth.login',
                        () => commandAuthLogin({}),
                        { command: 'auth', subcommand: 'login', interactive: true }
                    );
                    if (loginCode !== 0) return loginCode;
                }
            }

            if (!connectorState) {
                console.log(color.bold('\nAlmost there!'));
                console.log(color.dim("This machine isn't registered yet. Running setup to connect it...\n"));
                captureEvent('cli_command_executed', { command: 'setup', interactive: true });
                return runCommandWithOpsSummary('cli.setup', () => commandSetup({}), { command: 'setup', interactive: true });
            }

            captureEvent('cli_command_executed', { command: 'shell', interactive: true });
            return runCommandWithOpsSummary('cli.shell', () => commandShell(), { command: 'shell', interactive: true });
        }
        captureEvent('cli_command_executed', { command: 'help' });
        return runCommandWithOpsSummary('cli.help', () => {
            printHelp();
            return 0;
        }, { command: 'help', interactive: false });
    }

    const parsed = parseArgs(argv);
    captureEvent('cli_command_executed', { command: parsed.command, subcommand: parsed.subcommand });
    const operation = resolveCommandOperation(parsed);
    return runCommandWithOpsSummary(operation, async () => {
        switch (parsed.command) {
            case 'setup':
                return commandSetup(parsed.flags);
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
            case 'version':
                return commandVersion();
            case 'auth': {
                const sub = parsed.subcommand;
                if (sub === 'login') return commandAuthLogin(parsed.flags);
                if (sub === 'logout') return Promise.resolve(commandAuthLogout());
                if (sub === 'status') return Promise.resolve(commandAuthStatus(parsed.flags));
                if (sub === 'rotate') return commandAuthRotate(parsed.flags);
                console.log(`\nAuthentication commands:\n`);
                console.log(`  auth login    Start device-code login flow`);
                console.log(`  auth logout   Clear stored credentials`);
                console.log(`  auth status   Show current auth state\n`);
                return sub ? 1 : 0;
            }
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
                if (parsed.subcommand === 'service') {
                    return commandDaemonService(parsed.serviceAction);
                }
                printHelp();
                return 1;
            case 'config': {
                const sub = parsed.subcommand;
                if (sub === 'list' || !sub) return commandConfigList();
                if (sub === 'get') return commandConfigGet(parsed.positionalArgs[0]);
                if (sub === 'set') return commandConfigSet(parsed.positionalArgs[0], parsed.positionalArgs[1]);
                printHelp();
                return 1;
            }
            case 'sync': {
                const sub = parsed.subcommand;
                if (sub === 'status' || !sub) return commandSyncStatus();
                if (sub === 'policy') {
                    const action = parsed.positionalArgs[0];
                    if (action === 'get') return commandSyncPolicyGet(parsed.flags);
                    if (action === 'set') return commandSyncPolicySet(parsed.positionalArgs[1], parsed.flags);
                    console.error('Usage: 0ctx sync policy get --context-id=<contextId>');
                    console.error('   or: 0ctx sync policy set <local_only|metadata_only|full_sync> --context-id=<contextId>');
                    return 1;
                }
                printHelp();
                return 1;
            }
            case 'connector':
                if (parsed.subcommand === 'service') {
                    return commandDaemonService(parsed.serviceAction);
                }
                if (parsed.subcommand === 'queue') {
                    return commandConnectorQueue(parsed.positionalArgs[0], parsed.flags);
                }
                return commandConnector(parsed.subcommand, parsed.flags);
            case 'logs':
                return commandLogs(parsed.flags);
            case 'dashboard':
                return commandDashboard(parsed.flags);
            case 'shell':
                return commandShell();
            case 'release':
                if (parsed.subcommand === 'publish') {
                    return commandReleasePublish(parsed.flags);
                }
                printHelp();
                return 1;
            case 'ui':
                console.error('`0ctx ui` has been removed from the end-user flow.');
                console.error('Use `0ctx setup` and then open the hosted dashboard URL (or run `0ctx dashboard`).');
                return 1;
            case 'help':
                printHelp();
                return 0;
            default:
                printHelp();
                return 1;
        }
    }, {
        command: parsed.command,
        subcommand: parsed.subcommand ?? null,
        interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY)
    });
}

main()
    .then(async code => {
        await shutdownTelemetry();
        process.exitCode = code;
    })
    .catch(async error => {
        await shutdownTelemetry();
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
