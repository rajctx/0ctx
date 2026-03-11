import {
  storeExecCommand,
  errorResponse,
  jsonResponse,
  requireTenantSession
} from '@/lib/bff';
import { GA_SUPPORTED_CLIENTS } from '@/app/actions/types';

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

  const machineId = typeof body.machineId === 'string' ? body.machineId : null;
  if (!machineId) {
    return errorResponse(400, 'invalid_request', 'machineId is required');
  }

  const clients = Array.isArray(body.clients) ? body.clients : [...GA_SUPPORTED_CLIENTS];
  const dryRun = body.dryRun === true;

  try {
    const result = await storeExecCommand(
      machineId,
      'bootstrap',
      { clients, dryRun, json: true },
      { tenantId }
    );

    if (!result.ok) {
      return errorResponse(502, 'bootstrap_failed', result.error ?? 'Bootstrap workflow failed', true);
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
