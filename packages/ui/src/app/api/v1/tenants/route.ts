import { errorResponse, jsonResponse, requireSession } from '@/lib/bff';
import { getStore } from '@/lib/store';

export async function POST(request: Request) {
  const [, authErr] = await requireSession();
  if (authErr) return authErr;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse(400, 'invalid_body', 'Request body must be valid JSON');
  }

  const tenantId = typeof body.tenantId === 'string' ? body.tenantId : null;
  const name = typeof body.name === 'string' ? body.name : '';

  if (!tenantId) {
    return errorResponse(400, 'invalid_request', 'tenantId is required');
  }

  try {
    const store = getStore();
    const tenant = await store.createTenant({
      tenantId,
      name,
      settings: typeof body.settings === 'object' && body.settings ? body.settings as Record<string, unknown> : {}
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
