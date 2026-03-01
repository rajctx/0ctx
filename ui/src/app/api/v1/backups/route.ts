import {
  storeExecCommand,
  errorResponse,
  jsonResponse,
  requireTenantSession
} from '@/lib/bff';

export async function GET() {
  const [, claims, authErr] = await requireTenantSession();
  if (authErr) return authErr;

  const tenantId = claims.tenantId;
  if (!tenantId) {
    return errorResponse(403, 'no_tenant', 'No tenant associated with this account.');
  }

  const machineId = claims.sub; // target the user's own machine via sub as fallback

  try {
    const result = await storeExecCommand(machineId, 'listBackups', {}, { tenantId });

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
    return errorResponse(400, 'invalid_body', 'Request body must be valid JSON');
  }

  const machineId = typeof body.machineId === 'string' ? body.machineId : null;
  const contextId = body.contextId as string;

  if (!machineId) {
    return errorResponse(400, 'invalid_request', 'machineId is required');
  }
  if (!contextId) {
    return errorResponse(400, 'invalid_request', 'contextId is required');
  }

  try {
    const result = await storeExecCommand(
      machineId,
      'createBackup',
      {
        contextId,
        name: body.name ?? undefined,
        encrypted: body.encrypted !== false
      },
      { contextId, tenantId }
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
