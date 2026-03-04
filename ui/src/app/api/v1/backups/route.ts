import {
  storeExecCommand,
  errorResponse,
  jsonResponse,
  requireTenantSession,
  resolveTenantMachineId
} from '@/lib/bff';

export async function GET(request: Request) {
  const [, claims, authErr] = await requireTenantSession();
  if (authErr) return authErr;

  const tenantId = claims.tenantId;
  if (!tenantId) {
    return errorResponse(403, 'no_tenant', 'No tenant associated with this account.');
  }

  const url = new URL(request.url);
  const requestedMachineId = url.searchParams.get('machineId');
  const machineId = await resolveTenantMachineId(claims, requestedMachineId);
  if (!machineId) {
    return errorResponse(404, 'no_connector', 'No connector available for this tenant.');
  }

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

  const action = typeof body.action === 'string' ? body.action : 'create';
  const requestedMachineId = typeof body.machineId === 'string' ? body.machineId : null;
  const machineId = await resolveTenantMachineId(claims, requestedMachineId);
  if (!machineId) {
    return errorResponse(404, 'no_connector', 'No connector available for this tenant.');
  }

  try {
    if (action === 'restore') {
      const fileName = typeof body.fileName === 'string' ? body.fileName : '';
      if (!fileName) {
        return errorResponse(400, 'invalid_request', 'fileName is required for restore action');
      }

      const result = await storeExecCommand(
        machineId,
        'restoreBackup',
        {
          fileName,
          name: body.name ?? undefined
        },
        { tenantId }
      );

      if (!result.ok) {
        return errorResponse(502, 'backup_restore_failed', result.error ?? 'Failed to restore backup', true);
      }

      return jsonResponse(result.result);
    }

    const contextId = typeof body.contextId === 'string' ? body.contextId : null;
    if (!contextId) {
      return errorResponse(400, 'invalid_request', 'contextId is required');
    }

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

