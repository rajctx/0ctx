import { errorResponse, jsonResponse, requireSession, resolveMachineId } from '@/lib/bff';
import { getStore } from '@/lib/store';

export async function GET(request: Request) {
  const [, authErr] = await requireSession();
  if (authErr) return authErr;

  const url = new URL(request.url);
  const machineId = url.searchParams.get('machineId') ?? resolveMachineId();
  const cursor = Number(url.searchParams.get('cursor') || '0');

  try {
    const store = getStore();
    const connector = await store.getConnector(machineId);

    if (!connector) {
      return errorResponse(404, 'not_found', 'Connector not registered');
    }

    const pending = await store.getQueue(machineId, cursor);
    const latestCursor = pending.length > 0 ? pending[pending.length - 1].cursor : cursor;

    return jsonResponse({
      cursor: latestCursor,
      commands: pending.map(cmd => ({
        commandId: cmd.commandId,
        cursor: cmd.cursor,
        contextId: cmd.contextId,
        method: cmd.method,
        params: cmd.params,
        createdAt: cmd.createdAt
      }))
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
