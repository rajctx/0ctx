import type { ConnectorState } from '../connector.js';

export interface ConnectorRuntimeSyncStatus {
    enabled: boolean;
    running: boolean;
    lastError: string | null;
    queue?: {
        pending: number;
        inFlight: number;
        failed: number;
        done: number;
    };
}

export interface ConnectorRuntimeOptions {
    intervalMs?: number;
    once?: boolean;
    autoStartDaemon?: boolean;
    quiet?: boolean;
}

export interface ConnectorRuntimeSummary {
    posture: 'connected' | 'degraded' | 'offline';
    recoveryState: 'healthy' | 'recovering' | 'backoff' | 'blocked';
    daemonRunning: boolean;
    machineId: string | null;
    lastError: string | null;
    consecutiveFailures: number;
}

export interface ConnectorRuntimeDependencies {
    now(): number;
    log(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    isDaemonReachable(): Promise<{ ok: boolean; error?: string }>;
    startDaemonDetached(): void;
    waitForDaemon(timeoutMs?: number): Promise<boolean>;
    getSyncStatus(): Promise<ConnectorRuntimeSyncStatus | null>;
    readConnectorState(): ConnectorState | null;
    registerConnector(options: {
        uiUrl: string;
        force?: boolean;
    }): { state: ConnectorState; created: boolean };
    writeConnectorState(state: ConnectorState): void;
    getUiUrl(): string;
    getQueueStats(now: number): {
        pending: number;
        ready: number;
        backoff: number;
        maxAttempts: number;
        oldestEnqueuedAt: number | null;
    };
}
