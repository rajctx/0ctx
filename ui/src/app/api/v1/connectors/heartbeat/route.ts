import { errorResponse, jsonResponse, requireSession, resolveMachineId } from '@/lib/bff';
import { getStore } from '@/lib/store';

export async function POST(request: Request) {
  const [, authErr] = await requireSession();
  if (authErr) return authErr;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // Empty body is fine.
  }

  const machineId = typeof body.machineId === 'string' ? body.machineId : resolveMachineId();
  const posture = typeof body.posture === 'string' ? body.posture : null;

  try {
    const store = getStore();
    const accepted = await store.updateHeartbeat(machineId, posture);

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
