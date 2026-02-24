import {
  cpFetch,
  cpJson,
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

  try {
    const res = await cpFetch('/v1/connectors/register', {
      method: 'POST',
      token,
      body: {
        machineId,
        tenantId: body.tenantId ?? null
      }
    });

    const data = await cpJson<Record<string, unknown>>(res);

    if (!res.ok) {
      return errorResponse(
        res.status,
        'registration_failed',
        (data as Record<string, unknown>)?.message as string ?? 'Connector registration failed',
        true
      );
    }

    return jsonResponse(data);
  } catch (err) {
    return errorResponse(
      502,
      'control_plane_unreachable',
      err instanceof Error ? err.message : 'Control-plane unreachable',
      true
    );
  }
}
