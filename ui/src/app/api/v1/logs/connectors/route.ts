import { getStore } from '@/lib/store';
import { requireTenantSession, errorResponse, jsonResponse } from '@/lib/bff';

export async function GET() {
  const [, claims, authErr] = await requireTenantSession();
  if (authErr) return authErr;

  const tenantId = claims.tenantId;
  if (!tenantId) {
    return errorResponse(403, 'no_tenant', 'No tenant associated with this account.');
  }

  try {
    const store = getStore();
    const connectors = await store.getConnectorsByTenant(tenantId);

    const now = Date.now();
    const enriched = connectors.map(c => ({
      machineId: c.machineId,
      posture: c.posture ?? 'offline',
      trustLevel: c.trustLevel,
      trustVerifiedAt: c.trustVerifiedAt,
      capabilities: c.capabilities,
      registeredAt: c.registeredAt,
      lastHeartbeatAt: c.lastHeartbeatAt,
      staleHeartbeat: c.lastHeartbeatAt !== null && (now - c.lastHeartbeatAt) > 2 * 60 * 1000,
    }));

    // Summary counts
    const counts = {
      total: enriched.length,
      connected: enriched.filter(c => c.posture === 'connected').length,
      degraded: enriched.filter(c => c.posture === 'degraded').length,
      offline: enriched.filter(c => c.posture === 'offline').length,
    };

    return jsonResponse({ connectors: enriched, counts });
  } catch (err) {
    console.error('[logs/connectors]', err);
    return errorResponse(500, 'store_error', 'Failed to fetch connectors.', true);
  }
}
