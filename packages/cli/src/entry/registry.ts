import os from 'os';
import path from 'path';
import { getConfigPath, getConfigValue, isValidConfigKey, listConfig, setConfigValue } from '@0ctx/core';
import { sendToDaemon } from '@0ctx/mcp/dist/client';
import { commandAuthLogin, commandAuthLogout, commandAuthRotate, commandAuthStatus, getEnvToken, isTokenExpired, refreshAccessToken, resolveToken } from '../auth';
import { fetchConnectorCapabilities, registerConnectorInCloud, sendConnectorEvents, sendConnectorHeartbeat } from '../cloud';
import { getConnectorStatePath, readConnectorState, registerConnector, writeConnectorState } from '../connector';
import { getConnectorQueuePath, getConnectorQueueStats, getReadyConnectorEvents, listQueuedConnectorEvents, markConnectorEventsDelivered, markConnectorEventsFailed, purgeConnectorQueue } from '../connector-queue';
import { drainConnectorQueue } from '../connector-queue-drain';
import { runConnectorRuntime } from '../connector-runtime';
import { appendHookEventLog, getHookDebugRetentionDays, getHookDumpDir, getHookDumpRetentionDays, isHookDebugArtifactsEnabled, persistHookDump, persistHookTranscriptHistory, persistHookTranscriptSnapshot, pruneHookDumps } from '../hook-dumps';
import { getHookConfigPath, getHookStatePath, installHooks, matchesHookCaptureRoot, normalizeHookPayload, readCodexArchiveCapture, readCodexCapture, readHookInstallState, readInlineHookCapture, readTranscriptCapture, resolveCodexSessionArchivePath, resolveHookCaptureRoot, resolveHookTranscriptPath, selectHookContextId } from '../hooks';
import { startLogsServer } from '../logs-server';
import { appendCliOpsLogEntry, clearCliOpsLog, getCliOpsLogPath, readCliOpsLog } from '../ops-log';
import { runReleasePublish } from '../release';
import { runInteractiveShell } from '../shell';
import { createCommandContextResolver, getContextIdFlag, resolveCommandRepoRoot } from '../cli-core/command-context';
import { applyDashboardQuery, parseOptionalBooleanLikeFlag, parseOptionalPositiveNumberFlag, parseOptionalStringFlag, parsePositiveIntegerFlag, parsePositiveNumberFlag, sleepMs } from '../cli-core/args';
import { ALL_SUPPORTED_CLIENTS, DEFAULT_HOOK_INSTALL_CLIENTS, DEFAULT_MCP_CLIENTS, SESSION_START_AGENTS, deriveEnableMcpClientsFromHookClients, isGaHookAgent, parseClients, parseEnableMcpClients, parseHookClients, validateExplicitPreviewSelection, validatePreviewOptIn } from '../cli-core/clients';
import { checkDaemonCapabilities, ensureDaemonCapabilities, inferDaemonRecoverySteps, isDaemonReachable, printCapabilityMismatch, startDaemonDetached, waitForDaemon } from '../cli-core/daemon';
import { detectInstalledGaHookClients, detectInstalledGaMcpClients, detectRegisteredGaMcpClients } from '../cli-core/detect-clients';
import { formatAgentList, formatDebugArtifactsLabel, formatLabelValue, formatRetentionLabel, formatSyncPolicyLabel } from '../cli-core/format';
import { createOpsSummaryRunner } from '../cli-core/ops';
import { printJsonOrValue } from '../cli-core/output';
import { buildDefaultDashboardQuery, getHostedDashboardUrl, openUrl, printBootstrapResults, resolveCliEntrypoint, runBootstrap } from '../cli-core/platform';
import { createHookHealthCollector, createRepoReadinessCollector } from '../cli-core/readiness';
import { findGitRepoRoot, getCurrentWorkstream, resolveRepoRoot, safeGitValue } from '../cli-core/repo';
import { commandDaemonService } from '../cli-core/service';
import { readStdinPayload } from '../cli-core/stdin';
import type { HookInstallClient, SupportedClient } from '../cli-core/types';
import { createConnectorCommands, createQueueCommands } from '../commands/connector';
import { createHookCommands } from '../commands/connector/hook';
import { asRecord, buildHookCaptureMeta, createHookSupport, extractSupportedHookAgent } from '../commands/connector/hook/support';
import { printHelp } from '../commands/help';
import { createLifecycleCommands } from '../commands/lifecycle';
import { createMiscCommands } from '../commands/misc';
import { createPolicyCommands } from '../commands/product/policy';
import { createProductCommands } from '../commands/product';
import { createRecallCommands } from '../commands/recall';
import { createWorkstreamCommands } from '../commands/workstream';

export function createCliRegistry() {
    const dbPath = process.env.CTX_DB_PATH || path.join(os.homedir(), '.0ctx', '0ctx.db');
    const keyPath = path.join(os.homedir(), '.0ctx', 'master.key');
    const socketPath = process.env.CTX_SOCKET_PATH || (os.platform() === 'win32' ? '\\\\.\\pipe\\0ctx.sock' : path.join(os.homedir(), '.0ctx', '0ctx.sock'));
    const defaultEnableMcpClients: SupportedClient[] = DEFAULT_MCP_CLIENTS;
    const cliVersion = (() => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const pkg = require('../../package.json') as { version?: string };
            return typeof pkg.version === 'string' ? pkg.version : 'unknown';
        } catch {
            return 'unknown';
        }
    })();
    const collectHookHealth = createHookHealthCollector({
        getHookDumpDir,
        getHookDumpRetentionDays,
        getHookDebugRetentionDays,
        isHookDebugArtifactsEnabled,
        getHookStatePath,
        getHookConfigPath,
        readHookInstallState,
        sendToDaemon
    });
    const collectRepoReadiness = createRepoReadinessCollector({
        ensureDaemonCapabilities,
        resolveRepoRoot: repoRoot => resolveRepoRoot(repoRoot ?? null),
        sendToDaemon
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
    const { commandConnectorQueue } = createQueueCommands({
        getConnectorQueueStats, listQueuedConnectorEvents, getConnectorQueuePath, getCliOpsLogPath, readCliOpsLog, clearCliOpsLog, appendCliOpsLogEntry, parsePositiveIntegerFlag, parsePositiveNumberFlag, resolveToken, readConnectorState, purgeConnectorQueue, drainConnectorQueue, sendConnectorEvents, getReadyConnectorEvents, markConnectorEventsDelivered, markConnectorEventsFailed, writeConnectorState
    });
    const { commandHook: commandConnectorHook } = createHookCommands({
        resolveRepoRoot, parseOptionalStringFlag, resolveContextIdForHookIngest: (repoRoot, explicitContextId) => resolveContextIdForHookIngest(repoRoot, explicitContextId), validateExplicitPreviewSelection, validatePreviewOptIn, parseHookClients: raw => parseHookClients(raw), installHooks, readHookInstallState, parsePositiveIntegerFlag, getHookDumpRetentionDays, pruneHookDumps, extractSupportedHookAgent, readStdinPayload, normalizeHookPayload, resolveHookTranscriptPath, resolveCodexSessionArchivePath, readCodexArchiveCapture, readTranscriptCapture, readCodexCapture, readInlineHookCapture, persistHookTranscriptSnapshot, persistHookTranscriptHistory, appendHookEventLog, persistHookDump, resolveHookCaptureRoot, validateHookIngestWorkspace, buildHookCaptureMeta, ensureChatSessionNode, ensureChatCommitNode, asRecord, safeGitValue, sendToDaemon
    });
    const { commandDataPolicy, commandSyncStatus, commandSyncPolicyGet, commandSyncPolicySet } = createPolicyCommands({
        requireCommandContextId, resolveCommandContextId, parseOptionalStringFlag, parseOptionalPositiveNumberFlag, parseOptionalBooleanLikeFlag, ensureDaemonCapabilities, printCapabilityMismatch, formatSyncPolicyLabel, formatDebugArtifactsLabel, printJsonOrValue, pruneHookDumps
    });
    const { commandStatus, commandBootstrap, commandMcp, commandInstall, commandEnable, commandDashboard, commandLogs, commandWorkspaces } = createProductCommands({
        DB_PATH: dbPath, KEY_PATH: keyPath, SOCKET_PATH: socketPath, DEFAULT_MCP_CLIENTS: defaultEnableMcpClients, isDaemonReachable, startDaemonDetached, waitForDaemon, inferDaemonRecoverySteps, sendToDaemon, findGitRepoRoot, collectRepoReadiness, validateExplicitPreviewSelection, validatePreviewOptIn, parseClients: raw => parseClients(raw), parseHookClients: raw => parseHookClients(raw), parseEnableMcpClients: raw => parseEnableMcpClients(raw), deriveEnableMcpClientsFromHookClients: hookClients => deriveEnableMcpClientsFromHookClients(hookClients as HookInstallClient[]), detectInstalledGaHookClients, detectInstalledGaMcpClients, parseOptionalStringFlag, parsePositiveIntegerFlag, parseOptionalPositiveNumberFlag, runBootstrap: (clients, dryRun, explicitEntrypoint, profile) => runBootstrap(clients as SupportedClient[], dryRun, explicitEntrypoint, profile), printBootstrapResults, resolveRepoRoot, selectHookContextId, installHooks, commandInstall: flags => commandInstall(flags), buildDefaultDashboardQuery: () => buildDefaultDashboardQuery({ sendToDaemon, selectHookContextId }), applyDashboardQuery, getHostedDashboardUrl, openUrl, getConnectorStatePath, readConnectorState, getConnectorQueuePath, listQueuedConnectorEvents, getConnectorQueueStats, getCliOpsLogPath, readCliOpsLog, startLogsServer, formatAgentList, formatLabelValue, formatRetentionLabel, formatSyncPolicyLabel, printJsonOrValue
    });
    const { commandConnector } = createConnectorCommands({
        isDaemonReachable, readConnectorState, resolveToken, fetchConnectorCapabilities, sendConnectorHeartbeat, getHostedDashboardUrl, getConnectorStatePath, writeConnectorState, sendToDaemon, inferDaemonRecoverySteps, runConnectorRuntime, parsePositiveIntegerFlag, commandLogs, commandDaemonService, commandConnectorQueue, registerConnector, registerConnectorInCloud
    });
    const { collectDoctorChecks, commandDoctor, commandRepair, commandReset, commandSetup } = createLifecycleCommands({
        DB_PATH: dbPath, KEY_PATH: keyPath, isDaemonReachable, findGitRepoRoot, collectRepoReadiness, getHookDumpDir, getConnectorQueuePath, getConnectorStatePath, getHookStatePath, inferDaemonRecoverySteps, getCliOpsLogPath, runBootstrap: (clients, dryRun) => runBootstrap(clients as SupportedClient[], dryRun), parseClients: raw => parseClients(raw), collectHookHealth, readHookInstallState, resolveContextIdForHookIngest: (projectRoot, preferredContextId) => resolveContextIdForHookIngest(projectRoot, preferredContextId ?? null), installHooks, commandBootstrap, waitForDaemon, startDaemonDetached, ensureDaemonCapabilities, resolveToken, readConnectorState, commandConnector, sleepMs, getHostedDashboardUrl, parsePositiveIntegerFlag, parseOptionalStringFlag, validateExplicitPreviewSelection, validatePreviewOptIn, commandAuthLogin, commandInstall, commandConnectorHook, resolveRepoRoot, sendToDaemon, applyDashboardQuery, commandDashboard
    });
    const { commandRecall } = createRecallCommands({
        parseOptionalStringFlag, parsePositiveIntegerFlag, parsePositiveNumberFlag, getContextIdFlag, checkDaemonCapabilities, printCapabilityMismatch, sendToDaemon
    });
    const { commandShell, commandReleasePublish, commandVersion, commandConfigList, commandConfigGet, commandConfigSet } = createMiscCommands({
        CLI_VERSION: cliVersion, parseOptionalStringFlag, runInteractiveShell, resolveCliEntrypoint, runReleasePublish, listConfig, getConfigPath, isValidConfigKey, getConfigValue, setConfigValue
    });
    const { commandBranches, commandSessions, commandAgentContext, commandCheckpoints, commandResume, commandRewind, commandExplain, commandExtract, commandInsights } = createWorkstreamCommands({
        requireCommandContextId, resolveCommandRepoRoot: flags => resolveCommandRepoRoot(flags, { parseOptionalStringFlag, resolveRepoRoot }), parseOptionalStringFlag, parsePositiveIntegerFlag, getCurrentWorkstream, formatSyncPolicyLabel
    });
    return {
        ALL_SUPPORTED_CLIENTS,
        defaultEnableMcpClients,
        collectDoctorChecks,
        runCommandWithOpsSummary,
        printHelp,
        resolveToken,
        isTokenExpired,
        refreshAccessToken,
        getEnvToken,
        readConnectorState,
        findGitRepoRoot,
        isDaemonReachable,
        startDaemonDetached,
        waitForDaemon,
        commandEnable,
        commandBranches,
        commandAuthLogin,
        commandAuthLogout,
        commandAuthStatus,
        commandAuthRotate,
        commandSetup,
        commandInstall,
        commandBootstrap,
        commandMcp,
        commandDoctor,
        commandStatus,
        commandRepair,
        commandReset,
        commandVersion,
        commandWorkspaces,
        commandAgentContext,
        commandSessions,
        commandCheckpoints,
        commandInsights,
        commandExtract,
        commandResume,
        commandRewind,
        commandExplain,
        commandRecall,
        commandDaemonService,
        commandConfigList,
        commandConfigGet,
        commandConfigSet,
        commandDataPolicy,
        commandSyncStatus,
        commandSyncPolicyGet,
        commandSyncPolicySet,
        commandConnector,
        commandConnectorQueue,
        commandConnectorHook,
        commandLogs,
        commandDashboard,
        commandShell,
        commandReleasePublish
    };
}

export type CliRegistry = ReturnType<typeof createCliRegistry>;
