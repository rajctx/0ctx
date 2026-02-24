import { errorResponse, jsonResponse, requireSession, resolveMachineId } from '@/lib/bff';
import { getStore } from '@/lib/store';

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
  const commandId = typeof body.commandId === 'string' ? body.commandId : null;

  if (!commandId) {
    return errorResponse(400, 'invalid_request', 'commandId is required');
  }

  try {
    const store = getStore();
    const status = body.status === 'failed' ? 'failed' as const : 'applied' as const;
    const accepted = await store.ackCommand(
      machineId,
      commandId,
      status,
      body.result,
      typeof body.error === 'string' ? body.error : undefined
    );

    if (!accepted) {
      return errorResponse(404, 'not_found', 'Command not found');
    }

    return jsonResponse({ accepted: true });
  } catch (err) {
    return errorResponse(
      500,
      'store_error',
      err instanceof Error ? err.message : 'Store error',
      true
    );
  }
}
