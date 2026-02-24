import {
  cpExecCommand,
  errorResponse,
  jsonResponse,
  requireSession,
  resolveMachineId
} from '@/lib/bff';

export async function GET() {
  const [token, authErr] = await requireSession();
  if (authErr) return authErr;

  const machineId = resolveMachineId();

  try {
    const result = await cpExecCommand(token, machineId, 'listBackups', {});

    if (!result.ok) {
      return errorResponse(502, 'backups_list_failed', result.error ?? 'Failed to list backups', true);
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

export async function POST(request: Request) {
  const [token, authErr] = await requireSession();
  if (authErr) return authErr;

  const machineId = resolveMachineId();
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse(400, 'invalid_body', 'Request body must be valid JSON');
  }

  const contextId = body.contextId as string;
  if (!contextId) {
    return errorResponse(400, 'invalid_request', 'contextId is required');
  }

  try {
    const result = await cpExecCommand(
      token,
      machineId,
      'createBackup',
      {
        contextId,
        name: body.name ?? undefined,
        encrypted: body.encrypted !== false
      },
      { contextId }
    );

    if (!result.ok) {
      return errorResponse(502, 'backup_create_failed', result.error ?? 'Failed to create backup', true);
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
