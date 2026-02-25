import { errorResponse, jsonResponse, requireSession } from '@/lib/bff';
import { getStore } from '@/lib/store';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const [, authErr] = await requireSession();
  if (authErr) return authErr;

  const { id } = await params;
  if (!id) {
    return errorResponse(400, 'invalid_request', 'Tenant ID is required');
  }

  try {
    const store = getStore();
    const tenant = await store.getTenant(id);

    if (!tenant) {
      return errorResponse(404, 'not_found', 'Tenant not found');
    }

    // Also return connectors scoped to this tenant
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
