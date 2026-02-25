/**
 * CLOUD-002: Persistence store for control-plane data.
 *
 * Provides an abstract Store interface with two backends:
 *   - MemoryStore  — default for NODE_ENV=development / tests
 *   - PgStore      — uses `pg` pool via DATABASE_URL for production
 *
 * Usage:
 *   import { getStore } from '@/lib/store';
 *   const store = getStore();
 *   await store.upsertConnector({ machineId, ... });
 */

import { randomUUID } from 'crypto';

// ── Types ────────────────────────────────────────────────────────────────────

export interface Tenant {
  tenantId: string;
  name: string;
  createdAt: number;
  settings: Record<string, unknown>;
}

export interface Connector {
  machineId: string;
  tenantId: string | null;
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
  tenantId: string | null;
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
  tenantId: string | null;
  subscriptionId: string;
  cursor: number;
  events: unknown[];
  receivedAt: number;
}

export interface TrustChallenge {
  machineId: string;
  nonce: string;
  createdAt: number;
  expiresAt: number;
}

// ── Store interface ──────────────────────────────────────────────────────────

export interface Store {
  // Tenants
  getTenant(tenantId: string): Promise<Tenant | null>;
  createTenant(tenant: Omit<Tenant, 'createdAt'>): Promise<Tenant>;

  // Connectors
  getConnector(machineId: string): Promise<Connector | null>;
  getConnectorsByTenant(tenantId: string): Promise<Connector[]>;
  upsertConnector(connector: Connector): Promise<Connector>;
  updateHeartbeat(machineId: string, posture: string | null): Promise<boolean>;

  // Commands
  getQueue(machineId: string, afterCursor?: number, limit?: number): Promise<Command[]>;
  getCommand(commandId: string): Promise<Command | null>;
  enqueueCommand(
    machineId: string,
    tenantId: string | null,
    method: string,
    params: Record<string, unknown>,
    contextId: string | null
  ): Promise<Command>;
  ackCommand(
    machineId: string,
    commandId: string,
    status: 'applied' | 'failed',
    result?: unknown,
    error?: string
  ): Promise<boolean>;

  // Events
  ingestEvents(entry: Omit<EventIngest, 'id' | 'receivedAt'>): Promise<EventIngest>;
  getEvents(opts: { machineId?: string; tenantId?: string; limit?: number }): Promise<EventIngest[]>;

  // Trust
  setTrustChallenge(machineId: string, nonce: string, ttlMs?: number): Promise<TrustChallenge>;
  getTrustChallenge(machineId: string): Promise<TrustChallenge | null>;
  deleteTrustChallenge(machineId: string): Promise<void>;

  // Lifecycle
  migrate(): Promise<void>;
  close(): Promise<void>;
}

// ── MemoryStore ──────────────────────────────────────────────────────────────

const DEFAULT_CAPABILITIES = ['sync', 'blackboard', 'commands'];

export class MemoryStore implements Store {
  private tenants = new Map<string, Tenant>();
  private connectors = new Map<string, Connector>();
  private commandQueues = new Map<string, Command[]>();
  private eventLog: EventIngest[] = [];
  private trustChallenges = new Map<string, TrustChallenge>();
  private globalCursor = 0;

  async getTenant(tenantId: string): Promise<Tenant | null> {
    return this.tenants.get(tenantId) ?? null;
  }

  async createTenant(t: Omit<Tenant, 'createdAt'>): Promise<Tenant> {
    const tenant: Tenant = { ...t, createdAt: Date.now() };
    this.tenants.set(tenant.tenantId, tenant);
    return tenant;
  }

  async getConnector(machineId: string): Promise<Connector | null> {
    return this.connectors.get(machineId) ?? null;
  }

  async getConnectorsByTenant(tenantId: string): Promise<Connector[]> {
    return [...this.connectors.values()].filter(c => c.tenantId === tenantId);
  }

  async upsertConnector(connector: Connector): Promise<Connector> {
    this.connectors.set(connector.machineId, connector);
    return connector;
  }

  async updateHeartbeat(machineId: string, posture: string | null): Promise<boolean> {
    const c = this.connectors.get(machineId);
    if (!c) return false;
    c.lastHeartbeatAt = Date.now();
    c.posture = posture;
    return true;
  }

  async getQueue(machineId: string, afterCursor = 0, limit = 200): Promise<Command[]> {
    const queue = this.commandQueues.get(machineId) ?? [];
    return queue
      .filter(cmd => cmd.status === 'pending' && cmd.cursor > afterCursor)
      .slice(0, limit);
  }

  async getCommand(commandId: string): Promise<Command | null> {
    for (const queue of this.commandQueues.values()) {
      const cmd = queue.find(c => c.commandId === commandId);
      if (cmd) return cmd;
    }
    return null;
  }

  async enqueueCommand(
    machineId: string,
    tenantId: string | null,
    method: string,
    params: Record<string, unknown>,
    contextId: string | null
  ): Promise<Command> {
    if (!this.commandQueues.has(machineId)) {
      this.commandQueues.set(machineId, []);
    }
    const queue = this.commandQueues.get(machineId)!;
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
      result: null
    };
    queue.push(command);
    return command;
  }

  async ackCommand(
    machineId: string,
    commandId: string,
    status: 'applied' | 'failed',
    result?: unknown,
    error?: string
  ): Promise<boolean> {
    const queue = this.commandQueues.get(machineId) ?? [];
    const cmd = queue.find(c => c.commandId === commandId);
    if (!cmd) return false;
    cmd.status = status;
    cmd.result = result ?? null;
    cmd.error = error;
    return true;
  }

  async ingestEvents(entry: Omit<EventIngest, 'id' | 'receivedAt'>): Promise<EventIngest> {
    const ev: EventIngest = {
      ...entry,
      id: randomUUID(),
      receivedAt: Date.now()
    };
    this.eventLog.push(ev);
    return ev;
  }

  async getEvents(opts: { machineId?: string; tenantId?: string; limit?: number }): Promise<EventIngest[]> {
    let results = [...this.eventLog];
    if (opts.machineId) results = results.filter(e => e.machineId === opts.machineId);
    if (opts.tenantId) results = results.filter(e => e.tenantId === opts.tenantId);
    return results.slice(-(opts.limit ?? 100));
  }

  async setTrustChallenge(machineId: string, nonce: string, ttlMs = 300_000): Promise<TrustChallenge> {
    const challenge: TrustChallenge = {
      machineId,
      nonce,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs
    };
    this.trustChallenges.set(machineId, challenge);
    return challenge;
  }

  async getTrustChallenge(machineId: string): Promise<TrustChallenge | null> {
    const c = this.trustChallenges.get(machineId);
    if (!c) return null;
    if (Date.now() > c.expiresAt) {
      this.trustChallenges.delete(machineId);
      return null;
    }
    return c;
  }

  async deleteTrustChallenge(machineId: string): Promise<void> {
    this.trustChallenges.delete(machineId);
  }

  async migrate(): Promise<void> {
    // No-op for in-memory store
  }

  async close(): Promise<void> {
    this.tenants.clear();
    this.connectors.clear();
    this.commandQueues.clear();
    this.eventLog = [];
    this.trustChallenges.clear();
  }

  // ── MemoryStore helpers (for stats/health) ──

  get connectorCount(): number {
    return this.connectors.size;
  }

  get pendingCommandCount(): number {
    let count = 0;
    for (const queue of this.commandQueues.values()) {
      count += queue.filter(c => c.status === 'pending').length;
    }
    return count;
  }

  get totalCommandCount(): number {
    let count = 0;
    for (const queue of this.commandQueues.values()) {
      count += queue.length;
    }
    return count;
  }

  get eventCount(): number {
    return this.eventLog.length;
  }
}

// ── PrismaStore ──────────────────────────────────────────────────────────────

/**
 * Production Postgres-backed store using Prisma v7.
 * Requires DATABASE_URL to be set.
 */
export class PrismaStore implements Store {
  private getClient() {
    // Lazy import to avoid pulling Prisma into environments that don't need it
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { prisma } = require('@/lib/prisma') as { prisma: import('@/generated/prisma').PrismaClient };
    return prisma;
  }

  async migrate(): Promise<void> {
    // Prisma migrations are run via CLI (`prisma migrate deploy`).
    // This is a no-op at runtime.
  }

  async close(): Promise<void> {
    await this.getClient().$disconnect();
  }

  // ── Tenants ──

  async getTenant(tenantId: string): Promise<Tenant | null> {
    const row = await this.getClient().tenant.findUnique({ where: { tenantId } });
    if (!row) return null;
    return {
      tenantId: row.tenantId,
      name: row.name,
      createdAt: row.createdAt.getTime(),
      settings: (row.settings as Record<string, unknown>) ?? {}
    };
  }

  async createTenant(t: Omit<Tenant, 'createdAt'>): Promise<Tenant> {
    const row = await this.getClient().tenant.upsert({
      where: { tenantId: t.tenantId },
      update: { name: t.name, settings: t.settings as object },
      create: { tenantId: t.tenantId, name: t.name, settings: t.settings as object }
    });
    return {
      tenantId: row.tenantId,
      name: row.name,
      createdAt: row.createdAt.getTime(),
      settings: (row.settings as Record<string, unknown>) ?? {}
    };
  }

  // ── Connectors ──

  async getConnector(machineId: string): Promise<Connector | null> {
    const row = await this.getClient().connector.findUnique({ where: { machineId } });
    if (!row) return null;
    return this.toConnector(row);
  }

  async getConnectorsByTenant(tenantId: string): Promise<Connector[]> {
    const rows = await this.getClient().connector.findMany({ where: { tenantId } });
    return rows.map(r => this.toConnector(r));
  }

  async upsertConnector(c: Connector): Promise<Connector> {
    await this.getClient().connector.upsert({
      where: { machineId: c.machineId },
      update: {
        tenantId: c.tenantId,
        registrationId: c.registrationId,
        streamUrl: c.streamUrl,
        capabilities: c.capabilities,
        posture: c.posture,
        trustLevel: c.trustLevel,
        trustVerifiedAt: c.trustVerifiedAt ? new Date(c.trustVerifiedAt) : null,
        lastHeartbeatAt: c.lastHeartbeatAt ? new Date(c.lastHeartbeatAt) : null
      },
      create: {
        machineId: c.machineId,
        tenantId: c.tenantId,
        registrationId: c.registrationId,
        streamUrl: c.streamUrl,
        capabilities: c.capabilities,
        posture: c.posture,
        trustLevel: c.trustLevel,
        trustVerifiedAt: c.trustVerifiedAt ? new Date(c.trustVerifiedAt) : null,
        registeredAt: new Date(c.registeredAt),
        lastHeartbeatAt: c.lastHeartbeatAt ? new Date(c.lastHeartbeatAt) : null
      }
    });
    return c;
  }

  async updateHeartbeat(machineId: string, posture: string | null): Promise<boolean> {
    try {
      await this.getClient().connector.update({
        where: { machineId },
        data: { lastHeartbeatAt: new Date(), posture }
      });
      return true;
    } catch {
      return false;
    }
  }

  // ── Commands ──

  async getQueue(machineId: string, afterCursor = 0, limit = 200): Promise<Command[]> {
    const rows = await this.getClient().command.findMany({
      where: {
        machineId,
        status: 'pending',
        cursor: { gt: BigInt(afterCursor) }
      },
      orderBy: { cursor: 'asc' },
      take: limit
    });
    return rows.map(r => this.toCommand(r));
  }

  async getCommand(commandId: string): Promise<Command | null> {
    const row = await this.getClient().command.findUnique({ where: { commandId } });
    if (!row) return null;
    return this.toCommand(row);
  }

  async enqueueCommand(
    machineId: string,
    tenantId: string | null,
    method: string,
    params: Record<string, unknown>,
    contextId: string | null
  ): Promise<Command> {
    const commandId = randomUUID();
    const row = await this.getClient().command.create({
      data: {
        commandId,
        machineId,
        tenantId,
        contextId,
        method,
        params: params as object,
        status: 'pending'
      }
    });
    return this.toCommand(row);
  }

  async ackCommand(
    machineId: string,
    commandId: string,
    status: 'applied' | 'failed',
    result?: unknown,
    error?: string
  ): Promise<boolean> {
    try {
      await this.getClient().command.updateMany({
        where: { commandId, machineId },
        data: {
          status,
          result: result !== undefined ? (result as object) : undefined,
          error: error ?? null
        }
      });
      return true;
    } catch {
      return false;
    }
  }

  // ── Events ──

  async ingestEvents(entry: Omit<EventIngest, 'id' | 'receivedAt'>): Promise<EventIngest> {
    const id = randomUUID();
    const row = await this.getClient().eventsIngest.create({
      data: {
        id,
        machineId: entry.machineId,
        tenantId: entry.tenantId,
        subscriptionId: entry.subscriptionId,
        cursor: BigInt(entry.cursor),
        events: entry.events as object[]
      }
    });
    return {
      id: row.id,
      machineId: row.machineId,
      tenantId: row.tenantId,
      subscriptionId: row.subscriptionId,
      cursor: Number(row.cursor),
      events: row.events as unknown[],
      receivedAt: row.receivedAt.getTime()
    };
  }

  async getEvents(opts: { machineId?: string; tenantId?: string; limit?: number }): Promise<EventIngest[]> {
    const where: Record<string, unknown> = {};
    if (opts.machineId) where.machineId = opts.machineId;
    if (opts.tenantId) where.tenantId = opts.tenantId;

    const rows = await this.getClient().eventsIngest.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take: opts.limit ?? 100
    });

    return rows.map(r => ({
      id: r.id,
      machineId: r.machineId,
      tenantId: r.tenantId,
      subscriptionId: r.subscriptionId,
      cursor: Number(r.cursor),
      events: r.events as unknown[],
      receivedAt: r.receivedAt.getTime()
    }));
  }

  // ── Trust ──

  async setTrustChallenge(machineId: string, nonce: string, ttlMs = 300_000): Promise<TrustChallenge> {
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.getClient().trustChallenge.upsert({
      where: { machineId },
      update: { nonce, createdAt: new Date(), expiresAt },
      create: { machineId, nonce, expiresAt }
    });
    return { machineId, nonce, createdAt: Date.now(), expiresAt: expiresAt.getTime() };
  }

  async getTrustChallenge(machineId: string): Promise<TrustChallenge | null> {
    const row = await this.getClient().trustChallenge.findUnique({ where: { machineId } });
    if (!row || Date.now() > row.expiresAt.getTime()) return null;
    return {
      machineId: row.machineId,
      nonce: row.nonce,
      createdAt: row.createdAt.getTime(),
      expiresAt: row.expiresAt.getTime()
    };
  }

  async deleteTrustChallenge(machineId: string): Promise<void> {
    await this.getClient().trustChallenge.deleteMany({ where: { machineId } });
  }

  // ── Helpers ──

  private toConnector(r: {
    machineId: string; tenantId: string | null; registrationId: string;
    streamUrl: string; capabilities: unknown; posture: string | null;
    trustLevel: string; trustVerifiedAt: Date | null; registeredAt: Date;
    lastHeartbeatAt: Date | null;
  }): Connector {
    return {
      machineId: r.machineId,
      tenantId: r.tenantId,
      registrationId: r.registrationId,
      streamUrl: r.streamUrl,
      capabilities: (r.capabilities as string[]) ?? [],
      posture: r.posture,
      trustLevel: r.trustLevel,
      trustVerifiedAt: r.trustVerifiedAt?.getTime() ?? null,
      registeredAt: r.registeredAt.getTime(),
      lastHeartbeatAt: r.lastHeartbeatAt?.getTime() ?? null
    };
  }

  private toCommand(r: {
    commandId: string; machineId: string; cursor: bigint;
    tenantId: string | null; contextId: string | null; method: string;
    params: unknown; createdAt: Date; status: string;
    result: unknown; error: string | null;
  }): Command {
    return {
      commandId: r.commandId,
      machineId: r.machineId,
      cursor: Number(r.cursor),
      tenantId: r.tenantId,
      contextId: r.contextId,
      method: r.method,
      params: (r.params as Record<string, unknown>) ?? {},
      createdAt: r.createdAt.getTime(),
      status: r.status as 'pending' | 'applied' | 'failed',
      result: r.result ?? null,
      error: r.error ?? undefined
    };
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

let _store: Store | null = null;

/**
 * Get the singleton store instance.
 * Uses PgStore when DATABASE_URL is set and NODE_ENV=production,
 * otherwise falls back to MemoryStore.
 */
export function getStore(): Store {
  if (_store) return _store;

  const usePrisma = process.env.DATABASE_URL && process.env.NODE_ENV === 'production';
  _store = usePrisma ? new PrismaStore() : new MemoryStore();
  return _store;
}

/** Reset the singleton (for testing). */
export function resetStore(): void {
  _store = null;
}
