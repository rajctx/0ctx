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
  const filterMachineId = url.searchParams.get('machineId') ?? undefined;
  const filterStatus = url.searchParams.get('status') ?? undefined;
  const limit = Math.min(500, Number(url.searchParams.get('limit') || '150'));

  try {
    const store = getStore();
    const connectors = await store.getConnectorsByTenant(tenantId);

    // For each connector, fetch their full queue (cursor=0 = all commands)
    const queues = await Promise.all(
      connectors
        .filter(c => !filterMachineId || c.machineId === filterMachineId)
        .map(c => store.getQueue(c.machineId, tenantId, 0, 500))
    );

    let allCommands = queues.flat();

    if (filterStatus) {
      allCommands = allCommands.filter(c => c.status === filterStatus);
    }

    // Sort newest first (highest cursor = most recent)
    allCommands.sort((a, b) => b.cursor - a.cursor);
    allCommands = allCommands.slice(0, limit);

    const counts = {
      pending: allCommands.filter(c => c.status === 'pending').length,
      applied: allCommands.filter(c => c.status === 'applied').length,
      failed:  allCommands.filter(c => c.status === 'failed').length,
    };

    return jsonResponse({ commands: allCommands, counts, total: allCommands.length });
  } catch (err) {
    console.error('[logs/commands]', err);
    return errorResponse(500, 'store_error', 'Failed to fetch commands.', true);
  }
}
