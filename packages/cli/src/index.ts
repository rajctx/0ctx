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
import {
    appendHookEventLog,
    getHookDebugRetentionDays,
    getHookDumpDir,
    getHookDumpRetentionDays,
    persistHookDump,
    pruneHookDumps,
    persistHookTranscriptHistory,
    persistHookTranscriptSnapshot
} from './hook-dumps';
import {
    getHookConfigPath,
    getHookStatePath,
    installHooks,
    matchesHookCaptureRoot,
    normalizeHookPayload,
    readCodexArchiveCapture,
    readCodexCapture,
    readInlineHookCapture,
    readTranscriptCapture,
    resolveCodexSessionArchivePath,
    resolveHookTranscriptPath,
    resolveHookCaptureRoot,
    readHookInstallState,
    selectHookContextId,
    type HookSupportedAgent
} from './hooks';

type SupportedClient = 'claude' | 'cursor' | 'windsurf' | 'codex' | 'antigravity';
type HookInstallClient = 'claude' | 'cursor' | 'windsurf' | 'codex' | 'factory' | 'antigravity';
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

interface HookHealthAgentCheck {
    agent: HookSupportedAgent;
    configPath: string;
    configExists: boolean;
    commandPresent: boolean;
    command: string | null;
}

interface HookHealthDetails {
    statePath: string;
    projectRoot: string | null;
    projectRootExists: boolean;
    projectConfigPath: string | null;
    projectConfigExists: boolean;
    contextId: string | null;
    contextIdExists: boolean | null;
    installedAgentCount: number;
    agents: HookHealthAgentCheck[];
}

interface RepoReadinessSummary {
    repoRoot: string;
    contextId: string | null;
    workspaceName: string | null;
    workstream: string | null;
    sessionCount: number | null;
    checkpointCount: number | null;
    syncPolicy: string | null;
    captureReadyAgents: HookSupportedAgent[];
    captureMissingAgents: HookInstallClient[];
    captureManagedForRepo: boolean;
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
const SUPPORTED_HOOK_INSTALL_CLIENTS: HookInstallClient[] = ['claude', 'cursor', 'windsurf', 'codex', 'factory', 'antigravity'];
const DEFAULT_MCP_CLIENTS: SupportedClient[] = ['claude', 'antigravity'];
const DEFAULT_HOOK_INSTALL_CLIENTS: HookInstallClient[] = ['claude', 'factory', 'antigravity'];
const DEFAULT_ENABLE_MCP_CLIENTS: SupportedClient[] = DEFAULT_MCP_CLIENTS;
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
        || command === 'checkpoints'
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
    if (!raw || typeof raw !== 'string') return DEFAULT_MCP_CLIENTS;
    const normalized = raw.trim().toLowerCase();
    if (!normalized || normalized === 'ga') return DEFAULT_MCP_CLIENTS;

    const parsed = normalized
        .split(/[,\s]+/)
        .map(item => item.trim())
        .filter((item): item is SupportedClient => SUPPORTED_CLIENTS.includes(item as SupportedClient));

    return parsed.length > 0 ? parsed : DEFAULT_MCP_CLIENTS;
}

function parseHookClients(raw: string | boolean | undefined): HookInstallClient[] {
    if (!raw || typeof raw !== 'string') return DEFAULT_HOOK_INSTALL_CLIENTS;
    const normalized = raw.trim().toLowerCase();
    if (!normalized || normalized === 'ga') return DEFAULT_HOOK_INSTALL_CLIENTS;

    const parsed = normalized
        .split(/[,\s]+/)
        .map(item => item.trim())
        .filter((item): item is HookInstallClient => item === 'factory' || SUPPORTED_CLIENTS.includes(item as SupportedClient));

    return parsed.length > 0 ? parsed : DEFAULT_HOOK_INSTALL_CLIENTS;
}

function parseEnableMcpClients(raw: string | boolean | undefined): SupportedClient[] {
    if (!raw || typeof raw !== 'string') return DEFAULT_ENABLE_MCP_CLIENTS;
    const normalized = raw.trim().toLowerCase();
    if (!normalized) return DEFAULT_ENABLE_MCP_CLIENTS;
    if (normalized === 'none') return [];
    if (normalized === 'ga') return DEFAULT_ENABLE_MCP_CLIENTS;
    return parseClients(raw);
}

function validateExplicitPreviewSelection(
    raw: string | boolean | undefined,
    explicitExample: string
): string | null {
    if (!raw || typeof raw !== 'string') return null;
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'preview' || normalized === 'all') {
        return `Preview integrations must be named explicitly. Use --clients=${explicitExample}.`;
    }
    return null;
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

function isHookCommandPresent(agent: HookSupportedAgent, configContent: string, expectedCommand: string | null): boolean {
    if (agent === 'codex') {
        return configContent.includes('# BEGIN 0ctx-codex-notify')
            && configContent.includes('# END 0ctx-codex-notify')
            && configContent.includes('--agent=codex');
    }

    if (!expectedCommand) return false;
    return configContent.includes('0ctx connector hook ingest')
        && configContent.includes(`--agent=${agent}`)
        && configContent.includes(expectedCommand.replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' '));
}

async function collectHookHealth(): Promise<{
    check: DoctorCheck;
    dumpCheck: DoctorCheck;
    details: HookHealthDetails;
}> {
    const state = readHookInstallState();
    const statePath = getHookStatePath();
    const projectRoot = state.projectRoot ? path.resolve(state.projectRoot) : null;
    const projectConfigPath = state.projectConfigPath ?? (projectRoot ? path.join(projectRoot, '.0ctx', 'settings.local.json') : null);
    const installedAgents = state.agents.filter(agent => agent.installed);
    const projectRootExists = projectRoot ? fs.existsSync(projectRoot) : false;
    const projectConfigExists = projectConfigPath ? fs.existsSync(projectConfigPath) : false;
    let contextIdExists: boolean | null = null;

    if (state.contextId) {
        try {
            const contexts = await sendToDaemon('listContexts', {}) as Array<{ id?: string }> | null;
            contextIdExists = Array.isArray(contexts)
                ? contexts.some(context => context?.id === state.contextId)
                : false;
        } catch {
            contextIdExists = null;
        }
    }

    const agents: HookHealthAgentCheck[] = installedAgents.map(agentState => {
        const configPath = projectRoot ? getHookConfigPath(projectRoot, agentState.agent) : getHookConfigPath('.', agentState.agent);
        const configExists = fs.existsSync(configPath);
        const content = configExists ? fs.readFileSync(configPath, 'utf8') : '';
        return {
            agent: agentState.agent,
            configPath,
            configExists,
            commandPresent: configExists && isHookCommandPresent(agentState.agent, content, agentState.command),
            command: agentState.command
        };
    });

    const missingAgents = agents.filter(agent => !agent.configExists || !agent.commandPresent);
    const dumpDir = getHookDumpDir();
    let dumpDirWritable = true;
    let dumpDirError: string | null = null;
    try {
        fs.mkdirSync(dumpDir, { recursive: true });
        fs.accessSync(dumpDir, fs.constants.W_OK);
    } catch (error) {
        dumpDirWritable = false;
        dumpDirError = error instanceof Error ? error.message : String(error);
    }

    let status: CheckStatus = 'pass';
    let message = 'Managed capture integration state is healthy.';

    if (!projectRoot) {
        status = 'warn';
        message = 'No managed capture integration project has been recorded yet.';
    } else if (!projectRootExists) {
        status = 'fail';
        message = 'Managed capture integration project root no longer exists.';
    } else if (!projectConfigExists) {
        status = 'fail';
        message = 'Managed capture integration project config is missing.';
    } else if (missingAgents.length > 0) {
        status = 'fail';
        message = 'One or more managed capture integration configs are missing or stale.';
    } else if (state.contextId && contextIdExists === false) {
        status = 'warn';
        message = 'Stored capture context id no longer exists; reinstall integrations to refresh context binding.';
    }

    return {
        check: {
            id: 'hook_state',
            status,
            message,
            details: {
                statePath,
                projectRoot,
                projectRootExists,
                projectConfigPath,
                projectConfigExists,
                contextId: state.contextId,
                contextIdExists,
                installedAgentCount: installedAgents.length,
                agents
            } satisfies HookHealthDetails
        },
        dumpCheck: {
            id: 'hook_dump_dir',
            status: dumpDirWritable ? 'pass' : 'warn',
            message: dumpDirWritable
                ? `Hook dump directory is writable (dump retention ${getHookDumpRetentionDays()} days, debug retention ${getHookDebugRetentionDays()} days).`
                : 'Hook dump directory is not writable.',
            details: {
                path: dumpDir,
                retentionDays: getHookDumpRetentionDays(),
                debugRetentionDays: getHookDebugRetentionDays(),
                error: dumpDirError
            }
        },
        details: {
            statePath,
            projectRoot,
            projectRootExists,
            projectConfigPath,
            projectConfigExists,
            contextId: state.contextId,
            contextIdExists,
            installedAgentCount: installedAgents.length,
            agents
        }
    };
}

function getCurrentWorkstream(repoRoot: string): string | null {
    return safeGitValue(repoRoot, ['branch', '--show-current'])
        ?? safeGitValue(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

function formatLabelValue(label: string, value: string): string {
    return `${color.dim(label.padEnd(12))} : ${value}`;
}

function formatAgentName(agent: string): string {
    switch (agent) {
        case 'claude':
            return 'Claude';
        case 'factory':
            return 'Factory';
        case 'antigravity':
            return 'Antigravity';
        case 'codex':
            return 'Codex';
        case 'cursor':
            return 'Cursor';
        case 'windsurf':
            return 'Windsurf';
        default:
            return agent;
    }
}

function formatAgentList(agents: string[]): string {
    if (agents.length === 0) return 'none';
    return agents.map(formatAgentName).join(', ');
}

async function collectRepoReadiness(options: {
    repoRoot?: string | null;
    contextId?: string | null;
    hookDetails?: HookHealthDetails | null;
} = {}): Promise<RepoReadinessSummary | null> {
    const repoRoot = resolveRepoRoot(options.repoRoot ?? null);
    const contexts = await sendToDaemon('listContexts', {}) as Array<{ id?: string; name?: string; paths?: string[] }> | null;
    if (!Array.isArray(contexts)) {
        return null;
    }

    const matchedContextId = options.contextId
        ?? selectHookContextId(contexts, repoRoot, null);
    const matchedContext = typeof matchedContextId === 'string'
        ? contexts.find(context => context?.id === matchedContextId) ?? null
        : null;

    if (!matchedContextId || !matchedContext) {
        return {
            repoRoot,
            contextId: null,
            workspaceName: null,
            workstream: getCurrentWorkstream(repoRoot),
            sessionCount: null,
            checkpointCount: null,
            syncPolicy: null,
            captureReadyAgents: [],
            captureMissingAgents: [...DEFAULT_HOOK_INSTALL_CLIENTS],
            captureManagedForRepo: false
        };
    }

    const branch = getCurrentWorkstream(repoRoot);
    const pack = await sendToDaemon('getAgentContextPack', {
        contextId: matchedContextId,
        branch,
        sessionLimit: 3,
        checkpointLimit: 2,
        handoffLimit: 3
    }) as {
        workspaceName?: string;
        branch?: string | null;
        workstream?: { sessionCount?: number; checkpointCount?: number };
    } | null;
    const syncPolicyResult = await sendToDaemon('getSyncPolicy', { contextId: matchedContextId }) as
        | string
        | { syncPolicy?: string | null }
        | null;
    const syncPolicy = typeof syncPolicyResult === 'string'
        ? syncPolicyResult
        : (typeof syncPolicyResult?.syncPolicy === 'string' ? syncPolicyResult.syncPolicy : null);

    const hookDetails = options.hookDetails ?? (await collectHookHealth()).details;
    const hookProjectRoot = hookDetails.projectRoot ? path.resolve(hookDetails.projectRoot) : null;
    const captureManagedForRepo = hookProjectRoot === repoRoot;
    const captureReadyAgents = captureManagedForRepo
        ? hookDetails.agents
            .filter(agent => agent.configExists && agent.commandPresent)
            .map(agent => agent.agent)
            .filter((agent): agent is HookSupportedAgent => Boolean(agent))
        : [];
    const captureMissingAgents = DEFAULT_HOOK_INSTALL_CLIENTS.filter(
        agent => !captureReadyAgents.includes(agent as HookSupportedAgent)
    );

    return {
        repoRoot,
        contextId: matchedContextId,
        workspaceName: typeof pack?.workspaceName === 'string'
            ? pack.workspaceName
            : (typeof matchedContext.name === 'string' ? matchedContext.name : null),
        workstream: typeof pack?.branch === 'string' && pack.branch.trim().length > 0
            ? pack.branch
            : branch,
        sessionCount: typeof pack?.workstream?.sessionCount === 'number' ? pack.workstream.sessionCount : null,
        checkpointCount: typeof pack?.workstream?.checkpointCount === 'number' ? pack.workstream.checkpointCount : null,
        syncPolicy,
        captureReadyAgents,
        captureMissingAgents,
        captureManagedForRepo
    };
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

    throw new Error('Could not resolve MCP server entrypoint. Run `npm run build` (repo) or `0ctx repair` (installed CLI).');
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

async function buildDefaultDashboardQuery(): Promise<string | undefined> {
    const params = new URLSearchParams();
    const state = readConnectorState();

    if (state?.machineId) params.set('machineId', state.machineId);
    if (state?.tenantId) params.set('tenantId', state.tenantId);

    try {
        const repoRoot = findGitRepoRoot(null);
        if (repoRoot) {
            const contexts = await sendToDaemon('listContexts', {}) as Array<{ id?: string; name?: string; paths?: string[] }>;
            const contextId = selectHookContextId(contexts, repoRoot, null);
            const context = contextId ? contexts.find(item => item.id === contextId) : null;
            if (context?.id) {
                params.set('contextId', context.id);
                if (context.name) params.set('contextName', context.name);
            }
        }
    } catch {
        // best effort; dashboard can still open with machine-only query
    }

    const query = params.toString();
    return query.length > 0 ? query : undefined;
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

    if (!payload.daemon.running) {
        const info: string[] = [];
        if (payload.daemon.error) {
            info.push(formatLabelValue('Runtime', color.red(payload.daemon.error)));
        }
        for (const [idx, step] of payload.daemon.recoverySteps.entries()) {
            info.push(formatLabelValue(`Recover ${idx + 1}`, color.yellow(step)));
        }
        p.note(info.join('\n'), 'Runtime Unavailable');
        p.outro(color.yellow('0ctx runtime is unavailable on this machine.'));
        return 1;
    }

    if (payload.capabilities && payload.capabilities.missingFeatures.length > 0) {
        const info = [
            formatLabelValue('Runtime', color.yellow('needs upgrade')),
            formatLabelValue('Missing', payload.capabilities.missingFeatures.join(', ')),
            formatLabelValue('Next step', '0ctx enable')
        ];
        p.note(info.join('\n'), 'Runtime Readiness');
        p.outro(color.yellow('0ctx runtime is reachable, but this CLI expects newer capabilities.'));
        return 1;
    }

    const repoRootHint = findGitRepoRoot(null);
    if (!repoRootHint) {
        p.note(
            [
                formatLabelValue('Runtime', color.green('ready')),
                formatLabelValue('Directory', 'Not inside a git repo'),
                formatLabelValue('Next step', 'cd <repo> && 0ctx enable')
            ].join('\n'),
            'Local Product Path'
        );
        p.outro(color.green('0ctx runtime is ready.'));
        return 0;
    }

    let repoReadiness: RepoReadinessSummary | null = null;
    try {
        repoReadiness = await collectRepoReadiness({ repoRoot: repoRootHint });
    } catch {
        repoReadiness = null;
    }

    if (!repoReadiness) {
        p.note(
            [
                formatLabelValue('Runtime', color.green('ready')),
                formatLabelValue('Repo', repoRootHint),
                formatLabelValue('Next step', '0ctx enable')
            ].join('\n'),
            'Repo Readiness'
        );
        p.outro(color.green('0ctx runtime is ready.'));
        return 0;
    }

    if (!repoReadiness.contextId || !repoReadiness.workspaceName) {
        p.note(
            [
                formatLabelValue('Repo', repoReadiness.repoRoot),
                formatLabelValue('Workspace', color.yellow('not enabled')),
                formatLabelValue('Workstream', repoReadiness.workstream ?? '-'),
                formatLabelValue('Next step', '0ctx enable')
            ].join('\n'),
            'Repo Readiness'
        );
        p.outro(color.yellow('This repo is not enabled for 0ctx yet.'));
        return 1;
    }

    const captureLine = repoReadiness.captureManagedForRepo
        ? (repoReadiness.captureMissingAgents.length === 0
            ? `${formatAgentList(repoReadiness.captureReadyAgents)} ready`
            : `${formatAgentList(repoReadiness.captureReadyAgents)} ready${repoReadiness.captureReadyAgents.length > 0 ? '; ' : ''}${formatAgentList(repoReadiness.captureMissingAgents)} not installed`)
        : 'Run 0ctx enable to install supported capture integrations';
    const historySummary = repoReadiness.sessionCount === null
        ? 'No workstream history yet'
        : `${repoReadiness.sessionCount} sessions, ${repoReadiness.checkpointCount ?? 0} checkpoints`;

    p.note(
        [
            formatLabelValue('Repo', repoReadiness.repoRoot),
            formatLabelValue('Workspace', repoReadiness.workspaceName),
            formatLabelValue('Workstream', repoReadiness.workstream ?? '-'),
            formatLabelValue('Capture', captureLine),
            formatLabelValue('History', historySummary),
            formatLabelValue('Sync', String(repoReadiness.syncPolicy ?? 'metadata_only'))
        ].join('\n'),
        'Repo Readiness'
    );
    p.outro(color.green('Use a supported agent normally in this repo. 0ctx will inject context and route capture automatically.'));

    return payload.ok ? 0 : 1;
}

async function commandBootstrap(flags: Record<string, string | boolean>): Promise<number> {
    const p = await import('@clack/prompts');
    const previewError = validateExplicitPreviewSelection(flags.clients, 'claude,antigravity,codex');
    if (previewError) {
        console.error(previewError);
        return 1;
    }
    const clients = parseClients(flags.clients);
    const dryRun = Boolean(flags['dry-run']);
    const entrypoint = parseOptionalStringFlag(flags.entrypoint) ?? undefined;
    const mcpProfile = parseOptionalStringFlag(flags['mcp-profile'] ?? flags.profile) ?? 'core';

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
        console.log(JSON.stringify({ dryRun, clients, mcpProfile, results }, null, 2));
    }
    return results.some((result: BootstrapResult) => result.status === 'failed') ? 1 : 0;
}

async function commandMcp(subcommand: string | undefined, flags: Record<string, string | boolean>): Promise<number> {
    const action = (subcommand ?? '').trim().toLowerCase();

    if (action === 'bootstrap') {
        return commandBootstrap(flags);
    }
    if (action === 'setup' || action === 'validate') {
        console.error(`0ctx mcp ${action} is deprecated. Use \`0ctx bootstrap\` for MCP registration or \`0ctx setup\` for advanced machine management.`);
        return 1;
    }
    if (action && action !== 'wizard') {
        console.error(`Unknown mcp action: '${action}'`);
        console.error('Usage: 0ctx mcp [bootstrap]');
        return 1;
    }

    const asJson = Boolean(flags.json);
    const quiet = Boolean(flags.quiet) || asJson;

    // Non-interactive fallback: do a safe MCP bootstrap with sensible defaults.
    if (quiet || !process.stdin.isTTY || !process.stdout.isTTY) {
        const nextFlags: Record<string, string | boolean> = { ...flags };
        if (!nextFlags.clients) nextFlags.clients = 'ga';
        if (!nextFlags['mcp-profile'] && !nextFlags.profile) nextFlags['mcp-profile'] = 'core';
        return commandBootstrap(nextFlags);
    }

    const p = await import('@clack/prompts');
    p.intro(color.bgBlue(color.black(' 0ctx mcp ')));

    const nextFlags: Record<string, string | boolean> = { ...flags };

    const selectedClients = await p.multiselect({
        message: 'Select AI clients',
        required: true,
        options: [
            { value: 'claude', label: 'Claude Desktop' },
            { value: 'antigravity', label: 'Antigravity' }
        ]
    });
    if (p.isCancel(selectedClients)) {
        p.cancel('Cancelled.');
        return 1;
    }
    const clients = (selectedClients as string[])
        .filter((client): client is SupportedClient => SUPPORTED_CLIENTS.includes(client as SupportedClient));
    const isGaClients = clients.length === DEFAULT_MCP_CLIENTS.length
        && DEFAULT_MCP_CLIENTS.every(client => clients.includes(client));
    nextFlags.clients = isGaClients ? 'ga' : clients.join(',');

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
    nextFlags['no-open'] = true;

    const resultCode = await commandBootstrap(nextFlags);

    if (resultCode === 0) {
        p.outro(color.green('MCP bootstrap completed.'));
    } else {
        p.outro(color.yellow('MCP bootstrap finished with issues.'));
    }
    return resultCode;
}

async function commandInstall(flags: Record<string, string | boolean>): Promise<number> {
    const p = await import('@clack/prompts');
    const quiet = Boolean(flags.quiet);
    const asJson = Boolean(flags.json);
    const skipBootstrap = Boolean(flags['skip-bootstrap']);
    const previewError = validateExplicitPreviewSelection(flags.clients, 'claude,factory,antigravity,codex');
    if (previewError) {
        console.error(previewError);
        return 1;
    }

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

async function commandEnable(flags: Record<string, string | boolean>): Promise<number> {
    const quiet = Boolean(flags.quiet);
    const asJson = Boolean(flags.json);
    const skipBootstrap = Boolean(flags['skip-bootstrap']);
    const skipHooks = Boolean(flags['skip-hooks']);
    const repoRoot = resolveRepoRoot(parseOptionalStringFlag(flags['repo-root'] ?? flags.repoRoot));
    const requestedName = parseOptionalStringFlag(flags.name ?? flags['workspace-name'] ?? flags.workspaceName);
    const workspaceName = requestedName ?? (path.basename(repoRoot) || 'Workspace');
    const hookPreviewError = validateExplicitPreviewSelection(flags.clients, 'claude,factory,antigravity,codex');
    if (hookPreviewError) {
        console.error(hookPreviewError);
        return 1;
    }
    const mcpPreviewError = validateExplicitPreviewSelection(flags['mcp-clients'] ?? flags.mcpClients, 'claude,antigravity,codex');
    if (mcpPreviewError) {
        console.error(`MCP clients: ${mcpPreviewError}`);
        return 1;
    }
    const hookClients = parseHookClients(flags.clients);
    const mcpClients = parseEnableMcpClients(flags['mcp-clients'] ?? flags.mcpClients);
    const mcpProfile = parseOptionalStringFlag(flags['mcp-profile'] ?? flags.profile) ?? 'core';

    const p = (!quiet && !asJson) ? await import('@clack/prompts') : null;
    const s = p?.spinner() ?? null;

    if (p) {
        p.intro(color.bgBlue(color.black(' 0ctx enable ')));
        s?.start('Preparing local runtime');
    }

    const steps: Array<{
        id: string;
        status: CheckStatus;
        message: string;
        details?: Record<string, unknown>;
    }> = [];

    const installCode = await commandInstall({ ...flags, quiet: true, json: false, 'skip-bootstrap': true });
    steps.push({
        id: 'runtime',
        status: installCode === 0 ? 'pass' : 'fail',
        message: installCode === 0
            ? 'Local runtime is ready.'
            : 'Failed to start or verify the local runtime.'
    });
    if (installCode !== 0) {
        if (s) s.stop(color.red('Runtime preparation failed'));
        if (asJson) {
            console.log(JSON.stringify({ ok: false, repoRoot, steps }, null, 2));
        } else {
            console.error('enable_runtime_failed: unable to prepare the local runtime');
            p?.outro(color.red('Enable failed'));
        }
        return 1;
    }

    if (s) s.message('Resolving workspace');

    const contexts = await sendToDaemon('listContexts', {}) as Array<{ id?: string; name?: string; paths?: string[] }>;
    let contextId = selectHookContextId(contexts, repoRoot, null);
    let created = false;

    if (!contextId) {
        const createdContext = await sendToDaemon('createContext', {
            name: workspaceName,
            paths: [repoRoot]
        }) as { id?: string; contextId?: string; name?: string };
        contextId = createdContext?.id ?? createdContext?.contextId ?? null;
        created = Boolean(contextId);
    }

    if (!contextId) {
        steps.push({
            id: 'workspace',
            status: 'fail',
            message: 'Failed to resolve or create a workspace for the repository.'
        });
        if (s) s.stop(color.red('Workspace resolution failed'));
        if (asJson) {
            console.log(JSON.stringify({ ok: false, repoRoot, steps }, null, 2));
        } else {
            console.error('enable_workspace_failed: unable to resolve or create a workspace');
            p?.outro(color.red('Enable failed'));
        }
        return 1;
    }

    await sendToDaemon('switchContext', { contextId });
    steps.push({
        id: 'workspace',
        status: 'pass',
        message: created
            ? `Created and selected workspace '${workspaceName}'.`
            : 'Selected the workspace bound to this repository.',
        details: {
            contextId,
            repoRoot,
            created
        }
    });

    let bootstrapResults: BootstrapResult[] = [];
    if (!skipBootstrap && mcpClients.length > 0) {
        if (s) s.message('Registering MCP clients');
        bootstrapResults = runBootstrap(mcpClients, false, undefined, mcpProfile);
        const failedBootstrap = bootstrapResults.some(result => result.status === 'failed');
        steps.push({
            id: 'mcp',
            status: failedBootstrap ? 'fail' : 'pass',
            message: failedBootstrap
                ? 'One or more MCP registrations failed.'
                : 'MCP registration completed.',
            details: {
                clients: mcpClients,
                profile: mcpProfile,
                results: bootstrapResults
            }
        });
        if (failedBootstrap) {
            if (s) s.stop(color.red('MCP registration failed'));
            if (asJson) {
                console.log(JSON.stringify({ ok: false, repoRoot, contextId, steps }, null, 2));
            } else {
                await printBootstrapResults(bootstrapResults, false);
                p?.outro(color.red('Enable failed'));
            }
            return 1;
        }
    } else {
        steps.push({
            id: 'mcp',
            status: 'warn',
            message: skipBootstrap
                ? 'Skipped MCP registration.'
                : 'No MCP clients selected for registration.',
            details: {
                clients: mcpClients,
                profile: mcpProfile
            }
        });
    }

    let hookSummary: ReturnType<typeof installHooks> | null = null;
    let hookHealthDetails: HookHealthDetails | null = null;
    if (!skipHooks && hookClients.length > 0) {
        if (s) s.message('Installing capture integrations');
        hookSummary = installHooks({
            projectRoot: repoRoot,
            contextId,
            clients: hookClients,
            installClaudeGlobal: Boolean(flags.global)
        });
        steps.push({
            id: 'capture',
            status: 'pass',
            message: 'Capture integrations installed.',
            details: {
                clients: hookClients,
                changed: hookSummary.changed,
                statePath: hookSummary.statePath,
                projectConfigPath: hookSummary.projectConfigPath
            }
        });
        hookHealthDetails = (await collectHookHealth()).details;
    } else {
        steps.push({
            id: 'capture',
            status: 'warn',
            message: skipHooks
                ? 'Skipped capture integration installation.'
                : 'No capture integrations selected for installation.',
            details: {
                clients: hookClients
            }
        });
    }

    if (s) s.stop(color.green('0ctx is enabled for this repository'));

    if (asJson) {
        console.log(JSON.stringify({
            ok: true,
            repoRoot,
            contextId,
            workspaceName,
            created,
            hookClients,
            mcpClients,
            mcpProfile,
            steps,
            bootstrapResults,
            hooks: hookSummary
        }, null, 2));
        return 0;
    }

    const repoReadiness = await collectRepoReadiness({
        repoRoot,
        contextId,
        hookDetails: hookHealthDetails
    });

    const info = repoReadiness
        ? [
            formatLabelValue('Repo', repoReadiness.repoRoot),
            formatLabelValue('Workspace', repoReadiness.workspaceName ?? workspaceName),
            formatLabelValue('Workstream', repoReadiness.workstream ?? '-'),
            formatLabelValue(
                'Capture',
                repoReadiness.captureMissingAgents.length === 0
                    ? `${formatAgentList(repoReadiness.captureReadyAgents)} ready`
                    : `${formatAgentList(repoReadiness.captureReadyAgents)} ready${repoReadiness.captureReadyAgents.length > 0 ? '; ' : ''}${formatAgentList(repoReadiness.captureMissingAgents)} not installed`
            ),
            formatLabelValue(
                'History',
                repoReadiness.sessionCount === null
                    ? 'No captured workstream history yet'
                    : `${repoReadiness.sessionCount} sessions, ${repoReadiness.checkpointCount ?? 0} checkpoints`
            ),
            formatLabelValue('Sync', String(repoReadiness.syncPolicy ?? 'metadata_only'))
        ]
        : [
            formatLabelValue('Repo', repoRoot),
            formatLabelValue('Workspace', workspaceName)
        ];

    p?.note(info.join('\n'), 'Repo Readiness');
    p?.outro(color.green('Use a supported agent normally in this repo. 0ctx will inject current context and route capture automatically.'));
    return 0;
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

    const hookHealth = await collectHookHealth();
    checks.push(hookHealth.check);
    checks.push(hookHealth.dumpCheck);

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

async function repairManagedHooks(flags: Record<string, string | boolean>): Promise<RepairStep> {
    const hookState = readHookInstallState();
    const projectRoot = hookState.projectRoot ? path.resolve(hookState.projectRoot) : null;
    const installedAgents = hookState.agents
        .filter(agent => agent.installed)
        .map(agent => agent.agent);

    if (!projectRoot || installedAgents.length === 0) {
        return {
            id: 'hooks_reinstall',
            status: 'warn',
            code: 0,
            message: 'No managed capture integration installation is recorded yet.',
            details: {
                statePath: getHookStatePath(),
                projectRoot: projectRoot ?? null
            }
        };
    }

    if (!fs.existsSync(projectRoot)) {
        return {
            id: 'hooks_reinstall',
            status: 'fail',
            code: 1,
            message: 'Managed capture integration project root is missing.',
            details: {
                projectRoot
            }
        };
    }

    const refreshedContextId = await resolveContextIdForHookIngest(projectRoot, hookState.contextId);
    const result = installHooks({
        projectRoot,
        contextId: refreshedContextId,
        clients: installedAgents,
        dryRun: false,
        cliCommand: '0ctx'
    });
    const failedAgents = result.state.agents
        .filter(agent => installedAgents.includes(agent.agent) && !agent.installed)
        .map(agent => agent.agent);

    return {
        id: 'hooks_reinstall',
        status: failedAgents.length === 0 ? 'pass' : 'fail',
        code: failedAgents.length === 0 ? 0 : 1,
        message: failedAgents.length === 0
            ? 'Managed capture integrations were refreshed from the recorded project state.'
            : `Managed capture integrations failed for: ${failedAgents.join(', ')}`,
        details: {
            projectRoot,
            refreshedContextId,
            warnings: result.warnings,
            agents: result.state.agents
        }
    };
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

        const hookRepairStep = await repairManagedHooks(flags);
        steps.push(hookRepairStep);
        if (hookRepairStep.status === 'fail') {
            console.log(JSON.stringify({ ok: false, steps }, null, 2));
            return hookRepairStep.code || 1;
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

    p.log.step('Refreshing managed capture integrations');
    const hookRepairStep = await repairManagedHooks(flags);
    if (hookRepairStep.status === 'fail') {
        p.log.error(hookRepairStep.message);
        p.outro(color.yellow('Repair partial (hook refresh failed)'));
        return hookRepairStep.code || 1;
    }
    if (hookRepairStep.status === 'warn') {
        p.log.warn(hookRepairStep.message);
    } else {
        p.log.success(hookRepairStep.message);
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

async function commandReset(flags: Record<string, string | boolean>): Promise<number> {
    const asJson = Boolean(flags.json);
    const full = Boolean(flags.full);
    const includeAuth = Boolean(flags['include-auth']);
    const confirmed = Boolean(flags.confirm);

    if (!confirmed && !asJson) {
        const p = await import('@clack/prompts');
        const accepted = await p.confirm({
            message: full
                ? 'Reset local 0ctx runtime data, hook state, connector state, and backups on this machine?'
                : 'Reset local 0ctx runtime data on this machine?',
            initialValue: false
        });
        if (p.isCancel(accepted) || !accepted) {
            p.cancel('Reset cancelled.');
            return 1;
        }
    } else if (!confirmed && asJson) {
        console.error('reset_requires_confirm: pass --confirm to run non-interactively.');
        return 1;
    }

    const daemonBefore = await isDaemonReachable();
    if (daemonBefore.ok) {
        console.error('reset_requires_daemon_stop: stop the daemon/service before resetting local data.');
        console.error('Try: 0ctx connector service stop');
        return 1;
    }

    const homeRoot = path.join(os.homedir(), '.0ctx');
    const authFile = process.env.CTX_AUTH_FILE ?? path.join(homeRoot, 'auth.json');
    const backupDir = process.env.CTX_BACKUP_DIR ?? path.join(homeRoot, 'backups');
    const targets = [
        DB_PATH,
        `${DB_PATH}-shm`,
        `${DB_PATH}-wal`,
        getHookDumpDir(),
        getConnectorQueuePath(),
        getCliOpsLogPath(),
        full ? getConnectorStatePath() : null,
        full ? getHookStatePath() : null,
        full ? backupDir : null,
        includeAuth ? authFile : null
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);

    const removed: string[] = [];
    const skipped: string[] = [];
    for (const target of targets) {
        if (!fs.existsSync(target)) {
            skipped.push(target);
            continue;
        }
        fs.rmSync(target, { recursive: true, force: true });
        removed.push(target);
    }

    if (asJson) {
        console.log(JSON.stringify({
            ok: true,
            full,
            includeAuth,
            removed,
            skipped
        }, null, 2));
        return 0;
    }

    console.log('\nLocal reset complete.\n');
    for (const entry of removed) {
        console.log(`  removed: ${entry}`);
    }
    for (const entry of skipped) {
        console.log(`  skipped: ${entry}`);
    }
    console.log('');
    return 0;
}

async function commandDashboard(flags: Record<string, string | boolean>): Promise<number> {
    const explicitQuery = parseOptionalStringFlag(flags['dashboard-query']);
    const fallbackQuery = explicitQuery ?? await buildDefaultDashboardQuery();
    const url = applyDashboardQuery(getHostedDashboardUrl(), fallbackQuery);
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

function readStdinPayload(): string {
    if (process.stdin.isTTY) return '';
    try {
        const chunk = fs.readFileSync(0);
        return chunk.toString('utf8');
    } catch {
        return '';
    }
}

function findGitRepoRoot(input: string | null): string | null {
    const cwd = input ? path.resolve(input) : process.cwd();
    try {
        const root = execSync('git rev-parse --show-toplevel', {
            cwd,
            stdio: ['ignore', 'pipe', 'ignore']
        }).toString().trim();
        return root.length > 0 ? root : null;
    } catch {
        return null;
    }
}

function resolveRepoRoot(input: string | null): string {
    if (input) {
        const resolved = path.resolve(input);
        return findGitRepoRoot(resolved) ?? resolved;
    }
    return findGitRepoRoot(null) ?? process.cwd();
}

function safeGitValue(repoRoot: string, args: string[]): string | null {
    try {
        const value = execSync(`git ${args.join(' ')}`, {
            cwd: repoRoot,
            stdio: ['ignore', 'pipe', 'ignore']
        }).toString().trim();
        if (!value || value === 'HEAD') return null;
        return value;
    } catch {
        return null;
    }
}

function extractSupportedHookAgent(raw: string | null): HookSupportedAgent | null {
    if (raw === 'claude' || raw === 'windsurf' || raw === 'codex' || raw === 'cursor' || raw === 'factory' || raw === 'antigravity') {
        return raw;
    }
    return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

async function resolveContextIdForHookIngest(repoRoot: string, explicitContextId: string | null): Promise<string | null> {
    const contexts = await sendToDaemon('listContexts', {}) as Array<{ id: string; paths?: string[] }>;
    return selectHookContextId(contexts, repoRoot, explicitContextId);
}

async function resolveHookContextPaths(contextId: string): Promise<string[] | null> {
    const contexts = await sendToDaemon('listContexts', {}) as Array<{ id?: string; paths?: string[] }>;
    const matched = Array.isArray(contexts)
        ? contexts.find(context => typeof context?.id === 'string' && context.id === contextId)
        : null;
    if (!matched) return null;
    return Array.isArray(matched.paths)
        ? matched.paths.filter((rawPath): rawPath is string => typeof rawPath === 'string' && rawPath.trim().length > 0)
        : [];
}

async function validateHookIngestWorkspace(options: {
    agent: HookSupportedAgent;
    contextId: string;
    repoRoot: string;
    payload: Record<string, unknown>;
}): Promise<{
    ok: boolean;
    captureRoot: string;
    error: string | null;
}> {
    const captureRoot = resolveHookCaptureRoot(options.agent, options.payload, options.repoRoot) ?? path.resolve(options.repoRoot);
    const contextPaths = await resolveHookContextPaths(options.contextId);
    if (contextPaths === null) {
        return {
            ok: false,
            captureRoot,
            error: `connector_hook_ingest_context_missing: context '${options.contextId}' was not found.`
        };
    }
    if (contextPaths.length === 0 || matchesHookCaptureRoot(contextPaths, captureRoot)) {
        return {
            ok: true,
            captureRoot,
            error: null
        };
    }

    return {
        ok: false,
        captureRoot,
        error: `connector_hook_ingest_workspace_mismatch: capture path '${captureRoot}' is outside the bound workspace paths for context '${options.contextId}' (${contextPaths.join(', ')}).`
    };
}

interface HookArtifactPaths {
    dumpPath: string | null;
    hookEventLogPath: string | null;
    transcriptDumpPath: string | null;
    transcriptHistoryPath: string | null;
    transcriptSourcePath: string | null;
}

function buildHookCaptureMeta(options: {
    agent: HookSupportedAgent;
    sessionId: string;
    turnId: string;
    role: string;
    occurredAt: number;
    branch: string | null;
    commitSha: string | null;
    repositoryRoot: string;
    artifacts: HookArtifactPaths;
    extra?: Record<string, unknown>;
}): Record<string, unknown> {
    return {
        agent: options.agent,
        sessionId: options.sessionId,
        turnId: options.turnId,
        role: options.role,
        occurredAt: options.occurredAt,
        branch: options.branch,
        commitSha: options.commitSha,
        repositoryRoot: options.repositoryRoot,
        hookDumpPath: options.artifacts.dumpPath,
        hookEventLogPath: options.artifacts.hookEventLogPath,
        transcriptDumpPath: options.artifacts.transcriptDumpPath,
        transcriptHistoryPath: options.artifacts.transcriptHistoryPath,
        transcriptSourcePath: options.artifacts.transcriptSourcePath,
        ...(options.extra ?? {})
    };
}

async function ensureChatSessionNode(options: {
    contextId: string;
    agent: HookSupportedAgent;
    sessionId: string;
    summary: string;
    startedAt: number;
    branch: string | null;
    commitSha: string | null;
    repositoryRoot: string;
    artifacts: HookArtifactPaths;
    sessionTitle?: string | null;
}): Promise<{ id?: string; content?: string } | null> {
    const sessionKey = `chat_session:${options.agent}:${options.sessionId}`;
    let sessionNode = await sendToDaemon('getByKey', {
        contextId: options.contextId,
        key: sessionKey,
        includeHidden: true
    }) as { id?: string; content?: string } | null;

    if (!sessionNode?.id) {
        sessionNode = await sendToDaemon('addNode', {
            contextId: options.contextId,
            type: 'artifact',
            hidden: true,
            thread: options.sessionId,
            key: sessionKey,
            tags: ['chat_session', `agent:${options.agent}`],
            source: `hook:${options.agent}`,
            content: options.summary,
            createdAtOverride: options.startedAt,
            rawPayload: {
                agent: options.agent,
                sessionId: options.sessionId,
                sessionTitle: options.sessionTitle ?? null,
                branch: options.branch,
                commitSha: options.commitSha,
                repositoryRoot: options.repositoryRoot,
                meta: buildHookCaptureMeta({
                    agent: options.agent,
                    sessionId: options.sessionId,
                    turnId: `session-${options.sessionId}`,
                    role: 'session',
                    occurredAt: options.startedAt,
                    branch: options.branch,
                    commitSha: options.commitSha,
                    repositoryRoot: options.repositoryRoot,
                    artifacts: options.artifacts,
                    extra: {
                        sessionTitle: options.sessionTitle ?? null
                    }
                })
            }
        }) as { id?: string; content?: string } | null;
    } else if (sessionNode.content !== options.summary) {
        sessionNode = await sendToDaemon('updateNode', {
            id: sessionNode.id,
            updates: {
                content: options.summary,
                hidden: true
            }
        }) as { id?: string; content?: string } | null;
    }

    return sessionNode;
}

async function ensureChatCommitNode(options: {
    contextId: string;
    agent: HookSupportedAgent;
    branch: string | null;
    commitSha: string | null;
    repositoryRoot: string;
}): Promise<{ id?: string } | null> {
    if (!options.commitSha) return null;

    const commitKey = `chat_commit:${options.branch ?? 'detached'}:${options.commitSha}`;
    let commitNode = await sendToDaemon('getByKey', {
        contextId: options.contextId,
        key: commitKey,
        includeHidden: true
    }) as { id?: string } | null;
    if (commitNode?.id) return commitNode;

    commitNode = await sendToDaemon('addNode', {
        contextId: options.contextId,
        type: 'artifact',
        hidden: true,
        key: commitKey,
        tags: ['chat_commit', `branch:${options.branch ?? 'detached'}`],
        source: `hook:${options.agent}`,
        content: `Commit ${options.commitSha.slice(0, 12)} on ${options.branch ?? 'detached'}`,
        rawPayload: {
            branch: options.branch,
            commitSha: options.commitSha,
            repositoryRoot: options.repositoryRoot
        }
    }) as { id?: string } | null;
    return commitNode;
}

async function commandConnectorHook(action: string | undefined, flags: Record<string, string | boolean>): Promise<number> {
    const safeAction = action ?? 'status';
    const validActions = ['install', 'status', 'ingest', 'prune', 'session-start'];
    if (!validActions.includes(safeAction)) {
        console.error(`Unknown connector hook action: '${action ?? ''}'`);
        console.error(`Valid actions: ${validActions.join(', ')}`);
        return 1;
    }

    const asJson = Boolean(flags.json);
    const quiet = Boolean(flags.quiet) || asJson;

    if (safeAction === 'install') {
        const dryRun = Boolean(flags['dry-run']) || Boolean(flags['hooks-dry-run']);
        const installClaudeGlobal = Boolean(flags.global);
        const repoRoot = resolveRepoRoot(parseOptionalStringFlag(flags['repo-root']));
        const requestedContextId = parseOptionalStringFlag(flags['context-id'] ?? flags.contextId);
        const contextId = await resolveContextIdForHookIngest(repoRoot, requestedContextId);
        const previewError = validateExplicitPreviewSelection(flags.clients, 'claude,factory,antigravity,codex');
        if (previewError) {
            console.error(previewError);
            return 1;
        }
        const clients = parseHookClients(flags.clients).map(client => client.toLowerCase());
        const result = installHooks({
            projectRoot: repoRoot,
            contextId,
            clients,
            dryRun,
            cliCommand: '0ctx',
            installClaudeGlobal
        });

        if (asJson) {
            console.log(JSON.stringify({
                ok: true,
                dryRun: result.dryRun,
                changed: result.changed,
                projectRoot: result.projectRoot,
                contextId: result.contextId,
                projectConfigPath: result.projectConfigPath,
                statePath: result.statePath,
                claudeConfigPath: result.claudeConfigPath,
                claudeHookConfigured: result.claudeHookConfigured,
                claudeHookReason: result.claudeHookReason,
                claudeGlobalConfigPath: result.claudeGlobalConfigPath,
                claudeGlobalHookConfigured: result.claudeGlobalHookConfigured,
                claudeGlobalHookReason: result.claudeGlobalHookReason,
                windsurfConfigPath: result.windsurfConfigPath,
                windsurfHookConfigured: result.windsurfHookConfigured,
                windsurfHookReason: result.windsurfHookReason,
                cursorConfigPath: result.cursorConfigPath,
                cursorHookConfigured: result.cursorHookConfigured,
                cursorHookReason: result.cursorHookReason,
                factoryConfigPath: result.factoryConfigPath,
                factoryHookConfigured: result.factoryHookConfigured,
                factoryHookReason: result.factoryHookReason,
                antigravityConfigPath: result.antigravityConfigPath,
                antigravityHookConfigured: result.antigravityHookConfigured,
                antigravityHookReason: result.antigravityHookReason,
                codexConfigPath: result.codexConfigPath,
                codexNotifyConfigured: result.codexNotifyConfigured,
                codexNotifyReason: result.codexNotifyReason,
                warnings: result.warnings,
                agents: result.state.agents
            }, null, 2));
        } else if (!quiet) {
            console.log(`hook_install: ${dryRun ? 'dry-run' : (result.changed ? 'updated' : 'already up-to-date')}`);
            console.log(`project_root: ${result.projectRoot}`);
            console.log(`context_id: ${result.contextId ?? 'n/a (repo path will resolve at capture time)'}`);
            console.log(`project_config: ${result.projectConfigPath}`);
            console.log(`state_path: ${result.statePath}`);
            console.log(`claude_config: ${result.claudeConfigPath}`);
            console.log(`claude_hook: ${result.claudeHookConfigured ? 'configured' : `not-configured (${result.claudeHookReason ?? 'unknown'})`}`);
            if (installClaudeGlobal || result.claudeGlobalHookConfigured) {
                console.log(`claude_global_config: ${result.claudeGlobalConfigPath}`);
                console.log(`claude_global_hook: ${result.claudeGlobalHookConfigured ? 'configured' : `not-configured (${result.claudeGlobalHookReason ?? 'unknown'})`}`);
            }
            console.log(`windsurf_config: ${result.windsurfConfigPath}`);
            console.log(`windsurf_hook: ${result.windsurfHookConfigured ? 'configured' : `not-configured (${result.windsurfHookReason ?? 'unknown'})`}`);
            console.log(`cursor_config: ${result.cursorConfigPath}`);
            console.log(`cursor_hook: ${result.cursorHookConfigured ? 'configured' : `not-configured (${result.cursorHookReason ?? 'unknown'})`}`);
            console.log(`factory_config: ${result.factoryConfigPath}`);
            console.log(`factory_hook: ${result.factoryHookConfigured ? 'configured' : `not-configured (${result.factoryHookReason ?? 'unknown'})`}`);
            console.log(`antigravity_config: ${result.antigravityConfigPath}`);
            console.log(`antigravity_hook: ${result.antigravityHookConfigured ? 'configured' : `not-configured (${result.antigravityHookReason ?? 'unknown'})`}`);
            console.log(`codex_config: ${result.codexConfigPath}`);
            console.log(`codex_notify: ${result.codexNotifyConfigured ? 'configured' : `not-configured (${result.codexNotifyReason ?? 'unknown'})`}`);
            for (const agent of result.state.agents) {
                console.log(`agent_${agent.agent}: ${agent.status}${agent.installed ? ' (installed)' : ''}`);
            }
            for (const warning of result.warnings) {
                console.log(`warning: ${warning}`);
            }
        }
        return 0;
    }

    if (safeAction === 'status') {
        const state = readHookInstallState();
        if (asJson) {
            console.log(JSON.stringify(state, null, 2));
        } else if (!quiet) {
            console.log('\nConnector Hook Status\n');
            console.log(`  project_root:   ${state.projectRoot ?? 'n/a'}`);
            console.log(`  project_config: ${state.projectConfigPath ?? 'n/a'}`);
            console.log(`  updated_at:     ${new Date(state.updatedAt).toISOString()}`);
            for (const agent of state.agents) {
                console.log(`  ${agent.agent}: ${agent.status}${agent.installed ? ' (installed)' : ''}`);
            }
            console.log('');
        }
        return 0;
    }

    if (safeAction === 'prune') {
        const maxAgeDays = parsePositiveIntegerFlag(flags.days ?? flags['retention-days'], getHookDumpRetentionDays());
        const result = pruneHookDumps({ maxAgeDays });
        if (asJson) {
            console.log(JSON.stringify({ ok: true, ...result }, null, 2));
        } else if (!quiet) {
            console.log('\nHook Dump Prune\n');
            console.log(`  root:           ${result.rootDir}`);
            console.log(`  retention_days: ${result.maxAgeDays}`);
            console.log(`  deleted_files:  ${result.deletedFiles}`);
            console.log(`  deleted_dirs:   ${result.deletedDirs}`);
            console.log(`  reclaimed:      ${result.reclaimedBytes} bytes`);
            console.log('');
        }
        return 0;
    }

    const rawAgentFlag = parseOptionalStringFlag(flags.agent)?.trim().toLowerCase() ?? null;
    const agent = extractSupportedHookAgent(rawAgentFlag);
    if (!agent) {
        console.error("connector_hook_ingest_requires_agent: pass --agent=claude|windsurf|codex|cursor|factory|antigravity");
        return 1;
    }

    const inputFile = parseOptionalStringFlag(flags['input-file']);
    const inlinePayload = parseOptionalStringFlag(flags.payload);
    const payloadText = inputFile
        ? fs.readFileSync(path.resolve(inputFile), 'utf8')
        : inlinePayload ?? readStdinPayload();
    if (safeAction !== 'session-start' && (!payloadText || payloadText.trim().length === 0)) {
        console.error('connector_hook_ingest_requires_payload: provide --input-file, --payload, or stdin');
        return 1;
    }

    let parsedPayload: unknown = {};
    if (payloadText && payloadText.trim().length > 0) {
        try {
            parsedPayload = JSON.parse(payloadText);
        } catch {
            parsedPayload = { content: payloadText };
        }
    }

    if (safeAction === 'session-start') {
        if (agent !== 'claude' && agent !== 'factory' && agent !== 'antigravity') {
            if (asJson) {
                console.log(JSON.stringify({
                    ok: true,
                    injected: false,
                    reason: 'unsupported_agent'
                }, null, 2));
            }
            return 0;
        }

        const rawPayload = asRecord(parsedPayload) ?? {};
        const requestedRepoRoot = parseOptionalStringFlag(flags['repo-root']);
        const repoRoot = resolveHookCaptureRoot(
            agent,
            rawPayload,
            requestedRepoRoot ? resolveRepoRoot(requestedRepoRoot) : null
        ) ?? resolveRepoRoot(requestedRepoRoot);
        const explicitContextId = parseOptionalStringFlag(flags['context-id'] ?? flags.contextId);
        const contextId = await resolveContextIdForHookIngest(repoRoot, explicitContextId);
        if (!contextId) {
            if (asJson) {
                console.log(JSON.stringify({
                    ok: true,
                    injected: false,
                    reason: 'context_missing'
                }, null, 2));
            }
            return 0;
        }

        const workspaceCheck = await validateHookIngestWorkspace({
            agent,
            contextId,
            repoRoot,
            payload: rawPayload
        });
        if (!workspaceCheck.ok) {
            if (asJson) {
                console.log(JSON.stringify({
                    ok: true,
                    injected: false,
                    reason: 'workspace_mismatch',
                    captureRoot: workspaceCheck.captureRoot
                }, null, 2));
            }
            return 0;
        }

        const captureRoot = workspaceCheck.captureRoot;
        const branch = safeGitValue(captureRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
        const pack = await sendToDaemon('getAgentContextPack', {
            contextId,
            branch,
            worktreePath: captureRoot,
            sessionLimit: 3,
            checkpointLimit: 2,
            handoffLimit: 5
        }) as { workspaceName?: string; promptText?: string };

        if (asJson) {
            console.log(JSON.stringify({
                ok: true,
                injected: true,
                contextId,
                workspaceName: pack.workspaceName,
                captureRoot,
                branch,
                context: pack.promptText
            }, null, 2));
        } else if (typeof pack.promptText === 'string' && pack.promptText.trim().length > 0) {
            process.stdout.write(pack.promptText);
        }
        return 0;
    }

    const normalized = normalizeHookPayload(agent, parsedPayload);
    const explicitTranscriptPath = resolveHookTranscriptPath(normalized.raw);
    const codexArchivePath = agent === 'codex' && !explicitTranscriptPath
        ? resolveCodexSessionArchivePath(normalized.raw, normalized.sessionId)
        : null;
    const codexArchiveCapture = agent === 'codex' && codexArchivePath
        ? readCodexArchiveCapture(codexArchivePath, {
            sessionId: normalized.sessionId,
            occurredAt: normalized.occurredAt,
            sessionTitle: typeof normalized.raw.sessionTitle === 'string' ? normalized.raw.sessionTitle : null,
            cwd: typeof normalized.raw.cwd === 'string' ? normalized.raw.cwd : null
        })
        : null;
    if (agent === 'codex') {
        if (codexArchiveCapture?.cwd && typeof normalized.raw.cwd !== 'string') {
            normalized.raw.cwd = codexArchiveCapture.cwd;
        }
        if (codexArchiveCapture?.sessionTitle && typeof normalized.raw.sessionTitle !== 'string') {
            normalized.raw.sessionTitle = codexArchiveCapture.sessionTitle;
        }
    }
    const requestedRepoRoot = parseOptionalStringFlag(flags['repo-root']);
    const repoRoot = resolveHookCaptureRoot(
        agent,
        normalized.raw,
        requestedRepoRoot ? resolveRepoRoot(requestedRepoRoot) : null
    ) ?? resolveRepoRoot(requestedRepoRoot);
    const explicitContextId = parseOptionalStringFlag(flags['context-id'] ?? flags.contextId);
    const contextId = await resolveContextIdForHookIngest(repoRoot, explicitContextId);
    if (!contextId) {
        console.error('connector_hook_ingest_context_missing: no workspace matched this repository path. Run `0ctx enable` in this repo first, or use --context-id only for support workflows.');
        return 1;
    }
    const captureNow = Date.now();
    const transcriptSourcePath = explicitTranscriptPath ?? codexArchivePath;
    const transcriptDumpPath = transcriptSourcePath
        ? persistHookTranscriptSnapshot({
            agent,
            sessionId: normalized.sessionId,
            transcriptPath: transcriptSourcePath
        })
        : null;
    const transcriptHistoryPath = transcriptSourcePath
        ? persistHookTranscriptHistory({
            agent,
            sessionId: normalized.sessionId,
            transcriptPath: transcriptSourcePath,
            now: captureNow
        })
        : null;
    const hookEventLogPath = appendHookEventLog({
        agent,
        sessionId: normalized.sessionId,
        rawText: payloadText
    });
    const dumpPath = persistHookDump({
        agent,
        contextId,
        rawText: payloadText,
        parsedPayload,
        normalized,
        repositoryRoot: resolveHookCaptureRoot(agent, normalized.raw, repoRoot),
        eventLogPath: hookEventLogPath,
        transcriptSnapshotPath: transcriptDumpPath,
        transcriptHistoryPath,
        now: captureNow
    });
    const artifacts: HookArtifactPaths = {
        dumpPath,
        hookEventLogPath,
        transcriptDumpPath,
        transcriptHistoryPath,
        transcriptSourcePath
    };
    const workspaceCheck = await validateHookIngestWorkspace({
        agent,
        contextId,
        repoRoot,
        payload: normalized.raw
    });
    if (!workspaceCheck.ok) {
        console.error(workspaceCheck.error ?? 'connector_hook_ingest_workspace_mismatch');
        return 1;
    }

    const captureRoot = workspaceCheck.captureRoot;
    const branch = safeGitValue(captureRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const commitSha = safeGitValue(captureRoot, ['rev-parse', 'HEAD']);
    const transcriptCapture = transcriptSourcePath
        ? (agent === 'codex'
            ? (codexArchiveCapture ?? readCodexArchiveCapture(transcriptSourcePath, {
                sessionId: normalized.sessionId,
                occurredAt: normalized.occurredAt,
                sessionTitle: typeof normalized.raw.sessionTitle === 'string' ? normalized.raw.sessionTitle : null,
                cwd: typeof normalized.raw.cwd === 'string' ? normalized.raw.cwd : null
            }))
            : readTranscriptCapture(transcriptSourcePath))
        : null;
    const codexCapture = agent === 'codex' && !transcriptCapture
        ? readCodexCapture(normalized.raw, {
            sessionId: normalized.sessionId,
            turnId: normalized.turnId,
            occurredAt: normalized.occurredAt
        })
        : null;
    const inlineCapture = !transcriptCapture && !codexCapture
        ? readInlineHookCapture(agent, normalized.raw, {
            sessionId: normalized.sessionId,
            turnId: normalized.turnId,
            occurredAt: normalized.occurredAt
        })
        : null;
    const captureData = transcriptCapture ?? codexCapture ?? inlineCapture;
    const sessionSummary = captureData?.summary ?? normalized.summary;
    const sessionStartedAt = captureData?.startedAt ?? normalized.occurredAt;
    const sessionNode = await ensureChatSessionNode({
        contextId,
        agent,
        sessionId: normalized.sessionId,
        summary: sessionSummary,
        startedAt: sessionStartedAt,
        branch,
        commitSha,
        repositoryRoot: captureRoot,
        artifacts,
        sessionTitle: captureData?.sessionTitle ?? (typeof normalized.raw.sessionTitle === 'string' ? normalized.raw.sessionTitle : null)
    });
    const commitNode = await ensureChatCommitNode({
        contextId,
        agent,
        branch,
        commitSha,
        repositoryRoot: captureRoot
    });

    const capturedNodes: Array<{
        id: string;
        key: string;
        role: string;
        occurredAt: number;
        deduped: boolean;
    }> = [];

    if (captureData && captureData.messages.length > 0) {
        for (const message of captureData.messages) {
            const key = `chat_turn:${agent}:${normalized.sessionId}:${message.messageId}`;
            const existing = await sendToDaemon('getByKey', {
                contextId,
                key,
                includeHidden: true
            }) as { id?: string } | null;

            if (existing?.id) {
                capturedNodes.push({
                    id: existing.id,
                    key,
                    role: message.role,
                    occurredAt: message.occurredAt,
                    deduped: true
                });
                continue;
            }

            const node = await sendToDaemon('addNode', {
                contextId,
                type: 'artifact',
                hidden: true,
                thread: normalized.sessionId,
                key,
                tags: ['chat_turn', `agent:${agent}`, `role:${message.role}`],
                source: `hook:${agent}`,
                content: message.text,
                createdAtOverride: message.occurredAt,
                rawPayload: {
                    ...message.raw,
                    role: message.role,
                    text: message.text,
                    branch,
                    commitSha,
                    occurredAt: message.occurredAt,
                    meta: buildHookCaptureMeta({
                        agent,
                        sessionId: normalized.sessionId,
                        turnId: message.messageId,
                        role: message.role,
                        occurredAt: message.occurredAt,
                        branch,
                        commitSha,
                        repositoryRoot: captureRoot,
                        artifacts,
                        extra: {
                            parentId: message.parentId,
                            lineNumber: message.lineNumber,
                            transcriptMessageId: message.messageId,
                            captureSource: transcriptCapture
                                ? (agent === 'codex' ? 'codex-archive' : 'transcript')
                                : (codexCapture ? 'codex-notify' : 'inline-hook')
                        }
                    })
                }
            }) as { id: string };

            capturedNodes.push({
                id: node.id,
                key,
                role: message.role,
                occurredAt: message.occurredAt,
                deduped: false
            });

            if (sessionNode?.id) {
                await sendToDaemon('addEdge', {
                    fromId: node.id,
                    toId: sessionNode.id,
                    relation: 'depends_on'
                });
            }
            if (commitNode?.id) {
                await sendToDaemon('addEdge', {
                    fromId: node.id,
                    toId: commitNode.id,
                    relation: 'depends_on'
                });
            }
        }
    } else {
        const key = `chat_turn:${agent}:${normalized.sessionId}:${normalized.turnId}`;
        const existing = await sendToDaemon('getByKey', {
            contextId,
            key,
            includeHidden: true
        }) as { id?: string } | null;

        if (existing?.id) {
            capturedNodes.push({
                id: existing.id,
                key,
                role: normalized.role,
                occurredAt: normalized.occurredAt,
                deduped: true
            });
        } else {
            const node = await sendToDaemon('addNode', {
                contextId,
                type: 'artifact',
                hidden: true,
                thread: normalized.sessionId,
                key,
                tags: ['chat_turn', `agent:${agent}`, `role:${normalized.role}`],
                source: `hook:${agent}`,
                content: normalized.summary,
                createdAtOverride: normalized.occurredAt,
                rawPayload: {
                    ...normalized.raw,
                    branch,
                    commitSha,
                    occurredAt: normalized.occurredAt,
                    meta: buildHookCaptureMeta({
                        agent,
                        sessionId: normalized.sessionId,
                        turnId: normalized.turnId,
                        role: normalized.role,
                        occurredAt: normalized.occurredAt,
                        branch,
                        commitSha,
                        repositoryRoot: captureRoot,
                        artifacts
                    })
                }
            }) as { id: string };

            capturedNodes.push({
                id: node.id,
                key,
                role: normalized.role,
                occurredAt: normalized.occurredAt,
                deduped: false
            });

            if (sessionNode?.id) {
                await sendToDaemon('addEdge', {
                    fromId: node.id,
                    toId: sessionNode.id,
                    relation: 'depends_on'
                });
            }
            if (commitNode?.id) {
                await sendToDaemon('addEdge', {
                    fromId: node.id,
                    toId: commitNode.id,
                    relation: 'depends_on'
                });
            }
        }
    }

    const insertedNodes = capturedNodes.filter(node => !node.deduped);
    const dedupedNodes = capturedNodes.filter(node => node.deduped);
    const leadNode = insertedNodes.at(-1) ?? capturedNodes.at(-1) ?? null;

    if (asJson) {
        console.log(JSON.stringify({
            ok: true,
            nodeId: leadNode?.id ?? null,
            nodeIds: capturedNodes.map(node => node.id),
            keys: capturedNodes.map(node => node.key),
            sessionNodeId: sessionNode?.id ?? null,
            contextId,
            sessionId: normalized.sessionId,
            insertedCount: insertedNodes.length,
            dedupedCount: dedupedNodes.length,
            transcriptMessageCount: transcriptCapture?.messages.length ?? 0,
            branch,
            commitSha,
            dumpPath,
            hookEventLogPath,
            transcriptDumpPath,
            transcriptHistoryPath
        }, null, 2));
    } else if (!quiet) {
        console.log(`hook_ingest: captured ${insertedNodes.length > 0 ? insertedNodes.length : dedupedNodes.length} ${agent} message${(insertedNodes.length + dedupedNodes.length) === 1 ? '' : 's'}`);
        if (leadNode?.id) console.log(`node_id: ${leadNode.id}`);
        console.log(`context_id: ${contextId}`);
        console.log(`session_id: ${normalized.sessionId}`);
        console.log(`inserted: ${insertedNodes.length}`);
        console.log(`deduped: ${dedupedNodes.length}`);
        if (dumpPath) console.log(`hook_dump: ${dumpPath}`);
        if (hookEventLogPath) console.log(`hook_event_log: ${hookEventLogPath}`);
        if (transcriptDumpPath) console.log(`transcript_dump: ${transcriptDumpPath}`);
        if (transcriptHistoryPath) console.log(`transcript_history: ${transcriptHistoryPath}`);
        if (branch) console.log(`branch: ${branch}`);
        if (commitSha) console.log(`commit: ${commitSha}`);
    }
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
                        : ((sync?.enabled === false || sync == null || sync?.running) ? 'connected' : 'degraded');
        const recoveryState = !daemon.ok
            ? 'blocked'
            : (!token || !registration)
                ? 'recovering'
                : (registration.runtime.eventQueueBackoff > 0
                    || Boolean(registration.runtime.eventBridgeError)
                    || Boolean(registration.runtime.commandBridgeError)
                    || Boolean(cloud.lastError))
                    ? 'backoff'
                    : 'healthy';

        const payload = {
            posture,
            recoveryState,
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
                    recoveryState: registration.runtime.recoveryState ?? recoveryState,
                    consecutiveFailures: registration.runtime.consecutiveFailures ?? 0,
                    lastHealthyAt: registration.runtime.lastHealthyAt
                        ? new Date(registration.runtime.lastHealthyAt).toISOString()
                        : null,
                    lastRecoveryAt: registration.runtime.lastRecoveryAt
                        ? new Date(registration.runtime.lastRecoveryAt).toISOString()
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
        console.log(`  recovery:     ${payload.recoveryState}`);
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
                console.log(
                    `  recovery_state: ${payload.registration.runtime.recoveryState}` +
                    ` failures=${payload.registration.runtime.consecutiveFailures}`
                );
                if (payload.registration.runtime.lastEventSyncAt) {
                    console.log(`  event_sync:   ${payload.registration.runtime.lastEventSyncAt}`);
                }
                if (payload.registration.runtime.eventBridgeError) {
                    console.log(`  event_error:  ${payload.registration.runtime.eventBridgeError}`);
                }
                if (payload.registration.runtime.lastHealthyAt) {
                    console.log(`  last_healthy: ${payload.registration.runtime.lastHealthyAt}`);
                }
                if (payload.registration.runtime.lastRecoveryAt) {
                    console.log(`  last_recovery:${payload.registration.runtime.lastRecoveryAt}`);
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
            console.log('Validation failed. Fix the failed checks, then rerun `0ctx setup --validate` or use `0ctx enable` inside a repo.');
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
    const skipHooks = Boolean(flags['skip-hooks']);
    const hooksDryRun = Boolean(flags['hooks-dry-run']);
    const requireCloud = Boolean(flags['require-cloud']);
    const waitCloudReady = Boolean(flags['wait-cloud-ready']);
    const cloudWaitTimeoutMs = parsePositiveIntegerFlag(flags['cloud-wait-timeout-ms'], 60_000);
    const cloudWaitIntervalMs = parsePositiveIntegerFlag(flags['cloud-wait-interval-ms'], 2_000);
    const createContextName = parseOptionalStringFlag(flags['create-context']);
    const dashboardQueryInput = flags['dashboard-query'];
    const steps: SetupStep[] = [];
    const previewError = validateExplicitPreviewSelection(flags.clients, 'claude,factory,antigravity,codex');
    if (previewError) {
        console.error(previewError);
        return 1;
    }

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

    if (skipHooks) {
        steps.push({
            id: 'hooks_install',
            status: 'warn',
            code: 0,
            message: 'Capture integration installation was skipped by --skip-hooks.'
        });
    } else {
        const hooksCode = await commandConnectorHook('install', {
            ...flags,
            quiet: true,
            json: false,
            'repo-root': parseOptionalStringFlag(flags['repo-root']) ?? process.cwd(),
            'dry-run': hooksDryRun
        });
        steps.push({
            id: 'hooks_install',
            status: hooksCode === 0 ? (hooksDryRun ? 'warn' : 'pass') : 'fail',
            code: hooksCode,
            message: hooksCode === 0
                ? (hooksDryRun ? 'Capture integration installation dry-run completed.' : 'Capture integration installation completed.')
                : 'Capture integration installation failed.'
        });
        if (hooksCode !== 0) {
            if (asJson) {
                console.log(JSON.stringify({ ok: false, steps, dashboardUrl: getHostedDashboardUrl() }, null, 2));
            }
            return hooksCode;
        }
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
    const setupRepoRoot = resolveRepoRoot(null);
    if (createContextName) {
        try {
            const created = await sendToDaemon('createContext', {
                name: createContextName,
                paths: [setupRepoRoot]
            }) as { id?: string; contextId?: string };
            createdContextId = created?.id ?? created?.contextId ?? null;
            steps.push({
                id: 'create_context',
                status: 'pass',
                code: 0,
                message: `Context created: ${createContextName} (${setupRepoRoot})`
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

function printHelp(showAdvanced = false): void {
    if (!showAdvanced) {
        console.log(`0ctx CLI

Usage:
  0ctx                    Auto-enable inside a repo. Outside a repo, show readiness/help.
  0ctx enable [--repo-root=<path>] [--name=<workspace>] [--json]
              [--clients=ga|claude,factory,antigravity] [--mcp-clients=none|ga|claude,antigravity]
              [--skip-bootstrap] [--skip-hooks] [--mcp-profile=core|recall|ops]

Daily use:
  0ctx workstreams [--repo-root=<path>] [--limit=100] [--json]
  0ctx workstreams current [--repo-root=<path>] [--branch=<name>] [--worktree-path=<path>]
                         [--session-limit=3] [--checkpoint-limit=2] [--json]
  0ctx workstreams compare [--repo-root=<path>] --source=<branch> --target=<branch>
                          [--source-worktree-path=<path>] [--target-worktree-path=<path>]
                          [--session-limit=3] [--checkpoint-limit=2] [--json]
  0ctx agent-context [--repo-root=<path>] [--branch=<name>] [--worktree-path=<path>]
                     [--session-limit=3] [--checkpoint-limit=2] [--handoff-limit=5] [--json]
  0ctx sessions [--repo-root=<path>] [--branch=<name>] [--session-id=<id>] [--worktree-path=<path>] [--limit=100] [--json]
  0ctx checkpoints [list] [--repo-root=<path>] [--branch=<name>] [--worktree-path=<path>] [--limit=100] [--json]
  0ctx checkpoints create [--repo-root=<path>] [--session-id=<id>] [--name="..."] [--summary="..."] [--json]
  0ctx checkpoints show [--repo-root=<path>] [--checkpoint-id=<id>] [--json]
  0ctx resume [--repo-root=<path>] [--session-id=<id>] [--json]
  0ctx rewind [--repo-root=<path>] [--checkpoint-id=<id>] [--json]
  0ctx explain [--repo-root=<path>] [--checkpoint-id=<id>] [--json]
  0ctx status [--json] [--compact]
  0ctx shell
  0ctx version [--verbose] [--json]
  0ctx --version | -v

Supported integrations:
  GA: Claude, Factory, Antigravity
  Preview: Codex (notify + archive), Cursor, Windsurf

Authentication:
  0ctx auth login
  0ctx auth logout
  0ctx auth status [--json]

Need machine management, sync, connector controls, or preview install paths?
  0ctx help --advanced
`);
        return;
    }

    console.log(`0ctx CLI

Usage:
  0ctx                    Auto-enable inside a repo. Outside a repo, show readiness/help.
  0ctx shell
  0ctx version [--verbose] [--json]
  0ctx --version | -v

Recommended daily flow:
  0ctx enable [--repo-root=<path>] [--name=<workspace>] [--json]
              [--clients=ga|claude,factory,antigravity] [--mcp-clients=none|ga|claude,antigravity]
              [--skip-bootstrap] [--skip-hooks] [--mcp-profile=core|recall|ops]

Advanced / machine management:
  0ctx setup [--clients=ga|<explicit-list>] [--no-open] [--json] [--validate]
             [--require-cloud] [--wait-cloud-ready]
             [--cloud-wait-timeout-ms=60000] [--cloud-wait-interval-ms=2000]
             [--create-context=<name>] [--dashboard-query[=k=v&...]]
             [--skip-service] [--skip-bootstrap] [--skip-hooks] [--hooks-dry-run]
             [--mcp-profile=all|core|recall|ops]
  0ctx install [--clients=ga|<explicit-list>] [--json] [--skip-bootstrap] [--mcp-profile=all|core|recall|ops]
  0ctx bootstrap [--dry-run] [--clients=ga|<explicit-list>] [--entrypoint=/path/to/mcp-server.js]
                 [--mcp-profile=all|core|recall|ops] [--json]
  0ctx mcp [bootstrap]
  0ctx mcp                     Interactive MCP bootstrap for GA clients
  0ctx mcp bootstrap [--dry-run] [--clients=ga|<explicit-list>] [--mcp-profile=all|core|recall|ops]
  0ctx doctor [--json] [--clients=...]
  0ctx status [--json] [--compact]
  0ctx repair [--clients=...] [--deep] [--json]
  0ctx reset [--confirm] [--full] [--include-auth] [--json]
  0ctx workstreams [--repo-root=<path>] [--limit=100] [--json]
  0ctx workstreams current [--repo-root=<path>] [--branch=<name>] [--worktree-path=<path>]
                           [--session-limit=3] [--checkpoint-limit=2] [--json]
  0ctx workstreams compare [--repo-root=<path>] --source=<branch> --target=<branch>
                        [--source-worktree-path=<path>] [--target-worktree-path=<path>]
                        [--session-limit=3] [--checkpoint-limit=2] [--json]
  0ctx agent-context [--repo-root=<path>] [--branch=<name>] [--worktree-path=<path>]
                     [--session-limit=3] [--checkpoint-limit=2] [--handoff-limit=5] [--json]
  0ctx branches [--repo-root=<path>] [--limit=100] [--json]
  0ctx branches compare [--repo-root=<path>] --source=<branch> --target=<branch>
                     [--source-worktree-path=<path>] [--target-worktree-path=<path>]
                     [--session-limit=3] [--checkpoint-limit=2] [--json]
  0ctx sessions [--repo-root=<path>] [--branch=<name>] [--session-id=<id>] [--worktree-path=<path>] [--limit=100] [--json]
  0ctx checkpoints [list] [--repo-root=<path>] [--branch=<name>] [--worktree-path=<path>] [--limit=100] [--json]
  0ctx checkpoints create [--repo-root=<path>] [--session-id=<id>] [--name="..."] [--summary="..."] [--json]
  0ctx checkpoints show [--repo-root=<path>] [--checkpoint-id=<id>] [--json]
  0ctx extract session [--repo-root=<path>] [--session-id=<id>] [--preview] [--keys=key1,key2] [--max-nodes=12] [--json]
  0ctx extract checkpoint [--repo-root=<path>] [--checkpoint-id=<id>] [--preview] [--keys=key1,key2] [--max-nodes=12] [--json]
  0ctx resume [--repo-root=<path>] [--session-id=<id>] [--json]
  0ctx rewind [--repo-root=<path>] [--checkpoint-id=<id>] [--json]
  0ctx explain [--repo-root=<path>] [--checkpoint-id=<id>] [--json]
  0ctx logs [--no-open] [--snapshot] [--limit=50] [--since-hours=N] [--grep=text] [--errors-only]
  0ctx recall [--mode=auto|temporal|topic|graph] [--query="..."] [--since-hours=24] [--limit=10] [--depth=2] [--max-nodes=30] [--start] [--json]
  0ctx recall feedback --node-id=<id> (--helpful|--not-helpful) [--reason="..."] [--context-id=<id>] [--json]
  0ctx recall feedback list|stats [--context-id=<id>] [--node-id=<id>] [--helpful|--not-helpful] [--limit=50] [--json]
  0ctx dashboard [--no-open] [--dashboard-query=k=v&...]
  0ctx release publish --version vX.Y.Z [--tag latest|next] [--otp 123456] [--dry-run] [--json]
  0ctx daemon start

Capture support:
  GA:      claude, factory, antigravity
  Preview: codex (notify + archive), cursor, windsurf

Client scope defaults:
  ga      Supported-by-default product path
  Preview integrations must be named explicitly when you opt into them.
  Example: --clients=codex

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
  0ctx sync policy get [--repo-root=<path>] [--json]
  0ctx sync policy set <local_only|metadata_only|full_sync> [--repo-root=<path>] [--json]

Connector:
  0ctx connector service install|enable|disable|uninstall|status|start|stop|restart
  0ctx connector install|enable|disable|uninstall|status|start|stop|restart
  0ctx connector status [--json] [--cloud] [--require-bridge]
  0ctx connector verify [--require-cloud] [--json]
  0ctx connector register [--force] [--local-only] [--require-cloud] [--json]
  0ctx connector run [--once] [--interval-ms=5000] [--no-daemon-autostart]
  0ctx connector hook install [--clients=ga|<explicit-list>] [--repo-root=<path>] [--global]
  0ctx connector hook status [--json]
  0ctx connector hook prune [--days=14] [--json]
0ctx connector hook session-start --agent=claude|factory|antigravity [--repo-root=<path>]
                                    [--input-file=<path>|--payload='<json>'|stdin] [--json]
  0ctx connector hook ingest --agent=claude|windsurf|codex|cursor|factory|antigravity [--repo-root=<path>]
                              [--input-file=<path>|--payload='<json>'|stdin]
  0ctx hook install|status|prune|session-start|ingest  Alias for "0ctx connector hook ..."
  0ctx connector queue status [--json]
  0ctx connector queue drain [--max-batches=10] [--batch-size=200] [--wait] [--strict|--fail-on-retry] [--timeout-ms=120000] [--poll-ms=1000] [--json]
  0ctx connector queue purge [--all|--older-than-hours=N|--min-attempts=N] [--dry-run|--confirm] [--json]
  0ctx connector queue logs [--limit=50] [--json] [--clear --confirm|--dry-run]
  0ctx connector logs [--service|--system] [--no-open] [--snapshot] [--limit=50] [--since-hours=N] [--grep=text] [--errors-only]

Support overrides:
  Use --context-id only for support, debugging, or automation outside a bound repo.

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

async function resolveCommandContextId(
    flags: Record<string, string | boolean>
): Promise<string | null> {
    const explicit = getContextIdFlag(flags);
    if (explicit) return explicit;

    const requestedRepoRoot = parseOptionalStringFlag(flags['repo-root'] ?? flags.repoRoot);
    try {
        const contexts = await sendToDaemon('listContexts', {}) as Array<{ id?: string; paths?: string[] }> | null;
        if (Array.isArray(contexts)) {
            const repoRoot = resolveRepoRoot(requestedRepoRoot);
            const byRepo = selectHookContextId(contexts, repoRoot, null);
            if (byRepo) return byRepo;
        }
    } catch {
        return null;
    }
    return null;
}

async function requireCommandContextId(
    flags: Record<string, string | boolean>,
    commandLabel: string
): Promise<string | null> {
    const contextId = await resolveCommandContextId(flags);
    if (!contextId) {
        console.error(`Missing workspace for \`${commandLabel}\`. Run this inside a bound repo, pass '--repo-root=<path>', or use '--context-id=<contextId>' for support workflows.`);
        return null;
    }
    return contextId;
}

function resolveCommandRepoRoot(flags: Record<string, string | boolean>): string {
    return resolveRepoRoot(parseOptionalStringFlag(flags['repo-root'] ?? flags.repoRoot));
}

function resolveCommandWorkstreamScope(flags: Record<string, string | boolean>): {
    repoRoot: string;
    branch: string | null;
    worktreePath: string | null;
} {
    const repoRoot = resolveCommandRepoRoot(flags);
    return {
        repoRoot,
        branch: parseOptionalStringFlag(flags.branch) ?? getCurrentWorkstream(repoRoot),
        worktreePath: parseOptionalStringFlag(flags['worktree-path'] ?? flags.worktreePath)
    };
}

async function resolveLatestSessionForCommand(
    contextId: string,
    flags: Record<string, string | boolean>
): Promise<Record<string, unknown> | null> {
    const scope = resolveCommandWorkstreamScope(flags);
    const result = scope.branch
        ? await sendToDaemon('listBranchSessions', {
            contextId,
            branch: scope.branch,
            worktreePath: scope.worktreePath,
            limit: 1
        })
        : await sendToDaemon('listChatSessions', { contextId, limit: 1 });
    const sessions = Array.isArray(result) ? result : [];
    return (sessions[0] as Record<string, unknown> | undefined) ?? null;
}

async function resolveLatestCheckpointForCommand(
    contextId: string,
    flags: Record<string, string | boolean>
): Promise<Record<string, unknown> | null> {
    const scope = resolveCommandWorkstreamScope(flags);
    const result = scope.branch
        ? await sendToDaemon('listBranchCheckpoints', {
            contextId,
            branch: scope.branch,
            worktreePath: scope.worktreePath,
            limit: 1
        })
        : await sendToDaemon('listCheckpoints', { contextId });
    const checkpoints = Array.isArray(result) ? result : [];
    return (checkpoints[0] as Record<string, unknown> | undefined) ?? null;
}

function printInferredSelection(asJson: boolean, label: string, value: string): void {
    if (asJson) return;
    console.log(`${label}: ${value}`);
}

function printJsonOrValue(asJson: boolean, value: unknown, human: () => void): number {
    if (asJson) {
        console.log(JSON.stringify(value, null, 2));
        return 0;
    }
    human();
    return 0;
}

function short(value: string, max = 120): string {
    return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

async function commandBranches(args: string[], flags: Record<string, string | boolean>): Promise<number> {
    const subcommand = String(args[0] || '').trim().toLowerCase();
    const commandLabel = subcommand === 'compare'
        ? '0ctx workstreams compare'
        : (subcommand === 'current' ? '0ctx workstreams current' : '0ctx workstreams');
    const contextId = await requireCommandContextId(flags, commandLabel);
    if (!contextId) return 1;
    const asJson = Boolean(flags.json);
    try {
        if (subcommand === 'current') {
            const scope = resolveCommandWorkstreamScope(flags);
            const sessionLimit = parsePositiveIntegerFlag(flags['session-limit'] ?? flags.sessionLimit, 3);
            const checkpointLimit = parsePositiveIntegerFlag(flags['checkpoint-limit'] ?? flags.checkpointLimit, 2);
            const result = await sendToDaemon('getWorkstreamBrief', {
                contextId,
                branch: scope.branch,
                worktreePath: scope.worktreePath,
                sessionLimit,
                checkpointLimit
            }) as {
                workspaceName: string;
                branch: string | null;
                worktreePath?: string | null;
                currentHeadSha?: string | null;
                currentHeadRef?: string | null;
                isDetachedHead?: boolean | null;
                headDiffersFromCaptured?: boolean | null;
                sessionCount: number;
                checkpointCount: number;
                lastAgent?: string | null;
                lastCommitSha?: string | null;
                lastActivityAt?: number | null;
                upstream?: string | null;
                aheadCount?: number | null;
                behindCount?: number | null;
                mergeBaseSha?: string | null;
                isCurrent?: boolean | null;
                hasUncommittedChanges?: boolean | null;
                stagedChangeCount?: number | null;
                unstagedChangeCount?: number | null;
                untrackedCount?: number | null;
                baseline?: { summary?: string | null } | null;
                recentSessions?: Array<{ summary?: string | null; agent?: string | null }>;
                latestCheckpoints?: Array<{ name?: string | null; summary?: string | null }>;
                insights?: Array<{ type?: string | null; content?: string | null }>;
            };
            return printJsonOrValue(asJson, result, () => {
                const workstreamName = result.branch
                    || (result.isDetachedHead && result.currentHeadSha ? `detached HEAD @ ${String(result.currentHeadSha).slice(0, 12)}` : 'unknown workstream');
                const workstreamLabel = `${workstreamName}${result.worktreePath ? ` (${result.worktreePath})` : ''}`;
                console.log('\nCurrent Workstream\n');
                console.log(`  Workspace: ${result.workspaceName}`);
                console.log(`  Workstream: ${workstreamLabel}`);
                console.log(`  Sessions: ${result.sessionCount} | Checkpoints: ${result.checkpointCount}`);
                if (result.lastActivityAt) {
                    console.log(`  Last activity: ${new Date(result.lastActivityAt).toLocaleString()}`);
                }
                if (result.lastAgent) {
                    console.log(`  Last agent: ${result.lastAgent}`);
                }
                if (result.lastCommitSha) {
                    console.log(`  Last commit: ${String(result.lastCommitSha).slice(0, 12)}`);
                }
                if (result.isDetachedHead && result.currentHeadSha) {
                    console.log(`  HEAD: detached @ ${String(result.currentHeadSha).slice(0, 12)}`);
                } else if (result.currentHeadSha) {
                    const refLabel = result.currentHeadRef ? ` | ${result.currentHeadRef}` : '';
                    console.log(`  HEAD: ${String(result.currentHeadSha).slice(0, 12)}${refLabel}`);
                }
                if (result.upstream) {
                    const ahead = typeof result.aheadCount === 'number' ? result.aheadCount : '?';
                    const behind = typeof result.behindCount === 'number' ? result.behindCount : '?';
                    console.log(`  Git: ${result.upstream} | ahead ${ahead} | behind ${behind}`);
                } else if (result.isCurrent === true) {
                    console.log('  Git: current local workstream');
                }
                if (result.mergeBaseSha) {
                    console.log(`  Merge base: ${String(result.mergeBaseSha).slice(0, 12)}`);
                }
                if (result.headDiffersFromCaptured && result.lastCommitSha && result.currentHeadSha) {
                    console.log(`  Capture drift: ${String(result.lastCommitSha).slice(0, 12)} -> ${String(result.currentHeadSha).slice(0, 12)}`);
                }
                if (result.hasUncommittedChanges) {
                    console.log(`  Local changes: staged ${result.stagedChangeCount ?? 0} | unstaged ${result.unstagedChangeCount ?? 0} | untracked ${result.untrackedCount ?? 0}`);
                }
                if (result.baseline?.summary) {
                    console.log(`  Baseline: ${result.baseline.summary}`);
                }
                if (Array.isArray(result.recentSessions) && result.recentSessions.length > 0) {
                    console.log('\n  Recent sessions:');
                    for (const session of result.recentSessions.slice(0, 3)) {
                        const agent = session.agent ? `[${session.agent}] ` : '';
                        console.log(`    - ${agent}${short(String(session.summary ?? '-'), 120)}`);
                    }
                }
                if (Array.isArray(result.latestCheckpoints) && result.latestCheckpoints.length > 0) {
                    console.log('\n  Latest checkpoints:');
                    for (const checkpoint of result.latestCheckpoints.slice(0, 3)) {
                        const label = checkpoint.name || checkpoint.summary || 'checkpoint';
                        console.log(`    - ${short(String(label), 120)}`);
                    }
                }
                if (Array.isArray(result.insights) && result.insights.length > 0) {
                    console.log('\n  Reviewed insights:');
                    for (const insight of result.insights.slice(0, 4)) {
                        console.log(`    - [${String(insight.type ?? 'insight')}] ${short(String(insight.content ?? '-'), 120)}`);
                    }
                }
                console.log('');
            });
        }

        if (subcommand === 'compare') {
            const sourceBranch = parseOptionalStringFlag(flags.source ?? flags['source-branch'] ?? flags.sourceBranch);
            const targetBranch = parseOptionalStringFlag(flags.target ?? flags['target-branch'] ?? flags.targetBranch);
            if (!sourceBranch || !targetBranch) {
                console.error('Missing workstream comparison inputs. Pass --source=<branch> and --target=<branch>.');
                return 1;
            }
            const sourceWorktreePath = parseOptionalStringFlag(flags['source-worktree-path'] ?? flags.sourceWorktreePath);
            const targetWorktreePath = parseOptionalStringFlag(flags['target-worktree-path'] ?? flags.targetWorktreePath);
            const sessionLimit = parsePositiveIntegerFlag(flags['session-limit'] ?? flags.sessionLimit, 3);
            const checkpointLimit = parsePositiveIntegerFlag(flags['checkpoint-limit'] ?? flags.checkpointLimit, 2);
            const result = await sendToDaemon('compareWorkstreams', {
                contextId,
                sourceBranch,
                sourceWorktreePath,
                targetBranch,
                targetWorktreePath,
                sessionLimit,
                checkpointLimit
            }) as {
                workspaceName: string;
                comparable: boolean;
                sameRepository: boolean;
                sourceAheadCount: number | null;
                targetAheadCount: number | null;
                mergeBaseSha: string | null;
                newerSide: 'source' | 'target' | 'same' | 'unknown';
                sharedAgents: string[];
                sourceOnlyAgents: string[];
                targetOnlyAgents: string[];
                comparisonText: string;
                source: {
                    branch: string | null;
                    worktreePath?: string | null;
                    lastCommitSha?: string | null;
                    sessionCount: number;
                    checkpointCount: number;
                    recentSessions?: Array<{ summary?: string | null; agent?: string | null }>;
                };
                target: {
                    branch: string | null;
                    worktreePath?: string | null;
                    lastCommitSha?: string | null;
                    sessionCount: number;
                    checkpointCount: number;
                    recentSessions?: Array<{ summary?: string | null; agent?: string | null }>;
                };
            };
            return printJsonOrValue(asJson, result, () => {
                const sourceLabel = `${result.source.branch || 'detached'}${result.source.worktreePath ? ` (${result.source.worktreePath})` : ''}`;
                const targetLabel = `${result.target.branch || 'detached'}${result.target.worktreePath ? ` (${result.target.worktreePath})` : ''}`;
                console.log('\nWorkstream comparison\n');
                console.log(`  Workspace: ${result.workspaceName}`);
                console.log(`  Source:    ${sourceLabel}`);
                console.log(`  Target:    ${targetLabel}`);
                console.log(`  Sessions:  ${result.source.sessionCount} vs ${result.target.sessionCount}`);
                console.log(`  Checkpts:  ${result.source.checkpointCount} vs ${result.target.checkpointCount}`);
                if (result.source.lastCommitSha || result.target.lastCommitSha) {
                    console.log(`  Commits:   ${String(result.source.lastCommitSha || 'none').slice(0, 12)} vs ${String(result.target.lastCommitSha || 'none').slice(0, 12)}`);
                }
                if (result.comparable && result.sameRepository) {
                    console.log(`  Git:       source ahead ${result.sourceAheadCount ?? '?'} | target ahead ${result.targetAheadCount ?? '?'} | newer ${result.newerSide}`);
                    console.log(`  Merge base:${result.mergeBaseSha ? ` ${String(result.mergeBaseSha).slice(0, 12)}` : ' none'}`);
                } else {
                    console.log(`  Git:       ${result.sameRepository ? 'not comparable' : 'different repositories'}`);
                }
                if (result.sharedAgents.length > 0) {
                    console.log(`  Shared agents: ${result.sharedAgents.join(', ')}`);
                }
                if (result.sourceOnlyAgents.length > 0) {
                    console.log(`  Source only:   ${result.sourceOnlyAgents.join(', ')}`);
                }
                if (result.targetOnlyAgents.length > 0) {
                    console.log(`  Target only:   ${result.targetOnlyAgents.join(', ')}`);
                }
                console.log(`\n  ${result.comparisonText}\n`);
            });
        }

        const limit = parsePositiveIntegerFlag(flags.limit, 100);
        const result = await sendToDaemon('listBranchLanes', { contextId, limit }) as Array<{
            branch: string;
            worktreePath?: string | null;
            repositoryRoot?: string | null;
            lastAgent?: string | null;
            lastCommitSha?: string | null;
            lastActivityAt: number;
            sessionCount: number;
            checkpointCount: number;
            agentSet?: string[];
            upstream?: string | null;
            aheadCount?: number | null;
            behindCount?: number | null;
            isCurrent?: boolean | null;
            currentHeadSha?: string | null;
            currentHeadRef?: string | null;
            isDetachedHead?: boolean | null;
            headDiffersFromCaptured?: boolean | null;
            baseline?: { summary?: string | null } | null;
        }>;
        return printJsonOrValue(asJson, result, () => {
            console.log('\nWorkstreams\n');
            if (!result.length) {
                console.log('  No workstreams found.\n');
                return;
            }
            for (const lane of result) {
                console.log(`  ${lane.branch}${lane.worktreePath ? ` (${lane.worktreePath})` : ''}`);
                console.log(`    Last activity: ${new Date(lane.lastActivityAt).toLocaleString()}`);
                console.log(`    Sessions: ${lane.sessionCount} | Checkpoints: ${lane.checkpointCount}`);
                if (lane.lastAgent) console.log(`    Last agent: ${lane.lastAgent}`);
                if (lane.lastCommitSha) console.log(`    Last commit: ${String(lane.lastCommitSha).slice(0, 12)}`);
                if (lane.isDetachedHead && lane.currentHeadSha) {
                    console.log(`    HEAD: detached @ ${String(lane.currentHeadSha).slice(0, 12)}`);
                } else if (lane.currentHeadSha || lane.currentHeadRef) {
                    const headParts = [
                        lane.currentHeadSha ? String(lane.currentHeadSha).slice(0, 12) : null,
                        lane.currentHeadRef ?? null
                    ].filter(Boolean);
                    if (headParts.length > 0) {
                        console.log(`    HEAD: ${headParts.join(' | ')}`);
                    }
                }
                if (lane.headDiffersFromCaptured && lane.lastCommitSha && lane.currentHeadSha) {
                    console.log(`    Capture drift: ${String(lane.lastCommitSha).slice(0, 12)} -> ${String(lane.currentHeadSha).slice(0, 12)}`);
                }
                if (lane.baseline?.summary) {
                    console.log(`    Baseline: ${lane.baseline.summary}`);
                }
                if (lane.upstream) {
                    const ahead = typeof lane.aheadCount === 'number' ? lane.aheadCount : '?';
                    const behind = typeof lane.behindCount === 'number' ? lane.behindCount : '?';
                    console.log(`    Git: ${lane.upstream} | ahead ${ahead} | behind ${behind}`);
                } else if (lane.isCurrent === true) {
                    console.log('    Git: current local workstream');
                }
                if (Array.isArray(lane.agentSet) && lane.agentSet.length > 0) {
                    console.log(`    Agents: ${lane.agentSet.join(', ')}`);
                }
                console.log('');
            }
        });
    } catch (error) {
        console.error('Failed to list workstreams:', error instanceof Error ? error.message : String(error));
        return 1;
    }
}

async function commandSessions(flags: Record<string, string | boolean>): Promise<number> {
    const contextId = await requireCommandContextId(flags, '0ctx sessions');
    if (!contextId) return 1;
    const asJson = Boolean(flags.json);
    const sessionId = parseOptionalStringFlag(flags['session-id'] ?? flags.sessionId);
    const branch = parseOptionalStringFlag(flags.branch);
    const worktreePath = parseOptionalStringFlag(flags['worktree-path'] ?? flags.worktreePath);
    const limit = parsePositiveIntegerFlag(flags.limit, 100);
    try {
        if (sessionId) {
            const detail = await sendToDaemon('getSessionDetail', { contextId, sessionId }) as {
                session: { summary?: string; agent?: string | null; branch?: string | null; turnCount?: number; commitSha?: string | null } | null;
                messages: Array<{ role?: string | null; content?: string; createdAt?: number }>;
                checkpointCount: number;
            };
            return printJsonOrValue(asJson, detail, () => {
                console.log('\nSession Detail\n');
                console.log(`  Session: ${sessionId}`);
                console.log(`  Summary: ${detail.session?.summary ?? '-'}`);
                console.log(`  Agent: ${detail.session?.agent ?? '-'}`);
                console.log(`  Workstream: ${detail.session?.branch ?? '-'}`);
                console.log(`  Commit: ${detail.session?.commitSha ?? '-'}`);
                console.log(`  Messages: ${detail.messages.length}`);
                console.log(`  Checkpoints: ${detail.checkpointCount}`);
                console.log('');
                for (const message of detail.messages.slice(0, 20)) {
                    console.log(`  [${message.role ?? 'unknown'}] ${short(String(message.content ?? ''), 180)}`);
                }
                console.log('');
            });
        }

        const result = branch
            ? await sendToDaemon('listBranchSessions', { contextId, branch, worktreePath, limit })
            : await sendToDaemon('listChatSessions', { contextId, limit });

        const sessions = Array.isArray(result) ? result : [];
        return printJsonOrValue(asJson, sessions, () => {
            console.log('\nSessions\n');
            if (!sessions.length) {
                console.log('  No sessions found.\n');
                return;
            }
            for (const session of sessions as Array<Record<string, unknown>>) {
                console.log(`  ${String(session.sessionId ?? '-')}`);
                console.log(`    ${String(session.summary ?? '-')}`);
                console.log(`    Workstream: ${String(session.branch ?? '-')}`);
                console.log(`    Agent: ${String(session.agent ?? '-')}`);
                console.log(`    Turns: ${String(session.turnCount ?? 0)}`);
                console.log(`    Last: ${session.lastTurnAt ? new Date(Number(session.lastTurnAt)).toLocaleString() : '-'}`);
                console.log('');
            }
        });
    } catch (error) {
        console.error('Failed to inspect sessions:', error instanceof Error ? error.message : String(error));
        return 1;
    }
}

async function commandAgentContext(flags: Record<string, string | boolean>): Promise<number> {
    const contextId = await requireCommandContextId(flags, '0ctx agent-context');
    if (!contextId) return 1;
    const asJson = Boolean(flags.json);
    const scope = resolveCommandWorkstreamScope(flags);
    const sessionLimit = parsePositiveIntegerFlag(flags['session-limit'] ?? flags.sessionLimit, 3);
    const checkpointLimit = parsePositiveIntegerFlag(flags['checkpoint-limit'] ?? flags.checkpointLimit, 2);
    const handoffLimit = parsePositiveIntegerFlag(flags['handoff-limit'] ?? flags.handoffLimit, 5);
    try {
        const result = await sendToDaemon('getAgentContextPack', {
            contextId,
            branch: scope.branch,
            worktreePath: scope.worktreePath,
            sessionLimit,
            checkpointLimit,
            handoffLimit
        }) as {
            promptText?: string | null;
        };
        return printJsonOrValue(asJson, result, () => {
            if (typeof result.promptText === 'string' && result.promptText.trim().length > 0) {
                process.stdout.write(result.promptText.endsWith('\n') ? result.promptText : `${result.promptText}\n`);
                return;
            }
            console.log('\nAgent context is not available for the current workstream yet.\n');
        });
    } catch (error) {
        console.error('Failed to get agent context:', error instanceof Error ? error.message : String(error));
        return 1;
    }
}

async function commandCheckpoints(
    subcommand: string | undefined,
    flags: Record<string, string | boolean>
): Promise<number> {
    const contextId = await requireCommandContextId(flags, '0ctx checkpoints');
    if (!contextId) return 1;
    const asJson = Boolean(flags.json);
    const action = (subcommand ?? 'list').toLowerCase();
    const checkpointId = parseOptionalStringFlag(flags['checkpoint-id'] ?? flags.checkpointId);
    const branch = parseOptionalStringFlag(flags.branch);
    const worktreePath = parseOptionalStringFlag(flags['worktree-path'] ?? flags.worktreePath);
    const sessionId = parseOptionalStringFlag(flags['session-id'] ?? flags.sessionId);
    const name = parseOptionalStringFlag(flags.name);
    const summary = parseOptionalStringFlag(flags.summary);
    const limit = parsePositiveIntegerFlag(flags.limit, 100);

    try {
        if (action === 'create') {
            let effectiveSessionId = sessionId;
            if (!effectiveSessionId) {
                const inferredSession = await resolveLatestSessionForCommand(contextId, flags);
                effectiveSessionId = typeof inferredSession?.sessionId === 'string'
                    ? inferredSession.sessionId
                    : null;
                if (!effectiveSessionId) {
                    console.error('No captured session found for the current workstream. Capture one session first or pass --session-id=<id>.');
                    return 1;
                }
                printInferredSelection(asJson, 'Using latest session', effectiveSessionId);
            }
            const result = await sendToDaemon('createSessionCheckpoint', { contextId, sessionId: effectiveSessionId, name, summary });
            return printJsonOrValue(asJson, result, () => {
                const checkpoint = result as { id?: string; branch?: string | null; commitSha?: string | null; summary?: string | null };
                console.log('\nCheckpoint Created\n');
                console.log(`  Id: ${checkpoint.id ?? '-'}`);
                console.log(`  Workstream: ${checkpoint.branch ?? '-'}`);
                console.log(`  Commit: ${checkpoint.commitSha ?? '-'}`);
                console.log(`  Summary: ${checkpoint.summary ?? '-'}`);
                console.log('');
            });
        }

        if (action === 'show' || action === 'detail') {
            let effectiveCheckpointId = checkpointId;
            if (!effectiveCheckpointId) {
                const inferredCheckpoint = await resolveLatestCheckpointForCommand(contextId, flags);
                effectiveCheckpointId = typeof inferredCheckpoint?.checkpointId === 'string'
                    ? inferredCheckpoint.checkpointId
                    : typeof inferredCheckpoint?.id === 'string'
                        ? inferredCheckpoint.id
                        : null;
                if (!effectiveCheckpointId) {
                    console.error('No checkpoint found for the current workstream. Create one first or pass --checkpoint-id=<id>.');
                    return 1;
                }
                printInferredSelection(asJson, 'Using latest checkpoint', effectiveCheckpointId);
            }
            const result = await sendToDaemon('getCheckpointDetail', { contextId, checkpointId: effectiveCheckpointId });
            return printJsonOrValue(asJson, result, () => {
                const detail = result as { checkpoint?: Record<string, unknown>; snapshotNodeCount?: number; payloadAvailable?: boolean };
                console.log('\nCheckpoint Detail\n');
                console.log(`  Id: ${effectiveCheckpointId}`);
                console.log(`  Name: ${String(detail.checkpoint?.name ?? '-')}`);
                console.log(`  Kind: ${String(detail.checkpoint?.kind ?? '-')}`);
                console.log(`  Workstream: ${String(detail.checkpoint?.branch ?? '-')}`);
                console.log(`  Session: ${String(detail.checkpoint?.sessionId ?? '-')}`);
                console.log(`  Snapshot nodes: ${String(detail.snapshotNodeCount ?? 0)}`);
                console.log(`  Payload: ${detail.payloadAvailable ? 'available' : 'missing'}`);
                console.log('');
            });
        }

        const result = branch
            ? await sendToDaemon('listBranchCheckpoints', { contextId, branch, worktreePath, limit })
            : await sendToDaemon('listCheckpoints', { contextId });
        const checkpoints = Array.isArray(result) ? result : [];
        return printJsonOrValue(asJson, checkpoints, () => {
            console.log('\nCheckpoints\n');
            if (!checkpoints.length) {
                console.log('  No checkpoints found.\n');
                return;
            }
            for (const checkpoint of checkpoints as Array<Record<string, unknown>>) {
                console.log(`  ${String(checkpoint.id ?? checkpoint.checkpointId ?? '-')}`);
                console.log(`    ${String(checkpoint.summary ?? checkpoint.name ?? '-')}`);
                console.log(`    Workstream: ${String(checkpoint.branch ?? '-')}`);
                console.log(`    Session: ${String(checkpoint.sessionId ?? '-')}`);
                console.log(`    Kind: ${String(checkpoint.kind ?? '-')}`);
                console.log(`    Created: ${checkpoint.createdAt ? new Date(Number(checkpoint.createdAt)).toLocaleString() : '-'}`);
                console.log('');
            }
        });
    } catch (error) {
        console.error('Failed to inspect checkpoints:', error instanceof Error ? error.message : String(error));
        return 1;
    }
}

async function commandResume(flags: Record<string, string | boolean>): Promise<number> {
    const contextId = await requireCommandContextId(flags, '0ctx resume');
    if (!contextId) return 1;
    let sessionId = parseOptionalStringFlag(flags['session-id'] ?? flags.sessionId);
    const asJson = Boolean(flags.json);
    if (!sessionId) {
        const inferredSession = await resolveLatestSessionForCommand(contextId, flags);
        sessionId = typeof inferredSession?.sessionId === 'string'
            ? inferredSession.sessionId
            : null;
        if (!sessionId) {
            console.error('No captured session found for the current workstream. Capture one session first or pass --session-id=<id>.');
            return 1;
        }
        printInferredSelection(asJson, 'Using latest session', sessionId);
    }
    try {
        const result = await sendToDaemon('resumeSession', { contextId, sessionId });
        return printJsonOrValue(asJson, result, () => {
            const detail = result as { session?: Record<string, unknown>; checkpointCount?: number };
            console.log('\nResume Session\n');
            console.log(`  Session: ${sessionId}`);
            console.log(`  Summary: ${String(detail.session?.summary ?? '-')}`);
            console.log(`  Workstream: ${String(detail.session?.branch ?? '-')}`);
            console.log(`  Agent: ${String(detail.session?.agent ?? '-')}`);
            console.log(`  Checkpoints: ${String(detail.checkpointCount ?? 0)}`);
            console.log('');
        });
    } catch (error) {
        console.error('Failed to resume session:', error instanceof Error ? error.message : String(error));
        return 1;
    }
}

async function commandRewind(flags: Record<string, string | boolean>): Promise<number> {
    const contextId = await requireCommandContextId(flags, '0ctx rewind');
    if (!contextId) return 1;
    let checkpointId = parseOptionalStringFlag(flags['checkpoint-id'] ?? flags.checkpointId);
    const asJson = Boolean(flags.json);
    if (!checkpointId) {
        const inferredCheckpoint = await resolveLatestCheckpointForCommand(contextId, flags);
        checkpointId = typeof inferredCheckpoint?.checkpointId === 'string'
            ? inferredCheckpoint.checkpointId
            : typeof inferredCheckpoint?.id === 'string'
                ? inferredCheckpoint.id
                : null;
        if (!checkpointId) {
            console.error('No checkpoint found for the current workstream. Create one first or pass --checkpoint-id=<id>.');
            return 1;
        }
        printInferredSelection(asJson, 'Using latest checkpoint', checkpointId);
    }
    try {
        const result = await sendToDaemon('rewindCheckpoint', { contextId, checkpointId });
        return printJsonOrValue(asJson, result, () => {
            const detail = result as { checkpoint?: Record<string, unknown> };
            console.log('\nRewind Complete\n');
            console.log(`  Checkpoint: ${checkpointId}`);
            console.log(`  Name: ${String(detail.checkpoint?.name ?? '-')}`);
            console.log(`  Workstream: ${String(detail.checkpoint?.branch ?? '-')}`);
            console.log('');
        });
    } catch (error) {
        console.error('Failed to rewind checkpoint:', error instanceof Error ? error.message : String(error));
        return 1;
    }
}

async function commandExplain(flags: Record<string, string | boolean>): Promise<number> {
    const contextId = await requireCommandContextId(flags, '0ctx explain');
    if (!contextId) return 1;
    let checkpointId = parseOptionalStringFlag(flags['checkpoint-id'] ?? flags.checkpointId);
    const asJson = Boolean(flags.json);
    if (!checkpointId) {
        const inferredCheckpoint = await resolveLatestCheckpointForCommand(contextId, flags);
        checkpointId = typeof inferredCheckpoint?.checkpointId === 'string'
            ? inferredCheckpoint.checkpointId
            : typeof inferredCheckpoint?.id === 'string'
                ? inferredCheckpoint.id
                : null;
        if (!checkpointId) {
            console.error('No checkpoint found for the current workstream. Create one first or pass --checkpoint-id=<id>.');
            return 1;
        }
        printInferredSelection(asJson, 'Using latest checkpoint', checkpointId);
    }
    try {
        const result = await sendToDaemon('explainCheckpoint', { contextId, checkpointId });
        return printJsonOrValue(asJson, result, () => {
            const detail = result as { checkpoint?: Record<string, unknown>; snapshotNodeCount?: number; snapshotEdgeCount?: number; snapshotCheckpointCount?: number };
            console.log('\nCheckpoint Explanation\n');
            console.log(`  Checkpoint: ${checkpointId}`);
            console.log(`  Summary: ${String(detail.checkpoint?.summary ?? detail.checkpoint?.name ?? '-')}`);
            console.log(`  Workstream: ${String(detail.checkpoint?.branch ?? '-')}`);
            console.log(`  Session: ${String(detail.checkpoint?.sessionId ?? '-')}`);
            console.log(`  Snapshot nodes: ${String(detail.snapshotNodeCount ?? 0)}`);
            console.log(`  Snapshot edges: ${String(detail.snapshotEdgeCount ?? 0)}`);
            console.log(`  Snapshot checkpoints: ${String(detail.snapshotCheckpointCount ?? 0)}`);
            console.log('');
        });
    } catch (error) {
        console.error('Failed to explain checkpoint:', error instanceof Error ? error.message : String(error));
        return 1;
    }
}

async function commandExtract(positionalArgs: string[], flags: Record<string, string | boolean>): Promise<number> {
    const asJson = Boolean(flags.json);
    const preview = Boolean(flags.preview);
    const action = String(positionalArgs[0] || '').trim().toLowerCase();
    const maxNodes = parsePositiveIntegerFlag(flags['max-nodes'] ?? flags.maxNodes, 12);
    const candidateKeys = parseOptionalStringFlag(flags.keys ?? flags['candidate-keys'])
        ?.split(',')
        .map((value) => value.trim())
        .filter(Boolean);

    try {
        if (action === 'session') {
            const contextId = await requireCommandContextId(flags, '0ctx extract session');
            if (!contextId) return 1;
            let sessionId = parseOptionalStringFlag(flags['session-id'] ?? flags.sessionId);
            if (!sessionId) {
                const inferredSession = await resolveLatestSessionForCommand(contextId, flags);
                sessionId = typeof inferredSession?.sessionId === 'string'
                    ? inferredSession.sessionId
                    : null;
                if (!sessionId) {
                    console.error('No captured session found for the current workstream. Capture one session first or pass --session-id=<id>.');
                    return 1;
                }
                printInferredSelection(asJson, 'Using latest session', sessionId);
            }
            const method = preview ? 'previewSessionKnowledge' : 'extractSessionKnowledge';
            const result = await sendToDaemon(method, { contextId, sessionId, maxNodes, candidateKeys });
            return printJsonOrValue(asJson, result, () => {
                const extraction = result as {
                    createdCount?: number;
                    reusedCount?: number;
                    nodeCount?: number;
                    createCount?: number;
                    reuseCount?: number;
                    candidateCount?: number;
                    nodes?: Array<{ type?: string; content?: string }>;
                    candidates?: Array<{ type?: string; content?: string; action?: string }>;
                };
            console.log(preview ? '\nSession Insights Preview\n' : '\nSession Insights Save\n');
                console.log(`  Session: ${sessionId}`);
                console.log(`  Created: ${String(extraction.createdCount ?? extraction.createCount ?? 0)}`);
                console.log(`  Reused: ${String(extraction.reusedCount ?? extraction.reuseCount ?? 0)}`);
                console.log(`  ${preview ? 'Candidates' : 'Nodes'}:   ${String(extraction.nodeCount ?? extraction.candidateCount ?? 0)}`);
                const items: Array<{ type?: string; content?: string; action?: string }> = preview
                    ? (extraction.candidates ?? [])
                    : (extraction.nodes ?? []);
                for (const node of items.slice(0, 8)) {
                    const actionLabel = preview && node.action ? ` ${String(node.action).toUpperCase()}` : '';
                    console.log(`    - [${String(node.type ?? 'node')}${actionLabel}] ${String(node.content ?? '-')}`);
                }
                console.log('');
            });
        }

        if (action === 'checkpoint') {
            let checkpointId = parseOptionalStringFlag(flags['checkpoint-id'] ?? flags.checkpointId);
            if (!checkpointId) {
                const contextId = await requireCommandContextId(flags, '0ctx extract checkpoint');
                if (!contextId) return 1;
                const inferredCheckpoint = await resolveLatestCheckpointForCommand(contextId, flags);
                checkpointId = typeof inferredCheckpoint?.checkpointId === 'string'
                    ? inferredCheckpoint.checkpointId
                    : typeof inferredCheckpoint?.id === 'string'
                        ? inferredCheckpoint.id
                        : null;
                if (!checkpointId) {
                    console.error('No checkpoint found for the current workstream. Create one first or pass --checkpoint-id=<id>.');
                    return 1;
                }
                printInferredSelection(asJson, 'Using latest checkpoint', checkpointId);
            }
            const method = preview ? 'previewCheckpointKnowledge' : 'extractCheckpointKnowledge';
            const result = await sendToDaemon(method, { checkpointId, maxNodes, candidateKeys });
            return printJsonOrValue(asJson, result, () => {
                const extraction = result as {
                    createdCount?: number;
                    reusedCount?: number;
                    nodeCount?: number;
                    createCount?: number;
                    reuseCount?: number;
                    candidateCount?: number;
                    nodes?: Array<{ type?: string; content?: string }>;
                    candidates?: Array<{ type?: string; content?: string; action?: string }>;
                };
            console.log(preview ? '\nCheckpoint Insights Preview\n' : '\nCheckpoint Insights Save\n');
                console.log(`  Checkpoint: ${checkpointId}`);
                console.log(`  Created:    ${String(extraction.createdCount ?? extraction.createCount ?? 0)}`);
                console.log(`  Reused:     ${String(extraction.reusedCount ?? extraction.reuseCount ?? 0)}`);
                console.log(`  ${preview ? 'Candidates' : 'Nodes'}:      ${String(extraction.nodeCount ?? extraction.candidateCount ?? 0)}`);
                const items: Array<{ type?: string; content?: string; action?: string }> = preview
                    ? (extraction.candidates ?? [])
                    : (extraction.nodes ?? []);
                for (const node of items.slice(0, 8)) {
                    const actionLabel = preview && node.action ? ` ${String(node.action).toUpperCase()}` : '';
                    console.log(`    - [${String(node.type ?? 'node')}${actionLabel}] ${String(node.content ?? '-')}`);
                }
                console.log('');
            });
        }

        console.error('Usage: 0ctx extract session [--repo-root=<path>] [--session-id=<id>] [--preview] [--keys=key1,key2] [--max-nodes=12] [--json]');
        console.error('   or: 0ctx extract checkpoint [--repo-root=<path>] [--checkpoint-id=<id>] [--preview] [--keys=key1,key2] [--max-nodes=12] [--json]');
        return 1;
    } catch (error) {
        console.error('Failed to save insights:', error instanceof Error ? error.message : String(error));
        return 1;
    }
}

async function commandSyncPolicyGet(flags: Record<string, string | boolean>): Promise<number> {
    const contextId = await requireCommandContextId(flags, '0ctx sync policy get');
    if (!contextId) {
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
    const contextId = await requireCommandContextId(flags, '0ctx sync policy set');
    if (!contextId) {
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
    if (parsed.command === 'hook') {
        const action = parsed.positionalArgs[0] || 'status';
        return `cli.connector.hook.${action}`;
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
    if (parsed.command === 'checkpoints') {
        return parsed.subcommand ? `cli.checkpoints.${parsed.subcommand}` : 'cli.checkpoints.list';
    }
    if (parsed.command === 'workstreams') {
        return 'cli.workstreams';
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
                printHelp(false);
                return 0;
            }, { command: 'help', interactive: true });
        }
        if (process.stdin.isTTY && process.stdout.isTTY) {
            // Auto-run repo enablement when possible, otherwise fall back to setup.
            // Checks: (1) no auth token, (2) expired token (try silent refresh first),
            // (3) no connector state on disk.
            const tokenStore = resolveToken();
            const connectorState = readConnectorState();
            const detectedRepoRoot = findGitRepoRoot(null);

            if (!tokenStore) {
                console.log(color.bold('\nWelcome to 0ctx!'));
                if (detectedRepoRoot) {
                    console.log(color.dim(`Detected git repo. Enabling 0ctx for ${detectedRepoRoot}.\n`));
                    return runCommandWithOpsSummary(
                        'cli.enable',
                        () => commandEnable({ 'repo-root': detectedRepoRoot }),
                        { command: 'enable', interactive: true, reason: 'first_run_repo' }
                    );
                }
                console.log(color.dim("0ctx works repo-first. Move into a project repo and run `0ctx enable`.\n"));
                console.log(color.dim('Optional machine step: run `0ctx auth login` first if you need account-backed features before enabling a repo.\n'));
                return 0;
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
                    if (!detectedRepoRoot) {
                        console.log(color.bold('\nYour session has expired.'));
                        console.log(color.dim('Move into a repo and run `0ctx enable`, or run `0ctx auth login` if you need account-backed features first.\n'));
                        return 0;
                    }
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
                if (detectedRepoRoot) {
                    console.log(color.bold('\nAlmost there!'));
                    console.log(color.dim(`This repo is not enabled yet. Enabling 0ctx for ${detectedRepoRoot}...\n`));
                    captureEvent('cli_command_executed', { command: 'enable', interactive: true, reason: 'machine_unregistered_repo' });
                    return runCommandWithOpsSummary(
                        'cli.enable',
                        () => commandEnable({ 'repo-root': detectedRepoRoot }),
                        { command: 'enable', interactive: true, reason: 'machine_unregistered_repo' }
                    );
                }
                console.log(color.bold('\nAlmost there!'));
                console.log(color.dim("This machine is signed in, but you are not inside an enabled repo.\n"));
                console.log(color.dim('Next step: `cd <repo> && 0ctx enable`\n'));
                return 0;
            }

            // Returning users can still land in a broken state (e.g. daemon
            // not running, missing service registration after updates). Keep
            // `0ctx` as a one-command entrypoint by attempting automatic
            // setup/repair before showing the repo-first summary.
            const daemonPreflight = await isDaemonReachable();
            if (!daemonPreflight.ok) {
                console.log(color.bold('\nRuntime needs repair.'));
                if (detectedRepoRoot) {
                    console.log(color.dim(`Daemon is unreachable. Re-enabling 0ctx for ${detectedRepoRoot}...\n`));
                    captureEvent('cli_command_executed', { command: 'enable', interactive: true, reason: 'daemon_unreachable_repo' });
                    const enableCode = await runCommandWithOpsSummary(
                        'cli.enable.auto_repair',
                        () => commandEnable({ 'repo-root': detectedRepoRoot }),
                        { command: 'enable', interactive: true, reason: 'daemon_unreachable_repo' }
                    );
                    if (enableCode !== 0) return enableCode;
                } else {
                    console.log(color.dim('Daemon is unreachable and this directory is not a bound repo.\n'));
                    console.log(color.dim('Use `0ctx repair` if you are fixing this machine, or `cd <repo> && 0ctx enable` from a project.\n'));
                    return 1;
                }
            }

            if (!detectedRepoRoot) {
                console.log(color.bold('\n0ctx is ready on this machine.'));
                console.log(color.dim('Move into a repo and run `0ctx enable` for the normal product flow.\n'));
                console.log(color.dim('Use `0ctx shell` only if you need the advanced interactive shell outside a repo.\n'));
                return 0;
            }

            captureEvent('cli_command_executed', {
                command: 'workstreams',
                subcommand: 'current',
                interactive: true,
                reason: 'repo_entrypoint'
            });
            return runCommandWithOpsSummary(
                'cli.workstreams.current',
                () => commandBranches(['current'], { 'repo-root': detectedRepoRoot, limit: '1' }),
                {
                    command: 'workstreams',
                    subcommand: 'current',
                    interactive: true,
                    reason: 'repo_entrypoint',
                    limit: '1'
                }
            );
        }
        captureEvent('cli_command_executed', { command: 'help' });
        return runCommandWithOpsSummary('cli.help', () => {
            printHelp(false);
            return 0;
        }, { command: 'help', interactive: false });
    }

    const parsed = parseArgs(argv);
    captureEvent('cli_command_executed', { command: parsed.command, subcommand: parsed.subcommand });
    const operation = resolveCommandOperation(parsed);
    return runCommandWithOpsSummary(operation, async () => {
        switch (parsed.command) {
            case 'enable':
                return commandEnable(parsed.flags);
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
            case 'reset':
                return commandReset(parsed.flags);
            case 'version':
                return commandVersion(parsed.flags);
            case 'workstreams':
            case 'branches':
                return commandBranches(parsed.positionalArgs, parsed.flags);
            case 'agent-context':
                return commandAgentContext(parsed.flags);
            case 'sessions':
                return commandSessions(parsed.flags);
            case 'checkpoints':
                return commandCheckpoints(parsed.subcommand, parsed.flags);
            case 'extract':
                return commandExtract(parsed.positionalArgs, parsed.flags);
            case 'resume':
                return commandResume(parsed.flags);
            case 'rewind':
                return commandRewind(parsed.flags);
            case 'explain':
                return commandExplain(parsed.flags);
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
                printHelp(Boolean(parsed.flags.advanced));
                return 1;
            case 'config': {
                const sub = parsed.subcommand;
                if (sub === 'list' || !sub) return commandConfigList();
                if (sub === 'get') return commandConfigGet(parsed.positionalArgs[0]);
                if (sub === 'set') return commandConfigSet(parsed.positionalArgs[0], parsed.positionalArgs[1]);
                printHelp(Boolean(parsed.flags.advanced));
                return 1;
            }
            case 'sync': {
                const sub = parsed.subcommand;
                if (sub === 'status' || !sub) return commandSyncStatus();
                if (sub === 'policy') {
                    const action = parsed.positionalArgs[0];
                    if (action === 'get') return commandSyncPolicyGet(parsed.flags);
                    if (action === 'set') return commandSyncPolicySet(parsed.positionalArgs[1], parsed.flags);
                    console.error('Usage: 0ctx sync policy get [--repo-root=<path>] [--json]');
                    console.error('   or: 0ctx sync policy set <local_only|metadata_only|full_sync> [--repo-root=<path>] [--json]');
                    return 1;
                }
                printHelp(Boolean(parsed.flags.advanced));
                return 1;
            }
            case 'connector':
                if (parsed.subcommand === 'service') {
                    return commandDaemonService(parsed.serviceAction);
                }
                if (parsed.subcommand === 'queue') {
                    return commandConnectorQueue(parsed.positionalArgs[0], parsed.flags);
                }
                if (parsed.subcommand === 'hook') {
                    return commandConnectorHook(parsed.positionalArgs[0], parsed.flags);
                }
                return commandConnector(parsed.subcommand, parsed.flags);
            case 'hook':
                return commandConnectorHook(parsed.positionalArgs[0], parsed.flags);
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
                printHelp(Boolean(parsed.flags.advanced));
                return 1;
            case 'ui':
                console.error('`0ctx ui` has been removed from the end-user flow.');
                console.error('Use `0ctx enable` inside a repo for the normal product flow. Use `0ctx dashboard` only for hosted support surfaces.');
                return 1;
            case 'help':
                printHelp(Boolean(parsed.flags.advanced));
                return 0;
            default:
                printHelp(Boolean(parsed.flags.advanced));
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
