import {
  storeExecCommand,
  errorResponse,
  jsonResponse,
  requireTenantSession
} from '@/lib/bff';
import { getStore } from '@/lib/store';

export async function POST(request: Request) {
  const [, claims, authErr] = await requireTenantSession();
  if (authErr) return authErr;

  const tenantId = claims.tenantId;
  if (!tenantId) {
    return errorResponse(403, 'no_tenant', 'No tenant associated with this account.');
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // Empty body is fine.
  }

  // The body.method field indicates which daemon command to run
  // (e.g. 'listContexts', 'getGraphData', 'doctor', etc.).
  // Default to 'doctor' for backward compatibility.
  const method = typeof body.method === 'string' ? body.method : 'doctor';

  // Resolve the target connector — use machineId from body if provided,
  // otherwise pick the first registered connector for this tenant.
  let machineId = typeof body.machineId === 'string' ? body.machineId : null;
  if (!machineId) {
    const store = getStore();
    const connectors = await store.getConnectorsByTenant(tenantId);
    if (connectors.length === 0) {
      return errorResponse(404, 'no_connector', 'No connectors registered for this tenant.');
    }
    machineId = connectors[0].machineId;
  }

  try {
    const result = await storeExecCommand(machineId, method, body, {
      tenantId,
      contextId: typeof body.contextId === 'string' ? body.contextId : undefined,
      timeoutMs: 15_000
    });

    if (!result.ok) {
      return errorResponse(502, 'command_failed', result.error ?? 'Command execution failed', true);
    }

    return jsonResponse(result.result);
  } catch (err) {
    return errorResponse(
      502,
      'command_bridge_error',
      err instanceof Error ? err.message : 'Command bridge error',
      true
    );
  }
}
