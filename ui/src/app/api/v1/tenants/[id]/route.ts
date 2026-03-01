import { errorResponse, jsonResponse, requireTenantSession } from '@/lib/bff';
import { getStore } from '@/lib/store';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const [, claims, authErr] = await requireTenantSession();
  if (authErr) return authErr;

  const { id } = await params;
  if (!id) {
    return errorResponse(400, 'invalid_request', 'Tenant ID is required');
  }

  // Users can only read their own tenant.
  if (claims.tenantId && id !== claims.tenantId) {
    return errorResponse(403, 'forbidden', 'Access to this tenant is not allowed');
  }

  try {
    const store = getStore();
    const tenant = await store.getTenant(id);

    if (!tenant) {
      return errorResponse(404, 'not_found', 'Tenant not found');
    }

    const connectors = await store.getConnectorsByTenant(id);

    return jsonResponse({ ...tenant, connectors });
  } catch (err) {
    return errorResponse(
      500,
      'store_error',
      err instanceof Error ? err.message : 'Store error',
      true
    );
  }
}
