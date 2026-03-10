import { randomUUID } from 'crypto';
import { getPrisma } from '@/lib/prisma';
import type { Command, Connector, EventIngest, Store, StoredSyncEnvelope, Tenant, TrustChallenge } from '@/lib/store/types';
import { toCommand, toConnector, toSyncEnvelope } from '@/lib/store/prisma-mappers';

export class PrismaStore implements Store {
  private getClient() {
    return getPrisma();
  }

  async migrate(): Promise<void> { }

  async close(): Promise<void> {
    await this.getClient().$disconnect();
  }

  async getTenant(tenantId: string): Promise<Tenant | null> {
    const row = await this.getClient().tenant.findUnique({ where: { tenantId } });
    return row
      ? { tenantId: row.tenantId, name: row.name, createdAt: row.createdAt.getTime(), settings: (row.settings as Record<string, unknown>) ?? {} }
      : null;
  }

  async createTenant(tenant: Omit<Tenant, 'createdAt'>): Promise<Tenant> {
    const row = await this.getClient().tenant.upsert({
      where: { tenantId: tenant.tenantId },
      update: { name: tenant.name, settings: tenant.settings as object },
      create: { tenantId: tenant.tenantId, name: tenant.name, settings: tenant.settings as object },
    });
    return { tenantId: row.tenantId, name: row.name, createdAt: row.createdAt.getTime(), settings: (row.settings as Record<string, unknown>) ?? {} };
  }

  async getConnector(machineId: string, tenantId: string): Promise<Connector | null> {
    const row = await this.getClient().connector.findUnique({ where: { tenantId_machineId: { tenantId, machineId } } });
    return row ? toConnector(row) : null;
  }

  async getConnectorsByTenant(tenantId: string): Promise<Connector[]> {
    return (await this.getClient().connector.findMany({ where: { tenantId } })).map(toConnector);
  }

  async upsertConnector(connector: Connector): Promise<Connector> {
    await this.getClient().connector.upsert({
      where: { tenantId_machineId: { tenantId: connector.tenantId, machineId: connector.machineId } },
      update: {
        registrationId: connector.registrationId,
        streamUrl: connector.streamUrl,
        capabilities: connector.capabilities,
        posture: connector.posture,
        trustLevel: connector.trustLevel,
        trustVerifiedAt: connector.trustVerifiedAt ? new Date(connector.trustVerifiedAt) : null,
        lastHeartbeatAt: connector.lastHeartbeatAt ? new Date(connector.lastHeartbeatAt) : null,
      },
      create: {
        machineId: connector.machineId,
        tenantId: connector.tenantId,
        registrationId: connector.registrationId,
        streamUrl: connector.streamUrl,
        capabilities: connector.capabilities,
        posture: connector.posture,
        trustLevel: connector.trustLevel,
        trustVerifiedAt: connector.trustVerifiedAt ? new Date(connector.trustVerifiedAt) : null,
        registeredAt: new Date(connector.registeredAt),
        lastHeartbeatAt: connector.lastHeartbeatAt ? new Date(connector.lastHeartbeatAt) : null,
      },
    });
    return connector;
  }

  async updateHeartbeat(machineId: string, tenantId: string, posture: string | null): Promise<boolean> {
    try {
      await this.getClient().connector.update({ where: { tenantId_machineId: { tenantId, machineId } }, data: { lastHeartbeatAt: new Date(), posture } });
      return true;
    } catch {
      return false;
    }
  }

  async getQueue(machineId: string, tenantId: string, afterCursor = 0, limit = 200): Promise<Command[]> {
    const rows = await this.getClient().command.findMany({
      where: { machineId, tenantId, status: 'pending', cursor: { gt: BigInt(afterCursor) } },
      orderBy: { cursor: 'asc' },
      take: limit,
    });
    return rows.map(toCommand);
  }

  async listCommands(machineId: string, tenantId: string, options: { afterCursor?: number; limit?: number; status?: Array<Command['status']> } = {}): Promise<Command[]> {
    const afterCursor = options.afterCursor ?? 0;
    const limit = options.limit ?? 200;
    const rows = await this.getClient().command.findMany({
      where: {
        machineId,
        tenantId,
        ...(options.status && options.status.length > 0 ? { status: { in: options.status } } : {}),
        cursor: { gt: BigInt(afterCursor) },
      },
      orderBy: { cursor: 'asc' },
      take: Math.min(limit, 500),
    });
    return rows.map(toCommand);
  }

  async getCommand(commandId: string): Promise<Command | null> {
    const row = await this.getClient().command.findUnique({ where: { commandId } });
    return row ? toCommand(row) : null;
  }

  async enqueueCommand(machineId: string, tenantId: string, method: string, params: Record<string, unknown>, contextId: string | null): Promise<Command> {
    const row = await this.getClient().command.create({
      data: { commandId: randomUUID(), machineId, tenantId, contextId, method, params: params as object, status: 'pending' },
    });
    return toCommand(row);
  }

  async ackCommand(machineId: string, tenantId: string, commandId: string, status: 'applied' | 'failed', result?: unknown, error?: string): Promise<boolean> {
    try {
      await this.getClient().command.updateMany({
        where: { commandId, machineId, tenantId },
        data: { status, result: result !== undefined ? (result as object) : undefined, error: error ?? null },
      });
      return true;
    } catch {
      return false;
    }
  }

  async ingestEvents(entry: Omit<EventIngest, 'id' | 'receivedAt'>): Promise<EventIngest> {
    const row = await this.getClient().eventsIngest.create({
      data: {
        id: randomUUID(),
        machineId: entry.machineId,
        tenantId: entry.tenantId,
        subscriptionId: entry.subscriptionId,
        cursor: BigInt(entry.cursor),
        events: entry.events as object[],
      },
    });
    return { id: row.id, machineId: row.machineId, tenantId: row.tenantId, subscriptionId: row.subscriptionId, cursor: Number(row.cursor), events: row.events as unknown[], receivedAt: row.receivedAt.getTime() };
  }

  async getEvents(opts: { machineId?: string; tenantId?: string; limit?: number }): Promise<EventIngest[]> {
    const where: Record<string, unknown> = {};
    if (opts.machineId) where.machineId = opts.machineId;
    if (opts.tenantId) where.tenantId = opts.tenantId;
    const rows = await this.getClient().eventsIngest.findMany({ where, orderBy: { receivedAt: 'desc' }, take: opts.limit ?? 100 });
    return rows.map((row) => ({ id: row.id, machineId: row.machineId, tenantId: row.tenantId, subscriptionId: row.subscriptionId, cursor: Number(row.cursor), events: row.events as unknown[], receivedAt: row.receivedAt.getTime() }));
  }

  async setTrustChallenge(machineId: string, tenantId: string, nonce: string, ttlMs = 300_000): Promise<TrustChallenge> {
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.getClient().trustChallenge.upsert({
      where: { tenantId_machineId: { tenantId, machineId } },
      update: { nonce, createdAt: new Date(), expiresAt },
      create: { machineId, tenantId, nonce, expiresAt },
    });
    return { machineId, tenantId, nonce, createdAt: Date.now(), expiresAt: expiresAt.getTime() };
  }

  async getTrustChallenge(machineId: string, tenantId: string): Promise<TrustChallenge | null> {
    const row = await this.getClient().trustChallenge.findUnique({ where: { tenantId_machineId: { tenantId, machineId } } });
    return row && Date.now() <= row.expiresAt.getTime()
      ? { machineId: row.machineId, tenantId: row.tenantId, nonce: row.nonce, createdAt: row.createdAt.getTime(), expiresAt: row.expiresAt.getTime() }
      : null;
  }

  async deleteTrustChallenge(machineId: string, tenantId: string): Promise<void> {
    await this.getClient().trustChallenge.deleteMany({ where: { machineId, tenantId } });
  }

  async storeSyncEnvelope(envelope: Omit<StoredSyncEnvelope, 'id' | 'receivedAt'>): Promise<StoredSyncEnvelope> {
    const row = await this.getClient().syncEnvelope.create({
      data: { tenantId: envelope.tenantId, contextId: envelope.contextId, userId: envelope.userId, timestamp: BigInt(envelope.timestamp), encrypted: envelope.encrypted, syncPolicy: envelope.syncPolicy ?? null, payload: envelope.payload as object },
    });
    return toSyncEnvelope(row);
  }

  async getSyncEnvelopes(tenantId: string, since: number, limit = 50): Promise<StoredSyncEnvelope[]> {
    const rows = await this.getClient().syncEnvelope.findMany({
      where: { tenantId, timestamp: { gt: BigInt(since) } },
      orderBy: { timestamp: 'asc' },
      take: Math.min(limit, 200),
    });
    return rows.map(toSyncEnvelope);
  }
}
