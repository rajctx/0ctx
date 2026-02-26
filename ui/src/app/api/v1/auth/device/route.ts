/**
 * Device-Code OAuth2 Authorization Endpoint
 *
 * Implements the server side of the device authorization grant (RFC 8628) for
 * CLI-to-hosted-cloud authentication.
 *
 * Flow:
 *   1. CLI calls POST /api/v1/auth/device  → receives { deviceCode, userCode, verificationUri, ... }
 *   2. User opens verificationUri in browser, enters userCode, authorizes
 *   3. CLI polls POST /api/v1/auth/device/token  → receives access/refresh tokens (or "authorization_pending")
 *
 * This route proxies device-code requests to Auth0's device authorization endpoint.
 */
import { NextRequest, NextResponse } from 'next/server';
import { correlationId, errorResponse, jsonResponse } from '@/lib/bff';

const AUTH0_ISSUER = process.env.AUTH0_ISSUER_BASE_URL ?? '';
const AUTH0_CLIENT_ID = process.env.AUTH0_CLIENT_ID ?? '';
const CTX_UI_BASE_URL = process.env.CTX_UI_BASE_URL ?? 'http://localhost:3000';

// ─── POST: Initiate device authorization ──────────────────────────────────────

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

  let body: { scope?: string } = {};
  try {
    body = await request.json();
  } catch {
    // default scope
  }

  const scope = body.scope ?? 'openid profile email offline_access';

  try {
    const deviceAuthUrl = `${AUTH0_ISSUER}/oauth/device/code`;
    const res = await fetch(deviceAuthUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: AUTH0_CLIENT_ID,
        scope,
        audience: `${CTX_UI_BASE_URL}/api`
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'Unknown error');
      return errorResponse(
        502,
        'device_auth_upstream_error',
        `Auth0 device authorization failed: ${res.status} ${errText}`,
        true,
        correlationId()
      );
    }

    const data = (await res.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      verification_uri_complete: string;
      expires_in: number;
      interval: number;
    };

    return jsonResponse({
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: `${CTX_UI_BASE_URL}/auth/device`,
      verificationUriComplete: data.verification_uri_complete,
      expiresIn: data.expires_in,
      interval: data.interval
    });
  } catch (err) {
    return errorResponse(
      502,
      'device_auth_error',
      err instanceof Error ? err.message : 'Device authorization request failed',
      true,
      correlationId()
    );
  }
}

// ─── GET: Health / introspection ──────────────────────────────────────────────

export async function GET() {
  return NextResponse.json({
    grant: 'urn:ietf:params:oauth:grant-type:device_code',
    configured: Boolean(AUTH0_ISSUER && AUTH0_CLIENT_ID),
    verificationUri: `${CTX_UI_BASE_URL}/auth/device`
  });
}
