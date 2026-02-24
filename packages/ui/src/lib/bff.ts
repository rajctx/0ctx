import { randomUUID } from 'crypto';
import { auth0 } from '@/lib/auth0';

const CONTROL_PLANE_URL =
  process.env.CTX_CONTROL_PLANE_URL || 'http://127.0.0.1:8787';
const BFF_TIMEOUT_MS = Number(process.env.CTX_BFF_TIMEOUT_MS) || 30_000;

export type RuntimePosture = 'connected' | 'degraded' | 'offline';
export type SyncPolicy = 'local_only' | 'metadata_only' | 'full_sync';
export type OnboardingStepStatus = 'todo' | 'in_progress' | 'blocked' | 'done';

export interface BffErrorEnvelope {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    correlationId: string;
  };
}

export function correlationId(): string {
  return `req_${randomUUID()}`;
}

export function errorEnvelope(
  code: string,
  message: string,
  retryable = false,
  corrId?: string
): BffErrorEnvelope {
  return {
    error: {
      code,
      message,
      retryable,
      correlationId: corrId ?? correlationId()
    }
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  retryable = false,
  corrId?: string
): Response {
  return jsonResponse(errorEnvelope(code, message, retryable, corrId), status);
}

/**
 * Resolve Auth0 session. Returns access token string or null.
 * For dev without Auth0 configured, falls back to CTX_BFF_DEV_TOKEN env var.
 */
export async function resolveSession(): Promise<string | null> {
  try {
    const session = await auth0.getSession();
    if (session?.tokenSet?.accessToken) {
      return session.tokenSet.accessToken;
    }
  } catch {
    // Auth0 not configured or session unavailable.
  }

  // Dev fallback: allow a static token for local development.
  const devToken = process.env.CTX_BFF_DEV_TOKEN;
  if (devToken) return devToken;

  return null;
}

/**
 * Require a valid session, returning the token.
 * Returns [token, null] on success or [null, Response] on failure.
 */
export async function requireSession(): Promise<
  [string, null] | [null, Response]
> {
  const token = await resolveSession();
  if (!token) {
    return [
      null,
      errorResponse(401, 'unauthorized', 'Authentication required.')
    ];
  }
  return [token, null];
}

/** HTTP call to control-plane API. */
export async function cpFetch(
  path: string,
  options: {
    method?: string;
    token: string;
    body?: unknown;
    timeoutMs?: number;
  }
): Promise<Response> {
  const url = `${CONTROL_PLANE_URL}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? BFF_TIMEOUT_MS
  );

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json'
    };

    const fetchOptions: RequestInit = {
      method: options.method ?? 'GET',
      headers,
      signal: controller.signal
    };

    if (options.body !== undefined) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    return await fetch(url, fetchOptions);
  } finally {
    clearTimeout(timeout);
  }
}

/** Parse JSON from a control-plane response, returning null on failure. */
export async function cpJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Execute a command on a connector via the control-plane command bridge.
 * Uses the synchronous /v1/connectors/commands/exec endpoint.
 */
export async function cpExecCommand(
  token: string,
  machineId: string,
  method: string,
  params: Record<string, unknown> = {},
  options: { contextId?: string; timeoutMs?: number } = {}
): Promise<{ ok: boolean; result: unknown; error?: string }> {
  const res = await cpFetch('/v1/connectors/commands/exec', {
    method: 'POST',
    token,
    body: {
      machineId,
      method,
      params,
      contextId: options.contextId ?? null,
      timeoutMs: options.timeoutMs ?? 15_000
    },
    timeoutMs: (options.timeoutMs ?? 15_000) + 5_000
  });

  const data = await cpJson<{
    ok?: boolean;
    result?: unknown;
    error?: string;
    status?: string;
  }>(res);

  if (!res.ok || !data) {
    return {
      ok: false,
      result: null,
      error: data?.error ?? `Control-plane returned ${res.status}`
    };
  }

  return {
    ok: data.ok !== false && data.status !== 'failed',
    result: data.result ?? data,
    error: data.error
  };
}

/**
 * Resolve the connector machineId for the current session.
 * In production this would come from tenant/session metadata.
 * For dev, falls back to CTX_CONNECTOR_MACHINE_ID env var or hostname.
 */
export function resolveMachineId(): string {
  return (
    process.env.CTX_CONNECTOR_MACHINE_ID ||
    process.env.HOSTNAME ||
    'dev-machine'
  );
}
