import { randomUUID } from 'crypto';
import {
  errorResponse,
  jsonResponse,
  requireSession,
  resolveMachineId
} from '@/lib/bff';
import { getStore } from '@/lib/store';

export async function POST(request: Request) {
  const [, authErr] = await requireSession();
  if (authErr) return authErr;

  const machineId = resolveMachineId();
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // Empty body is fine.
  }

  try {
    const store = getStore();
    const tenantId = typeof body.tenantId === 'string' ? body.tenantId : null;
    const existing = await store.getConnector(machineId);

    const connector = existing ?? {
      machineId,
      tenantId,
      registrationId: `reg_${randomUUID()}`,
      streamUrl: '',
      capabilities: ['sync', 'blackboard', 'commands'],
      posture: null,
      trustLevel: 'unverified',
      trustVerifiedAt: null,
      registeredAt: Date.now(),
      lastHeartbeatAt: null
    };
    connector.tenantId = tenantId;

    await store.upsertConnector(connector);

    // Issue trust challenge nonce
    const nonce = randomUUID();
    await store.setTrustChallenge(machineId, nonce);

    return jsonResponse({
      registrationId: connector.registrationId,
      streamUrl: connector.streamUrl,
      capabilities: connector.capabilities,
      tenantId: connector.tenantId,
      trustChallenge: nonce,
      trustLevel: connector.trustLevel
    });
  } catch (err) {
    return errorResponse(
      502,
      'registration_failed',
      err instanceof Error ? err.message : 'Connector registration failed',
      true
    );
  }
}
