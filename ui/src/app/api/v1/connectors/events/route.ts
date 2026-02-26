import { errorResponse, jsonResponse, requireSession, resolveMachineId } from '@/lib/bff';
import { getStore } from '@/lib/store';
import { emitEvent } from '@/lib/events';

export async function POST(request: Request) {
  const [, authErr] = await requireSession();
  if (authErr) return authErr;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse(400, 'invalid_body', 'Request body must be valid JSON');
  }

  const machineId = typeof body.machineId === 'string' ? body.machineId : resolveMachineId();

  try {
    const store = getStore();
    const connector = await store.getConnector(machineId);

    if (!connector) {
      return errorResponse(404, 'not_found', 'Connector not registered');
    }

    const events = Array.isArray(body.events) ? body.events : [];
    const entry = await store.ingestEvents({
      machineId,
      tenantId: typeof body.tenantId === 'string' ? body.tenantId : null,
      subscriptionId: typeof body.subscriptionId === 'string' ? body.subscriptionId : '',
      cursor: typeof body.cursor === 'number' ? body.cursor : 0,
      events
    });

    // Fan-out to SSE subscribers
    emitEvent(entry);

    return jsonResponse({ accepted: true, processed: events.length });
  } catch (err) {
    return errorResponse(
      500,
      'store_error',
      err instanceof Error ? err.message : 'Store error',
      true
    );
  }
}
