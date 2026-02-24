import {
  cpFetch,
  cpJson,
  errorResponse,
  jsonResponse,
  requireSession,
  resolveMachineId
} from '@/lib/bff';

export async function GET() {
  const [token, authErr] = await requireSession();
  if (authErr) return authErr;

  const machineId = resolveMachineId();

  try {
    const [healthRes, capRes] = await Promise.all([
      cpFetch('/v1/health', { token }),
      cpFetch(`/v1/connectors/capabilities?machineId=${encodeURIComponent(machineId)}`, { token })
    ]);

    const health = await cpJson<Record<string, unknown>>(healthRes);
    const capabilities = await cpJson<{
      capabilities?: string[];
      posture?: string;
    }>(capRes);

    const posture = capabilities?.posture ?? (capRes.ok ? 'connected' : 'offline');
    const bridgeHealthy = capRes.ok && !!capabilities;
    const cloudConnected = healthRes.ok && health?.status === 'ok';

    return jsonResponse({
      posture,
      bridgeHealthy,
      cloudConnected,
      capabilities: capabilities?.capabilities ?? [],
      cloud: health ?? null
    });
  } catch (err) {
    return errorResponse(
      502,
      'control_plane_unreachable',
      err instanceof Error ? err.message : 'Control-plane unreachable',
      true
    );
  }
}
