import { randomUUID, createHmac } from 'crypto';
import { auth0 } from '@/lib/auth0';

const CONTROL_PLANE_URL =
  process.env.CTX_CONTROL_PLANE_URL || 'http://127.0.0.1:8787';
const BFF_TIMEOUT_MS = Number(process.env.CTX_BFF_TIMEOUT_MS) || 30_000;
const BFF_RATE_LIMIT_RPM = Number(process.env.CTX_BFF_RATE_LIMIT_RPM) || 300;
const CP_SIGNING_SECRET = process.env.CTX_CP_SIGNING_SECRET || '';

// ─── SEC-001: Rate limiting (in-memory sliding window) ────────────────────────

const rateLimitBuckets = new Map<string, number[]>();

/**
 * Check if a request should be rate-limited.
 * Uses a per-IP sliding window of RPM.
 */
export function checkRateLimit(clientIp: string): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  let bucket = rateLimitBuckets.get(clientIp);
  if (!bucket) {
    bucket = [];
    rateLimitBuckets.set(clientIp, bucket);
  }
  // Prune expired entries
  while (bucket.length > 0 && bucket[0] < now - windowMs) bucket.shift();
  if (bucket.length >= BFF_RATE_LIMIT_RPM) return false; // rate limited
  bucket.push(now);
  return true;
}

// ─── SEC-001: CSRF validation ─────────────────────────────────────────────────

/**
 * Validate CSRF for state-mutating BFF requests.
 * Checks that Origin or Referer matches the app host.
 * Returns true if request is safe, false if CSRF suspected.
 */
export function validateCsrf(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;

  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const host = request.headers.get('host');

  if (!host) return true; // Can't validate without host

  if (origin) {
    try {
      const originHost = new URL(origin).host;
      return originHost === host;
    } catch {
      return false;
    }
  }

  if (referer) {
    try {
      const refererHost = new URL(referer).host;
      return refererHost === host;
    } catch {
      return false;
    }
  }

  // No Origin or Referer — allow for same-origin server actions
  return true;
}

// ─── SEC-001: Request signing for control-plane calls ─────────────────────────

/**
 * Sign a request body with HMAC-SHA256 for control-plane verification.
 * Returns headers to attach. No-op if CTX_CP_SIGNING_SECRET is not set.
 */
export function signRequest(body: string): Record<string, string> {
  if (!CP_SIGNING_SECRET) return {};
  const timestamp = Date.now().toString();
  const signature = createHmac('sha256', CP_SIGNING_SECRET)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return {
    'X-CTX-Timestamp': timestamp,
    'X-CTX-Signature': signature
  };
}

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

export function jsonResponse(body: unknown, status = 200, requestId?: string): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (requestId) headers['X-Request-Id'] = requestId;
  return new Response(JSON.stringify(body), { status, headers });
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
    requestId?: string;
  }
): Promise<Response> {
  const url = `${CONTROL_PLANE_URL}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? BFF_TIMEOUT_MS
  );

  try {
    const bodyStr = options.body !== undefined ? JSON.stringify(options.body) : undefined;
    const reqId = options.requestId ?? correlationId();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
      'X-Request-Id': reqId,
      ...signRequest(bodyStr ?? '')
    };

    const fetchOptions: RequestInit = {
      method: options.method ?? 'GET',
      headers,
      signal: controller.signal
    };

    if (bodyStr !== undefined) {
      fetchOptions.body = bodyStr;
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
