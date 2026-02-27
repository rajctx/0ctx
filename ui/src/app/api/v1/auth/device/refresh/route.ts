/**
 * Device-Code Token Refresh Endpoint
 *
 * CLI uses this to refresh an expired access token using its refresh token.
 * Proxies the refresh_token grant to Auth0 and returns new tokens with
 * email / tenantId decoded from the id_token (when returned).
 *
 * POST { refreshToken: string }
 * → 200 { accessToken, refreshToken, tokenType, expiresIn, email, tenantId }
 * → 400/401 { error, errorDescription } on invalid / expired refresh token
 */
import { NextRequest } from 'next/server';
import { correlationId, errorResponse, jsonResponse } from '@/lib/bff';

const AUTH0_ISSUER = process.env.AUTH0_ISSUER_BASE_URL ?? '';
const AUTH0_CLIENT_ID = process.env.AUTH0_CLIENT_ID ?? '';

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const [, payloadB64] = token.split('.');
    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  if (!AUTH0_ISSUER || !AUTH0_CLIENT_ID) {
    return errorResponse(503, 'auth_not_configured', 'Auth0 is not configured.', false, correlationId());
  }

  let body: { refreshToken?: string } = {};
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'invalid_request', 'Missing request body.');
  }

  if (!body.refreshToken) {
    return errorResponse(400, 'invalid_request', 'refreshToken is required.');
  }

  try {
    const res = await fetch(`${AUTH0_ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: AUTH0_CLIENT_ID,
        refresh_token: body.refreshToken,
      }),
    });

    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      id_token?: string;
      token_type?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!res.ok || !data.access_token) {
      return jsonResponse(
        { error: data.error ?? 'refresh_failed', errorDescription: data.error_description ?? `Auth0 returned ${res.status}` },
        res.ok ? 400 : res.status
      );
    }

    let email: string | null = null;
    let tenantId: string | null = null;
    if (data.id_token) {
      const claims = decodeJwtPayload(data.id_token);
      if (claims) {
        email = typeof claims.email === 'string' ? claims.email : null;
        tenantId = typeof claims['https://0ctx.com/tenant_id'] === 'string'
          ? (claims['https://0ctx.com/tenant_id'] as string)
          : null;
      }
    }

    return jsonResponse({
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      tokenType: data.token_type ?? 'Bearer',
      expiresIn: data.expires_in ?? 3600,
      email,
      tenantId,
    });
  } catch (err) {
    return errorResponse(502, 'refresh_error', err instanceof Error ? err.message : 'Refresh request failed', true, correlationId());
  }
}
