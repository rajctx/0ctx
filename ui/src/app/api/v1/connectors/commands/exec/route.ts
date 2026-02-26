import { errorResponse, jsonResponse, requireSession, resolveMachineId, storeExecCommand } from '@/lib/bff';

export async function POST(request: Request) {
  const [, authErr] = await requireSession();
  if (authErr) return authErr;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse(400, 'invalid_body', 'Request body must be valid JSON');
  }

  const machineId = typeof body.machineId === 'string' ? body.machineId : resolveMachineId();
  const method = typeof body.method === 'string' ? body.method : null;

  if (!method) {
    return errorResponse(400, 'invalid_request', 'method is required');
  }

  try {
    const result = await storeExecCommand(
      machineId,
      method,
      typeof body.params === 'object' && body.params ? body.params as Record<string, unknown> : {},
      {
        contextId: typeof body.contextId === 'string' ? body.contextId : undefined,
        timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined,
        tenantId: typeof body.tenantId === 'string' ? body.tenantId : undefined
      }
    );

    return jsonResponse({
      ok: result.ok,
      commandId: null,
      status: result.ok ? 'applied' : 'failed',
      result: result.result,
      error: result.error ?? null
    });
  } catch (err) {
    return errorResponse(
      500,
      'store_error',
      err instanceof Error ? err.message : 'Store error',
      true
    );
  }
}
