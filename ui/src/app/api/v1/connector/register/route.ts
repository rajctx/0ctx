import { randomUUID } from 'crypto';
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
    // Empty body is fine.
  }

  const machineId =
    typeof body.machineId === 'string' && body.machineId ? body.machineId : null;

  if (!machineId) {
    return errorResponse(400, 'invalid_request', 'machineId is required');
  }

  try {
    const store = getStore();
    // Composite lookup — only returns a connector owned by this tenant.
    const existing = await store.getConnector(machineId, tenantId);

    const connector = existing ?? {
      machineId,
      tenantId,
      registrationId: `reg_${randomUUID()}`,
      streamUrl: '',
      capabilities: ['sync', 'blackboard', 'commands'],
      posture: null,
      trustLevel: 'unverified',
      trustVerifiedAt: null,
      registeredAt: Date.now(),
      lastHeartbeatAt: null
    };

    await store.upsertConnector(connector);

    const nonce = randomUUID();
    await store.setTrustChallenge(machineId, tenantId, nonce);

    return jsonResponse({
      registrationId: connector.registrationId,
      streamUrl: connector.streamUrl,
      capabilities: connector.capabilities,
      tenantId: connector.tenantId,
      trustChallenge: nonce,
      trustLevel: connector.trustLevel
    });
  } catch (err) {
    return errorResponse(
      502,
      'registration_failed',
      err instanceof Error ? err.message : 'Connector registration failed',
      true
    );
  }
}
