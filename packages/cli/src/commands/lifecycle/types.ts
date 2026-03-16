import type { RepoReadinessSummary } from '@0ctx/core';
import type { DaemonCapabilityCheck, DaemonHealthSummary } from '../../cli-core/daemon';

export type FlagMap = Record<string, string | boolean>;

export interface DoctorCheck {
    id: string;
    status: 'pass' | 'warn' | 'fail';
    message: string;
    details?: Record<string, unknown>;
}

export interface RepairStep {
    id: string;
    status: 'pass' | 'warn' | 'fail';
    code: number;
    message: string;
    details?: Record<string, unknown>;
}

export interface SetupStep {
    id: string;
    status: 'pass' | 'warn' | 'fail';
    code: number;
    message: string;
}

export interface BootstrapResult {
    client: string;
    status: string;
    configPath: string;
    message?: string;
}

export interface HealthCommandDeps {
    DB_PATH: string;
    KEY_PATH: string;
    isDaemonReachable: () => Promise<DaemonHealthSummary>;
    inferDaemonRecoverySteps: (error?: string) => string[];
    findGitRepoRoot: (input: string | null) => string | null;
    collectRepoReadiness: (opts: { repoRoot: string; contextId?: string | null }) => Promise<RepoReadinessSummary | null>;
    getCliOpsLogPath: () => string;
    runBootstrap: (clients: string[], dryRun: boolean) => BootstrapResult[];
    parseClients: (raw: string | boolean | undefined) => string[];
    collectHookHealth: () => Promise<{ check: DoctorCheck; dumpCheck: DoctorCheck }>;
    readHookInstallState: () => { projectRoot?: string | null; contextId?: string | null; agents: Array<{ agent: string; installed: boolean }> };
    getHookStatePath: () => string;
    resolveContextIdForHookIngest: (projectRoot: string, preferredContextId?: string | null) => Promise<string | null>;
    installHooks: (opts: { projectRoot: string; contextId: string | null; clients: string[]; dryRun: boolean; cliCommand: string }) => { warnings: string[]; state: { agents: Array<{ agent: string; installed: boolean }> } };
    commandBootstrap: (flags: FlagMap) => Promise<number>;
    waitForDaemon: () => Promise<boolean>;
    startDaemonDetached: () => void;
    ensureDaemonCapabilities: (requiredMethods: string[]) => Promise<DaemonCapabilityCheck>;
}

export interface SetupCommandDeps {
    readConnectorState: () => { machineId: string } | null;
    commandConnector: (action: string, flags: FlagMap) => Promise<number>;
    parseOptionalStringFlag: (value: string | boolean | undefined) => string | null | undefined;
    validateExplicitPreviewSelection: (raw: string | boolean | undefined, previewList: string) => string | null;
    validatePreviewOptIn: (raw: string | boolean | undefined, allowPreview: boolean, previewList: string, gaExample?: string) => string | null;
    commandInstall: (flags: FlagMap) => Promise<number>;
    commandConnectorHook: (action: string, flags: FlagMap) => Promise<number>;
    resolveRepoRoot: (input: string | null) => string;
    sendToDaemon: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
}

export interface ResetCommandDeps {
    DB_PATH: string;
    isDaemonReachable: () => Promise<DaemonHealthSummary>;
    getHookDumpDir: () => string;
    getConnectorQueuePath: () => string;
    getCliOpsLogPath: () => string;
    getConnectorStatePath: () => string;
    getHookStatePath: () => string;
}
