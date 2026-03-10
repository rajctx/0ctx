import type { TokenStore } from '../auth.js';
import type { ConnectorState } from '../connector.js';
import type { ConnectorCommand, ConnectorEventPayload } from '../cloud.js';

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
    cloudConnected: boolean;
    registrationMode: 'none' | 'local' | 'cloud';
    auth: boolean;
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
    resolveToken(): TokenStore | null;
    readConnectorState(): ConnectorState | null;
    registerConnector(options: {
        tenantId?: string | null;
        uiUrl: string;
        force?: boolean;
        registrationMode?: 'local' | 'cloud';
        cloud?: {
            registrationId?: string | null;
            streamUrl?: string | null;
            capabilities?: string[];
        };
    }): { state: ConnectorState; created: boolean };
    writeConnectorState(state: ConnectorState): void;
    getDashboardUrl(): string;
    registerConnectorInCloud(
        token: string,
        payload: {
            machineId: string;
            tenantId: string | null;
            uiUrl: string;
            platform: string;
        }
    ): Promise<{
        ok: boolean;
        error?: string;
        data?: { registrationId?: string; streamUrl?: string; capabilities?: string[]; tenantId?: string };
    }>;
    fetchConnectorCapabilities(
        token: string,
        machineId: string
    ): Promise<{ ok: boolean; statusCode?: number; error?: string; data?: { capabilities?: string[]; features?: string[] } }>;
    sendConnectorHeartbeat(
        token: string,
        payload: {
            machineId: string;
            tenantId: string | null;
            posture: 'connected' | 'degraded' | 'offline';
            daemonRunning: boolean;
            syncEnabled: boolean;
            syncRunning: boolean;
            queue?: { pending: number; inFlight: number; failed: number; done: number };
        }
    ): Promise<{ ok: boolean; error?: string }>;
    createDaemonSession(): Promise<{ sessionToken: string }>;
    subscribeEvents(
        sessionToken: string,
        afterSequence?: number
    ): Promise<{ subscriptionId: string; lastAckedSequence?: number }>;
    pollEvents(
        sessionToken: string,
        subscriptionId: string,
        afterSequence: number,
        limit?: number
    ): Promise<{ cursor: number; events: ConnectorEventPayload[]; hasMore?: boolean }>;
    ackEvents(
        sessionToken: string,
        subscriptionId: string,
        sequence: number
    ): Promise<{ lastAckedSequence?: number }>;
    sendConnectorEvents(
        token: string,
        payload: {
            machineId: string;
            tenantId: string | null;
            subscriptionId: string;
            cursor: number;
            events: ConnectorEventPayload[];
        }
    ): Promise<{ ok: boolean; error?: string; statusCode: number }>;
    fetchConnectorCommands(
        token: string,
        machineId: string,
        cursor: number
    ): Promise<{ ok: boolean; error?: string; statusCode: number; data?: { cursor?: number; commands?: ConnectorCommand[] } }>;
    ackConnectorCommand(
        token: string,
        payload: {
            machineId: string;
            tenantId: string | null;
            commandId: string;
            cursor: number;
            status: 'applied' | 'failed';
            result?: unknown;
            error?: string;
        }
    ): Promise<{ ok: boolean; error?: string; statusCode: number }>;
    applyDaemonCommand(
        sessionToken: string,
        method: string,
        params: Record<string, unknown>
    ): Promise<unknown>;
    getContextSyncPolicy(
        sessionToken: string,
        contextId: string
    ): Promise<'local_only' | 'metadata_only' | 'full_sync' | null>;
    enqueueEvents(
        subscriptionId: string,
        events: ConnectorEventPayload[],
        now: number
    ): { enqueued: number; lastSequence: number | null };
    getReadyEvents(limit: number, now: number): Array<{
        queueId: string;
        eventId: string;
        subscriptionId: string;
        sequence: number;
        contextId: string | null;
        type: string;
        timestamp: number;
        source: string;
        payload: Record<string, unknown>;
    }>;
    markEventsDelivered(queueIds: string[]): void;
    markEventsFailed(queueIds: string[], error: string, now: number): void;
    getQueueStats(now: number): {
        pending: number;
        ready: number;
        backoff: number;
        maxAttempts: number;
        oldestEnqueuedAt: number | null;
    };
    pruneQueue(now: number): { removed: number; remaining: number };
}
