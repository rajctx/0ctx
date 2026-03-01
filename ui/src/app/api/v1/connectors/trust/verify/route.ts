import { errorResponse, jsonResponse, requireTenantSession } from '@/lib/bff';
import { getStore } from '@/lib/store';

export async function POST(request: Request) {
  const [, claims, authErr] = await requireTenantSession();
  if (authErr) return authErr;

  const tenantId = claims.tenantId;
  if (!tenantId) {
    return errorResponse(403, 'no_tenant', 'No tenant associated with this account.');
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse(400, 'invalid_body', 'Request body must be valid JSON');
  }

  const machineId = typeof body.machineId === 'string' ? body.machineId : null;
  const challengeResponse = typeof body.challengeResponse === 'string' ? body.challengeResponse : null;

  if (!machineId) {
    return errorResponse(400, 'invalid_request', 'machineId is required');
  }
  if (!challengeResponse) {
    return errorResponse(400, 'invalid_request', 'challengeResponse is required');
  }

  try {
    const store = getStore();
    // Composite lookup — 404 if this machine doesn't belong to this tenant.
    const connector = await store.getConnector(machineId, tenantId);
    if (!connector) {
      return errorResponse(400, 'invalid_request', 'Connector not registered');
    }

    const challenge = await store.getTrustChallenge(machineId, tenantId);
    if (!challenge) {
      return errorResponse(400, 'no_challenge', 'No pending trust challenge for this machine');
    }

    // Accept the challenge response (in production, verify HMAC signature)
    connector.trustLevel = 'verified';
    connector.trustVerifiedAt = Date.now();
    await store.upsertConnector(connector);
    await store.deleteTrustChallenge(machineId, tenantId);

    return jsonResponse({ accepted: true, trustLevel: 'verified' });
  } catch (err) {
    return errorResponse(
      500,
      'store_error',
      err instanceof Error ? err.message : 'Store error',
      true
    );
  }
}
