import {
  storeExecCommand,
  errorResponse,
  jsonResponse,
  requireSession,
  resolveMachineId
} from '@/lib/bff';

export async function POST(request: Request) {
  const [, authErr] = await requireSession();
  if (authErr) return authErr;

  const machineId = resolveMachineId();
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // Empty body is fine.
  }

  const clients = Array.isArray(body.clients) ? body.clients : ['claude', 'cursor', 'windsurf'];

  try {
    const result = await storeExecCommand(machineId, 'repair', { clients });

    if (!result.ok) {
      return errorResponse(502, 'repair_failed', result.error ?? 'Repair workflow failed', true);
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
