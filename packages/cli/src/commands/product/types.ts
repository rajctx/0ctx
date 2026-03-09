import type { HookHealthDetails } from '../../cli-core/types';

export type FlagMap = Record<string, string | boolean>;
export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface RepoReadinessSummary {
    repoRoot: string;
    contextId: string | null;
    workspaceName: string | null;
    workstream: string | null;
    sessionCount: number | null;
    checkpointCount: number | null;
    captureManagedForRepo: boolean;
    captureReadyAgents: string[];
    captureMissingAgents: string[];
    autoContextAgents: string[];
    syncPolicy: string | null;
    captureRetentionDays: number;
    debugRetentionDays: number;
    debugArtifactsEnabled: boolean;
}

export interface BootstrapResult {
    client: string;
    status: string;
    configPath: string;
    message?: string;
}

export interface ProductCommandDeps {
    DB_PATH: string;
    KEY_PATH: string;
    SOCKET_PATH: string;
    DEFAULT_MCP_CLIENTS: string[];
    isDaemonReachable: () => Promise<{ ok: boolean; error?: string; health?: any }>;
    startDaemonDetached: () => void;
    waitForDaemon: (timeoutMs?: number) => Promise<boolean>;
    inferDaemonRecoverySteps: (error?: string) => string[];
    sendToDaemon: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
    findGitRepoRoot: (input: string | null) => string | null;
    collectRepoReadiness: (opts: { repoRoot: string; contextId?: string | null; hookDetails?: HookHealthDetails | null }) => Promise<RepoReadinessSummary | null>;
    validateExplicitPreviewSelection: (raw: string | boolean | undefined, previewExample: string, gaExample?: string) => string | null;
    parseClients: (raw: string | boolean | undefined) => string[];
    parseHookClients: (raw: string | boolean | undefined) => string[];
    parseEnableMcpClients: (raw: string | boolean | undefined) => string[];
    parseOptionalStringFlag: (value: string | boolean | undefined) => string | null;
    parsePositiveIntegerFlag: (value: string | boolean | undefined, fallback: number) => number;
    parseOptionalPositiveNumberFlag: (value: string | boolean | undefined) => number | null;
    runBootstrap: (clients: string[], dryRun: boolean, explicitEntrypoint?: string, profile?: string) => BootstrapResult[];
    printBootstrapResults: (results: BootstrapResult[], dryRun: boolean) => Promise<void>;
    resolveRepoRoot: (input: string | null) => string;
    selectHookContextId: (contexts: Array<{ id?: string; name?: string; paths?: string[] }>, repoRoot: string, preferredContextId: string | null) => string | null;
    installHooks: (opts: { projectRoot: string; contextId: string | null; clients: string[]; installClaudeGlobal?: boolean; dryRun?: boolean; cliCommand?: string }) => { changed?: unknown; statePath?: string; projectConfigPath?: string; warnings?: string[] };
    collectHookHealth: () => Promise<{ details: HookHealthDetails }>;
    commandInstall: (flags: FlagMap) => Promise<number>;
    buildDefaultDashboardQuery: () => Promise<string | undefined>;
    applyDashboardQuery: (url: string, queryRaw: string | boolean | undefined) => string;
    getHostedDashboardUrl: () => string;
    openUrl: (url: string) => void;
    getConnectorStatePath: () => string;
    readConnectorState: () => unknown;
    getConnectorQueuePath: () => string;
    listQueuedConnectorEvents: () => any[];
    getConnectorQueueStats: () => unknown;
    getCliOpsLogPath: () => string;
    readCliOpsLog: (limit?: number) => unknown[];
    startLogsServer: () => Promise<{ port: number; close: () => Promise<void> }>;
    formatAgentList: (agents: string[]) => string;
    formatDataPolicyNarrative: (policy: { syncPolicy: string | null | undefined; captureRetentionDays: number; debugRetentionDays: number; debugArtifactsEnabled: boolean }) => string;
    formatLabelValue: (label: string, value: string) => string;
    formatRetentionLabel: (summary: RepoReadinessSummary) => string;
    formatSyncPolicyLabel: (policy: string | null | undefined) => string;
}
