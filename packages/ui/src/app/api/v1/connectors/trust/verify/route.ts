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
  const challengeResponse = typeof body.challengeResponse === 'string' ? body.challengeResponse : null;

  if (!challengeResponse) {
    return errorResponse(400, 'invalid_request', 'challengeResponse is required');
  }

  try {
    const store = getStore();
    const connector = await store.getConnector(machineId);

    if (!connector) {
      return errorResponse(400, 'invalid_request', 'Connector not registered');
    }

    const challenge = await store.getTrustChallenge(machineId);
    if (!challenge) {
      return errorResponse(400, 'no_challenge', 'No pending trust challenge for this machine');
    }

    // Accept the challenge response (in production, verify HMAC signature)
    connector.trustLevel = 'verified';
    connector.trustVerifiedAt = Date.now();
    await store.upsertConnector(connector);
    await store.deleteTrustChallenge(machineId);

    return jsonResponse({ accepted: true, trustLevel: 'verified' });
  } catch (err) {
    return errorResponse(
      500,
      'store_error',
      err instanceof Error ? err.message : 'Store error',
      true
    );
  }
}
