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

// ── PgStore ──────────────────────────────────────────────────────────────────

/**
 * Production Postgres-backed store.
 * Requires `pg` to be installed and DATABASE_URL to be set.
 */
export class PgStore implements Store {
  private pool: import('pg').Pool | null = null;

  private async getPool(): Promise<import('pg').Pool> {
    if (this.pool) return this.pool;
    const { Pool } = await import('pg');
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000
    });
    return this.pool;
  }

  async migrate(): Promise<void> {
    const pool = await this.getPool();
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const sql = readFileSync(
      join(process.cwd(), 'prisma', 'migrations', '001_control_plane.sql'),
      'utf8'
    );
    await pool.query(sql);
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  // ── Tenants ──

  async getTenant(tenantId: string): Promise<Tenant | null> {
    const pool = await this.getPool();
    const { rows } = await pool.query(
      'SELECT tenant_id, name, created_at, settings FROM tenants WHERE tenant_id = $1',
      [tenantId]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      tenantId: r.tenant_id,
      name: r.name,
      createdAt: new Date(r.created_at).getTime(),
      settings: r.settings ?? {}
    };
  }

  async createTenant(t: Omit<Tenant, 'createdAt'>): Promise<Tenant> {
    const pool = await this.getPool();
    const { rows } = await pool.query(
      `INSERT INTO tenants (tenant_id, name, settings) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id) DO UPDATE SET name = $2, settings = $3
       RETURNING tenant_id, name, created_at, settings`,
      [t.tenantId, t.name, JSON.stringify(t.settings)]
    );
    const r = rows[0];
    return {
      tenantId: r.tenant_id,
      name: r.name,
      createdAt: new Date(r.created_at).getTime(),
      settings: r.settings ?? {}
    };
  }

  // ── Connectors ──

  async getConnector(machineId: string): Promise<Connector | null> {
    const pool = await this.getPool();
    const { rows } = await pool.query(
      `SELECT machine_id, tenant_id, registration_id, stream_url, capabilities,
              posture, trust_level, trust_verified_at, registered_at, last_heartbeat_at
       FROM connectors WHERE machine_id = $1`,
      [machineId]
    );
    if (rows.length === 0) return null;
    return this.rowToConnector(rows[0]);
  }

  async getConnectorsByTenant(tenantId: string): Promise<Connector[]> {
    const pool = await this.getPool();
    const { rows } = await pool.query(
      `SELECT machine_id, tenant_id, registration_id, stream_url, capabilities,
              posture, trust_level, trust_verified_at, registered_at, last_heartbeat_at
       FROM connectors WHERE tenant_id = $1`,
      [tenantId]
    );
    return rows.map(r => this.rowToConnector(r));
  }

  async upsertConnector(c: Connector): Promise<Connector> {
    const pool = await this.getPool();
    await pool.query(
      `INSERT INTO connectors (machine_id, tenant_id, registration_id, stream_url, capabilities, posture, trust_level, trust_verified_at, registered_at, last_heartbeat_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (machine_id) DO UPDATE SET
         tenant_id = $2, registration_id = $3, stream_url = $4, capabilities = $5,
         posture = $6, trust_level = $7, trust_verified_at = $8, last_heartbeat_at = $10`,
      [c.machineId, c.tenantId, c.registrationId, c.streamUrl,
       JSON.stringify(c.capabilities), c.posture, c.trustLevel,
       c.trustVerifiedAt ? new Date(c.trustVerifiedAt) : null,
       new Date(c.registeredAt), c.lastHeartbeatAt ? new Date(c.lastHeartbeatAt) : null]
    );
    return c;
  }

  async updateHeartbeat(machineId: string, posture: string | null): Promise<boolean> {
    const pool = await this.getPool();
    const { rowCount } = await pool.query(
      'UPDATE connectors SET last_heartbeat_at = NOW(), posture = $2 WHERE machine_id = $1',
      [machineId, posture]
    );
    return (rowCount ?? 0) > 0;
  }

  // ── Commands ──

  async getQueue(machineId: string, afterCursor = 0, limit = 200): Promise<Command[]> {
    const pool = await this.getPool();
    const { rows } = await pool.query(
      `SELECT command_id, machine_id, cursor, tenant_id, context_id, method, params, created_at, status, result, error
       FROM commands WHERE machine_id = $1 AND status = 'pending' AND cursor > $2
       ORDER BY cursor ASC LIMIT $3`,
      [machineId, afterCursor, limit]
    );
    return rows.map(r => this.rowToCommand(r));
  }

  async getCommand(commandId: string): Promise<Command | null> {
    const pool = await this.getPool();
    const { rows } = await pool.query(
      `SELECT command_id, machine_id, cursor, tenant_id, context_id, method, params, created_at, status, result, error
       FROM commands WHERE command_id = $1`,
      [commandId]
    );
    if (rows.length === 0) return null;
    return this.rowToCommand(rows[0]);
  }

  async enqueueCommand(
    machineId: string,
    tenantId: string | null,
    method: string,
    params: Record<string, unknown>,
    contextId: string | null
  ): Promise<Command> {
    const pool = await this.getPool();
    const commandId = randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO commands (command_id, machine_id, tenant_id, context_id, method, params, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING command_id, machine_id, cursor, tenant_id, context_id, method, params, created_at, status, result, error`,
      [commandId, machineId, tenantId, contextId, method, JSON.stringify(params)]
    );
    return this.rowToCommand(rows[0]);
  }

  async ackCommand(
    machineId: string,
    commandId: string,
    status: 'applied' | 'failed',
    result?: unknown,
    error?: string
  ): Promise<boolean> {
    const pool = await this.getPool();
    const { rowCount } = await pool.query(
      `UPDATE commands SET status = $3, result = $4, error = $5
       WHERE command_id = $1 AND machine_id = $2`,
      [commandId, machineId, status, result ? JSON.stringify(result) : null, error ?? null]
    );
    return (rowCount ?? 0) > 0;
  }

  // ── Events ──

  async ingestEvents(entry: Omit<EventIngest, 'id' | 'receivedAt'>): Promise<EventIngest> {
    const pool = await this.getPool();
    const id = randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO events_ingest (id, machine_id, tenant_id, subscription_id, cursor, events)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, machine_id, tenant_id, subscription_id, cursor, events, received_at`,
      [id, entry.machineId, entry.tenantId, entry.subscriptionId, entry.cursor, JSON.stringify(entry.events)]
    );
    const r = rows[0];
    return {
      id: r.id,
      machineId: r.machine_id,
      tenantId: r.tenant_id,
      subscriptionId: r.subscription_id,
      cursor: Number(r.cursor),
      events: r.events,
      receivedAt: new Date(r.received_at).getTime()
    };
  }

  async getEvents(opts: { machineId?: string; tenantId?: string; limit?: number }): Promise<EventIngest[]> {
    const pool = await this.getPool();
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (opts.machineId) { conditions.push(`machine_id = $${idx++}`); values.push(opts.machineId); }
    if (opts.tenantId) { conditions.push(`tenant_id = $${idx++}`); values.push(opts.tenantId); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = opts.limit ?? 100;
    values.push(limit);
    const { rows } = await pool.query(
      `SELECT id, machine_id, tenant_id, subscription_id, cursor, events, received_at
       FROM events_ingest ${where} ORDER BY received_at DESC LIMIT $${idx}`,
      values
    );
    return rows.map(r => ({
      id: r.id,
      machineId: r.machine_id,
      tenantId: r.tenant_id,
      subscriptionId: r.subscription_id,
      cursor: Number(r.cursor),
      events: r.events,
      receivedAt: new Date(r.received_at).getTime()
    }));
  }

  // ── Trust ──

  async setTrustChallenge(machineId: string, nonce: string, ttlMs = 300_000): Promise<TrustChallenge> {
    const pool = await this.getPool();
    const expiresAt = new Date(Date.now() + ttlMs);
    await pool.query(
      `INSERT INTO trust_challenges (machine_id, nonce, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (machine_id) DO UPDATE SET nonce = $2, created_at = NOW(), expires_at = $3`,
      [machineId, nonce, expiresAt]
    );
    return { machineId, nonce, createdAt: Date.now(), expiresAt: expiresAt.getTime() };
  }

  async getTrustChallenge(machineId: string): Promise<TrustChallenge | null> {
    const pool = await this.getPool();
    const { rows } = await pool.query(
      'SELECT machine_id, nonce, created_at, expires_at FROM trust_challenges WHERE machine_id = $1 AND expires_at > NOW()',
      [machineId]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      machineId: r.machine_id,
      nonce: r.nonce,
      createdAt: new Date(r.created_at).getTime(),
      expiresAt: new Date(r.expires_at).getTime()
    };
  }

  async deleteTrustChallenge(machineId: string): Promise<void> {
    const pool = await this.getPool();
    await pool.query('DELETE FROM trust_challenges WHERE machine_id = $1', [machineId]);
  }

  // ── Helpers ──

  private rowToConnector(r: Record<string, unknown>): Connector {
    return {
      machineId: r.machine_id as string,
      tenantId: r.tenant_id as string | null,
      registrationId: r.registration_id as string,
      streamUrl: r.stream_url as string,
      capabilities: (r.capabilities as string[]) ?? [],
      posture: r.posture as string | null,
      trustLevel: (r.trust_level as string) ?? 'unverified',
      trustVerifiedAt: r.trust_verified_at ? new Date(r.trust_verified_at as string).getTime() : null,
      registeredAt: new Date(r.registered_at as string).getTime(),
      lastHeartbeatAt: r.last_heartbeat_at ? new Date(r.last_heartbeat_at as string).getTime() : null
    };
  }

  private rowToCommand(r: Record<string, unknown>): Command {
    return {
      commandId: r.command_id as string,
      machineId: r.machine_id as string,
      cursor: Number(r.cursor),
      tenantId: r.tenant_id as string | null,
      contextId: r.context_id as string | null,
      method: r.method as string,
      params: (r.params as Record<string, unknown>) ?? {},
      createdAt: new Date(r.created_at as string).getTime(),
      status: r.status as 'pending' | 'applied' | 'failed',
      result: r.result ?? null,
      error: r.error as string | undefined
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

  const usePg = process.env.DATABASE_URL && process.env.NODE_ENV === 'production';
  _store = usePg ? new PgStore() : new MemoryStore();
  return _store;
}

/** Reset the singleton (for testing). */
export function resetStore(): void {
  _store = null;
}
