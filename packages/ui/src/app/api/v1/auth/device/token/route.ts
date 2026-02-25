/**
 * Device-Code Token Exchange Endpoint
 *
 * CLI polls this endpoint with the device_code to exchange for access + refresh tokens
 * once the user has authorized in the browser.
 *
 * Returns:
 *   - 200 with tokens on success
 *   - 400 with { error: "authorization_pending" } while user hasn't authorized yet
 *   - 400 with { error: "slow_down" } if polling too fast
 *   - 400 with { error: "expired_token" } if the device code expired
 */
import { NextRequest } from 'next/server';
import { correlationId, errorResponse, jsonResponse } from '@/lib/bff';

const AUTH0_ISSUER = process.env.AUTH0_ISSUER_BASE_URL ?? '';
const AUTH0_CLIENT_ID = process.env.AUTH0_CLIENT_ID ?? '';

export async function POST(request: NextRequest) {
  if (!AUTH0_ISSUER || !AUTH0_CLIENT_ID) {
    return errorResponse(
      503,
      'auth_not_configured',
      'Auth0 is not configured on this deployment.',
      false,
      correlationId()
    );
  }

  let body: { deviceCode?: string } = {};
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'invalid_request', 'Missing request body.');
  }

  if (!body.deviceCode) {
    return errorResponse(400, 'invalid_request', 'deviceCode is required.');
  }

  try {
    const tokenUrl = `${AUTH0_ISSUER}/oauth/token`;
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: AUTH0_CLIENT_ID,
        device_code: body.deviceCode
      })
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

    // Authorization still pending or other expected Auth0 errors
    if (!res.ok) {
      if (data.error === 'authorization_pending' || data.error === 'slow_down') {
        return jsonResponse({ error: data.error, errorDescription: data.error_description }, 400);
      }
      if (data.error === 'expired_token') {
        return jsonResponse({ error: 'expired_token', errorDescription: 'The device code has expired.' }, 400);
      }
      if (data.error === 'access_denied') {
        return jsonResponse({ error: 'access_denied', errorDescription: 'Authorization was denied.' }, 403);
      }
      return errorResponse(
        502,
        'token_exchange_failed',
        data.error_description ?? `Token exchange failed: ${res.status}`,
        true,
        correlationId()
      );
    }

    return jsonResponse({
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      idToken: data.id_token ?? null,
      tokenType: data.token_type ?? 'Bearer',
      expiresIn: data.expires_in ?? 3600
    });
  } catch (err) {
    return errorResponse(
      502,
      'token_exchange_error',
      err instanceof Error ? err.message : 'Token exchange request failed',
      true,
      correlationId()
    );
  }
}
