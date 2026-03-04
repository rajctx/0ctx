import { errorResponse, jsonResponse, requireTenantSession } from '@/lib/bff';
import { getStore } from '@/lib/store';

export async function GET() {
  const [, claims, authErr] = await requireTenantSession();
  if (authErr) return authErr;

  try {
    const store = getStore();

    // Fetch all connectors registered for this tenant.
    const connectors = claims.tenantId
      ? await store.getConnectorsByTenant(claims.tenantId)
      : [];

    // Derive aggregate posture: connected > degraded > offline.
    let posture: string = 'offline';
    if (connectors.some(c => c.posture === 'connected')) {
      posture = 'connected';
    } else if (connectors.some(c => c.posture === 'degraded')) {
      posture = 'degraded';
    }

    const bridgeHealthy = connectors.length > 0;
    const capabilities = connectors.flatMap(c => c.capabilities ?? []);
    const uniqueCapabilities = [...new Set(capabilities)];
    const sortedConnectors = [...connectors].sort((a, b) => {
      const aTs = typeof a.lastHeartbeatAt === 'number' ? a.lastHeartbeatAt : 0;
      const bTs = typeof b.lastHeartbeatAt === 'number' ? b.lastHeartbeatAt : 0;
      if (bTs !== aTs) return bTs - aTs;
      return a.machineId.localeCompare(b.machineId);
    });
    const defaultMachineId = connectors.some(c => c.machineId === claims.sub)
      ? claims.sub
      : (sortedConnectors[0]?.machineId ?? null);

    return jsonResponse({
      posture,
      bridgeHealthy,
      cloudConnected: true, // In-process — always reachable
      capabilities: uniqueCapabilities,
      viewerMachineId: claims.sub || null,
      defaultMachineId,
      connectors: connectors.map(c => ({
        machineId: c.machineId,
        posture: c.posture ?? 'offline',
        lastHeartbeatAt: c.lastHeartbeatAt
      })),
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
