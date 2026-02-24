import http from 'http';
import https from 'https';
import { getConfigValue } from '@0ctx/core';

const DEFAULT_CONTROL_PLANE_BASE_URL = 'https://api.0ctx.com/v1';
const DEFAULT_TIMEOUT_MS = 10_000;

interface CloudRequestOptions {
    method: 'GET' | 'POST';
    path: string;
    token: string;
    body?: unknown;
    query?: Record<string, string | number | null | undefined>;
}

export interface CloudApiResult<T> {
    ok: boolean;
    statusCode: number;
    data?: T;
    error?: string;
}

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
    error?: string;
}

export interface ConnectorCommandAckResponse {
    accepted?: boolean;
}

function parseTimeoutMs(): number {
    const raw = process.env.CTX_CONTROL_PLANE_TIMEOUT_MS;
    if (!raw) return DEFAULT_TIMEOUT_MS;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
    return parsed;
}

export function getControlPlaneBaseUrl(): string {
    const explicit = process.env.CTX_CONTROL_PLANE_URL?.trim();
    if (explicit) return explicit.replace(/\/$/, '');

    try {
        const syncEndpoint = getConfigValue('sync.endpoint');
        const parsed = new URL(syncEndpoint);
        const normalizedPath = parsed.pathname.replace(/\/+$/, '');
        const withoutSync = normalizedPath.endsWith('/sync')
            ? normalizedPath.slice(0, -('/sync'.length))
            : normalizedPath;

        parsed.pathname = withoutSync || '/v1';
        parsed.search = '';
        parsed.hash = '';

        return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/, '');
    } catch {
        return DEFAULT_CONTROL_PLANE_BASE_URL;
    }
}

function buildUrl(path: string, query?: Record<string, string | number | null | undefined>): URL {
    const normalizedPath = path.replace(/^\/+/, '');
    const base = `${getControlPlaneBaseUrl().replace(/\/$/, '')}/`;
    const url = new URL(normalizedPath, base);

    if (query) {
        for (const [key, value] of Object.entries(query)) {
            if (value === undefined || value === null) continue;
            url.searchParams.set(key, String(value));
        }
    }

    return url;
}

async function requestJson<T>(options: CloudRequestOptions): Promise<CloudApiResult<T>> {
    const url = buildUrl(options.path, options.query);
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);

    return new Promise((resolve) => {
        const transport = url.protocol === 'https:' ? https : http;
        const req = transport.request(
            {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + url.search,
                method: options.method,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${options.token}`,
                    ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
                },
                timeout: parseTimeoutMs()
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    const statusCode = res.statusCode ?? 0;
                    const text = Buffer.concat(chunks).toString('utf8');

                    if (statusCode >= 200 && statusCode < 300) {
                        if (!text.trim()) {
                            resolve({ ok: true, statusCode, data: {} as T });
                            return;
                        }
                        try {
                            resolve({ ok: true, statusCode, data: JSON.parse(text) as T });
                        } catch {
                            resolve({ ok: true, statusCode, data: {} as T });
                        }
                        return;
                    }

                    let error = `HTTP ${statusCode}`;
                    if (text.trim()) {
                        try {
                            const parsed = JSON.parse(text) as { error?: string; message?: string };
                            error = parsed.error || parsed.message || error;
                        } catch {
                            error = `${error}: ${text.slice(0, 200)}`;
                        }
                    }

                    resolve({ ok: false, statusCode, error });
                });
            }
        );

        req.on('error', (err) => {
            resolve({
                ok: false,
                statusCode: 0,
                error: err instanceof Error ? err.message : String(err)
            });
        });

        req.on('timeout', () => {
            req.destroy(new Error('Request timed out'));
        });

        if (payload) req.write(payload);
        req.end();
    });
}

async function requestWithFallback<T>(
    options: Omit<CloudRequestOptions, 'path'>,
    paths: string[]
): Promise<CloudApiResult<T>> {
    let last: CloudApiResult<T> | null = null;
    for (const path of paths) {
        const result = await requestJson<T>({ ...options, path });
        if (result.ok) return result;
        last = result;
        if (result.statusCode !== 404) break;
    }

    return last ?? { ok: false, statusCode: 0, error: 'Cloud request failed' };
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
