'use server';

import { bffGet, bffPut } from '@/lib/bff-client';
import type { AuthStatusSnapshot, CapabilitiesSnapshot, ConnectorStatusWorkflowResult, HealthSnapshot, MetricsSnapshot, RuntimeStatusSnapshot, SyncPolicy, SyncPolicySnapshot } from '@/app/actions/types';

export async function getRuntimeStatus(): Promise<RuntimeStatusSnapshot | null> {
  const res = await bffGet<RuntimeStatusSnapshot>('/api/v1/runtime/status');
  return res.data;
}

export async function getOperationalSnapshot(): Promise<{ health: HealthSnapshot | null; metrics: MetricsSnapshot | null; capabilities: CapabilitiesSnapshot | null; connectorStatus: ConnectorStatusWorkflowResult }> {
  const status = await getRuntimeStatus();
  if (!status) {
    const now = Date.now();
    return {
      health: null,
      metrics: null,
      capabilities: null,
      connectorStatus: { ok: false, command: 'bff', args: ['connector-status'], exitCode: 1, stdout: '', stderr: 'no status', startedAt: now, finishedAt: now, durationMs: 0, payload: null },
    };
  }

  const health: HealthSnapshot = { ok: status.bridgeHealthy && status.cloudConnected, status: status.posture, posture: status.posture, bridgeHealthy: status.bridgeHealthy, cloudConnected: status.cloudConnected };
  const metrics: MetricsSnapshot = { cloud: status.cloud } as MetricsSnapshot;
  const capabilities: CapabilitiesSnapshot = { methods: status.capabilities, apiVersion: '1' };
  const now = Date.now();
  const primaryMachineId = status.defaultMachineId ?? (status.connectors[0]?.machineId ?? null);
  const connectorStatus: ConnectorStatusWorkflowResult = {
    ok: true,
    command: 'bff',
    args: ['connector-status'],
    exitCode: 0,
    stdout: JSON.stringify(status),
    stderr: '',
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    payload: {
      posture: status.posture,
      daemon: { running: status.bridgeHealthy },
      registration: { registered: status.bridgeHealthy, machineId: primaryMachineId },
      bridge: { healthy: status.bridgeHealthy },
      cloud: { connected: status.cloudConnected },
      connectors: status.connectors,
      defaultMachineId: status.defaultMachineId ?? null,
      viewerMachineId: status.viewerMachineId ?? null,
      runtime: { eventBridgeSupported: true, commandBridgeSupported: true, queue: { pending: 0, backoff: 0 } },
    },
  };

  return { health, metrics, capabilities, connectorStatus };
}

export async function getHealth(): Promise<HealthSnapshot | null> {
  const status = await getRuntimeStatus();
  return status ? { ok: status.bridgeHealthy && status.cloudConnected, status: status.posture, posture: status.posture, bridgeHealthy: status.bridgeHealthy, cloudConnected: status.cloudConnected } : null;
}

export async function getMetricsSnapshot(): Promise<MetricsSnapshot | null> {
  const status = await getRuntimeStatus();
  return status ? ({ cloud: status.cloud } as MetricsSnapshot) : null;
}

export async function getCapabilities(): Promise<CapabilitiesSnapshot | null> {
  const status = await getRuntimeStatus();
  return status ? { methods: status.capabilities, apiVersion: '1' } : null;
}

export async function getAuthStatus(): Promise<AuthStatusSnapshot | null> {
  try {
    const { auth0 } = await import('@/lib/auth0');
    const session = await auth0.getSession();
    if (!session?.tokenSet?.accessToken) {
      return { authenticated: false, email: null, tenantId: null, expiresAt: null, tokenExpired: false };
    }

    const token = session.tokenSet.accessToken;
    const parts = token.split('.');
    let email: string | null = null;
    let tenantId: string | null = null;
    let expiresAt: number | null = null;
    let tokenExpired = false;

    if (parts.length >= 2) {
      try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
        tenantId = typeof payload['https://0ctx.com/tenant_id'] === 'string' ? payload['https://0ctx.com/tenant_id'] as string : null;
        email = typeof payload['https://0ctx.com/email'] === 'string' ? payload['https://0ctx.com/email'] as string : null;
        if (typeof payload.exp === 'number') {
          expiresAt = payload.exp * 1000;
          tokenExpired = Date.now() > expiresAt;
        }
      } catch { }
    }

    if (!email && session.user?.email) email = session.user.email as string;
    return { authenticated: true, email, tenantId, expiresAt, tokenExpired };
  } catch {
    return { authenticated: false, email: null, tenantId: null, expiresAt: null, tokenExpired: false };
  }
}

export async function getSyncPolicyAction(contextId: string, machineId?: string | null): Promise<SyncPolicySnapshot | null> {
  if (!contextId) return null;
  const params: Record<string, string> = {};
  if (machineId) params.machineId = machineId;
  const res = await bffGet<SyncPolicySnapshot>(`/api/v1/contexts/${encodeURIComponent(contextId)}/sync-policy`, { params });
  return res.data ?? null;
}

export async function setSyncPolicyAction(contextId: string, syncPolicy: SyncPolicy, machineId?: string | null): Promise<SyncPolicySnapshot | null> {
  if (!contextId) return null;
  const res = await bffPut<SyncPolicySnapshot>(`/api/v1/contexts/${encodeURIComponent(contextId)}/sync-policy`, { syncPolicy, machineId: machineId ?? undefined });
  return res.data ?? null;
}
