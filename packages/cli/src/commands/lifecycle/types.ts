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
    resolveToken: () => unknown | null;
    readConnectorState: () => { machineId: string; tenantId?: string | null; registrationMode: string } | null;
    commandConnector: (action: string, flags: FlagMap) => Promise<number>;
    sleepMs: (ms: number) => Promise<void>;
    getHostedDashboardUrl: () => string;
    parsePositiveIntegerFlag: (value: string | boolean | undefined, fallback: number) => number;
    parseOptionalStringFlag: (value: string | boolean | undefined) => string | null | undefined;
    validateExplicitPreviewSelection: (raw: string | boolean | undefined, previewList: string) => string | null;
    commandAuthLogin: (flags: FlagMap) => Promise<number>;
    commandInstall: (flags: FlagMap) => Promise<number>;
    commandConnectorHook: (action: string, flags: FlagMap) => Promise<number>;
    resolveRepoRoot: (input: string | null) => string;
    sendToDaemon: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
    applyDashboardQuery: (url: string, query?: string) => string;
    commandDashboard: (flags: FlagMap) => Promise<number>;
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
