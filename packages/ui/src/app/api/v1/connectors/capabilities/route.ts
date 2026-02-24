import { errorResponse, jsonResponse, requireSession, resolveMachineId } from '@/lib/bff';
import { getStore } from '@/lib/store';

export async function GET(request: Request) {
  const [, authErr] = await requireSession();
  if (authErr) return authErr;

  const url = new URL(request.url);
  const machineId = url.searchParams.get('machineId') ?? resolveMachineId();

  try {
    const store = getStore();
    const connector = await store.getConnector(machineId);

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
