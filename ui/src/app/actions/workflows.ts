'use server';

import { bffGet, bffPost } from '@/lib/bff-client';
import { bffToCliResult, normalizeClients } from '@/app/actions/helpers';
import type { ConnectorStatusWorkflowResult, DoctorCheck, DoctorWorkflowResult, RuntimeStatusSnapshot, StatusWorkflowResult, WorkflowOptions } from '@/app/actions/types';

export async function runStatusWorkflow(): Promise<StatusWorkflowResult> {
  const res = await bffGet<RuntimeStatusSnapshot>('/api/v1/runtime/status');
  const base = bffToCliResult(res, 'status');
  const summary: Record<string, string> = {};
  if (res.data) {
    summary['posture'] = res.data.posture;
    summary['bridge'] = res.data.bridgeHealthy ? 'healthy' : 'degraded';
    summary['cloud'] = res.data.cloudConnected ? 'connected' : 'offline';
  }
  return { ...base, summary };
}

export async function runDoctorWorkflow(options: WorkflowOptions = {}): Promise<DoctorWorkflowResult> {
  const res = await bffPost<{ checks?: DoctorCheck[] }>('/api/v1/runtime/command', { method: 'doctor', clients: normalizeClients(options.clients) });
  const base = bffToCliResult(res, 'doctor');
  return { ...base, checks: Array.isArray(res.data?.checks) ? res.data.checks : [] };
}

export async function runConnectorStatusWorkflow(options: { requireBridge?: boolean; cloud?: boolean } = {}): Promise<ConnectorStatusWorkflowResult> {
  const res = await bffGet<Record<string, unknown>>('/api/v1/runtime/status');
  const base = bffToCliResult(res, 'connector-status');
  const data = res.data;
  const connectors = Array.isArray(data?.connectors) ? data.connectors as Array<Record<string, unknown>> : [];
  const primaryMachineId = typeof data?.defaultMachineId === 'string' ? data.defaultMachineId as string : (typeof connectors[0]?.machineId === 'string' ? connectors[0].machineId as string : null);
  return {
    ...base,
    payload: data ? {
      posture: data.posture,
      daemon: { running: data.bridgeHealthy },
      registration: { registered: data.bridgeHealthy, machineId: primaryMachineId },
      bridge: { healthy: data.bridgeHealthy },
      cloud: { connected: data.cloudConnected },
      connectors,
      defaultMachineId: primaryMachineId,
      runtime: { eventBridgeSupported: true, commandBridgeSupported: true, queue: { pending: 0, backoff: 0 } },
    } : null,
  };
}

export async function runConnectorVerifyWorkflow(options: { requireCloud?: boolean } = {}): Promise<ConnectorStatusWorkflowResult> {
  return runConnectorStatusWorkflow({ cloud: options.requireCloud });
}

export async function runConnectorRegisterWorkflow(options: { requireCloud?: boolean; force?: boolean } = {}): Promise<ConnectorStatusWorkflowResult> {
  const res = await bffPost<Record<string, unknown>>('/api/v1/connector/register', {});
  return { ...bffToCliResult(res, 'connector-register'), payload: res.data ?? null };
}
