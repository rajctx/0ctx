import {
  storeExecCommand,
  errorResponse,
  jsonResponse,
  requireTenantSession
} from '@/lib/bff';
import { getStore } from '@/lib/store';

export async function GET() {
  const [, claims, authErr] = await requireTenantSession();
  if (authErr) return authErr;

  const tenantId = claims.tenantId;
  if (!tenantId) {
    return errorResponse(403, 'no_tenant', 'No tenant associated with this account.');
  }

  const store = getStore();
  const connectors = await store.getConnectorsByTenant(tenantId);
  if (connectors.length === 0) {
    return errorResponse(404, 'no_connector', 'No connectors registered for this tenant.');
  }
  const machineId = connectors[0].machineId;

  try {
    const result = await storeExecCommand(machineId, 'auditVerify', {}, { tenantId });

    if (!result.ok) {
      return errorResponse(502, 'audit_verify_failed', result.error ?? 'Verification failed', true);
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
