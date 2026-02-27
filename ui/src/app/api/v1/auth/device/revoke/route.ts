/**
 * Device-Code Token Revocation Endpoint
 *
 * CLI calls this when rotating tokens to revoke the old refresh token.
 * Proxies to Auth0's /oauth/revoke endpoint (RFC 7009).
 *
 * POST { token: string, tokenTypeHint?: "refresh_token" | "access_token" }
 * → 200 { ok: true } on success or if token was already invalid
 * → 400 { error, errorDescription } on bad request
 *
 * Note: Auth0 may return 200 even for already-revoked tokens (idempotent).
 */
import { NextRequest } from 'next/server';
import { correlationId, errorResponse, jsonResponse } from '@/lib/bff';

const AUTH0_ISSUER = process.env.AUTH0_ISSUER_BASE_URL ?? '';
const AUTH0_CLIENT_ID = process.env.AUTH0_CLIENT_ID ?? '';

export async function POST(request: NextRequest) {
  if (!AUTH0_ISSUER || !AUTH0_CLIENT_ID) {
    return errorResponse(503, 'auth_not_configured', 'Auth0 is not configured.', false, correlationId());
  }

  let body: { token?: string; tokenTypeHint?: string } = {};
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'invalid_request', 'Missing request body.');
  }

  if (!body.token) {
    return errorResponse(400, 'invalid_request', 'token is required.');
  }

  try {
    const params: Record<string, string> = {
      client_id: AUTH0_CLIENT_ID,
      token: body.token,
    };
    if (body.tokenTypeHint) {
      params.token_type_hint = body.tokenTypeHint;
    }

    const res = await fetch(`${AUTH0_ISSUER}/oauth/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string; error_description?: string };
      return jsonResponse(
        { error: data.error ?? 'revoke_failed', errorDescription: data.error_description ?? `Auth0 returned ${res.status}` },
        res.status
      );
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return errorResponse(502, 'revoke_error', err instanceof Error ? err.message : 'Revocation request failed', true, correlationId());
  }
}
