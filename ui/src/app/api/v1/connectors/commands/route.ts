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
  const cursor = Number(url.searchParams.get('cursor') || '0');

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

    const pending = await store.getQueue(machineId, tenantId, cursor);
    const latestCursor = pending.length > 0 ? pending[pending.length - 1].cursor : cursor;

    return jsonResponse({
      cursor: latestCursor,
      commands: pending.map(cmd => ({
        commandId: cmd.commandId,
        cursor: cmd.cursor,
        contextId: cmd.contextId,
        method: cmd.method,
        params: cmd.params,
        createdAt: cmd.createdAt
      }))
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
