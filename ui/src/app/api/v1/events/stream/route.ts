import { requireTenantSession, errorResponse } from '@/lib/bff';
import { createEventStream } from '@/lib/events';

export async function GET(request: Request) {
  const [, claims, authErr] = await requireTenantSession();
  if (authErr) return authErr;

  const tenantId = claims.tenantId;
  if (!tenantId) {
    return errorResponse(403, 'no_tenant', 'No tenant associated with this account.');
  }

  const url = new URL(request.url);
  const machineId = url.searchParams.get('machineId') ?? undefined;

  // tenantId is always derived from the JWT — never trust query params.
  const stream = createEventStream({ machineId, tenantId });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}
