import {
  cpExecCommand,
  errorResponse,
  jsonResponse,
  requireSession,
  resolveMachineId
} from '@/lib/bff';

export async function GET(request: Request) {
  const [token, authErr] = await requireSession();
  if (authErr) return authErr;

  const machineId = resolveMachineId();
  const url = new URL(request.url);
  const contextId = url.searchParams.get('contextId') ?? undefined;
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);

  try {
    const result = await cpExecCommand(token, machineId, 'listAuditEvents', {
      contextId,
      limit
    });

    if (!result.ok) {
      return errorResponse(502, 'audit_failed', result.error ?? 'Failed to list audit events', true);
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
