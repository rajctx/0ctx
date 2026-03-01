import { errorResponse, jsonResponse, requireTenantSession } from '@/lib/bff';
import { getStore } from '@/lib/store';

export async function GET(request: Request) {
  const [, claims, authErr] = await requireTenantSession();
  if (authErr) return authErr;

  const tenantId = claims.tenantId;
  if (!tenantId) {
    return errorResponse(403, 'no_tenant', 'No tenant associated with this account.');
  }

  const url = new URL(request.url);
  const machineId = url.searchParams.get('machineId');

  if (!machineId) {
    return errorResponse(400, 'invalid_request', 'machineId query param is required');
  }

  try {
    const store = getStore();
    // Composite lookup — 404 if this machine doesn't belong to this tenant.
    const connector = await store.getConnector(machineId, tenantId);
    if (!connector) {
      return errorResponse(404, 'not_found', 'Connector not registered');
    }

    return jsonResponse({
      capabilities: connector.capabilities,
      posture: connector.posture ?? 'degraded'
    });
  } catch (err) {
    return errorResponse(
      500,
      'store_error',
      err instanceof Error ? err.message : 'Store error',
      true
    );
  }
}
