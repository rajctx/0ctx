import { getControlPlaneBaseUrl, requestWithFallback, type CloudApiResult } from './cloud/request.js';

export { getControlPlaneBaseUrl };

export interface RegisterConnectorPayload {
    machineId: string;
    tenantId: string | null;
    uiUrl: string;
    platform: string;
}

export interface RegisterConnectorCloudResponse {
    registrationId?: string;
    streamUrl?: string;
    capabilities?: string[];
    tenantId?: string;
}

export interface ConnectorHeartbeatPayload {
    machineId: string;
    tenantId: string | null;
    posture: 'connected' | 'degraded' | 'offline';
    daemonRunning: boolean;
    syncEnabled: boolean;
    syncRunning: boolean;
    queue?: {
        pending: number;
        inFlight: number;
        failed: number;
        done: number;
    };
}

export interface ConnectorHeartbeatResponse {
    accepted?: boolean;
    serverTime?: string;
}

export interface ConnectorCapabilitiesResponse {
    capabilities?: string[];
    features?: string[];
    posture?: string;
}

export interface ConnectorEventPayload {
    eventId: string;
    sequence: number;
    contextId: string | null;
    type: string;
    timestamp: number;
    source: string;
    payload: Record<string, unknown>;
}

export interface ConnectorEventsIngestPayload {
    machineId: string;
    tenantId: string | null;
    subscriptionId: string;
    cursor: number;
    events: ConnectorEventPayload[];
}

export interface ConnectorEventsIngestResponse {
    accepted?: boolean;
    processed?: number;
}

export interface ConnectorCommand {
    commandId: string;
    cursor: number;
    contextId: string | null;
    method: string;
    params: Record<string, unknown>;
    createdAt?: number;
}

export interface ConnectorCommandsResponse {
    cursor?: number;
    commands?: ConnectorCommand[];
}

export interface ConnectorCommandAckPayload {
    machineId: string;
    tenantId: string | null;
    commandId: string;
    cursor: number;
    status: 'applied' | 'failed';
    result?: unknown;
    error?: string;
}

export interface ConnectorCommandAckResponse {
    accepted?: boolean;
}

const REGISTER_PATHS = ['connectors/register', 'connector/register'];
const HEARTBEAT_PATHS = ['connectors/heartbeat', 'connector/heartbeat'];
const CAPABILITIES_PATHS = ['connectors/capabilities', 'connector/capabilities'];
const EVENTS_INGEST_PATHS = ['connectors/events', 'connector/events'];
const COMMANDS_PATHS = ['connectors/commands', 'connector/commands'];
const COMMAND_ACK_PATHS = ['connectors/commands/ack', 'connector/commands/ack'];

export function registerConnectorInCloud(
    token: string,
    payload: RegisterConnectorPayload
): Promise<CloudApiResult<RegisterConnectorCloudResponse>> {
    return requestWithFallback<RegisterConnectorCloudResponse>(
        {
            method: 'POST',
            token,
            body: payload
        },
        REGISTER_PATHS
    );
}

export function sendConnectorHeartbeat(
    token: string,
    payload: ConnectorHeartbeatPayload
): Promise<CloudApiResult<ConnectorHeartbeatResponse>> {
    return requestWithFallback<ConnectorHeartbeatResponse>(
        {
            method: 'POST',
            token,
            body: payload
        },
        HEARTBEAT_PATHS
    );
}

export function fetchConnectorCapabilities(
    token: string,
    machineId: string
): Promise<CloudApiResult<ConnectorCapabilitiesResponse>> {
    return requestWithFallback<ConnectorCapabilitiesResponse>(
        {
            method: 'GET',
            token,
            query: { machineId }
        },
        CAPABILITIES_PATHS
    );
}

export function sendConnectorEvents(
    token: string,
    payload: ConnectorEventsIngestPayload
): Promise<CloudApiResult<ConnectorEventsIngestResponse>> {
    return requestWithFallback<ConnectorEventsIngestResponse>(
        {
            method: 'POST',
            token,
            body: payload
        },
        EVENTS_INGEST_PATHS
    );
}

export function fetchConnectorCommands(
    token: string,
    machineId: string,
    cursor = 0
): Promise<CloudApiResult<ConnectorCommandsResponse>> {
    return requestWithFallback<ConnectorCommandsResponse>(
        {
            method: 'GET',
            token,
            query: { machineId, cursor }
        },
        COMMANDS_PATHS
    );
}

export function ackConnectorCommand(
    token: string,
    payload: ConnectorCommandAckPayload
): Promise<CloudApiResult<ConnectorCommandAckResponse>> {
    return requestWithFallback<ConnectorCommandAckResponse>(
        {
            method: 'POST',
            token,
            body: payload
        },
        COMMAND_ACK_PATHS
    );
}

// SEC-001: Connector trust challenge verification

export interface TrustVerifyPayload {
    machineId: string;
    challengeResponse: string;
}

export interface TrustVerifyResponse {
    accepted?: boolean;
    trustLevel?: string;
}

const TRUST_VERIFY_PATHS = ['connectors/trust/verify', 'connector/trust/verify'];

export function verifyConnectorTrust(
    token: string,
    payload: TrustVerifyPayload
): Promise<CloudApiResult<TrustVerifyResponse>> {
    return requestWithFallback<TrustVerifyResponse>(
        {
            method: 'POST',
            token,
            body: payload
        },
        TRUST_VERIFY_PATHS
    );
}
