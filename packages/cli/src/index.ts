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

type SupportedClient = 'claude' | 'cursor' | 'windsurf' | 'codex' | 'antigravity';
type CheckStatus = 'pass' | 'warn' | 'fail';
type BootstrapResult = { client: string; status: string; configPath: string; message?: string };

interface DoctorCheck {
    id: string;
    status: CheckStatus;
    message: string;
    details?: Record<string, unknown>;
}

interface RepairStep {
    id: string;
    status: CheckStatus;
    code: number;
    message: string;
    details?: Record<string, unknown>;
}

interface SetupStep {
    id: string;
    status: CheckStatus;
    code: number;
    message: string;
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

const SUPPORTED_CLIENTS: SupportedClient[] = ['claude', 'cursor', 'windsurf', 'codex', 'antigravity'];
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
    if (normalized === 'log') return 'logs';
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
        || command === 'mcp'
        || command === 'release';
    const tokens = hasSubcommand
        ? rest
        : [maybeSubcommand, ...rest].filter((token): token is string => Boolean(token));
    const flags: Record<string, string | boolean> = {};

    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (!token.startsWith('--')) continue;

        const equalsIndex = token.indexOf('=');
        const rawKey = equalsIndex === -1 ? token : token.slice(0, equalsIndex);
        const rawValue = equalsIndex === -1 ? undefined : token.slice(equalsIndex + 1);
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
        .split(/[,\s]+/)
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

interface DaemonCapabilityCheck {
    ok: boolean;
    reachable: boolean;
    apiVersion: string | null;
    methods: string[];
    missingMethods: string[];
    error: string | null;
    recoverySteps: string[];
}

async function checkDaemonCapabilities(requiredMethods: string[]): Promise<DaemonCapabilityCheck> {
    const daemon = await isDaemonReachable();
    if (!daemon.ok) {
        return {
            ok: false,
            reachable: false,
            apiVersion: null,
            methods: [],
            missingMethods: [...requiredMethods],
            error: daemon.error ?? 'daemon_unreachable',
            recoverySteps: inferDaemonRecoverySteps(daemon.error)
        };
    }

    try {
        const capabilities = await sendToDaemon('getCapabilities', {}) as { apiVersion?: string; methods?: string[] } | null;
        const apiVersion = typeof capabilities?.apiVersion === 'string' ? capabilities.apiVersion : null;
        const methods = Array.isArray(capabilities?.methods) ? capabilities.methods : [];
        const missingMethods = requiredMethods.filter(method => !methods.includes(method));
        const versionMismatch = apiVersion !== null && apiVersion !== '2';
        const ok = !versionMismatch && missingMethods.length === 0;
        return {
            ok,
            reachable: true,
            apiVersion,
            methods,
            missingMethods,
            error: versionMismatch ? `api_version_mismatch:${apiVersion}` : null,
            recoverySteps: ['0ctx daemon start', '0ctx connector service restart']
        };
    } catch (error) {
        return {
            ok: false,
            reachable: true,
            apiVersion: null,
            methods: [],
            missingMethods: [...requiredMethods],
            error: error instanceof Error ? error.message : String(error),
            recoverySteps: ['0ctx daemon start', '0ctx connector service restart']
        };
    }
}

function printCapabilityMismatch(commandLabel: string, check: DaemonCapabilityCheck): void {
    console.error(`${commandLabel}_unavailable: daemon capability check failed.`);
    if (check.error) {
        console.error(`reason: ${check.error}`);
    }
    if (check.apiVersion && check.apiVersion !== '2') {
        console.error(`api_version: ${check.apiVersion} (expected 2)`);
    }
    if (check.missingMethods.length > 0) {
        console.error(`missing_methods: ${check.missingMethods.join(', ')}`);
    }
    console.error('Restart daemon/service after updating binaries:');
    for (const step of check.recoverySteps) {
        console.error(`  ${step}`);
    }
}

function inferDaemonRecoverySteps(error?: string): string[] {
    const normalized = (error ?? '').toLowerCase();
    const steps: string[] = ['0ctx daemon start'];

    if (normalized.includes('enoent') || normalized.includes('econnrefused') || normalized.includes('not running')) {
        steps.push('0ctx connector service status');
        steps.push('0ctx connector service start');
    }

    if (normalized.includes('eacces') || normalized.includes('permission') || normalized.includes('access is denied')) {
        steps.push('Run terminal as Administrator, then retry service commands');
    }

    steps.push('0ctx doctor');
    return Array.from(new Set(steps));
}

function resolveDaemonEntrypoint(): string {
    const candidates = [
        path.resolve(__dirname, 'daemon.js'),
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

    throw new Error(
        'Could not resolve daemon entrypoint. Run `npm run build` (repo) or reinstall/repair the CLI package.'
    );
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
    const normalizeDashboardBaseUrl = (input: string): string => {
        try {
            const parsed = new URL(input);
            const host = parsed.hostname.toLowerCase();
            const isLegacyHost = host === '0ctx.com'
                || host === 'www.0ctx.com'
                || host === 'app.0ctx.com';
            const isRootPath = parsed.pathname === '' || parsed.pathname === '/';
            if (isLegacyHost && isRootPath) {
                parsed.hostname = 'www.0ctx.com';
                parsed.pathname = '/dashboard/workspace';
                return parsed.toString();
            }
            return parsed.toString();
        } catch {
            return input;
        }
    };

    const configured = getConfigValue('ui.url');
    if (typeof configured === 'string' && configured.trim().length > 0) {
        return normalizeDashboardBaseUrl(configured.trim());
    }
    return normalizeDashboardBaseUrl('https://www.0ctx.com/dashboard/workspace');
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
    explicitEntrypoint?: string,
    profile?: string
): ReturnType<typeof bootstrapMcpRegistration> {
    return bootstrapMcpRegistration({
        clients,
        dryRun,
        serverName: '0ctx',
        entrypoint: resolveMcpEntrypointForBootstrap(explicitEntrypoint),
        profile
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

async function commandStatus(flags: Record<string, string | boolean> = {}): Promise<number> {
    const asJson = Boolean(flags.json);
    const compact = Boolean(flags.compact);
    const p = (asJson || compact) ? null : await import('@clack/prompts');
    const s = p ? p.spinner() : null;

    if (p && s) {
        p.intro(color.bgCyan(color.black(' 0ctx status ')));
        s.start('Checking daemon health');
    }

    let daemon = await isDaemonReachable();

    // Auto-start daemon if not running (best-effort, no error if it fails)
    if (!daemon.ok) {
        if (s) {
            s.message('Daemon not running — starting...');
        }
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

    if (s) {
        s.stop(`Daemon is ${daemon.ok ? color.green('running') : color.red('not running')}`);
    }

    let capabilities: any = null;
    const missingFeatures: string[] = [];
    const recoverySteps = daemon.ok ? [] : inferDaemonRecoverySteps(daemon.error);
    let apiError: string | null = null;

    if (daemon.ok) {
        try {
            capabilities = await sendToDaemon('getCapabilities', {});
            const methodNames = Array.isArray(capabilities?.methods) ? capabilities.methods : [];
            if (!methodNames.includes('recall')) {
                missingFeatures.push('recall');
            }
        } catch (error) {
            apiError = error instanceof Error ? error.message : String(error);
        }
    }

    const methodNames = Array.isArray(capabilities?.methods) ? capabilities.methods : [];
    const payload = {
        ok: daemon.ok && missingFeatures.length === 0,
        daemon: {
            running: daemon.ok,
            error: daemon.ok ? null : (daemon.error ?? 'unknown'),
            recoverySteps,
            health: daemon.ok ? (daemon.health ?? null) : null
        },
        paths: {
            socket: SOCKET_PATH,
            database: DB_PATH,
            masterKeyPath: KEY_PATH,
            masterKeyPresent: fs.existsSync(KEY_PATH) || Boolean(process.env.CTX_MASTER_KEY)
        },
        capabilities: daemon.ok ? {
            apiVersion: capabilities?.apiVersion ?? 'unknown',
            methodCount: methodNames.length,
            methods: methodNames,
            missingFeatures
        } : null,
        apiError
    };

    if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
        return payload.ok ? 0 : 1;
    }
    if (compact) {
        const methodCount = payload.capabilities?.methodCount ?? 0;
        const missing = payload.capabilities?.missingFeatures ?? [];
        const sync = payload.daemon.health?.sync as { enabled?: boolean; running?: boolean } | null | undefined;
        const syncState = sync
            ? `enabled=${Boolean(sync.enabled)} running=${Boolean(sync.running)}`
            : 'enabled=false running=false';
        const reason = payload.daemon.running
            ? (missing.length > 0 ? `missing=${missing.join(',')}` : 'healthy')
            : `error=${payload.daemon.error ?? 'unknown'}`;
        console.log(`status=${payload.ok ? 'ok' : 'degraded'} daemon=${payload.daemon.running ? 'running' : 'offline'} methods=${methodCount} sync=\"${syncState}\" reason=${reason}`);
        return payload.ok ? 0 : 1;
    }
    if (!p) {
        return payload.ok ? 0 : 1;
    }

    const info: Record<string, string> = {
        'Socket': payload.paths.socket,
        'Database': payload.paths.database,
        'Master Key': payload.paths.masterKeyPresent ? color.green('present') : color.yellow('missing')
    };

    if (!payload.daemon.running) {
        if (payload.daemon.error) {
            info['Error'] = color.red(payload.daemon.error);
        }
        payload.daemon.recoverySteps.forEach((step, idx) => {
            info[`Recover ${idx + 1}`] = color.yellow(step);
        });
    } else {
        if (payload.capabilities) {
            info['API Version'] = payload.capabilities.apiVersion;
            info['RPC Methods'] = String(payload.capabilities.methodCount);
            if (payload.capabilities.missingFeatures.includes('recall')) {
                info['Recall API'] = color.yellow('missing (restart daemon after update)');
            }
        }
        if (payload.apiError) {
            info['API Error'] = color.red(payload.apiError);
        }
    }

    p.note(
        Object.entries(info).map(([k, v]) => `${color.dim(k.padEnd(12))} : ${v}`).join('\n'),
        'System Details'
    );
    if (!payload.daemon.running) {
        p.outro(color.yellow('Daemon degraded or offline'));
    } else if (payload.capabilities && payload.capabilities.missingFeatures.length > 0) {
        p.outro(color.yellow(`Daemon reachable but missing capabilities: ${payload.capabilities.missingFeatures.join(', ')}`));
    } else {
        p.outro('All systems operational');
    }

    return payload.ok ? 0 : 1;
}

async function commandBootstrap(flags: Record<string, string | boolean>): Promise<number> {
    const p = await import('@clack/prompts');
    const clients = parseClients(flags.clients);
    const dryRun = Boolean(flags['dry-run']);
    const entrypoint = parseOptionalStringFlag(flags.entrypoint) ?? undefined;
    const mcpProfile = parseOptionalStringFlag(flags['mcp-profile'] ?? flags.profile) ?? undefined;

    if (!Boolean(flags.quiet) && !Boolean(flags.json)) {
        p.intro(color.bgBlue(color.black(' 0ctx bootstrap ')));
    }

    const s = p.spinner();
    if (!Boolean(flags.quiet) && !Boolean(flags.json)) s.start('Applying MCP configurations');

    const results = runBootstrap(clients, dryRun, entrypoint, mcpProfile);

    if (!Boolean(flags.quiet) && !Boolean(flags.json)) {
        s.stop('Bootstrap complete');
        await printBootstrapResults(results, dryRun);
        p.log.info('Restart your AI client app so it reloads MCP config changes.');
        p.outro(results.some(r => r.status === 'failed') ? color.yellow('Bootstrap finished with errors') : color.green('Bootstrap successful'));
    }

    if (Boolean(flags.json)) {
        console.log(JSON.stringify({ dryRun, clients, mcpProfile: mcpProfile ?? 'all', results }, null, 2));
    }
    return results.some((result: BootstrapResult) => result.status === 'failed') ? 1 : 0;
}

async function commandMcp(subcommand: string | undefined, flags: Record<string, string | boolean>): Promise<number> {
    const action = (subcommand ?? '').trim().toLowerCase();

    if (action === 'bootstrap') {
        return commandBootstrap(flags);
    }
    if (action === 'setup') {
        return commandSetup({ ...flags, 'no-open': true });
    }
    if (action === 'validate') {
        return commandSetup({ ...flags, validate: true, 'no-open': true });
    }
    if (action && action !== 'wizard') {
        console.error(`Unknown mcp action: '${action}'`);
        console.error('Usage: 0ctx mcp [setup|bootstrap|validate]');
        return 1;
    }

    const asJson = Boolean(flags.json);
    const quiet = Boolean(flags.quiet) || asJson;

    // Non-interactive fallback: do a safe MCP bootstrap with sensible defaults.
    if (quiet || !process.stdin.isTTY || !process.stdout.isTTY) {
        const nextFlags: Record<string, string | boolean> = { ...flags };
        if (!nextFlags.clients) nextFlags.clients = 'all';
        if (!nextFlags['mcp-profile'] && !nextFlags.profile) nextFlags['mcp-profile'] = 'core';
        return commandBootstrap(nextFlags);
    }

    const p = await import('@clack/prompts');
    p.intro(color.bgBlue(color.black(' 0ctx mcp ')));

    const flowChoice = await p.select({
        message: 'Choose MCP action',
        options: [
            { value: 'setup', label: 'Full setup (Recommended)', hint: 'Login + daemon/service + bootstrap + verify' },
            { value: 'bootstrap', label: 'Bootstrap only', hint: 'Write MCP config to selected AI clients' },
            { value: 'validate', label: 'Validate', hint: 'Run setup validation checks only' }
        ]
    });
    if (p.isCancel(flowChoice)) {
        p.cancel('Cancelled.');
        return 1;
    }

    const selectedAction = String(flowChoice);
    const nextFlags: Record<string, string | boolean> = { ...flags };

    const selectedClients = await p.multiselect({
        message: 'Select AI clients',
        required: true,
        options: [
            { value: 'claude', label: 'Claude Desktop' },
            { value: 'cursor', label: 'Cursor' },
            { value: 'windsurf', label: 'Windsurf' },
            { value: 'codex', label: 'Codex CLI' },
            { value: 'antigravity', label: 'Antigravity' }
        ]
    });
    if (p.isCancel(selectedClients)) {
        p.cancel('Cancelled.');
        return 1;
    }
    const clients = (selectedClients as string[])
        .filter((client): client is SupportedClient => SUPPORTED_CLIENTS.includes(client as SupportedClient));
    nextFlags.clients = clients.length === SUPPORTED_CLIENTS.length ? 'all' : clients.join(',');

    const selectedProfile = await p.select({
        message: 'Select MCP tool profile',
        initialValue: 'core',
        options: [
            { value: 'core', label: 'core (Recommended)', hint: 'Graph + context tools' },
            { value: 'recall', label: 'recall', hint: 'core + recall tools' },
            { value: 'ops', label: 'ops', hint: 'core + ops/runtime tools' },
            { value: 'all', label: 'all', hint: 'All MCP tools' }
        ]
    });
    if (p.isCancel(selectedProfile)) {
        p.cancel('Cancelled.');
        return 1;
    }
    nextFlags['mcp-profile'] = String(selectedProfile);

    if (selectedAction === 'setup') {
        const openDashboard = await p.confirm({
            message: 'Open dashboard at end of setup?',
            initialValue: true
        });
        if (p.isCancel(openDashboard)) {
            p.cancel('Cancelled.');
            return 1;
        }
        if (!openDashboard) {
            nextFlags['no-open'] = true;
        }
    } else {
        nextFlags['no-open'] = true;
    }

    const resultCode = selectedAction === 'setup'
        ? await commandSetup(nextFlags)
        : selectedAction === 'validate'
            ? await commandSetup({ ...nextFlags, validate: true })
            : await commandBootstrap(nextFlags);

    if (resultCode === 0) {
        p.outro(color.green('MCP command completed.'));
    } else {
        p.outro(color.yellow('MCP command finished with issues.'));
    }
    return resultCode;
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

async function collectDoctorChecks(flags: Record<string, string | boolean>): Promise<{
    checks: DoctorCheck[];
    daemon: { ok: boolean; error?: string; health?: any };
}> {
    const checks: DoctorCheck[] = [];
    const daemon = await isDaemonReachable();

    checks.push({
        id: 'daemon_reachable',
        status: daemon.ok ? 'pass' : 'fail',
        message: daemon.ok ? 'Daemon health check succeeded.' : 'Daemon is not reachable.',
        details: daemon.ok ? daemon.health : {
            error: daemon.error,
            recoverySteps: inferDaemonRecoverySteps(daemon.error)
        }
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

    return { checks, daemon };
}

async function commandDoctor(flags: Record<string, string | boolean>): Promise<number> {
    const { checks, daemon } = await collectDoctorChecks(flags);
    const hasFailures = checks.some(check => check.status === 'fail');
    const asJson = Boolean(flags.json);
    if (asJson) {
        console.log(JSON.stringify({ checks }, null, 2));
        return hasFailures ? 1 : 0;
    }

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

    if (!daemon.ok) {
        const recovery = inferDaemonRecoverySteps(daemon.error);
        console.log('\nDaemon recovery steps:');
        for (const [idx, step] of recovery.entries()) {
            console.log(`  ${idx + 1}. ${step}`);
        }
        console.log('');
    }

    p.outro(hasFailures ? color.red('Doctor found issues requiring attention.') : color.green('All systems go!'));
    return hasFailures ? 1 : 0;
}

async function commandRepair(flags: Record<string, string | boolean>): Promise<number> {
    const deep = Boolean(flags.deep);
    const asJson = Boolean(flags.json);

    if (asJson) {
        const steps: RepairStep[] = [];
        const daemon = await isDaemonReachable();

        if (!daemon.ok) {
            try {
                startDaemonDetached();
            } catch (error) {
                steps.push({
                    id: 'daemon_start',
                    status: 'fail',
                    code: 1,
                    message: 'Failed to start daemon.',
                    details: { error: error instanceof Error ? error.message : String(error) }
                });
                console.log(JSON.stringify({ ok: false, steps }, null, 2));
                return 1;
            }

            const ready = await waitForDaemon();
            steps.push({
                id: 'daemon_start',
                status: ready ? 'pass' : 'fail',
                code: ready ? 0 : 1,
                message: ready ? 'Daemon started successfully.' : 'Daemon start timeout.',
                details: { priorError: daemon.error ?? null }
            });

            if (!ready) {
                console.log(JSON.stringify({ ok: false, steps }, null, 2));
                return 1;
            }
        } else {
            steps.push({
                id: 'daemon_start',
                status: 'pass',
                code: 0,
                message: 'Daemon already running.'
            });
        }

        const bootstrapCode = await commandBootstrap({ ...flags, quiet: true, json: false });
        steps.push({
            id: 'bootstrap',
            status: bootstrapCode === 0 ? 'pass' : 'fail',
            code: bootstrapCode,
            message: bootstrapCode === 0 ? 'Bootstrap completed.' : 'Bootstrap failed.'
        });
        if (bootstrapCode !== 0) {
            console.log(JSON.stringify({ ok: false, steps }, null, 2));
            return bootstrapCode;
        }

        if (deep) {
            const check = await checkDaemonCapabilities(['recall']);
            const recallReady = check.ok;
            steps.push({
                id: 'deep_capabilities',
                status: recallReady ? 'pass' : 'fail',
                code: recallReady ? 0 : 1,
                message: recallReady
                    ? 'Daemon capability check passed.'
                    : 'Daemon capabilities are stale (recall missing).',
                details: {
                    capabilityError: check.error,
                    methodCount: check.methods.length,
                    recoverySteps: check.recoverySteps
                }
            });

            if (!recallReady) {
                console.log(JSON.stringify({ ok: false, steps }, null, 2));
                return 1;
            }
        }

        const { checks } = await collectDoctorChecks({ ...flags, json: false });
        const doctorFail = checks.some(check => check.status === 'fail');
        steps.push({
            id: 'doctor',
            status: doctorFail ? 'fail' : 'pass',
            code: doctorFail ? 1 : 0,
            message: doctorFail ? 'Doctor checks found failures.' : 'Doctor checks passed.',
            details: { checks }
        });

        const ok = steps.every(step => step.status !== 'fail');
        console.log(JSON.stringify({ ok, steps }, null, 2));
        return ok ? 0 : 1;
    }

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

    if (deep) {
        p.log.step('Running deep daemon capability checks');
        const check = await checkDaemonCapabilities(['recall']);
        if (!check.ok) {
            p.log.warn('Daemon is running but recall APIs are missing.');
            console.log('\nDeep repair steps:\n');
            console.log('  1. Restart daemon/service so latest daemon binary is active');
            for (const step of check.recoverySteps) {
                console.log(`     - ${step}`);
            }
            console.log('  2. Re-run: 0ctx status');
            console.log('  3. Verify: 0ctx recall --start\n');
            p.outro(color.yellow('Repair partial (daemon capabilities stale)'));
            return 1;
        }

        p.log.success('Deep capability check passed');
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
    if (Boolean(flags.snapshot)) {
        const limit = parsePositiveIntegerFlag(flags.limit, 50);
        const sinceHours = parseOptionalPositiveNumberFlag(flags['since-hours']);
        const grep = parseOptionalStringFlag(flags.grep)?.toLowerCase() ?? null;
        const errorsOnly = Boolean(flags['errors-only']);
        const now = Date.now();
        const sinceCutoff = sinceHours ? now - (sinceHours * 60 * 60 * 1000) : null;
        const daemon = await isDaemonReachable();
        const queueItemsRaw = listQueuedConnectorEvents();
        const queueStats = getConnectorQueueStats();
        const opsEntriesRaw = readCliOpsLog(Math.max(limit * 3, limit)).reverse();
        let auditEntriesRaw: Array<Record<string, unknown>> = [];
        let capabilities: unknown = null;
        let syncStatus: unknown = null;

        if (daemon.ok) {
            try {
                const auditResult = await sendToDaemon('listAuditEvents', { limit });
                auditEntriesRaw = Array.isArray(auditResult)
                    ? auditResult.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
                    : [];
            } catch {
                auditEntriesRaw = [];
            }
            try {
                capabilities = await sendToDaemon('getCapabilities', {});
            } catch {
                capabilities = null;
            }
            try {
                syncStatus = await sendToDaemon('syncStatus', {});
            } catch {
                syncStatus = null;
            }
        }

        const matchesSince = (value: number | null): boolean => {
            if (!sinceCutoff) return true;
            if (value === null) return false;
            return value >= sinceCutoff;
        };
        const matchesGrep = (entry: unknown): boolean => {
            if (!grep) return true;
            try {
                return JSON.stringify(entry).toLowerCase().includes(grep);
            } catch {
                return false;
            }
        };
        const isOpError = (entry: Record<string, unknown>): boolean => {
            const status = typeof entry.status === 'string' ? entry.status.toLowerCase() : '';
            return status === 'error' || status === 'fail' || status === 'failed';
        };
        const isAuditError = (entry: Record<string, unknown>): boolean => {
            const result = entry.result;
            if (!result || typeof result !== 'object') return false;
            const typed = result as Record<string, unknown>;
            if (typed.success === false) return true;
            return typeof typed.error === 'string' && typed.error.length > 0;
        };
        const queueItems = queueItemsRaw
            .filter(item => {
                if (!matchesSince(typeof item.enqueuedAt === 'number' ? item.enqueuedAt : null)) return false;
                if (errorsOnly && !(item.lastError || item.attempts > 0)) return false;
                return matchesGrep(item);
            })
            .slice(0, limit);
        const opsEntries = opsEntriesRaw
            .filter(entry => {
                if (!matchesSince(typeof entry.timestamp === 'number' ? entry.timestamp : null)) return false;
                if (errorsOnly && !isOpError(entry as unknown as Record<string, unknown>)) return false;
                return matchesGrep(entry);
            })
            .slice(0, limit);
        const auditEntries = auditEntriesRaw
            .filter(entry => {
                const createdAt = typeof entry.createdAt === 'number' ? entry.createdAt : null;
                if (!matchesSince(createdAt)) return false;
                if (errorsOnly && !isAuditError(entry)) return false;
                return matchesGrep(entry);
            })
            .slice(0, limit);

        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            filters: {
                limit,
                sinceHours,
                grep,
                errorsOnly
            },
            daemon: {
                reachable: daemon.ok,
                error: daemon.ok ? null : (daemon.error ?? 'unknown'),
                health: daemon.ok ? (daemon.health ?? null) : null,
                capabilities,
                sync: syncStatus
            },
            connector: {
                statePath: getConnectorStatePath(),
                state: readConnectorState(),
                queuePath: getConnectorQueuePath(),
                queue: {
                    stats: queueStats,
                    sample: queueItems,
                    filteredCount: queueItems.length,
                    totalCount: queueItemsRaw.length
                }
            },
            logs: {
                opsPath: getCliOpsLogPath(),
                opsEntries,
                auditEntries,
                filtered: {
                    opsCount: opsEntries.length,
                    auditCount: auditEntries.length
                }
            }
        }, null, 2));
        return 0;
    }

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

async function commandRecallFeedback(flags: Record<string, string | boolean>, positionalArgs: string[] = []): Promise<number> {
    const action = (positionalArgs[1] ?? '').toLowerCase();
    const asJson = Boolean(flags.json);
    const contextId = getContextIdFlag(flags);
    const nodeIdFilter = parseOptionalStringFlag(flags['node-id'] ?? flags.nodeId);
    const helpfulFlag = Boolean(flags.helpful);
    const notHelpfulFlag = Boolean(flags['not-helpful']);

    if (action === 'list' || action === 'ls' || action === 'stats' || Boolean(flags.list) || Boolean(flags.stats)) {
        if (helpfulFlag && notHelpfulFlag) {
            console.error("Use only one feedback filter: '--helpful' or '--not-helpful'.");
            return 1;
        }

        const helpfulFilter = helpfulFlag ? true : (notHelpfulFlag ? false : undefined);
        const limit = parsePositiveIntegerFlag(flags.limit, 50);
        const check = await checkDaemonCapabilities(['listRecallFeedback']);
        if (!check.ok) {
            printCapabilityMismatch('recall_feedback_list', check);
            return 1;
        }

        try {
            const result = await sendToDaemon('listRecallFeedback', {
                contextId,
                limit,
                nodeId: nodeIdFilter,
                helpful: helpfulFilter
            }) as {
                contextId?: string | null;
                total?: number;
                helpfulCount?: number;
                notHelpfulCount?: number;
                nodeSummary?: Array<{ nodeId: string; helpful: number; notHelpful: number; netScore: number; lastFeedbackAt: number }>;
                items?: Array<{ nodeId: string; helpful: boolean; reason?: string | null; createdAt?: number }>;
            };

            if (asJson) {
                console.log(JSON.stringify(result, null, 2));
                return 0;
            }

            const statsOnly = action === 'stats' || Boolean(flags.stats);
            console.log('\nRecall Feedback List\n');
            console.log(`  context_id:    ${String(result.contextId ?? contextId ?? 'active/global')}`);
            console.log(`  total:         ${result.total ?? 0}`);
            console.log(`  helpful:       ${result.helpfulCount ?? 0}`);
            console.log(`  not_helpful:   ${result.notHelpfulCount ?? 0}`);
            if (!statsOnly && Array.isArray(result.items) && result.items.length > 0) {
                console.log('\n  recent_feedback:');
                for (const item of result.items.slice(0, 10)) {
                    const ts = typeof item.createdAt === 'number' ? new Date(item.createdAt).toISOString() : 'n/a';
                    console.log(`    node=${item.nodeId} helpful=${item.helpful} at=${ts}`);
                }
            }
            if (Array.isArray(result.nodeSummary) && result.nodeSummary.length > 0) {
                console.log('\n  top_nodes:');
                for (const node of result.nodeSummary.slice(0, 10)) {
                    const ts = typeof node.lastFeedbackAt === 'number' ? new Date(node.lastFeedbackAt).toISOString() : 'n/a';
                    console.log(`    node=${node.nodeId} net=${node.netScore} helpful=${node.helpful} not_helpful=${node.notHelpful} last=${ts}`);
                }
            }
            console.log('');
            return 0;
        } catch (error) {
            console.error('recall_feedback_list_failed:', error instanceof Error ? error.message : String(error));
            return 1;
        }
    }

    const nodeId = nodeIdFilter;
    if (!nodeId) {
        console.error("Missing required '--node-id' for recall feedback.");
        return 1;
    }
    if (helpfulFlag === notHelpfulFlag) {
        console.error("Provide exactly one of '--helpful' or '--not-helpful' for recall feedback.");
        return 1;
    }

    const reason = parseOptionalStringFlag(flags.reason);
    const helpful = helpfulFlag && !notHelpfulFlag;

    const check = await checkDaemonCapabilities(['recallFeedback']);
    if (!check.ok) {
        printCapabilityMismatch('recall_feedback', check);
        return 1;
    }

    try {
        const result = await sendToDaemon('recallFeedback', {
            contextId,
            nodeId,
            helpful,
            reason
        }) as Record<string, unknown>;

        if (asJson) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log('\nRecall Feedback\n');
            console.log(`  node_id:      ${String(result.nodeId ?? nodeId)}`);
            console.log(`  helpful:      ${String(result.helpful ?? helpful)}`);
            if (reason) {
                console.log(`  reason:       ${reason}`);
            }
            if (contextId) {
                console.log(`  context_id:   ${contextId}`);
            }
            console.log(`  recorded_at:  ${typeof result.recordedAt === 'number' ? new Date(result.recordedAt).toISOString() : 'n/a'}`);
            console.log('');
        }
        return 0;
    } catch (error) {
        console.error('recall_feedback_failed:', error instanceof Error ? error.message : String(error));
        return 1;
    }
}

async function commandRecall(flags: Record<string, string | boolean>, positionalArgs: string[] = []): Promise<number> {
    if ((positionalArgs[0] ?? '').toLowerCase() === 'feedback') {
        return commandRecallFeedback(flags, positionalArgs);
    }

    const modeRaw = parseOptionalStringFlag(flags.mode) ?? 'auto';
    const mode = modeRaw.toLowerCase();
    const validModes = new Set(['auto', 'temporal', 'topic', 'graph']);
    if (!validModes.has(mode)) {
        console.error(`Invalid recall mode: '${modeRaw}'. Expected one of: auto, temporal, topic, graph.`);
        return 1;
    }

    const query = parseOptionalStringFlag(flags.query);
    const contextId = getContextIdFlag(flags);
    const sinceHours = parsePositiveNumberFlag(flags['since-hours'], 24);
    const limit = parsePositiveIntegerFlag(flags.limit, 10);
    const depth = parsePositiveIntegerFlag(flags.depth, 2);
    const maxNodes = parsePositiveIntegerFlag(flags['max-nodes'], 30);
    const startBrief = Boolean(flags.start);
    const asJson = Boolean(flags.json);
    const effectiveMode = startBrief ? 'auto' : mode;

    try {
        const check = await checkDaemonCapabilities(['recall']);
        if (!check.ok) {
            printCapabilityMismatch('recall', check);
            return 1;
        }

        const result = await sendToDaemon('recall', {
            contextId,
            mode: effectiveMode,
            query,
            sinceHours,
            limit,
            depth,
            maxNodes
        }) as Record<string, any>;

        if (asJson) {
            console.log(JSON.stringify(result, null, 2));
            return 0;
        }

        if (startBrief) {
            console.log('\nRecall Start Brief\n');
            console.log(`  mode:          ${result.mode ?? 'auto'}`);
            console.log(`  context:       ${result.contextId ?? 'active/global'}`);
            if (query) {
                console.log(`  query:         ${query}`);
            }

            const temporal = result.temporal as { sessions?: Array<{ endAt?: number; actions?: string[] }> } | undefined;
            const sessions = Array.isArray(temporal?.sessions) ? temporal.sessions : [];
            if (sessions.length > 0) {
                console.log('\n  recent_sessions:');
                for (const session of sessions.slice(0, 3)) {
                    const ts = typeof session.endAt === 'number' ? new Date(session.endAt).toISOString() : 'n/a';
                    const actions = Array.isArray(session.actions) ? session.actions.slice(0, 3).join(',') : 'n/a';
                    console.log(`    at=${ts} actions=${actions}`);
                }
            }

            const recommendations = Array.isArray(result.recommendations)
                ? result.recommendations
                : [];
            const topicHits = Array.isArray(result.topic?.hits)
                ? result.topic.hits
                : [];
            const anchors = recommendations.length > 0 ? recommendations : topicHits.slice(0, 3).map((hit: any) => ({
                nodeId: hit.nodeId,
                score: hit.score,
                reason: hit.matchReason
            }));

            if (anchors.length > 0) {
                console.log('\n  anchors:');
                for (const anchor of anchors.slice(0, 3)) {
                    console.log(`    node=${anchor.nodeId ?? 'n/a'} score=${anchor.score ?? 'n/a'} reason=${anchor.reason ?? 'n/a'}`);
                }
            }

            const graphNodeCount = result.graph?.subgraph?.nodes?.length ?? 0;
            console.log(`\n  graph_nodes:   ${graphNodeCount}`);
            console.log('\n  next_steps:');
            if (query) {
                console.log(`    1) 0ctx recall --mode=graph --query="${query}" --json`);
            } else {
                console.log('    1) 0ctx recall --mode=topic --query="<your topic>" --json');
            }
            console.log('    2) 0ctx logs');
            console.log('');
            return 0;
        }

        console.log('\nRecall Summary\n');
        console.log(`  mode:          ${result.mode ?? effectiveMode}`);
        console.log(`  context:       ${result.contextId ?? 'active/global'}`);
        if (query) {
            console.log(`  query:         ${query}`);
        }

        const summary = result.summary as Record<string, unknown> | undefined;
        if (summary) {
            console.log(`  sessions:      ${summary.sessionCount ?? 0}`);
            console.log(`  recent_events: ${summary.recentEventCount ?? 0}`);
            console.log(`  topic_hits:    ${summary.topicHitCount ?? 0}`);
            console.log(`  graph_nodes:   ${summary.graphNodeCount ?? 0}`);
        }

        if (Array.isArray(result.recommendations) && result.recommendations.length > 0) {
            console.log('\n  recommendations:');
            for (const item of result.recommendations.slice(0, 5)) {
                console.log(`    node=${item.nodeId ?? 'n/a'} score=${item.score ?? 'n/a'} reason=${item.reason ?? 'n/a'}`);
            }
        }

        if (result.mode === 'topic' && Array.isArray(result.hits)) {
            console.log('\n  top_hits:');
            for (const hit of result.hits.slice(0, 5)) {
                const preview = typeof hit.content === 'string' ? hit.content.slice(0, 96) : '';
                console.log(`    score=${hit.score ?? 'n/a'} reason=${hit.matchReason ?? 'n/a'} ${preview}`);
            }
        }

        console.log('');
        return 0;
    } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (text.includes('Unknown method: recall')) {
            printCapabilityMismatch('recall', {
                ok: false,
                reachable: true,
                apiVersion: null,
                methods: [],
                missingMethods: ['recall'],
                error: text,
                recoverySteps: ['0ctx daemon start', '0ctx connector service restart']
            });
            return 1;
        }
        console.error('recall_failed:', text);
        return 1;
    }
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

function commandVersion(flags: Record<string, string | boolean> = {}): number {
    const asJson = Boolean(flags.json);
    const verbose = Boolean(flags.verbose);
    const payload = {
        version: CLI_VERSION,
        cliPath: process.argv[1] ? path.resolve(process.argv[1]) : __filename,
        node: process.version,
        platform: `${os.platform()}-${os.arch()}`
    };

    if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
        return 0;
    }

    if (verbose) {
        console.log(`version: ${payload.version}`);
        console.log(`cli_path: ${payload.cliPath}`);
        console.log(`node: ${payload.node}`);
        console.log(`platform: ${payload.platform}`);
        return 0;
    }

    console.log(payload.version);
    return 0;
}

function parsePositiveNumberFlag(value: string | boolean | undefined, fallback: number): number {
    if (typeof value !== 'string') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function parseOptionalPositiveNumberFlag(value: string | boolean | undefined): number | null {
    if (typeof value !== 'string') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
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
                error: daemon.ok ? null : (daemon.error ?? 'unknown'),
                recoverySteps: daemon.ok ? [] : inferDaemonRecoverySteps(daemon.error)
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
            for (const [idx, step] of payload.daemon.recoverySteps.entries()) {
                console.log(`  daemon_fix_${idx + 1}: ${step}`);
            }
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
        if (!Boolean(flags.service) && !Boolean(flags.system)) {
            return commandLogs(flags);
        }

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

function statusToCode(status: CheckStatus): number {
    return status === 'fail' ? 1 : 0;
}

async function commandSetupValidate(flags: Record<string, string | boolean>): Promise<number> {
    const asJson = Boolean(flags.json);
    const quiet = Boolean(flags.quiet) || asJson;
    const requireCloud = Boolean(flags['require-cloud']);
    const waitCloudReady = Boolean(flags['wait-cloud-ready']);
    const cloudWaitTimeoutMs = parsePositiveIntegerFlag(flags['cloud-wait-timeout-ms'], 60_000);
    const cloudWaitIntervalMs = parsePositiveIntegerFlag(flags['cloud-wait-interval-ms'], 2_000);
    const steps: SetupStep[] = [];

    const token = resolveToken();
    steps.push({
        id: 'auth_login',
        status: token ? 'pass' : 'fail',
        code: token ? 0 : 1,
        message: token ? 'Authentication available.' : 'No active authentication session found.'
    });

    const registration = readConnectorState();
    steps.push({
        id: 'connector_state',
        status: registration ? 'pass' : 'warn',
        code: 0,
        message: registration
            ? 'Connector registration state exists.'
            : 'Connector registration state not found (setup will need to register this machine).'
    });

    try {
        const { checks } = await collectDoctorChecks({ ...flags, json: false });
        for (const check of checks) {
            steps.push({
                id: `doctor_${check.id}`,
                status: check.status,
                code: statusToCode(check.status),
                message: check.message
            });
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        steps.push({
            id: 'doctor_checks',
            status: 'fail',
            code: 1,
            message: `Doctor checks failed to execute: ${message}`
        });
    }

    const verifyFlags = {
        ...flags,
        quiet: true,
        json: false,
        'require-cloud': requireCloud,
        cloud: requireCloud
    };
    const verifyCode = await commandConnector('verify', verifyFlags);
    steps.push({
        id: 'connector_verify',
        status: verifyCode === 0 ? 'pass' : 'fail',
        code: verifyCode,
        message: verifyCode === 0 ? 'Connector verification passed.' : 'Connector verification failed.'
    });

    if (waitCloudReady || requireCloud) {
        if (!token || !registration) {
            steps.push({
                id: 'cloud_ready',
                status: 'fail',
                code: 1,
                message: 'Cloud-ready validation requires both authentication and connector registration.'
            });
        } else {
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
        }
    }

    const ok = steps.every(step => step.status !== 'fail');
    const dashboardUrl = getHostedDashboardUrl();

    if (asJson) {
        console.log(JSON.stringify({
            ok,
            mode: 'validate',
            steps,
            dashboardUrl
        }, null, 2));
        return ok ? 0 : 1;
    }

    if (!quiet) {
        console.log('\nSetup Validation\n');
        for (const step of steps) {
            console.log(`  ${step.status.padEnd(4)} ${step.id}: ${step.message}`);
        }
        console.log('');
        if (!ok) {
            console.log('Validation failed. Fix the failed checks, then run: 0ctx setup');
            console.log('');
        }
    }

    return ok ? 0 : 1;
}

async function commandSetup(flags: Record<string, string | boolean>): Promise<number> {
    if (Boolean(flags.validate)) {
        return commandSetupValidate(flags);
    }

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
    const steps: SetupStep[] = [];

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
  0ctx version [--verbose] [--json]
  0ctx --version | -v
  0ctx setup [--clients=all|claude,cursor,windsurf,codex,antigravity] [--no-open] [--json] [--validate]
             [--require-cloud] [--wait-cloud-ready]
             [--cloud-wait-timeout-ms=60000] [--cloud-wait-interval-ms=2000]
             [--create-context=<name>] [--dashboard-query[=k=v&...]]
             [--skip-service] [--skip-bootstrap] [--mcp-profile=all|core|recall|ops]
  0ctx install [--clients=all|claude,cursor,windsurf,codex,antigravity] [--json] [--skip-bootstrap] [--mcp-profile=all|core|recall|ops]
  0ctx bootstrap [--dry-run] [--clients=...] [--entrypoint=/path/to/mcp-server.js]
                 [--mcp-profile=all|core|recall|ops] [--json]
  0ctx mcp [setup|bootstrap|validate]
  0ctx mcp                     Interactive MCP setup/selection flow
  0ctx mcp setup [--clients=all|claude,cursor,windsurf,codex,antigravity] [--mcp-profile=all|core|recall|ops] [--no-open]
  0ctx mcp bootstrap [--dry-run] [--clients=...] [--mcp-profile=all|core|recall|ops]
  0ctx mcp validate [--clients=...] [--mcp-profile=...]
  0ctx doctor [--json] [--clients=...]
  0ctx status [--json] [--compact]
  0ctx repair [--clients=...] [--deep] [--json]
  0ctx logs [--no-open] [--snapshot] [--limit=50] [--since-hours=N] [--grep=text] [--errors-only]
  0ctx recall [--mode=auto|temporal|topic|graph] [--query="..."] [--since-hours=24] [--limit=10] [--depth=2] [--max-nodes=30] [--start] [--json]
  0ctx recall feedback --node-id=<id> (--helpful|--not-helpful) [--reason="..."] [--context-id=<id>] [--json]
  0ctx recall feedback list|stats [--context-id=<id>] [--node-id=<id>] [--helpful|--not-helpful] [--limit=50] [--json]
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
  0ctx connector logs [--service|--system] [--no-open] [--snapshot] [--limit=50] [--since-hours=N] [--grep=text] [--errors-only]

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
    if (parsed.command === 'mcp') {
        return parsed.subcommand ? `cli.mcp.${parsed.subcommand}` : 'cli.mcp';
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

            // Returning users can still land in a broken state (e.g. daemon
            // not running, missing service registration after updates). Keep
            // `0ctx` as a one-command entrypoint by attempting automatic
            // setup/repair before opening the interactive shell.
            const daemonPreflight = await isDaemonReachable();
            if (!daemonPreflight.ok) {
                console.log(color.bold('\nRuntime needs repair.'));
                console.log(color.dim('Daemon is unreachable. Running setup automatically...\n'));
                captureEvent('cli_command_executed', { command: 'setup', interactive: true, reason: 'daemon_unreachable' });
                const setupCode = await runCommandWithOpsSummary(
                    'cli.setup.auto_repair',
                    () => commandSetup({ 'no-open': true }),
                    { command: 'setup', interactive: true, reason: 'daemon_unreachable' }
                );
                if (setupCode !== 0) return setupCode;
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
            case 'mcp':
                return commandMcp(parsed.subcommand, parsed.flags);
            case 'doctor':
                return commandDoctor(parsed.flags);
            case 'status':
                return commandStatus(parsed.flags);
            case 'repair':
                return commandRepair(parsed.flags);
            case 'version':
                return commandVersion(parsed.flags);
            case 'recall':
                return commandRecall(parsed.flags, parsed.positionalArgs);
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
