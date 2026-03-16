export type FlagMap = Record<string, string | boolean>;

export interface QueueCommandDeps {
    getConnectorQueueStats: (now?: number) => any;
    listQueuedConnectorEvents: () => any[];
    getConnectorQueuePath: () => string;
    getCliOpsLogPath: () => string;
    readCliOpsLog: (limit?: number) => any[];
    clearCliOpsLog: () => { cleared: boolean; path: string };
    appendCliOpsLogEntry: (entry: {
        operation: string;
        status: 'success' | 'error' | 'partial' | 'dry_run';
        details?: Record<string, unknown>;
    }) => void;
    parsePositiveIntegerFlag: (value: string | boolean | undefined, fallback: number) => number;
    parsePositiveNumberFlag: (value: string | boolean | undefined, fallback: number) => number;
    purgeConnectorQueue: (options: Record<string, unknown>) => { removed: number; remaining: number };
}

export interface ConnectorCommandDeps {
    isDaemonReachable: () => Promise<{ ok: boolean; error?: string; health?: any }>;
    readConnectorState: () => any | null;
    getHostedUiUrl: () => string;
    getConnectorStatePath: () => string;
    writeConnectorState: (state: any) => void;
    sendToDaemon: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
    inferDaemonRecoverySteps: (error?: string) => string[];
    runConnectorRuntime: (options: Record<string, unknown>) => Promise<number>;
    parsePositiveIntegerFlag: (value: string | boolean | undefined, fallback: number) => number;
    commandLogs: (flags: FlagMap) => Promise<number>;
    commandDaemonService: (action: string | undefined) => Promise<number>;
    commandConnectorQueue: (action: string | undefined, flags: FlagMap) => Promise<number>;
    registerConnector: (options: { uiUrl: string; force: boolean }) => { state: any; created: boolean };
}
