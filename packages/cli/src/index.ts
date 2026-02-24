#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, execSync } from 'child_process';
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
import { commandAuthLogin, commandAuthLogout, commandAuthStatus, resolveToken } from './auth';
import { getConnectorStatePath, readConnectorState, registerConnector, writeConnectorState } from './connector';
import { fetchConnectorCapabilities, registerConnectorInCloud, sendConnectorHeartbeat } from './cloud';
import { runConnectorRuntime } from './connector-runtime';

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

function parseArgs(argv: string[]): ParsedArgs {
    const [command = 'help', maybeSubcommand, ...rest] = argv;
    const hasSubcommand = command === 'daemon' || command === 'auth' || command === 'config' || command === 'sync' || command === 'connector';
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

function runBootstrap(clients: SupportedClient[], dryRun: boolean): ReturnType<typeof bootstrapMcpRegistration> {
    return bootstrapMcpRegistration({
        clients,
        dryRun,
        serverName: '0ctx'
    });
}

function printBootstrapResults(results: BootstrapResult[], dryRun: boolean): void {
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
    return results.some((result: BootstrapResult) => result.status === 'failed') ? 1 : 0;
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

async function commandDashboard(flags: Record<string, string | boolean>): Promise<number> {
    const url = getHostedDashboardUrl();
    console.log(`dashboard_url: ${url}`);

    if (Boolean(flags['no-open'])) {
        console.log('Open the URL above in your browser.');
        return 0;
    }

    openUrl(url);
    console.log('Opened dashboard URL in your default browser (best effort).');
    return 0;
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

        if (!Boolean(flags.quiet)) {
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
        const token = resolveToken();
        if (!token) {
            console.error('connector_register_requires_auth: run `0ctx auth login` first.');
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

        if (!Boolean(flags.quiet)) {
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
            return 1;
        }

        return 0;
    }

    if (action === 'status') {
        const daemon = await isDaemonReachable();
        const registration = readConnectorState();
        const token = resolveToken();
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
                        : null
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

        if (Boolean(flags.json)) {
            console.log(JSON.stringify(payload, null, 2));
            return posture === 'connected' ? 0 : 1;
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
                if (payload.registration.runtime.lastEventSyncAt) {
                    console.log(`  event_sync:   ${payload.registration.runtime.lastEventSyncAt}`);
                }
                if (payload.registration.runtime.eventBridgeError) {
                    console.log(`  event_error:  ${payload.registration.runtime.eventBridgeError}`);
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
        console.log('');
        return posture === 'connected' ? 0 : 1;
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
    console.log('Running setup workflow...');

    if (!resolveToken()) {
        console.log('auth: no active session found. Starting login...');
        const authCode = await commandAuthLogin(flags);
        if (authCode !== 0) return authCode;
    } else {
        console.log('auth: already logged in');
    }

    // Best effort: install/enable/start managed service.
    for (const action of ['install', 'enable', 'start'] as const) {
        const code = await commandConnector(action, flags);
        if (code !== 0) {
            console.log(`connector ${action}: warning (continuing with local runtime flow)`);
        }
    }

    const installCode = await commandInstall(flags);
    if (installCode !== 0) return installCode;

    const registerCode = await commandConnector('register', { ...flags, quiet: true });
    if (registerCode !== 0) {
        console.error('setup_register_failed: unable to register connector metadata');
        return registerCode;
    }

    const verifyCode = await commandConnector('verify', flags);
    if (verifyCode !== 0) {
        console.error('setup_verify_failed: connector/runtime verification failed');
        return verifyCode;
    }

    return commandDashboard(flags);
}

function printHelp(): void {
    console.log(`0ctx CLI

Usage:
  0ctx setup [--clients=all|claude,cursor,windsurf] [--no-open]
  0ctx install [--clients=all|claude,cursor,windsurf]
  0ctx bootstrap [--dry-run] [--clients=...]
  0ctx doctor [--json] [--clients=...]
  0ctx status
  0ctx repair [--clients=...]
  0ctx dashboard [--no-open]
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

  Config keys: auth.server, sync.enabled, sync.endpoint, ui.url

Sync:
  0ctx sync status   Show sync engine health and queue

Connector:
  0ctx connector service install|enable|disable|uninstall|status|start|stop|restart
  0ctx connector install|enable|disable|uninstall|status|start|stop|restart
  0ctx connector status [--json] [--cloud]
  0ctx connector verify [--require-cloud]
  0ctx connector register [--force] [--local-only] [--require-cloud]
  0ctx connector run [--once] [--interval-ms=30000] [--no-daemon-autostart]
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

    // Parse boolean for sync.enabled
    let parsed: unknown = value;
    if (key === 'sync.enabled') {
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

async function main(): Promise<number> {
    const parsed = parseArgs(process.argv.slice(2));

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
        case 'auth': {
            const sub = parsed.subcommand;
            if (sub === 'login') return commandAuthLogin(parsed.flags);
            if (sub === 'logout') return Promise.resolve(commandAuthLogout());
            if (sub === 'status') return Promise.resolve(commandAuthStatus(parsed.flags));
            printHelp();
            return 1;
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
        case 'help':
        default:
            printHelp();
            return 0;
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
            printHelp();
            return 1;
        }
        case 'connector':
            if (parsed.subcommand === 'service') {
                return commandConnector(parsed.serviceAction, parsed.flags);
            }
            return commandConnector(parsed.subcommand, parsed.flags);
        case 'dashboard':
            return commandDashboard(parsed.flags);
        case 'ui':
            console.error('`0ctx ui` has been removed from the end-user flow.');
            console.error('Use `0ctx setup` and then open the hosted dashboard URL (or run `0ctx dashboard`).');
            return 1;
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
