import { errorResponse, jsonResponse, requireTenantSession } from '@/lib/bff';
import { getStore } from '@/lib/store';

export async function POST(request: Request) {
  const [, claims, authErr] = await requireTenantSession();
  if (authErr) return authErr;

  // tenantId is authoritative from the JWT — the token carries the tenant the
  // Auth0 Action assigned to this user at signup. Never trust the request body.
  const tenantId = claims.tenantId;

  if (!tenantId) {
    return errorResponse(
      403,
      'no_tenant',
      'No tenant associated with this account. Contact support.'
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // Empty body is fine — name is optional.
  }

  const name = typeof body.name === 'string' ? body.name : '';

  try {
    const store = getStore();
    const tenant = await store.createTenant({
      tenantId,
      name,
      settings:
        typeof body.settings === 'object' && body.settings
          ? (body.settings as Record<string, unknown>)
          : {}
    });

    return jsonResponse(tenant, 201);
  } catch (err) {
    return errorResponse(
      500,
      'store_error',
      err instanceof Error ? err.message : 'Store error',
      true
    );
  }
}
