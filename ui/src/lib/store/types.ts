export interface Tenant {
  tenantId: string;
  name: string;
  createdAt: number;
  settings: Record<string, unknown>;
}

export interface Connector {
  machineId: string;
  tenantId: string;
  registrationId: string;
  streamUrl: string;
  capabilities: string[];
  posture: string | null;
  trustLevel: string;
  trustVerifiedAt: number | null;
  registeredAt: number;
  lastHeartbeatAt: number | null;
}

export interface Command {
  commandId: string;
  machineId: string;
  cursor: number;
  tenantId: string;
  contextId: string | null;
  method: string;
  params: Record<string, unknown>;
  createdAt: number;
  status: 'pending' | 'applied' | 'failed';
  result: unknown;
  error?: string;
}

export interface EventIngest {
  id: string;
  machineId: string;
  tenantId: string;
  subscriptionId: string;
  cursor: number;
  events: unknown[];
  receivedAt: number;
}

export interface TrustChallenge {
  machineId: string;
  tenantId: string;
  nonce: string;
  createdAt: number;
  expiresAt: number;
}

export interface StoredSyncEnvelope {
  id: string;
  tenantId: string;
  contextId: string;
  userId: string;
  timestamp: number;
  encrypted: boolean;
  syncPolicy?: string;
  payload: unknown;
  receivedAt: number;
}

export interface Store {
  getTenant(tenantId: string): Promise<Tenant | null>;
  createTenant(tenant: Omit<Tenant, 'createdAt'>): Promise<Tenant>;
  getConnector(machineId: string, tenantId: string): Promise<Connector | null>;
  getConnectorsByTenant(tenantId: string): Promise<Connector[]>;
  upsertConnector(connector: Connector): Promise<Connector>;
  updateHeartbeat(machineId: string, tenantId: string, posture: string | null): Promise<boolean>;
  getQueue(machineId: string, tenantId: string, afterCursor?: number, limit?: number): Promise<Command[]>;
  listCommands(machineId: string, tenantId: string, options?: { afterCursor?: number; limit?: number; status?: Array<Command['status']> }): Promise<Command[]>;
  getCommand(commandId: string): Promise<Command | null>;
  enqueueCommand(machineId: string, tenantId: string, method: string, params: Record<string, unknown>, contextId: string | null): Promise<Command>;
  ackCommand(machineId: string, tenantId: string, commandId: string, status: 'applied' | 'failed', result?: unknown, error?: string): Promise<boolean>;
  ingestEvents(entry: Omit<EventIngest, 'id' | 'receivedAt'>): Promise<EventIngest>;
  getEvents(opts: { machineId?: string; tenantId?: string; limit?: number }): Promise<EventIngest[]>;
  setTrustChallenge(machineId: string, tenantId: string, nonce: string, ttlMs?: number): Promise<TrustChallenge>;
  getTrustChallenge(machineId: string, tenantId: string): Promise<TrustChallenge | null>;
  deleteTrustChallenge(machineId: string, tenantId: string): Promise<void>;
  storeSyncEnvelope(envelope: Omit<StoredSyncEnvelope, 'id' | 'receivedAt'>): Promise<StoredSyncEnvelope>;
  getSyncEnvelopes(tenantId: string, since: number, limit?: number): Promise<StoredSyncEnvelope[]>;
  migrate(): Promise<void>;
  close(): Promise<void>;
}
