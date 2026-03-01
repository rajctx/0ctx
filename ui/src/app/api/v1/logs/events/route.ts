import { getStore } from '@/lib/store';
import { requireTenantSession, errorResponse, jsonResponse } from '@/lib/bff';

export async function GET(request: Request) {
  const [, claims, authErr] = await requireTenantSession();
  if (authErr) return authErr;

  const tenantId = claims.tenantId;
  if (!tenantId) {
    return errorResponse(403, 'no_tenant', 'No tenant associated with this account.');
  }

  const url = new URL(request.url);
  const machineId = url.searchParams.get('machineId') ?? undefined;
  const limit = Math.min(500, Number(url.searchParams.get('limit') || '100'));

  try {
    const store = getStore();
    const events = await store.getEvents({ tenantId, machineId, limit });

    // Enrich with event count per batch and first event type preview
    const enriched = events.map(e => ({
      id: e.id,
      machineId: e.machineId,
      subscriptionId: e.subscriptionId,
      cursor: e.cursor,
      receivedAt: e.receivedAt,
      eventCount: Array.isArray(e.events) ? e.events.length : 0,
      firstEventType: Array.isArray(e.events) && e.events.length > 0
        ? ((e.events[0] as Record<string, unknown>)?.type as string ?? 'unknown')
        : 'unknown',
    }));

    return jsonResponse({ events: enriched, total: enriched.length });
  } catch (err) {
    console.error('[logs/events]', err);
    return errorResponse(500, 'store_error', 'Failed to fetch events.', true);
  }
}
