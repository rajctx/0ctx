import type { TokenStore } from '../auth.js';
import type { ConnectorState } from '../connector.js';
import type { ConnectorEventPayload } from '../cloud.js';

const DEFAULT_INTERVAL_MS = 5_000;
const MIN_INTERVAL_MS = 1_000;
const CLOUD_COMMAND_METHOD_ALLOWLIST = new Set([
    'listContexts',
    'getGraphData',
    'createContext',
    'deleteContext',
    'addNode',
    'updateNode',
    'deleteNode',
    'listRecallFeedback',
    'recallFeedback',
    'evaluateCompletion',
    'listAuditEvents',
    'getSyncPolicy',
    'listBackups',
    'createBackup',
    'restoreBackup',
    'addEdge',
    'saveCheckpoint',
    'resolveGate',
    'setSyncPolicy'
]);

export function redactEventForMetadataOnly(event: ConnectorEventPayload): ConnectorEventPayload {
    const payload = event.payload ?? {};
    const method = typeof payload.method === 'string' ? payload.method : null;
    const result = typeof payload.result === 'object' && payload.result !== null ? (payload.result as Record<string, unknown>) : null;
    const contextId = typeof payload.contextId === 'string' ? payload.contextId : null;
    const id = typeof payload.id === 'string' ? payload.id : null;

    return {
        eventId: event.eventId,
        sequence: event.sequence,
        contextId: event.contextId,
        type: event.type,
        timestamp: event.timestamp,
        source: event.source,
        payload: {
            mode: 'metadata_only',
            ...(method ? { method } : {}),
            ...(contextId ? { contextId } : {}),
            ...(id ? { id } : {}),
            ...(result ? { result } : {})
        }
    };
}

export function isMethodAllowedForCloudCommand(method: string): boolean {
    return CLOUD_COMMAND_METHOD_ALLOWLIST.has(method);
}

export function deriveRecoveryState(options: {
    daemonOk: boolean;
    token: TokenStore | null;
    registration: ConnectorState | null;
    cloudConnected: boolean;
    lastError: string | null;
}): 'healthy' | 'recovering' | 'backoff' | 'blocked' {
    if (!options.daemonOk) return 'blocked';
    if (!options.token || !options.registration) return 'recovering';
    if (
        options.registration.runtime.eventQueueBackoff > 0 ||
        Boolean(options.registration.runtime.eventBridgeError) ||
        Boolean(options.registration.runtime.commandBridgeError) ||
        Boolean(options.lastError)
    ) {
        return 'backoff';
    }
    if (options.registration.registrationMode === 'cloud' && !options.cloudConnected) {
        return 'recovering';
    }
    return 'healthy';
}

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function normalizeIntervalMs(intervalMs: number | undefined): number {
    if (!intervalMs || !Number.isFinite(intervalMs)) return DEFAULT_INTERVAL_MS;
    return Math.max(MIN_INTERVAL_MS, intervalMs);
}
