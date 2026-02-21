export interface DaemonRequest {
    method: string;
    params?: Record<string, unknown>;
    requestId?: string;
    sessionToken?: string;
    apiVersion?: string;
}

export interface DaemonResponse {
    ok: boolean;
    requestId?: string;
    result?: unknown;
    error?: string;
}
