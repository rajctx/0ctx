import { getConfigValue } from '@0ctx/core';

export const DEFAULT_AUTH_SERVER = 'https://www.0ctx.com';
export const DEFAULT_SCOPE = 'openid profile email offline_access';

export interface TokenStore {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    email: string;
    tenantId: string;
}

export interface DeviceCodeResponse {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval: number;
}

export interface TokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    email?: string;
    tenant_id?: string;
}

export interface BffError {
    code: string;
    message: string;
    retryable?: boolean;
    correlationId?: string;
}

export interface BffDeviceCodeResponse {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete?: string;
    expiresIn: number;
    interval: number;
    error?: BffError;
}

export interface BffTokenResponse {
    accessToken?: string;
    refreshToken?: string | null;
    idToken?: string | null;
    tokenType?: string;
    expiresIn?: number;
    email?: string | null;
    tenantId?: string | null;
    error?: BffError | string;
    errorDescription?: string;
}

export function bffErrorMessage(error: BffError | string | undefined): string {
    if (!error) return 'unknown error';
    if (typeof error === 'string') return error;
    return error.message ?? error.code ?? 'unknown error';
}

export function bffErrorCode(error: BffError | string | undefined): string | undefined {
    if (!error) return undefined;
    if (typeof error === 'string') return error;
    return error.code;
}

export function normalize0ctxHostedUrl(value: string): string {
    try {
        const parsed = new URL(value);
        if (parsed.hostname === '0ctx.com') parsed.hostname = 'www.0ctx.com';
        return parsed.toString();
    } catch {
        return value.replace(/^https:\/\/0ctx\.com(?=\/|$)/, 'https://www.0ctx.com');
    }
}

export function getAuthServer(): string {
    return normalize0ctxHostedUrl(getConfigValue('auth.server')).replace(/\/$/, '');
}
