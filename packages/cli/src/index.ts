#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';
import color from 'picocolors';
import { sendToDaemon } from '@0ctx/mcp/dist/client';
import { listConfig, getConfigValue, setConfigValue, isValidConfigKey, getConfigPath } from '@0ctx/core';
import type { AppConfig } from '@0ctx/core';
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
    selectHookContextId
} from './hooks';
import {
    applyDashboardQuery,
    parseArgs,
    parseOptionalBooleanLikeFlag,
    parseOptionalPositiveNumberFlag,
    parseOptionalStringFlag,
    parsePositiveIntegerFlag,
    parsePositiveNumberFlag,
    sleepMs
} from './cli-core/args';
import {
    checkDaemonCapabilities,
    ensureDaemonCapabilities,
    inferDaemonRecoverySteps,
    isDaemonReachable,
    printCapabilityMismatch,
    startDaemonDetached,
    waitForDaemon
} from './cli-core/daemon';
import {
    formatAgentList,
    formatDataPolicyNarrative,
    formatDebugArtifactsLabel,
    formatLabelValue,
    formatRetentionLabel,
    formatSyncPolicyLabel
} from './cli-core/format';
import {
    buildDefaultDashboardQuery,
    getHostedDashboardUrl,
    openUrl,
    printBootstrapResults,
    resolveCliEntrypoint,
    runBootstrap
} from './cli-core/platform';
import { createCommandContextResolver, getContextIdFlag, resolveCommandRepoRoot } from './cli-core/command-context';
import { createOpsSummaryRunner } from './cli-core/ops';
import {
    ALL_SUPPORTED_CLIENTS,
    DEFAULT_HOOK_INSTALL_CLIENTS,
    DEFAULT_MCP_CLIENTS,
    SESSION_START_AGENTS,
    isGaHookAgent,
    parseClients,
    parseEnableMcpClients,
    parseHookClients,
    validateExplicitPreviewSelection
} from './cli-core/clients';
import { normalizeVersionCommandArgs, printJsonOrValue, resolveCommandOperation } from './cli-core/output';
import { getCurrentWorkstream, findGitRepoRoot, resolveRepoRoot, safeGitValue } from './cli-core/repo';
import { createHookHealthCollector, createRepoReadinessCollector } from './cli-core/readiness';
import { commandDaemonService } from './cli-core/service';
import { readStdinPayload } from './cli-core/stdin';
import type {
    BootstrapResult,
    HookInstallClient,
    RepairStep,
    SupportedClient
} from './cli-core/types';
import { createWorkstreamCommands } from './commands/workstream';
import { createPolicyCommands } from './commands/product/policy';
import { createLifecycleCommands } from './commands/lifecycle';
import { createProductCommands } from './commands/product';
import { createConnectorCommands, createQueueCommands } from './commands/connector';
import { createHookCommands } from './commands/connector/hook';
import { asRecord, buildHookCaptureMeta, createHookSupport, extractSupportedHookAgent } from './commands/connector/hook/support';
import { createRecallCommands } from './commands/recall';
import { createMiscCommands } from './commands/misc';
import { printHelp } from './commands/help';

const DB_PATH = process.env.CTX_DB_PATH || path.join(os.homedir(), '.0ctx', '0ctx.db');
const KEY_PATH = path.join(os.homedir(), '.0ctx', 'master.key');
const SOCKET_PATH = os.platform() === 'win32'
    ? '\\\\.\\pipe\\0ctx.sock'
    : path.join(os.homedir(), '.0ctx', '0ctx.sock');

const SUPPORTED_CLIENTS: SupportedClient[] = ALL_SUPPORTED_CLIENTS;
const SUPPORTED_HOOK_INSTALL_CLIENTS: HookInstallClient[] = ['claude', 'cursor', 'windsurf', 'codex', 'factory', 'antigravity'];
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

const collectHookHealth = createHookHealthCollector({
    getHookDumpDir,
    getHookDumpRetentionDays,
    getHookDebugRetentionDays,
    getHookStatePath,
    getHookConfigPath,
    readHookInstallState,
    sendToDaemon
});

const collectRepoReadiness = createRepoReadinessCollector({
    ensureDaemonCapabilities,
    resolveRepoRoot: repoRoot => resolveRepoRoot(repoRoot ?? null),
    selectHookContextId: (contexts, repoRoot, explicitContextId) => selectHookContextId(contexts, repoRoot, explicitContextId ?? null),
    sendToDaemon,
    getCurrentWorkstream,
    collectHookHealth,
    defaultHookInstallClients: DEFAULT_HOOK_INSTALL_CLIENTS,
    sessionStartAgents: SESSION_START_AGENTS,
    isGaHookAgent
});

const { resolveContextIdForHookIngest, validateHookIngestWorkspace, ensureChatSessionNode, ensureChatCommitNode } = createHookSupport({
    sendToDaemon,
    selectHookContextId,
    resolveHookCaptureRoot,
    matchesHookCaptureRoot: (contextPaths, captureRoot) => matchesHookCaptureRoot(contextPaths ?? [], captureRoot)
});

const { resolveCommandContextId, requireCommandContextId } = createCommandContextResolver({
    parseOptionalStringFlag,
    resolveRepoRoot,
    sendToDaemon,
    selectHookContextId
});

const runCommandWithOpsSummary = createOpsSummaryRunner(appendCliOpsLogEntry);

// ─── Config command ──────────────────────────────────────────────────────────

const { commandConnectorQueue } = createQueueCommands({
    getConnectorQueueStats,
    listQueuedConnectorEvents,
    getConnectorQueuePath,
    getCliOpsLogPath,
    readCliOpsLog,
    clearCliOpsLog,
    appendCliOpsLogEntry,
    parsePositiveIntegerFlag,
    parsePositiveNumberFlag,
    resolveToken,
    readConnectorState,
    purgeConnectorQueue,
    drainConnectorQueue,
    sendConnectorEvents,
    getReadyConnectorEvents,
    markConnectorEventsDelivered,
    markConnectorEventsFailed,
    writeConnectorState
});

const { commandHook: commandConnectorHook } = createHookCommands({
    resolveRepoRoot,
    parseOptionalStringFlag,
    resolveContextIdForHookIngest: (repoRoot, explicitContextId) => resolveContextIdForHookIngest(repoRoot, explicitContextId),
    validateExplicitPreviewSelection,
    parseHookClients: raw => parseHookClients(raw),
    installHooks,
    readHookInstallState,
    parsePositiveIntegerFlag,
    getHookDumpRetentionDays,
    pruneHookDumps,
    extractSupportedHookAgent,
    readStdinPayload,
    normalizeHookPayload,
    resolveHookTranscriptPath,
    resolveCodexSessionArchivePath,
    readCodexArchiveCapture,
    readTranscriptCapture,
    readCodexCapture,
    readInlineHookCapture,
    persistHookTranscriptSnapshot,
    persistHookTranscriptHistory,
    appendHookEventLog,
    persistHookDump,
    resolveHookCaptureRoot,
    validateHookIngestWorkspace,
    buildHookCaptureMeta,
    ensureChatSessionNode,
    ensureChatCommitNode,
    asRecord,
    safeGitValue,
    sendToDaemon
});

const {
    commandDataPolicy,
    commandSyncStatus,
    commandSyncPolicyGet,
    commandSyncPolicySet
} = createPolicyCommands({
    requireCommandContextId,
    resolveCommandContextId,
    parseOptionalStringFlag,
    parseOptionalPositiveNumberFlag,
    parseOptionalBooleanLikeFlag,
    ensureDaemonCapabilities,
    printCapabilityMismatch,
    formatSyncPolicyLabel,
    formatDebugArtifactsLabel,
    printJsonOrValue
});

const {
    commandStatus,
    commandBootstrap,
    commandMcp,
    commandInstall,
    commandEnable,
    commandDashboard,
    commandLogs,
    commandWorkspaces
} = createProductCommands({
    DB_PATH,
    KEY_PATH,
    SOCKET_PATH,
    DEFAULT_MCP_CLIENTS,
    isDaemonReachable,
    startDaemonDetached,
    waitForDaemon,
    inferDaemonRecoverySteps,
    sendToDaemon,
    findGitRepoRoot,
    collectRepoReadiness,
    validateExplicitPreviewSelection,
    parseClients: raw => parseClients(raw),
    parseHookClients: raw => parseHookClients(raw),
    parseEnableMcpClients: raw => parseEnableMcpClients(raw),
    parseOptionalStringFlag,
    parsePositiveIntegerFlag,
    parseOptionalPositiveNumberFlag,
    runBootstrap: (clients, dryRun, explicitEntrypoint, profile) => runBootstrap(clients as SupportedClient[], dryRun, explicitEntrypoint, profile),
    printBootstrapResults,
    resolveRepoRoot,
    selectHookContextId,
    installHooks,
    collectHookHealth,
    commandInstall: flags => commandInstall(flags),
    buildDefaultDashboardQuery: () => buildDefaultDashboardQuery({ sendToDaemon, selectHookContextId }),
    applyDashboardQuery,
    getHostedDashboardUrl,
    openUrl,
    getConnectorStatePath,
    readConnectorState,
    getConnectorQueuePath,
    listQueuedConnectorEvents,
    getConnectorQueueStats,
    getCliOpsLogPath,
    readCliOpsLog,
    startLogsServer,
    formatAgentList,
    formatDataPolicyNarrative,
    formatLabelValue,
    formatRetentionLabel,
    formatSyncPolicyLabel,
    printJsonOrValue
});

const { commandConnector } = createConnectorCommands({
    isDaemonReachable,
    readConnectorState,
    resolveToken,
    fetchConnectorCapabilities,
    sendConnectorHeartbeat,
    getHostedDashboardUrl,
    getConnectorStatePath,
    writeConnectorState,
    sendToDaemon,
    inferDaemonRecoverySteps,
    runConnectorRuntime,
    parsePositiveIntegerFlag,
    commandLogs,
    commandDaemonService,
    commandConnectorQueue,
    registerConnector,
    registerConnectorInCloud
});

const {
    collectDoctorChecks,
    commandDoctor,
    commandRepair,
    commandReset,
    commandSetupValidate,
    commandSetup
} = createLifecycleCommands({
    DB_PATH,
    KEY_PATH,
    isDaemonReachable,
    getHookDumpDir,
    getConnectorQueuePath,
    getConnectorStatePath,
    getHookStatePath,
    inferDaemonRecoverySteps,
    getCliOpsLogPath,
    runBootstrap: (clients, dryRun) => runBootstrap(clients as SupportedClient[], dryRun),
    parseClients: raw => parseClients(raw),
    collectHookHealth,
    readHookInstallState,
    resolveContextIdForHookIngest: (projectRoot, preferredContextId) => resolveContextIdForHookIngest(projectRoot, preferredContextId ?? null),
    installHooks,
    commandBootstrap,
    waitForDaemon,
    startDaemonDetached,
    ensureDaemonCapabilities,
    resolveToken,
    readConnectorState,
    commandConnector,
    sleepMs,
    getHostedDashboardUrl,
    parsePositiveIntegerFlag,
    parseOptionalStringFlag,
    validateExplicitPreviewSelection,
    commandAuthLogin,
    commandInstall,
    commandConnectorHook,
    resolveRepoRoot,
    sendToDaemon,
    applyDashboardQuery,
    commandDashboard
});

const { commandRecall } = createRecallCommands({
    parseOptionalStringFlag,
    parsePositiveIntegerFlag,
    parsePositiveNumberFlag,
    getContextIdFlag,
    checkDaemonCapabilities,
    printCapabilityMismatch,
    sendToDaemon
});

const {
    commandShell,
    commandReleasePublish,
    commandVersion,
    commandConfigList,
    commandConfigGet,
    commandConfigSet
} = createMiscCommands({
    CLI_VERSION,
    parseOptionalStringFlag,
    runInteractiveShell,
    resolveCliEntrypoint,
    runReleasePublish,
    listConfig,
    getConfigPath,
    isValidConfigKey,
    getConfigValue,
    setConfigValue
});

const {
    commandBranches,
    commandSessions,
    commandAgentContext,
    commandCheckpoints,
    commandResume,
    commandRewind,
    commandExplain,
    commandExtract,
    commandInsights
} = createWorkstreamCommands({
    requireCommandContextId,
    resolveCommandRepoRoot: flags => resolveCommandRepoRoot(flags, { parseOptionalStringFlag, resolveRepoRoot }),
    parseOptionalStringFlag,
    parsePositiveIntegerFlag,
    getCurrentWorkstream,
    formatSyncPolicyLabel
});

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
            case 'workspaces':
                return commandWorkspaces(parsed.positionalArgs, parsed.flags);
            case 'agent-context':
                return commandAgentContext(parsed.flags);
            case 'sessions':
                return commandSessions(parsed.flags);
            case 'checkpoints':
                return commandCheckpoints(parsed.subcommand, parsed.flags);
            case 'insights':
                return commandInsights(parsed.positionalArgs, parsed.flags);
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
            case 'data-policy':
                return commandDataPolicy(parsed.subcommand ?? parsed.positionalArgs[0] ?? null, parsed.flags);
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

