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

  const clients = Array.isArray(body.clients) ? body.clients : ['claude', 'cursor', 'windsurf'];

  try {
    const result = await cpExecCommand(token, machineId, 'doctor', {
      clients,
      json: true
    });

    if (!result.ok) {
      return errorResponse(502, 'doctor_failed', result.error ?? 'Doctor workflow failed', true);
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
