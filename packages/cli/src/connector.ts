import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

export interface ConnectorCloudState {
    registrationId: string | null;
    streamUrl: string | null;
    capabilities: string[];
    lastHeartbeatAt: number | null;
    lastError: string | null;
}

export interface ConnectorRuntimeState {
    daemonSessionToken: string | null;
    eventSubscriptionId: string | null;
    lastEventSequence: number;
    lastEventSyncAt: number | null;
    eventBridgeSupported: boolean;
    eventBridgeError: string | null;
    eventQueuePending: number;
    eventQueueReady: number;
    eventQueueBackoff: number;
    lastCommandCursor: number;
    lastCommandSyncAt: number | null;
    commandBridgeSupported: boolean;
    commandBridgeError: string | null;
    recoveryState?: 'healthy' | 'recovering' | 'backoff' | 'blocked';
    consecutiveFailures?: number;
    lastHealthyAt?: number | null;
    lastRecoveryAt?: number | null;
}

export interface ConnectorState {
    machineId: string;
    tenantId: string | null;
    uiUrl: string;
    registeredAt: number;
    updatedAt: number;
    registrationMode: 'local' | 'cloud';
    cloud: ConnectorCloudState;
    runtime: ConnectorRuntimeState;
}

export interface RegisterConnectorOptions {
    tenantId?: string | null;
    uiUrl: string;
    force?: boolean;
    cloud?: {
        registrationId?: string | null;
        streamUrl?: string | null;
        capabilities?: string[];
    };
    registrationMode?: 'local' | 'cloud';
    runtime?: Partial<ConnectorRuntimeState>;
}

export function getConnectorStatePath(): string {
    return process.env.CTX_CONNECTOR_STATE_PATH || path.join(os.homedir(), '.0ctx', 'connector.json');
}

export function readConnectorState(): ConnectorState | null {
    try {
        const filePath = getConnectorStatePath();
        if (!fs.existsSync(filePath)) return null;
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<ConnectorState>;
        if (!parsed.machineId || !parsed.uiUrl || !parsed.registeredAt) return null;
        return {
            machineId: parsed.machineId,
            tenantId: parsed.tenantId ?? null,
            uiUrl: parsed.uiUrl,
            registeredAt: parsed.registeredAt,
            updatedAt: parsed.updatedAt ?? parsed.registeredAt,
            registrationMode: parsed.registrationMode === 'cloud' ? 'cloud' : 'local',
            cloud: {
                registrationId: parsed.cloud?.registrationId ?? null,
                streamUrl: parsed.cloud?.streamUrl ?? null,
                capabilities: Array.isArray(parsed.cloud?.capabilities) ? parsed.cloud.capabilities : [],
                lastHeartbeatAt: parsed.cloud?.lastHeartbeatAt ?? null,
                lastError: parsed.cloud?.lastError ?? null
            },
            runtime: {
                daemonSessionToken: parsed.runtime?.daemonSessionToken ?? null,
                eventSubscriptionId: parsed.runtime?.eventSubscriptionId ?? null,
                lastEventSequence: typeof parsed.runtime?.lastEventSequence === 'number' ? parsed.runtime.lastEventSequence : 0,
                lastEventSyncAt: parsed.runtime?.lastEventSyncAt ?? null,
                eventBridgeSupported: parsed.runtime?.eventBridgeSupported !== false,
                eventBridgeError: parsed.runtime?.eventBridgeError ?? null,
                eventQueuePending: typeof parsed.runtime?.eventQueuePending === 'number' ? parsed.runtime.eventQueuePending : 0,
                eventQueueReady: typeof parsed.runtime?.eventQueueReady === 'number' ? parsed.runtime.eventQueueReady : 0,
                eventQueueBackoff: typeof parsed.runtime?.eventQueueBackoff === 'number' ? parsed.runtime.eventQueueBackoff : 0,
                lastCommandCursor: typeof parsed.runtime?.lastCommandCursor === 'number' ? parsed.runtime.lastCommandCursor : 0,
                lastCommandSyncAt: parsed.runtime?.lastCommandSyncAt ?? null,
                commandBridgeSupported: parsed.runtime?.commandBridgeSupported !== false,
                commandBridgeError: parsed.runtime?.commandBridgeError ?? null,
                recoveryState: parsed.runtime?.recoveryState === 'blocked'
                    || parsed.runtime?.recoveryState === 'recovering'
                    || parsed.runtime?.recoveryState === 'backoff'
                    ? parsed.runtime.recoveryState
                    : 'healthy',
                consecutiveFailures: typeof parsed.runtime?.consecutiveFailures === 'number' ? parsed.runtime.consecutiveFailures : 0,
                lastHealthyAt: parsed.runtime?.lastHealthyAt ?? null,
                lastRecoveryAt: parsed.runtime?.lastRecoveryAt ?? null
            }
        };
    } catch {
        return null;
    }
}

export function writeConnectorState(state: ConnectorState): void {
    const filePath = getConnectorStatePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
}

export function registerConnector(options: RegisterConnectorOptions): { state: ConnectorState; created: boolean } {
    const existing = readConnectorState();
    const now = Date.now();

    if (existing && !options.force) {
        return { state: existing, created: false };
    }

    const baseRuntime: ConnectorRuntimeState = options.force
        ? {
            daemonSessionToken: null,
            eventSubscriptionId: null,
            lastEventSequence: existing?.runtime.lastEventSequence ?? 0,
            lastEventSyncAt: existing?.runtime.lastEventSyncAt ?? null,
            eventBridgeSupported: true,
            eventBridgeError: null,
            eventQueuePending: existing?.runtime.eventQueuePending ?? 0,
            eventQueueReady: existing?.runtime.eventQueueReady ?? 0,
            eventQueueBackoff: existing?.runtime.eventQueueBackoff ?? 0,
            lastCommandCursor: existing?.runtime.lastCommandCursor ?? 0,
            lastCommandSyncAt: existing?.runtime.lastCommandSyncAt ?? null,
            commandBridgeSupported: true,
            commandBridgeError: null,
            recoveryState: existing?.runtime.recoveryState ?? 'healthy',
            consecutiveFailures: existing?.runtime.consecutiveFailures ?? 0,
            lastHealthyAt: existing?.runtime.lastHealthyAt ?? null,
            lastRecoveryAt: existing?.runtime.lastRecoveryAt ?? null
        }
        : {
            daemonSessionToken: existing?.runtime.daemonSessionToken ?? null,
            eventSubscriptionId: existing?.runtime.eventSubscriptionId ?? null,
            lastEventSequence: existing?.runtime.lastEventSequence ?? 0,
            lastEventSyncAt: existing?.runtime.lastEventSyncAt ?? null,
            eventBridgeSupported: existing?.runtime.eventBridgeSupported ?? true,
            eventBridgeError: existing?.runtime.eventBridgeError ?? null,
            eventQueuePending: existing?.runtime.eventQueuePending ?? 0,
            eventQueueReady: existing?.runtime.eventQueueReady ?? 0,
            eventQueueBackoff: existing?.runtime.eventQueueBackoff ?? 0,
            lastCommandCursor: existing?.runtime.lastCommandCursor ?? 0,
            lastCommandSyncAt: existing?.runtime.lastCommandSyncAt ?? null,
            commandBridgeSupported: existing?.runtime.commandBridgeSupported ?? true,
            commandBridgeError: existing?.runtime.commandBridgeError ?? null,
            recoveryState: existing?.runtime.recoveryState ?? 'healthy',
            consecutiveFailures: existing?.runtime.consecutiveFailures ?? 0,
            lastHealthyAt: existing?.runtime.lastHealthyAt ?? null,
            lastRecoveryAt: existing?.runtime.lastRecoveryAt ?? null
        };

    const state: ConnectorState = {
        machineId: existing?.machineId ?? randomUUID(),
        tenantId: options.tenantId ?? existing?.tenantId ?? null,
        uiUrl: options.uiUrl,
        registeredAt: existing?.registeredAt ?? now,
        updatedAt: now,
        registrationMode: options.registrationMode ?? existing?.registrationMode ?? 'local',
        cloud: {
            registrationId: options.cloud?.registrationId ?? existing?.cloud.registrationId ?? null,
            streamUrl: options.cloud?.streamUrl ?? existing?.cloud.streamUrl ?? null,
            capabilities: options.cloud?.capabilities ?? existing?.cloud.capabilities ?? [],
            lastHeartbeatAt: existing?.cloud.lastHeartbeatAt ?? null,
            lastError: existing?.cloud.lastError ?? null
        },
        runtime: {
            daemonSessionToken: options.runtime?.daemonSessionToken ?? baseRuntime.daemonSessionToken,
            eventSubscriptionId: options.runtime?.eventSubscriptionId ?? baseRuntime.eventSubscriptionId,
            lastEventSequence: options.runtime?.lastEventSequence ?? baseRuntime.lastEventSequence,
            lastEventSyncAt: options.runtime?.lastEventSyncAt ?? baseRuntime.lastEventSyncAt,
            eventBridgeSupported: options.runtime?.eventBridgeSupported ?? baseRuntime.eventBridgeSupported,
            eventBridgeError: options.runtime?.eventBridgeError ?? baseRuntime.eventBridgeError,
            eventQueuePending: options.runtime?.eventQueuePending ?? baseRuntime.eventQueuePending,
            eventQueueReady: options.runtime?.eventQueueReady ?? baseRuntime.eventQueueReady,
            eventQueueBackoff: options.runtime?.eventQueueBackoff ?? baseRuntime.eventQueueBackoff,
            lastCommandCursor: options.runtime?.lastCommandCursor ?? baseRuntime.lastCommandCursor,
            lastCommandSyncAt: options.runtime?.lastCommandSyncAt ?? baseRuntime.lastCommandSyncAt,
            commandBridgeSupported: options.runtime?.commandBridgeSupported ?? baseRuntime.commandBridgeSupported,
            commandBridgeError: options.runtime?.commandBridgeError ?? baseRuntime.commandBridgeError,
            recoveryState: options.runtime?.recoveryState ?? baseRuntime.recoveryState,
            consecutiveFailures: options.runtime?.consecutiveFailures ?? baseRuntime.consecutiveFailures,
            lastHealthyAt: options.runtime?.lastHealthyAt ?? baseRuntime.lastHealthyAt,
            lastRecoveryAt: options.runtime?.lastRecoveryAt ?? baseRuntime.lastRecoveryAt
        }
    };

    writeConnectorState(state);
    return { state, created: !existing };
}
