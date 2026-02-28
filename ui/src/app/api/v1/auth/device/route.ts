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
// AUTH0_DEVICE_CLIENT_ID must be a "Native" application in Auth0 to support
// the Device Code grant (RFC 8628). Falls back to AUTH0_CLIENT_ID so that
// existing deployments continue to surface a clear 503 until configured.
const AUTH0_CLIENT_ID =
  process.env.AUTH0_DEVICE_CLIENT_ID ?? process.env.AUTH0_CLIENT_ID ?? '';
const CTX_UI_BASE_URL = process.env.CTX_UI_BASE_URL ?? 'http://localhost:3000';
// Audience must match the API Identifier configured in the Auth0 dashboard.
// Set AUTH0_AUDIENCE to match exactly what's in manage.auth0.com → APIs.
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE ?? 'https://0ctx.com/api';

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
        audience: AUTH0_AUDIENCE
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

    // Use our branded /auth/device page instead of the raw Auth0 activation
    // URL so users land on the 0ctx-branded page. verificationUriComplete
    // pre-fills the user code via query param so they don't have to type it.
    const verificationUri = `${CTX_UI_BASE_URL}/auth/device`;
    const verificationUriComplete = `${CTX_UI_BASE_URL}/auth/device?user_code=${encodeURIComponent(data.user_code)}`;

    return jsonResponse({
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri,
      verificationUriComplete,
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
