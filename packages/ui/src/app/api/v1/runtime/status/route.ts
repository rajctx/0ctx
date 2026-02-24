import {
  errorResponse,
  jsonResponse,
  requireSession,
  resolveMachineId
} from '@/lib/bff';
import { getStore } from '@/lib/store';

export async function GET() {
  const [, authErr] = await requireSession();
  if (authErr) return authErr;

  const machineId = resolveMachineId();

  try {
    const store = getStore();
    const connector = await store.getConnector(machineId);

    const posture = connector?.posture ?? 'offline';
    const bridgeHealthy = !!connector;
    const cloudConnected = true; // In-process — always reachable

    return jsonResponse({
      posture,
      bridgeHealthy,
      cloudConnected,
      capabilities: connector?.capabilities ?? [],
      cloud: { status: 'ok' }
    });
  } catch (err) {
    return errorResponse(
      502,
      'store_error',
      err instanceof Error ? err.message : 'Store error',
      true
    );
  }
}
