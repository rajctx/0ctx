import { randomUUID } from 'crypto';
import { headers as getRequestHeaders } from 'next/headers';
import { auth0 } from '@/lib/auth0';
import { getStore } from '@/lib/store';

const BFF_RATE_LIMIT_RPM = Number(process.env.CTX_BFF_RATE_LIMIT_RPM) || 300;

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
 * Resolve Auth0 session. Returns the access token string or null.
 * Works for both browser sessions (Auth0 cookie) and CLI connectors
 * (device-code bearer token forwarded via Authorization header).
 *
 * Priority:
 *  1. Auth0 cookie session (browser / dashboard)
 *  2. Authorization: Bearer <token> header (CLI / daemon device-code flow)
 */
export async function resolveSession(): Promise<string | null> {
  // 1. Try cookie-based Auth0 session first (browser sessions).
  try {
    const session = await auth0.getSession();
    if (session?.tokenSet?.accessToken) {
      return session.tokenSet.accessToken;
    }
  } catch {
    // Auth0 not configured or session unavailable.
  }

  // 2. Fall back to Authorization: Bearer header (CLI / daemon).
  //    The token is a valid Auth0 JWT issued via the device-code flow.
  try {
    const hdrs = await getRequestHeaders();
    const authorization = hdrs.get('authorization');
    if (authorization?.startsWith('Bearer ')) {
      const token = authorization.slice('Bearer '.length).trim();
      if (token) return token;
    }
  } catch {
    // headers() is only available inside a request context.
  }

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

// ─── Token claim extraction ────────────────────────────────────────────────────

export interface TokenClaims {
  /** Auth0 user subject (e.g. "auth0|abc123") */
  sub: string;
  /** Tenant ID injected by Auth0 Action as the custom claim https://0ctx.com/tenant_id */
  tenantId: string | null;
}

/**
 * Decode an already-verified Auth0 JWT access token's payload.
 * Does NOT re-verify the signature — Auth0 SDK already verified it.
 * Extracts `sub` and the `https://0ctx.com/tenant_id` custom claim.
 */
export function decodeTokenClaims(token: string): TokenClaims {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return { sub: '', tenantId: null };
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8')
    ) as Record<string, unknown>;
    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    const tenantId =
      typeof payload['https://0ctx.com/tenant_id'] === 'string'
        ? (payload['https://0ctx.com/tenant_id'] as string)
        : null;
    return { sub, tenantId };
  } catch {
    return { sub: '', tenantId: null };
  }
}

/**
 * Require a valid session and return the token + decoded JWT claims.
 * Returns [token, claims, null] on success or [null, null, Response] on failure.
 */
export async function requireTenantSession(): Promise<
  [string, TokenClaims, null] | [null, null, Response]
> {
  const [token, authErr] = await requireSession();
  if (authErr) return [null, null, authErr];
  const claims = decodeTokenClaims(token);
  return [token, claims, null];
}

/**
 * Execute a command on a connector via the in-process store.
 * Enqueues the command into Postgres and polls until the connector acks it.
 * tenantId must be provided — it is the authoritative identity from the JWT.
 */
export async function storeExecCommand(
  machineId: string,
  method: string,
  params: Record<string, unknown> = {},
  options: { contextId?: string; timeoutMs?: number; tenantId: string } = { tenantId: '' }
): Promise<{ ok: boolean; result: unknown; error?: string }> {
  if (!options.tenantId) {
    return { ok: false, result: null, error: 'tenantId is required to dispatch commands' };
  }
  const store = getStore();
  const connector = await store.getConnector(machineId, options.tenantId);
  if (!connector) {
    return { ok: false, result: null, error: 'Connector not registered' };
  }

  const command = await store.enqueueCommand(
    machineId,
    options.tenantId,
    method,
    params,
    options.contextId ?? null
  );

  // Connector runtime defaults to a short cadence; keep timeout bounded so
  // failed bridge calls surface quickly in UI.
  const pollTimeoutMs = Math.min(options.timeoutMs ?? 20_000, 120_000);
  const pollIntervalMs = 250;
  const deadline = Date.now() + pollTimeoutMs;

  while (Date.now() < deadline) {
    const current = await store.getCommand(command.commandId);
    if (current && current.status !== 'pending') {
      return {
        ok: current.status === 'applied',
        result: current.result ?? null,
        error: current.error
      };
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  return {
    ok: false,
    result: null,
    error: `Command not acknowledged within ${pollTimeoutMs}ms`
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

/**
 * Resolve a tenant-scoped machine id.
 * If `requestedMachineId` is provided, it must exist for this tenant.
 * Otherwise picks claims.sub when present in connector list, then freshest heartbeat.
 */
export async function resolveTenantMachineId(
  claims: TokenClaims,
  requestedMachineId?: string | null
): Promise<string | null> {
  if (!claims.tenantId) return null;
  const store = getStore();

  if (requestedMachineId) {
    const connector = await store.getConnector(requestedMachineId, claims.tenantId);
    return connector ? requestedMachineId : null;
  }

  const connectors = await store.getConnectorsByTenant(claims.tenantId);
  if (connectors.length === 0) return null;
  if (claims.sub && connectors.some(connector => connector.machineId === claims.sub)) {
    return claims.sub;
  }

  const sorted = [...connectors].sort((a, b) => {
    const aTs = typeof a.lastHeartbeatAt === 'number' ? a.lastHeartbeatAt : 0;
    const bTs = typeof b.lastHeartbeatAt === 'number' ? b.lastHeartbeatAt : 0;
    if (bTs !== aTs) return bTs - aTs;
    return a.machineId.localeCompare(b.machineId);
  });
  return sorted[0]?.machineId ?? null;
}
