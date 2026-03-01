import { getStore } from '@/lib/store';
import { requireTenantSession, errorResponse, jsonResponse } from '@/lib/bff';

const startedAt = Date.now();

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

    const connected = connectors.filter(c => c.posture === 'connected').length;
    const degraded  = connectors.filter(c => c.posture === 'degraded').length;
    const offline   = connectors.filter(c => !c.posture || c.posture === 'offline').length;

    // Aggregate command counts across all connectors
    const queueResults = await Promise.all(
      connectors.map(c => store.getQueue(c.machineId, tenantId, 0, 500))
    );
    const allCmds = queueResults.flat();

    const commandCounts = {
      pending: allCmds.filter(c => c.status === 'pending').length,
      applied: allCmds.filter(c => c.status === 'applied').length,
      failed:  allCmds.filter(c => c.status === 'failed').length,
    };

    // Check for stale connectors (no heartbeat in 5 min)
    const now = Date.now();
    const staleConnectors = connectors
      .filter(c => !c.lastHeartbeatAt || (now - c.lastHeartbeatAt) > 5 * 60 * 1000)
      .map(c => ({ machineId: c.machineId, lastHeartbeatAt: c.lastHeartbeatAt }));

    const storeBackend = process.env.DATABASE_URL ? 'postgres' : 'memory';

    return jsonResponse({
      uptimeMs: now - startedAt,
      storeBackend,
      connectorCounts: { total: connectors.length, connected, degraded, offline },
      commandCounts,
      staleConnectors,
    });
  } catch (err) {
    console.error('[logs/health]', err);
    return errorResponse(500, 'store_error', 'Failed to fetch health data.', true);
  }
}
