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

  const machineId = typeof body.machineId === 'string' ? body.machineId : null;
  const posture = typeof body.posture === 'string' ? body.posture : null;

  if (!machineId) {
    return errorResponse(400, 'invalid_request', 'machineId is required');
  }

  try {
    const store = getStore();
    // Composite lookup — 404 if this machine doesn't belong to this tenant.
    const connector = await store.getConnector(machineId, tenantId);
    if (!connector) {
      return errorResponse(404, 'not_found', 'Connector not registered');
    }

    const accepted = await store.updateHeartbeat(machineId, tenantId, posture);
    if (!accepted) {
      return errorResponse(404, 'not_found', 'Connector not registered');
    }

    return jsonResponse({ accepted: true, serverTime: new Date().toISOString() });
  } catch (err) {
    return errorResponse(
      500,
      'store_error',
      err instanceof Error ? err.message : 'Store error',
      true
    );
  }
}
