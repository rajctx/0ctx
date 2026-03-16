import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

export interface ConnectorRuntimeState {
    eventQueuePending: number;
    eventQueueReady: number;
    eventQueueBackoff: number;
    recoveryState?: 'healthy' | 'recovering' | 'backoff' | 'blocked';
    consecutiveFailures?: number;
    lastHealthyAt?: number | null;
    lastRecoveryAt?: number | null;
}

export interface ConnectorState {
    machineId: string;
    uiUrl: string;
    registeredAt: number;
    updatedAt: number;
    runtime: ConnectorRuntimeState;
}

export interface RegisterConnectorOptions {
    uiUrl: string;
    force?: boolean;
    runtime?: Partial<ConnectorRuntimeState>;
}

export function getConnectorStatePath(): string {
    return process.env.CTX_CONNECTOR_STATE_PATH || path.join(os.homedir(), '.0ctx', 'connector.json');
}

export function readConnectorState(): ConnectorState | null {
    try {
        const filePath = getConnectorStatePath();
        if (!fs.existsSync(filePath)) return null;
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<ConnectorState> & {
            runtime?: Partial<ConnectorRuntimeState>;
        };
        if (!parsed.machineId || !parsed.uiUrl || !parsed.registeredAt) return null;
        return {
            machineId: parsed.machineId,
            uiUrl: parsed.uiUrl,
            registeredAt: parsed.registeredAt,
            updatedAt: parsed.updatedAt ?? parsed.registeredAt,
            runtime: {
                eventQueuePending: typeof parsed.runtime?.eventQueuePending === 'number' ? parsed.runtime.eventQueuePending : 0,
                eventQueueReady: typeof parsed.runtime?.eventQueueReady === 'number' ? parsed.runtime.eventQueueReady : 0,
                eventQueueBackoff: typeof parsed.runtime?.eventQueueBackoff === 'number' ? parsed.runtime.eventQueueBackoff : 0,
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

    const baseRuntime: ConnectorRuntimeState = {
        eventQueuePending: existing?.runtime.eventQueuePending ?? 0,
        eventQueueReady: existing?.runtime.eventQueueReady ?? 0,
        eventQueueBackoff: existing?.runtime.eventQueueBackoff ?? 0,
        recoveryState: existing?.runtime.recoveryState ?? 'healthy',
        consecutiveFailures: existing?.runtime.consecutiveFailures ?? 0,
        lastHealthyAt: existing?.runtime.lastHealthyAt ?? null,
        lastRecoveryAt: existing?.runtime.lastRecoveryAt ?? null
    };

    const state: ConnectorState = {
        machineId: existing?.machineId ?? randomUUID(),
        uiUrl: options.uiUrl,
        registeredAt: existing?.registeredAt ?? now,
        updatedAt: now,
        runtime: {
            eventQueuePending: options.runtime?.eventQueuePending ?? baseRuntime.eventQueuePending,
            eventQueueReady: options.runtime?.eventQueueReady ?? baseRuntime.eventQueueReady,
            eventQueueBackoff: options.runtime?.eventQueueBackoff ?? baseRuntime.eventQueueBackoff,
            recoveryState: options.runtime?.recoveryState ?? baseRuntime.recoveryState,
            consecutiveFailures: options.runtime?.consecutiveFailures ?? baseRuntime.consecutiveFailures,
            lastHealthyAt: options.runtime?.lastHealthyAt ?? baseRuntime.lastHealthyAt,
            lastRecoveryAt: options.runtime?.lastRecoveryAt ?? baseRuntime.lastRecoveryAt
        }
    };

    writeConnectorState(state);
    return { state, created: !existing };
}
