import {
  cpExecCommand,
  errorResponse,
  jsonResponse,
  requireSession,
  resolveMachineId
} from '@/lib/bff';
import type { SyncPolicy } from '@/lib/bff';

const VALID_POLICIES: SyncPolicy[] = ['local_only', 'metadata_only', 'full_sync'];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ contextId: string }> }
) {
  const [token, authErr] = await requireSession();
  if (authErr) return authErr;

  const { contextId } = await params;
  if (!contextId) {
    return errorResponse(400, 'invalid_request', 'contextId is required');
  }

  const machineId = resolveMachineId();

  try {
    const result = await cpExecCommand(token, machineId, 'getSyncPolicy', { contextId }, { contextId });

    if (!result.ok) {
      return errorResponse(502, 'get_sync_policy_failed', result.error ?? 'Failed to get sync policy', true);
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

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ contextId: string }> }
) {
  const [token, authErr] = await requireSession();
  if (authErr) return authErr;

  const { contextId } = await params;
  if (!contextId) {
    return errorResponse(400, 'invalid_request', 'contextId is required');
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse(400, 'invalid_body', 'Request body must be valid JSON');
  }

  const syncPolicy = body.syncPolicy as string;
  if (!syncPolicy || !VALID_POLICIES.includes(syncPolicy as SyncPolicy)) {
    return errorResponse(400, 'invalid_policy', `syncPolicy must be one of: ${VALID_POLICIES.join(', ')}`);
  }

  const machineId = resolveMachineId();

  try {
    const result = await cpExecCommand(
      token,
      machineId,
      'setSyncPolicy',
      { contextId, syncPolicy },
      { contextId }
    );

    if (!result.ok) {
      return errorResponse(502, 'set_sync_policy_failed', result.error ?? 'Failed to set sync policy', true);
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
