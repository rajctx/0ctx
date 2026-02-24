import {
  cpExecCommand,
  errorResponse,
  jsonResponse,
  requireSession,
  resolveMachineId
} from '@/lib/bff';

export async function POST(request: Request) {
  const [token, authErr] = await requireSession();
  if (authErr) return authErr;

  const machineId = resolveMachineId();
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // Empty body is fine.
  }

  const timeoutMs = typeof body.timeoutMs === 'number' ? Math.max(1000, body.timeoutMs) : 120_000;

  try {
    const result = await cpExecCommand(
      token,
      machineId,
      'connectorQueueDrain',
      { wait: true, strict: body.strict === true, timeoutMs },
      { timeoutMs: timeoutMs + 10_000 }
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
