import { randomUUID } from 'crypto';
import type { Command, Connector, EventIngest, Store, StoredSyncEnvelope, Tenant, TrustChallenge } from '@/lib/store/types';
import { connectorKey } from '@/lib/store/shared';

export class MemoryStore implements Store {
  private tenants = new Map<string, Tenant>();
  private connectors = new Map<string, Connector>();
  private commandQueues = new Map<string, Command[]>();
  private eventLog: EventIngest[] = [];
  private trustChallenges = new Map<string, TrustChallenge>();
  private syncEnvelopes: StoredSyncEnvelope[] = [];
  private globalCursor = 0;

  async getTenant(tenantId: string): Promise<Tenant | null> {
    return this.tenants.get(tenantId) ?? null;
  }

  async createTenant(tenant: Omit<Tenant, 'createdAt'>): Promise<Tenant> {
    const created: Tenant = { ...tenant, createdAt: Date.now() };
    this.tenants.set(created.tenantId, created);
    return created;
  }

  async getConnector(machineId: string, tenantId: string): Promise<Connector | null> {
    return this.connectors.get(connectorKey(machineId, tenantId)) ?? null;
  }

  async getConnectorsByTenant(tenantId: string): Promise<Connector[]> {
    return [...this.connectors.values()].filter((connector) => connector.tenantId === tenantId);
  }

  async upsertConnector(connector: Connector): Promise<Connector> {
    this.connectors.set(connectorKey(connector.machineId, connector.tenantId), connector);
    return connector;
  }

  async updateHeartbeat(machineId: string, tenantId: string, posture: string | null): Promise<boolean> {
    const connector = this.connectors.get(connectorKey(machineId, tenantId));
    if (!connector) return false;
    connector.lastHeartbeatAt = Date.now();
    connector.posture = posture;
    return true;
  }

  async getQueue(machineId: string, tenantId: string, afterCursor = 0, limit = 200): Promise<Command[]> {
    const queue = this.commandQueues.get(connectorKey(machineId, tenantId)) ?? [];
    return queue.filter((command) => command.status === 'pending' && command.cursor > afterCursor).slice(0, limit);
  }

  async listCommands(machineId: string, tenantId: string, options: { afterCursor?: number; limit?: number; status?: Array<Command['status']> } = {}): Promise<Command[]> {
    const afterCursor = options.afterCursor ?? 0;
    const limit = options.limit ?? 200;
    const statuses = options.status && options.status.length > 0 ? new Set(options.status) : null;
    const queue = this.commandQueues.get(connectorKey(machineId, tenantId)) ?? [];
    return queue
      .filter((command) => command.cursor > afterCursor)
      .filter((command) => (statuses ? statuses.has(command.status) : true))
      .sort((left, right) => left.cursor - right.cursor)
      .slice(0, limit);
  }

  async getCommand(commandId: string): Promise<Command | null> {
    for (const queue of this.commandQueues.values()) {
      const command = queue.find((entry) => entry.commandId === commandId);
      if (command) return command;
    }
    return null;
  }

  async enqueueCommand(machineId: string, tenantId: string, method: string, params: Record<string, unknown>, contextId: string | null): Promise<Command> {
    const key = connectorKey(machineId, tenantId);
    const queue = this.commandQueues.get(key) ?? [];
    if (!this.commandQueues.has(key)) this.commandQueues.set(key, queue);

    const command: Command = {
      commandId: randomUUID(),
      machineId,
      cursor: ++this.globalCursor,
      tenantId,
      contextId,
      method,
      params,
      createdAt: Date.now(),
      status: 'pending',
      result: null,
    };
    queue.push(command);
    return command;
  }

  async ackCommand(machineId: string, tenantId: string, commandId: string, status: 'applied' | 'failed', result?: unknown, error?: string): Promise<boolean> {
    const queue = this.commandQueues.get(connectorKey(machineId, tenantId)) ?? [];
    const command = queue.find((entry) => entry.commandId === commandId);
    if (!command) return false;
    command.status = status;
    command.result = result ?? null;
    command.error = error;
    return true;
  }

  async ingestEvents(entry: Omit<EventIngest, 'id' | 'receivedAt'>): Promise<EventIngest> {
    const event: EventIngest = { ...entry, id: randomUUID(), receivedAt: Date.now() };
    this.eventLog.push(event);
    return event;
  }

  async getEvents(opts: { machineId?: string; tenantId?: string; limit?: number }): Promise<EventIngest[]> {
    let results = [...this.eventLog];
    if (opts.machineId) results = results.filter((event) => event.machineId === opts.machineId);
    if (opts.tenantId) results = results.filter((event) => event.tenantId === opts.tenantId);
    return results.slice(-(opts.limit ?? 100));
  }

  async setTrustChallenge(machineId: string, tenantId: string, nonce: string, ttlMs = 300_000): Promise<TrustChallenge> {
    const challenge: TrustChallenge = { machineId, tenantId, nonce, createdAt: Date.now(), expiresAt: Date.now() + ttlMs };
    this.trustChallenges.set(connectorKey(machineId, tenantId), challenge);
    return challenge;
  }

  async getTrustChallenge(machineId: string, tenantId: string): Promise<TrustChallenge | null> {
    const challenge = this.trustChallenges.get(connectorKey(machineId, tenantId));
    if (!challenge) return null;
    if (Date.now() > challenge.expiresAt) {
      this.trustChallenges.delete(connectorKey(machineId, tenantId));
      return null;
    }
    return challenge;
  }

  async deleteTrustChallenge(machineId: string, tenantId: string): Promise<void> {
    this.trustChallenges.delete(connectorKey(machineId, tenantId));
  }

  async storeSyncEnvelope(envelope: Omit<StoredSyncEnvelope, 'id' | 'receivedAt'>): Promise<StoredSyncEnvelope> {
    const stored: StoredSyncEnvelope = { ...envelope, id: randomUUID(), receivedAt: Date.now() };
    this.syncEnvelopes.push(stored);
    return stored;
  }

  async getSyncEnvelopes(tenantId: string, since: number, limit = 50): Promise<StoredSyncEnvelope[]> {
    return this.syncEnvelopes
      .filter((envelope) => envelope.tenantId === tenantId && envelope.timestamp > since)
      .sort((left, right) => left.timestamp - right.timestamp)
      .slice(0, limit);
  }

  async migrate(): Promise<void> { }

  async close(): Promise<void> {
    this.tenants.clear();
    this.connectors.clear();
    this.commandQueues.clear();
    this.eventLog = [];
    this.trustChallenges.clear();
    this.syncEnvelopes = [];
  }

  get connectorCount(): number { return this.connectors.size; }

  get pendingCommandCount(): number {
    let count = 0;
    for (const queue of this.commandQueues.values()) count += queue.filter((command) => command.status === 'pending').length;
    return count;
  }

  get totalCommandCount(): number {
    let count = 0;
    for (const queue of this.commandQueues.values()) count += queue.length;
    return count;
  }

  get eventCount(): number { return this.eventLog.length; }
}
