import {
  storeExecCommand,
  errorResponse,
  jsonResponse,
  requireTenantSession,
  resolveTenantMachineId
} from '@/lib/bff';
import { getStore } from '@/lib/store';

const RUNTIME_COMMAND_TIMEOUT_MS = 45_000;

const ALLOWED_COMMAND_METHODS = new Set([
  'listContexts',
  'getGraphData',
  'createContext',
  'deleteContext',
  'addNode',
  'updateNode',
  'deleteNode',
  'listRecallFeedback',
  'recallFeedback',
  'evaluateCompletion',
  'listAuditEvents',
  'getSyncPolicy',
  'setSyncPolicy',
  'listBackups',
  'createBackup',
  'restoreBackup'
]);

function toDoctorChecks(connectorCount: number) {
  const checks = [
    {
      id: 'connector_registered',
      status: connectorCount > 0 ? 'pass' : 'fail',
      message: connectorCount > 0 ? `Connectors registered: ${connectorCount}` : 'No connectors registered.'
    }
  ];
  return { checks };
}

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

  const method = typeof body.method === 'string' ? body.method : 'doctor';
  if (method === 'doctor') {
    const store = getStore();
    const connectors = await store.getConnectorsByTenant(tenantId);
    return jsonResponse(toDoctorChecks(connectors.length));
  }

  if (!ALLOWED_COMMAND_METHODS.has(method)) {
    return errorResponse(400, 'unsupported_method', `Unsupported runtime command method: ${method}`);
  }

  const requestedMachineId = typeof body.machineId === 'string' ? body.machineId : null;
  const machineId = await resolveTenantMachineId(claims, requestedMachineId);
  if (!machineId) {
    return errorResponse(404, 'no_connector', 'No connectors registered for this tenant.');
  }

  try {
    const result = await storeExecCommand(machineId, method, body, {
      tenantId,
      contextId: typeof body.contextId === 'string' ? body.contextId : undefined,
      timeoutMs: RUNTIME_COMMAND_TIMEOUT_MS
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
