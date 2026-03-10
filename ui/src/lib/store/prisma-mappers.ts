import type { Command, Connector, StoredSyncEnvelope } from '@/lib/store/types';

type ConnectorRow = {
  machineId: string;
  tenantId: string;
  registrationId: string;
  streamUrl: string;
  capabilities: unknown;
  posture: string | null;
  trustLevel: string;
  trustVerifiedAt: Date | null;
  registeredAt: Date;
  lastHeartbeatAt: Date | null;
};

type CommandRow = {
  commandId: string;
  machineId: string;
  cursor: bigint;
  tenantId: string;
  contextId: string | null;
  method: string;
  params: unknown;
  createdAt: Date;
  status: string;
  result: unknown;
  error: string | null;
};

type SyncEnvelopeRow = {
  id: string;
  tenantId: string;
  contextId: string;
  userId: string;
  timestamp: bigint;
  encrypted: boolean;
  syncPolicy: string | null;
  payload: unknown;
  receivedAt: Date;
};

export function toConnector(row: ConnectorRow): Connector {
  return {
    machineId: row.machineId,
    tenantId: row.tenantId,
    registrationId: row.registrationId,
    streamUrl: row.streamUrl,
    capabilities: (row.capabilities as string[]) ?? [],
    posture: row.posture,
    trustLevel: row.trustLevel,
    trustVerifiedAt: row.trustVerifiedAt?.getTime() ?? null,
    registeredAt: row.registeredAt.getTime(),
    lastHeartbeatAt: row.lastHeartbeatAt?.getTime() ?? null,
  };
}

export function toCommand(row: CommandRow): Command {
  return {
    commandId: row.commandId,
    machineId: row.machineId,
    cursor: Number(row.cursor),
    tenantId: row.tenantId,
    contextId: row.contextId,
    method: row.method,
    params: (row.params as Record<string, unknown>) ?? {},
    createdAt: row.createdAt.getTime(),
    status: row.status as 'pending' | 'applied' | 'failed',
    result: row.result ?? null,
    error: row.error ?? undefined,
  };
}

export function toSyncEnvelope(row: SyncEnvelopeRow): StoredSyncEnvelope {
  return {
    id: row.id,
    tenantId: row.tenantId,
    contextId: row.contextId,
    userId: row.userId,
    timestamp: Number(row.timestamp),
    encrypted: row.encrypted,
    syncPolicy: row.syncPolicy ?? undefined,
    payload: row.payload,
    receivedAt: row.receivedAt.getTime(),
  };
}
