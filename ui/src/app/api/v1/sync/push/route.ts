/**
 * POST /api/v1/sync/push
 *
 * Receives an encrypted SyncEnvelope from the daemon sync engine and stores it.
 * The daemon calls this endpoint for every context it needs to sync to the cloud.
 *
 * Security:
 *  - Requires valid Auth0 session (Bearer token from `0ctx auth login`)
 *  - tenantId from JWT must match envelope.tenantId (prevents cross-tenant writes)
 *  - local_only envelopes are rejected immediately (daemon should never send them)
 */

import { getStore } from '@/lib/store';
import { requireTenantSession, errorResponse, jsonResponse } from '@/lib/bff';

export async function POST(request: Request) {
  const [, claims, authErr] = await requireTenantSession();
  if (authErr) return authErr;

  const tenantId = claims.tenantId;
  if (!tenantId) {
    return errorResponse(403, 'no_tenant', 'No tenant associated with this account.');
  }

  let envelope: Record<string, unknown>;
  try {
    envelope = await request.json() as Record<string, unknown>;
  } catch {
    return errorResponse(400, 'invalid_json', 'Request body must be valid JSON.');
  }

  // Basic shape validation
  if (envelope.version !== 1) {
    return errorResponse(400, 'invalid_version', 'Only sync envelope version 1 is supported.');
  }
  if (typeof envelope.contextId !== 'string' || !envelope.contextId) {
    return errorResponse(400, 'missing_context_id', 'Envelope must include a contextId.');
  }

  // Security: if the envelope carries a tenantId, it must match the JWT tenant
  if (envelope.tenantId && envelope.tenantId !== tenantId) {
    return errorResponse(403, 'tenant_mismatch', 'Envelope tenantId does not match authenticated tenant.');
  }

  // local_only envelopes should never reach the server — daemon bug if they do
  if (envelope.syncPolicy === 'local_only') {
    return jsonResponse({ ok: true, skipped: true, reason: 'local_only' });
  }

  if (!envelope.payload) {
    return errorResponse(400, 'missing_payload', 'Envelope must include a payload.');
  }

  try {
    const store = getStore();
    await store.storeSyncEnvelope({
      tenantId,
      contextId: envelope.contextId as string,
      userId: typeof envelope.userId === 'string' ? envelope.userId : '',
      timestamp: typeof envelope.timestamp === 'number' ? envelope.timestamp : Date.now(),
      encrypted: envelope.encrypted === true,
      syncPolicy: typeof envelope.syncPolicy === 'string' ? envelope.syncPolicy : undefined,
      payload: envelope.payload,
    });

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('[sync/push]', err);
    return errorResponse(500, 'store_error', 'Failed to store sync envelope.', true);
  }
}
