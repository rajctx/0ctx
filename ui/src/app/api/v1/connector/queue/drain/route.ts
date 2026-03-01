import {
  storeExecCommand,
  errorResponse,
  jsonResponse,
  requireTenantSession
} from '@/lib/bff';

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

  const timeoutMs = typeof body.timeoutMs === 'number' ? Math.max(1000, body.timeoutMs) : 120_000;

  try {
    const result = await storeExecCommand(
      machineId,
      'connectorQueueDrain',
      { wait: true, strict: body.strict === true, timeoutMs },
      { timeoutMs: timeoutMs + 10_000, tenantId }
    );

    if (!result.ok) {
      return errorResponse(502, 'drain_failed', result.error ?? 'Queue drain failed', true);
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
